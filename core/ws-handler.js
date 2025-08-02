function handle(ws, tcpClients) {
    console.log('Tunnel WS client connecté')

    ws.on('message', msg => {
        let obj
        try {
            obj = JSON.parse(msg)
        } catch { return }
        const { id, data } = obj || {}
        if (!id || !data) return
        const sock = tcpClients.get(id)
        if (sock && !sock.destroyed)
            sock.write(Buffer.from(data, 'base64'))
    })

    ws.on('close', () => {
        console.log('Tunnel WS fermé')
        for (const sock of tcpClients.values()) sock.destroy()
        tcpClients.clear()
    })

    ws.on('error', err => {
        console.log('Erreur WS côté serveur :', err)
        for (const sock of tcpClients.values()) sock.destroy()
        tcpClients.clear()
    })
}

module.exports = { handle }
