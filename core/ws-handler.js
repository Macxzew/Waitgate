function handle(ws, tcpClients) {
    console.log('Tunnel WS client connecté')
    ws.on('message', data => {
        const clientId = data.readUInt32BE(0)
        const payload = data.slice(4)
        const sock = tcpClients.get(clientId)
        if (sock) sock.write(payload)
    })
    ws.on('close', () => {
        console.log('Tunnel fermé')
        for (const sock of tcpClients.values()) sock.destroy()
        tcpClients.clear()
    })
    ws.on('error', err => {
        console.log('Erreur WS côté serveur:', err)
        for (const sock of tcpClients.values()) sock.destroy()
        tcpClients.clear()
    })
}

module.exports = { handle }
