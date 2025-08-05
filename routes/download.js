// routes/download.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TUNNEL_CHACHA_KEY } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsTemplate = `
const LOCAL_HOST = '127.0.0.1' // Service IP address to be exposed
const LOCAL_PORT = 443         // Service port to be exposed
const REMOTE_WS_URL = 'REPLACE_ME_REMOTE_WS_URL'
const CHACHA_KEY_HEX = 'REPLACE_ME_CHACHA_KEY'
const RETRY_DELAY = 3000

const { spawnSync } = require('child_process')
let wsLib
try {
    wsLib = require('ws')
} catch (e) {
    console.log('[INFO] ‘ws’ module missing, automatic installation...')
    const res = spawnSync(
        process.platform.startsWith('win') ? 'npm.cmd' : 'npm',
        ['install', 'ws'],
        { stdio: 'inherit' }
    )
    if (res.status !== 0) {
        console.error("[ERROR] Failed to install the ws module.")
        process.exit(1)
    }
    console.log('[OK] ‘ws’ module installed.')
    console.log('[INFO] Please restart this script: node client.js')
    process.exit(0)
}

const WebSocket = wsLib
const net = require('net')
const http = require('http')
const https = require('https')
const crypto = require('crypto')

const KEY = Buffer.from(CHACHA_KEY_HEX, 'hex')
const ALGO = 'chacha20-poly1305'
const IV_LEN = 12
const TAG_LEN = 16

function encrypt(plainBuf) {
    const iv = crypto.randomBytes(IV_LEN)
    const cipher = crypto.createCipheriv(ALGO, KEY, iv)
    const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, encrypted, tag])
}

function decrypt(payloadBuf) {
    const iv = payloadBuf.slice(0, IV_LEN)
    const tag = payloadBuf.slice(-TAG_LEN)
    const enc = payloadBuf.slice(IV_LEN, -TAG_LEN)
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()])
}

const localSockets = new Map()

// Handler proxy HTTP/HTTPS
function handleProxyHTTP(reqId, req, ws) {
    const options = {
        hostname: LOCAL_HOST,
        port: LOCAL_PORT,
        path: req.path,
        method: req.method,
        headers: req.headers
    }
    const mod = (LOCAL_PORT == 443 ? https : http)
    const proxyReq = mod.request(options, proxyRes => {
        let chunks = []
        proxyRes.on('data', d => chunks.push(d))
        proxyRes.on('end', () => {
            ws.send(JSON.stringify({
                reqId,
                status: proxyRes.statusCode,
                headers: proxyRes.headers,
                body: Buffer.concat(chunks).toString('base64')
            }))
        })
    })
    proxyReq.on('error', () => {
        ws.send(JSON.stringify({ reqId, status: 502 }))
    })
    if (req.body) proxyReq.write(Buffer.from(req.body, 'base64'))
    proxyReq.end()
}

// Handler TCP brut (MC, SSH, etc.)
class LocalTunnel {
    constructor(clientId, ws, payload) {
        this.clientId = clientId
        this.ws = ws
        this.payload = payload
        this.socket = null
        this.retryTimeout = null
        this.connect()
    }
    connect() {
        this.socket = net.connect(LOCAL_PORT, LOCAL_HOST)
        this.socket.on('connect', () => {
            localSockets.set(this.clientId, this.socket)
            try {
                this.socket.write(decrypt(Buffer.from(this.payload, 'base64')))
            } catch (e) {
                console.log('[ERROR] Initial decryption failed:', e)
            }
        })
        this.socket.on('data', chunk => {
            if (this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({
                    id: this.clientId,
                    data: encrypt(chunk).toString('base64')
                }))
            }
        })
        this.socket.on('close', () => {
            localSockets.delete(this.clientId)
            clearTimeout(this.retryTimeout)
        })
        this.socket.on('error', err => {
            localSockets.delete(this.clientId)
            if (err.code === 'ECONNREFUSED')
                this.retryTimeout = setTimeout(() => this.connect(), RETRY_DELAY)
        })
    }
}

function handleWSMessage(msg, ws) {
    let obj
    try {
        obj = JSON.parse(msg)
    } catch { return }

    if (obj.type === 'http-proxy' && obj.reqId && obj.req) {
        handleProxyHTTP(obj.reqId, obj.req, ws)
        return
    }

    const { id, data } = obj || {}
    if (!id || !data) return
    const socket = localSockets.get(id)
    if (!socket)
        new LocalTunnel(id, ws, data)
    else if (!socket.destroyed) {
        try {
            socket.write(decrypt(Buffer.from(data, 'base64')))
        } catch (e) {
            console.log('[ERR] Déchiffrement échoué :', e)
        }
    }
}

function connectWS() {
    const ws = new WebSocket(REMOTE_WS_URL)
    ws.on('open', () => {
        console.log('The WS tunnel is connected.')
    })
    ws.on('message', msg => {
        handleWSMessage(msg, ws)
    })
    ws.on('close', () => {
        console.log('Tunnel closed, reconnecting in 5 seconds.')
        for (const sock of localSockets.values())
            sock.destroy()
        localSockets.clear()
        setTimeout(connectWS, 5000)
    })
    ws.on('error', () => {
    })
}

connectWS()
`

// Récup token + clé dans .env
function getTunnelToken() {
  try {
    const envPath = path.resolve(__dirname, '../.env')
    if (!fs.existsSync(envPath)) return null
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const match = envContent.match(/^TUNNEL_TOKEN=(.+)$/m)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

export function handle(req, res) {
  const token = getTunnelToken()
  if (!token) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    return res.end('Tunnel token not configured. Please restart the server.')
  }

  const proto = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http')
  const host = req.headers['host']
  const wsProto = proto === 'https' ? 'wss' : 'ws'
  const wsUrl = `${wsProto}://${host}/tunnel?token=${token}`

  const jsFinal = jsTemplate
    .replace('REPLACE_ME_REMOTE_WS_URL', wsUrl)
    .replace('REPLACE_ME_CHACHA_KEY', TUNNEL_CHACHA_KEY)

  res.writeHead(200, {
    'Content-Type': 'application/javascript',
    'Content-Disposition': 'attachment; filename="client.js"'
  })
  res.end(jsFinal)
}
