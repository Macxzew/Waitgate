const jsTemplate = `
const LOCAL_HOST = '127.0.0.1' // <-- À éditer si besoin
const LOCAL_PORT = 80         // <-- Mets 443 pour HTTPS local !
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
const http = require('http')
const https = require('https')

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

// --- Connexion WebSocket ---
function connectWS() {
    const ws = new WebSocket(REMOTE_WS_URL)
    ws.on('open', () => {
        console.log('Tunnel WS connecté')
    })
    ws.on('message', msg => {
        try {
            const data = JSON.parse(msg)
            // Handler pour le proxy HTTP/HTTPS
            if (data.type === 'http-proxy' && data.reqId && data.req) {
                handleProxyHTTP(data.reqId, data.req, ws)
            }
        } catch (e) {}
    })
    ws.on('close', () => {
        console.log('Tunnel fermé, reconnexion dans 5s')
        setTimeout(connectWS, 5000)
    })
    ws.on('error', () => {
        // Optionnel : log debug
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
