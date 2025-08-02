let nextId = 1

function forward(socket, firstBuffer, wsTunnel, tcpClients) {
    const clientId = nextId++
    tcpClients.set(clientId, socket)

    // Premier paquet via JSON/base64
    wsTunnel.send(JSON.stringify({
        id: clientId,
        data: firstBuffer.toString('base64')
    }))

    socket.on('data', chunk => {
        if (wsTunnel.readyState !== 1) return
        wsTunnel.send(JSON.stringify({
            id: clientId,
            data: chunk.toString('base64')
        }))
    })

    socket.on('close', () => {
        tcpClients.delete(clientId)
    })

    socket.on('error', () => {
        tcpClients.delete(clientId)
    })
}

module.exports = { forward }
