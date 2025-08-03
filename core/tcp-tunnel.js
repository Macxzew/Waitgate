const { encrypt } = require('./crypto-utils') // <-- à ajouter

let nextId = 1
const clientBuffers = new Map()

function forward(socket, firstBuffer, wsTunnel, tcpClients) {
    const clientId = nextId++
    tcpClients.set(clientId, socket)
    clientBuffers.set(clientId, firstBuffer) // stocke le 1er buffer

    // Timer pour envoyer le buffer après 50 ms
    const timer = setTimeout(() => {
        const buffered = clientBuffers.get(clientId)
        if (!buffered) return
        wsTunnel.send(JSON.stringify({
            id: clientId,
            data: encrypt(buffered).toString('base64')
        }))
        clientBuffers.delete(clientId)
    }, 50)

    socket.on('data', chunk => {
        if (wsTunnel.readyState !== 1) return

        if (clientBuffers.has(clientId)) {
            // Concatène dans le buffer avant l'envoi
            clientBuffers.set(clientId, Buffer.concat([clientBuffers.get(clientId), chunk]))
        } else {
            // Envoi direct après premier buffer envoyé
            wsTunnel.send(JSON.stringify({
                id: clientId,
                data: encrypt(chunk).toString('base64')
            }))
        }
    })

    socket.on('close', () => {
        tcpClients.delete(clientId)
        clientBuffers.delete(clientId)
        clearTimeout(timer)
    })

    socket.on('error', err => {
        tcpClients.delete(clientId)
        clientBuffers.delete(clientId)
        clearTimeout(timer)
    })
}

module.exports = { forward }
