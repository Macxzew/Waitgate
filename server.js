const http = require('http')
const WebSocket = require('ws')
const dashboard = require('./routes/dashboard')
const download = require('./routes/download')

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000

const wss = new WebSocket.Server({ noServer: true })
let wsTunnel = null

// Compat dashboard
const tcpClients = new Map()

const httpServer = http.createServer((req, res) => {
    if (req.url === '/dashboard' || req.url.startsWith('/api/')) {
        dashboard.handle(req, res, { wsTunnel, tcpClients })
        return
    }
    if (req.url === '/download') {
        download.handle(req, res)
        return
    }

    // Proxy HTTP universel
    if (req.url.startsWith('/proxy/')) {
        if (!wsTunnel || wsTunnel.readyState !== 1) {
            res.writeHead(502)
            return res.end('Aucun client proxy connecté.')
        }
        let body = []
        req.on('data', chunk => body.push(chunk))
        req.on('end', () => {
            const toProxy = {
                method: req.method,
                path: req.url.replace(/^\/proxy/, ''),
                headers: req.headers,
                body: body.length ? Buffer.concat(body).toString('base64') : undefined
            }
            const reqId = Math.random().toString(36).slice(2)
            function onMessage(msg) {
                try {
                    const data = JSON.parse(msg)
                    if (data.reqId !== reqId) return
                    wss.off('message', onMessage)
                    res.writeHead(data.status || 200, data.headers || {})
                    res.end(data.body ? Buffer.from(data.body, 'base64') : undefined)
                } catch {}
            }
            wss.on('message', onMessage)
            wsTunnel.send(JSON.stringify({ type: 'http-proxy', reqId, req: toProxy }))
        })
        return
    }

    res.writeHead(404)
    res.end('Not found')
})

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

wss.on('connection', ws => {
    wsTunnel = ws
    ws.on('close', () => { wsTunnel = null })
    ws.on('error', () => { wsTunnel = null })
})

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur distant écoute sur port ${PORT}`)
    console.log('En attente d’un client tunnel WS sur /tunnel ...')
})
