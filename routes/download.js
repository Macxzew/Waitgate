const jsTemplate = `
const LOCAL_HOST = '127.0.0.1' // IP du service à exposer
const LOCAL_PORT = 80         // Port du service à exposer
const REMOTE_WS_URL = 'REPLACE_ME_REMOTE_WS_URL'
const RETRY_DELAY = 3000

const { spawnSync } = require('child_process')
let wsLib
try {
    wsLib = require('ws')
} catch (e) {
    console.log('[INFO] Module "ws" absent, installation automatique...')
    const res = spawnSync(
        process.platform.startsWith('win') ? 'npm.cmd' : 'npm',
        ['install', 'ws'],
        { stdio: 'inherit' }
    )
    if (res.status !== 0) {
        console.error("[ERREUR] Impossible d'installer le module ws.")
        process.exit(1)
    }
    console.log('[OK] Module "ws" installé.')
    console.log('[INFO] Veuillez relancer ce script : node client.js')
    process.exit(0)
}

const WebSocket = wsLib
const net = require('net')
const http = require('http')
const https = require('https')

const localSockets = new Map()

// --- Handler proxy HTTP/HTTPS ---
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

// --- Handler TCP brut (MC, SSH, etc.) ---
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
            this.socket.write(Buffer.from(this.payload, 'base64'))
        })
        this.socket.on('data', chunk => {
            if (this.ws.readyState === 1) {
                this.ws.send(JSON.stringify({
                    id: this.clientId,
                    data: chunk.toString('base64')
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
    else if (!socket.destroyed)
        socket.write(Buffer.from(data, 'base64'))
}

function connectWS() {
    const ws = new WebSocket(REMOTE_WS_URL)
    ws.on('open', () => {
        console.log('Tunnel WS connecté')
    })
    ws.on('message', msg => {
        handleWSMessage(msg, ws)
    })
    ws.on('close', () => {
        console.log('Tunnel fermé, reconnexion dans 5s')
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

exports.handle = (req, res) => {
    const proto = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http')
    const host = req.headers['host']
    const wsProto = proto === 'https' ? 'wss' : 'ws'
    const wsUrl = `${wsProto}://${host}/tunnel`
    const jsFinal = jsTemplate.replace('REPLACE_ME_REMOTE_WS_URL', wsUrl)
    res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Content-Disposition': 'attachment; filename="client.js"'
    })
    res.end(jsFinal)
}
