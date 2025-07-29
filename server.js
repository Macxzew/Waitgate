const net = require('net')
const http = require('http')
const WebSocket = require('ws')

const tcpTunnel = require('./core/tcp-tunnel')
const wsHandler = require('./core/ws-handler')
const dashboard = require('./routes/dashboard')
const download = require('./routes/download')

const PORT = 2000

const wss = new WebSocket.Server({ noServer: true })
const tcpClients = new Map()
let wsTunnel = null

const httpServer = http.createServer((req, res) => {
    // Sert panel.css et panel.js (via dashboard.js)
    if (req.url === '/panel.css' || req.url === '/panel.js') {
        dashboard.handle(req, res, { wsTunnel, tcpClients })
        return
    }
    // Dashboard et API
    if (req.url.startsWith('/dashboard') || req.url.startsWith('/api/')) {
        dashboard.handle(req, res, { wsTunnel, tcpClients })
        return
    }
    // Download du client
    if (req.url === '/download') {
        download.handle(req, res)
        return
    }
    // 404
    res.writeHead(404)
    res.end('Not found')
})

const server = net.createServer(socket => {
    socket.once('data', buffer => {
        const str = buffer.toString()
        // Toutes les requêtes HTTP/WS/Web (cf panel)
        if (
            str.startsWith('GET /tunnel') ||
            str.startsWith('GET /dashboard') ||
            str.startsWith('GET /panel.css') ||
            str.startsWith('GET /panel.js') ||
            str.startsWith('POST /api/login') ||
            str.startsWith('POST /api/logout') ||
            str.startsWith('POST /api/kill-tunnel') ||
            str.startsWith('POST /api/wait-tunnel') ||
            str.startsWith('GET /api/status') ||
            str.startsWith('GET /download')
        ) {
            socket.unshift(buffer)
            httpServer.emit('connection', socket)
            return
        }
        // Tunnel direct
        if (!wsTunnel || wsTunnel.readyState !== WebSocket.OPEN) {
            socket.destroy()
            return
        }
        tcpTunnel.forward(socket, buffer, wsTunnel, tcpClients)
    })
})

httpServer.on('upgrade', (req, socket, head) => {
    console.log('Upgrade HTTP reçu :', req.url)
    if (req.url === '/tunnel') {
        if (wsTunnel && wsTunnel.readyState === WebSocket.OPEN) {
            console.log('Tunnel déjà occupé, refuse la connexion.')
            socket.destroy()
            return
        }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
    } else {
        socket.destroy()
    }
})

wss.on('connection', ws => {
    wsTunnel = ws
    console.log('Tunnel WS ouvert.')
    wsHandler.handle(ws, tcpClients)
    ws.on('close', () => {
        wsTunnel = null
        console.log('Tunnel WS fermé, attente d’un nouveau client...')
    })
})

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur distant écoute sur port ${PORT}`)
    console.log('En attente d’un client tunnel WS sur /tunnel ...')
})
