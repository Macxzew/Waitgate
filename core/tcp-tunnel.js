const { Buffer } = require('buffer')

let nextId = 1

function forward(socket, firstBuffer, wsTunnel, tcpClients) {
    const clientId = nextId++
    tcpClients.set(clientId, socket)
    const header = Buffer.alloc(4)
    header.writeUInt32BE(clientId, 0)
    wsTunnel.send(Buffer.concat([header, firstBuffer]))

    socket.on('data', chunk => {
        const header = Buffer.alloc(4)
        header.writeUInt32BE(clientId, 0)
        wsTunnel.send(Buffer.concat([header, chunk]))
    })
    socket.on('close', () => tcpClients.delete(clientId))
    socket.on('error', () => tcpClients.delete(clientId))
}

module.exports = { forward }
