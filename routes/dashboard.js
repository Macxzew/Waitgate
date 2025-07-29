const fs = require('fs')
const path = require('path')

const DASH_USER = 'admin'
const DASH_PASS = ' '
let sessionActive = false

const loginHtml = fs.readFileSync(path.join(__dirname, '../views/login.html'), 'utf-8')
const panelHtml = fs.readFileSync(path.join(__dirname, '../views/panel.html'), 'utf-8')

function renderPanel(ctx) {
    return panelHtml
        .replace('{{TUNNEL_STATUS}}', ctx.wsTunnel ? 'EN LIGNE' : 'HORS LIGNE')
        .replace('{{EXPOSER_IP}}', ctx.wsTunnel ? ctx.wsTunnel._socket.remoteAddress : '-')
        .replace('{{USER_IPS}}',
            Array.from(ctx.tcpClients.values()).length === 0
                ? '<i>Personne</i>'
                : Array.from(ctx.tcpClients.values())
                    .map(sock => `<span class="chip">${sock.remoteAddress}</span>`).join(' ')
        )
}

exports.handle = (req, res, ctx) => {
    if (req.url === '/dashboard') {
        if (!sessionActive) {
            res.writeHead(200, {'Content-Type':'text/html'})
            return res.end(loginHtml)
        }
        res.writeHead(200, {'Content-Type':'text/html'})
        return res.end(renderPanel(ctx))
    }

    if (req.url === '/api/login' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
            try {
                const {u, p} = JSON.parse(body)
                if (u === DASH_USER && p === DASH_PASS) {
                    sessionActive = true
                    res.writeHead(200, {'Content-Type':'application/json'})
                    return res.end(JSON.stringify({ok:1}))
                }
            } catch {}
            res.writeHead(200, {'Content-Type':'application/json'})
            res.end(JSON.stringify({ok:0}))
        })
        return
    }

    if (req.url === '/api/logout' && req.method === 'POST') {
        sessionActive = false
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({ok:1}))
    }

    if (req.url === '/api/wait-tunnel' && req.method === 'POST') {
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({ok:1}))
    }

    if (req.url === '/api/status') {
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({
            tunnel: !!ctx.wsTunnel,
            exposerIp: ctx.wsTunnel ? ctx.wsTunnel._socket.remoteAddress : null,
            userIps: Array.from(ctx.tcpClients.values()).map(sock => sock.remoteAddress)
        }))
    }

    res.writeHead(404)
    res.end('Not found')
}
