const net = require('net')
const http = require('http')
const WebSocket = require('ws')

const tcpTunnel = require('./core/tcp-tunnel')
const wsHandler = require('./core/ws-handler')
const dashboard = require('./routes/dashboard')
const download = require('./routes/download')

// Prend le port Render.com si dispo sinon fallback local
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000

const wss = new WebSocket.Server({ noServer: true })
const tcpClients = new Map()
let wsTunnel = null

// --- HTTP pour admin, dashboard, API, accueil public (si pas de tunnel actif) ---
const httpServer = http.createServer((req, res) => {
    // Admin/Dashboard/API
    if (req.url === '/dashboard' || req.url.startsWith('/api/')) {
        dashboard.handle(req, res, { wsTunnel, tcpClients })
        return
    }
    // Download du client
    if (req.url === '/download') {
        download.handle(req, res)
        return
    }
    // Accueil/welcome : seulement si PAS de tunnel
    if (!wsTunnel || wsTunnel.readyState !== WebSocket.OPEN) {
        dashboard.handle(req, res, { wsTunnel, tcpClients })
        return
    }
    // Sinon, TOUT passe en relay TCP (ne pas répondre ici !)
})

// --- TCP entrypoint (reverse proxy brut sur tout sauf admin/API) ---
const server = net.createServer(socket => {
    socket.once('data', buffer => {
        const str = buffer.toString()
        // Routes admin/API/welcome traitées par httpServer
        if (
            str.startsWith('GET /tunnel')      ||
            str.startsWith('GET /dashboard')   ||
            str.startsWith('GET /welcome')     ||
            str.startsWith('GET / ')           ||
            str.startsWith('POST /api/login')  ||
            str.startsWith('POST /api/logout') ||
            str.startsWith('POST /api/kill-tunnel') ||
            str.startsWith('POST /api/wait-tunnel') ||
            str.startsWith('GET /api/status')  ||
            str.startsWith('GET /download')
        ) {
            socket.unshift(buffer)
            httpServer.emit('connection', socket)
            return
        }
        // Tunnel direct sinon (reverse proxy TCP)
        if (wsTunnel && wsTunnel.readyState === WebSocket.OPEN) {
            tcpTunnel.forward(socket, buffer, wsTunnel, tcpClients)
            return
        }
        // Pas de tunnel : close direct
        socket.destroy()
    })
})

// --- WS upgrade : /tunnel ---
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

// Écoute sur le port auto (Render.com ready)
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur distant écoute sur port ${PORT}`)
    console.log('En attente d’un client tunnel WS sur /tunnel ...')
})
