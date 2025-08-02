const jsTemplate = `
const LOCAL_HOST = '127.0.0.1'
const LOCAL_PORT = 25565
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

const localSockets = new Map()

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
            this.socket.write(this.payload)
        })
        this.socket.on('data', chunk => {
            if (this.ws.readyState === 1) {
                const header = Buffer.alloc(4)
                header.writeUInt32BE(this.clientId, 0)
                this.ws.send(Buffer.concat([header, chunk]))
            }
        })
        this.socket.on('close', () => {
            localSockets.delete(this.clientId)
            clearTimeout(this.retryTimeout)
            // Optionnel : log debug
        })
        this.socket.on('error', err => {
            localSockets.delete(this.clientId)
            if (err.code === 'ECONNREFUSED')
                this.retryTimeout = setTimeout(() => this.connect(), RETRY_DELAY)
        })
    }
}

function handleWSMessage(data, ws) {
    const clientId = data.readUInt32BE(0)
    const payload = data.slice(4)
    const socket = localSockets.get(clientId)
    if (!socket)
        new LocalTunnel(clientId, ws, payload)
    else if (!socket.destroyed)
        socket.write(payload)
}

function connectWS() {
    const ws = new WebSocket(REMOTE_WS_URL)
    ws.on('open', () => {
        console.log('Tunnel WS connecté')
    })
    ws.on('message', data => {
        handleWSMessage(data, ws)
    })
    ws.on('close', () => {
        console.log('Tunnel fermé, reconnexion dans 5s')
        for (const sock of localSockets.values())
            sock.destroy()
        localSockets.clear()
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
    const jsFinal = jsTemplate.replace(
        'REPLACE_ME_REMOTE_WS_URL',
        wsUrl
    )
    res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Content-Disposition': 'attachment; filename="client.js"'
    })
    res.end(jsFinal)
}
