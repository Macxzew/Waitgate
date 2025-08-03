const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Import config
const { DASH_USER, DASH_PASS, LOGIN_SECRET } = require('../config')

let sessionActive = false

const rawLoginHtml = fs.readFileSync(path.join(__dirname, '../views/login.html'), 'utf-8')
const panelHtml    = fs.readFileSync(path.join(__dirname, '../views/panel.html'), 'utf-8')
const indexHtml  = fs.readFileSync(path.join(__dirname, '../views/index.html'), 'utf-8')

// Injecte la clé b64 dans login.html
const loginHtml = rawLoginHtml.replace(
    '{{LOGIN_SECRET}}',
    Buffer.from(LOGIN_SECRET, 'hex').toString('base64')
)

// Déchiffrement
function decryptPass(encryptedB64, secret) {
    const input = Buffer.from(encryptedB64, 'base64')

    const iv = input.slice(0, 12)                  // 12 octets
    const dataWithTag = input.slice(12)           // data + tag

    const key = Buffer.from(secret, 'hex')        // LOGIN_SECRET = hex (256 bits)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)

    const tag = dataWithTag.slice(-16)            // 16 octets
    const data = dataWithTag.slice(0, -16)        // ciphertext

    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
    return decrypted.toString()
}

// Rendu dyn du panel
function renderPanel(ctx) {
    const tcpClientsSafe = ctx.tcpClients || new Map()
    return panelHtml
        .replace('{{TUNNEL_STATUS}}', ctx.wsTunnel ? 'EN LIGNE' : 'HORS LIGNE')
        .replace('{{EXPOSER_IP}}', ctx.wsTunnel ? ctx.wsTunnel._socket.remoteAddress : '-')
        .replace('{{USER_IPS}}',
            Array.from(tcpClientsSafe.values()).length === 0
                ? '<i>Personne</i>'
                : Array.from(tcpClientsSafe.values())
                    .map(sock => `<span class="chip">${sock.remoteAddress}</span>`).join(' ')
        )
}

// Handler principal
exports.handle = (req, res, ctx) => {
    const tcpClientsSafe = ctx.tcpClients || new Map()

    if (req.url === '/' || req.url === '/index') {
        let msg, wait
        if (!ctx.wsTunnel) {
            msg  = 'No services exposed at this time.'
            wait = 'Waiting for a client...'
        } else if (!tcpClientsSafe.size) {
            msg  = 'A tunnel is currently active.'
            wait = 'A client is connected..'
        } else {
            msg  = 'A tunnel is currently active.'
            wait = 'A client is connected.'
        }
        res.writeHead(200, {'Content-Type':'text/html'})
        return res.end(indexHtml.replace('{{MSG}}', msg).replace('{{WAIT}}', wait))
    }

    if (req.url === '/dashboard') {
        res.writeHead(200, {'Content-Type':'text/html'})
        return res.end(sessionActive ? renderPanel(ctx) : loginHtml)
    }

    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
            try {
                const { u, p } = JSON.parse(body)
                const decryptedPass = decryptPass(p, LOGIN_SECRET)

                if (u === DASH_USER && decryptedPass === DASH_PASS) {
                    sessionActive = true
                    res.writeHead(200, {'Content-Type':'application/json'})
                    return res.end(JSON.stringify({ ok: 1 }))
                }
            } catch (err) {
            }
            res.writeHead(200, {'Content-Type':'application/json'})
            res.end(JSON.stringify({ ok: 0 }))
        })
        return
    }

    if (req.url === '/api/logout' && req.method === 'POST') {
        sessionActive = false
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({ ok: 1 }))
    }

    if (req.url === '/download') {
        if (!sessionActive) {
            res.writeHead(401, {'Content-Type': 'text/plain'})
            return res.end('Authentication required.')
        }
        const download = require('./download')
        return download.handle(req, res)
    }

    if (req.url === '/api/wait-tunnel' && req.method === 'POST') {
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({ ok: 1 }))
    }

    if (req.url === '/api/status') {
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({
            tunnel: !!ctx.wsTunnel,
            exposerIp: ctx.wsTunnel ? ctx.wsTunnel._socket.remoteAddress : null,
            userIps: Array.from(tcpClientsSafe.values()).map(sock => sock.remoteAddress)
        }))
    }

    res.writeHead(404)
    res.end('Not found')
}
