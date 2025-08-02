const fs = require('fs')
const path = require('path')

const DASH_USER = 'admin'
const DASH_PASS = ' '
let sessionActive = false

const loginHtml   = fs.readFileSync(path.join(__dirname, '../views/login.html'),   'utf-8')
const panelHtml   = fs.readFileSync(path.join(__dirname, '../views/panel.html'),   'utf-8')
const welcomeHtml = fs.readFileSync(path.join(__dirname, '../views/welcome.html'), 'utf-8')

// Rendu dynamique panel
function renderPanel(ctx) {
    // Protection : ctx.tcpClients peut être undefined
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

    // Accueil public (welcome) dynamique
    if (req.url === '/' || req.url === '/welcome') {
        let msg, wait
        if (!ctx.wsTunnel) {
            msg  = 'Aucun service exposé pour le moment.'
            wait = 'En attente d’un tunnel client…'
        } else if (!tcpClientsSafe.size) {
            msg  = 'Tunnel actif, aucun service web exposé.'
            wait = 'Client connecté, mais rien d’exposé pour l’instant.'
        } else {
            msg  = 'Tunnel actif, service(s) exposé(s).'
            wait = 'Vous pouvez accéder au service exposé, ou consulter le dashboard.'
        }
        res.writeHead(200, {'Content-Type':'text/html'})
        return res.end(
            welcomeHtml.replace('{{MSG}}', msg).replace('{{WAIT}}', wait)
        )
    }

    // Page dashboard protégée
    if (req.url === '/dashboard') {
        if (!sessionActive) {
            res.writeHead(200, {'Content-Type':'text/html'})
            return res.end(loginHtml)
        }
        res.writeHead(200, {'Content-Type':'text/html'})
        return res.end(renderPanel(ctx))
    }

    // Auth POST login
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

    // Logout
    if (req.url === '/api/logout' && req.method === 'POST') {
        sessionActive = false
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({ok:1}))
    }

    // Attente tunnel (no-op UX)
    if (req.url === '/api/wait-tunnel' && req.method === 'POST') {
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({ok:1}))
    }

    // Statut live AJAX
    if (req.url === '/api/status') {
        res.writeHead(200, {'Content-Type':'application/json'})
        return res.end(JSON.stringify({
            tunnel: !!ctx.wsTunnel,
            exposerIp: ctx.wsTunnel ? ctx.wsTunnel._socket.remoteAddress : null,
            userIps: Array.from(tcpClientsSafe.values()).map(sock => sock.remoteAddress)
        }))
    }

    // 404 fallback
    res.writeHead(404)
    res.end('Not found')
}
