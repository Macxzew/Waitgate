const net = require('net')
const http = require('http')
const WebSocket = require('ws')
const dashboard = require('./routes/dashboard')
const download = require('./routes/download')
const tcpTunnel = require('./core/tcp-tunnel')
const wsHandler = require('./core/ws-handler')

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000

const wss = new WebSocket.Server({ noServer: true })
const tcpClients = new Map()
let wsTunnel = null

// Serveur HTTP
const httpServer = http.createServer((req, res) => {
    // Dashboard, API, download
    if (req.url === '/dashboard' || req.url.startsWith('/api/')) {
        dashboard.handle(req, res, { wsTunnel, tcpClients })
        return
    }
    if (req.url === '/download') {
        download.handle(req, res)
        return
    }

    // Proxy HTTP pour TOUT le reste
    if (!wsTunnel || wsTunnel.readyState !== 1) {
        res.writeHead(502)
        return res.end('Aucun client proxy connecté.')
    }
    let body = []
    req.on('data', chunk => body.push(chunk))
    req.on('end', () => {
        const toProxy = {
            method: req.method,
            path: req.url,
            headers: req.headers,
            body: body.length ? Buffer.concat(body).toString('base64') : undefined
        }
        const reqId = Math.random().toString(36).slice(2)
        function onMessage(msg) {
            try {
                const data = JSON.parse(msg)
                if (data.reqId !== reqId) return
                wsTunnel.off('message', onMessage)
                res.writeHead(data.status || 200, data.headers || {})
                res.end(data.body ? Buffer.from(data.body, 'base64') : undefined)
            } catch (e) { }
        }
        wsTunnel.on('message', onMessage)
        wsTunnel.send(JSON.stringify({ type: 'http-proxy', reqId, req: toProxy }))
    })
})

// srv TCP “brut” pour tout ce qui n’est PAS HTTP/WS
const tcpServer = net.createServer(socket => {
    socket.once('data', buffer => {
        const str = buffer.toString()
        // Si c’est HTTP (ou WS) on route vers httpServer
        if (
            str.startsWith('GET ') || str.startsWith('POST ') ||
            str.startsWith('PUT ') || str.startsWith('HEAD ') ||
            str.startsWith('DELETE ') || str.startsWith('OPTIONS ')
        ) {
            socket.unshift(buffer)
            httpServer.emit('connection', socket)
            return
        }
        // Sinon tunnel TCP brut via WebSocket
        if (wsTunnel && wsTunnel.readyState === 1) {
            tcpTunnel.forward(socket, buffer, wsTunnel, tcpClients)
            return
        }
        socket.destroy()
    })
})

// WebSocket Upgrade
httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === '/tunnel') {
        if (wsTunnel && wsTunnel.readyState === WebSocket.OPEN) {
            socket.destroy()
            return
        }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
    } else {
        socket.destroy()
    }
})

// Gestion du tunnel WebSocket
wss.on('connection', ws => {
    wsTunnel = ws
    wsHandler.handle(ws, tcpClients)
    ws.on('close', () => {
        wsTunnel = null
        for (const sock of tcpClients.values()) sock.destroy()
        tcpClients.clear()
    })
    ws.on('error', () => {
        wsTunnel = null
        for (const sock of tcpClients.values()) sock.destroy()
        tcpClients.clear()
    })
})

// Démarre les serveurs
tcpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur universel écoute sur port ${PORT}`)
    console.log('En attente d’un client tunnel WS sur /tunnel ...')
})
