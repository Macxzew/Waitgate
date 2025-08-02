const { Buffer } = require('buffer')

let nextId = 1

function forward(socket, firstBuffer, wsTunnel, tcpClients) {
    const clientId = nextId++
    tcpClients.set(clientId, socket)

    // Send premier paquet au client
    const header = Buffer.alloc(4)
    header.writeUInt32BE(clientId, 0)
    wsTunnel.send(Buffer.concat([header, firstBuffer]))

    socket.on('data', chunk => {
        if (wsTunnel.readyState !== 1) return
        const header = Buffer.alloc(4)
        header.writeUInt32BE(clientId, 0)
        wsTunnel.send(Buffer.concat([header, chunk]))
    })

    socket.on('close', () => {
        tcpClients.delete(clientId)
        if (wsTunnel.readyState === 1) {
            const header = Buffer.alloc(4)
            header.writeUInt32BE(clientId, 0)
        }
    })

    socket.on('error', err => {
        tcpClients.delete(clientId)
    })
}

module.exports = { forward }
