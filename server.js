const net = require('net')
const http = require('http')
const WebSocket = require('ws')

const tcpTunnel = require('./core/tcp-tunnel')
const wsHandler = require('./core/ws-handler')
const dashboard = require('./routes/dashboard')
const download = require('./routes/download')

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000

const wss = new WebSocket.Server({ noServer: true })
const tcpClients = new Map()
let wsTunnel = null

const httpServer = http.createServer((req, res) => {
    if (req.url === '/dashboard' || req.url.startsWith('/api/')) {
        dashboard.handle(req, res, { wsTunnel, tcpClients })
        return
    }
    if (req.url === '/download') {
        download.handle(req, res)
        return
    }
    if (!wsTunnel || wsTunnel.readyState !== WebSocket.OPEN) {
        dashboard.handle(req, res, { wsTunnel, tcpClients })
        return
    }
    // Le reste : relayé par le proxy TCP
})

const server = net.createServer(socket => {
    socket.once('data', buffer => {
        const str = buffer.toString()
        if (
            str.startsWith('GET /tunnel') ||
            str.startsWith('GET /dashboard') ||
            str.startsWith('GET /welcome') ||
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
        // TOUT LE RESTE DOIT ÊTRE TUNNELISÉ !
        if (wsTunnel && wsTunnel.readyState === 1) {
            tcpTunnel.forward(socket, buffer, wsTunnel, tcpClients)
            return
        }
        socket.destroy()
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
        for (const sock of tcpClients.values()) sock.destroy()
        tcpClients.clear()
        console.log('Tunnel WS fermé, attente d’un nouveau client...')
    })
    ws.on('error', () => {
        wsTunnel = null
        for (const sock of tcpClients.values()) sock.destroy()
        tcpClients.clear()
        console.log('Tunnel WS erreur, attente d’un nouveau client...')
    })
})

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur distant écoute sur port ${PORT}`)
    console.log('En attente d’un client tunnel WS sur /tunnel ...')
})
