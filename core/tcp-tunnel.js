// core/tcp-tunnel.js
import { encrypt } from "./crypto-utils.js";

let nextId = 1;
const clientBuffers = new Map();

const MAX_INIT_BUFFER = 256 * 1024; // 256 Ko max pour le premier buffer
const INIT_TIMEOUT = 30000; // 30s max d'inactivité

/**
 * Forward TCP brut vers WS/WSS (via Render pour WSS)
 * @param {net.Socket} socket - socket TCP
 * @param {Buffer} firstBuffer - premier paquet
 * @param {WebSocket} wsTunnel - connexion WS/WSS
 * @param {Map} tcpClients - liste des clients TCP
 */
export function forward(socket, firstBuffer, wsTunnel, tcpClients) {
    const clientId = nextId++;
    tcpClients.set(clientId, socket);

    let totalInitBuffer = firstBuffer.length;
    clientBuffers.set(clientId, firstBuffer);

    // Envoi différé après 50ms
    const timer = setTimeout(() => {
        const buffered = clientBuffers.get(clientId);
        if (!buffered) return;
        sendEncrypted(wsTunnel, clientId, buffered);
        clientBuffers.delete(clientId);
    }, 50);

    // Timeout anti-idle
    const idleTimeout = setTimeout(() => {
        socket.destroy();
        clientBuffers.delete(clientId);
        tcpClients.delete(clientId);
        clearTimeout(timer);
    }, INIT_TIMEOUT);

    socket.on("data", (chunk) => {
        clearTimeout(idleTimeout); // reset idle timer
        if (clientBuffers.has(clientId)) {
            totalInitBuffer += chunk.length;
            if (totalInitBuffer > MAX_INIT_BUFFER) {
                socket.destroy();
                clientBuffers.delete(clientId);
                tcpClients.delete(clientId);
                clearTimeout(timer);
                return;
            }
            clientBuffers.set(
                clientId,
                Buffer.concat([clientBuffers.get(clientId), chunk])
            );
        } else {
            sendEncrypted(wsTunnel, clientId, chunk);
        }
    });

    function cleanup() {
        tcpClients.delete(clientId);
        clientBuffers.delete(clientId);
        clearTimeout(timer);
        clearTimeout(idleTimeout);
    }

    socket.on("close", cleanup);
    socket.on("error", cleanup);
}

/**
 * Envoie les données chiffrées via WS ou WSS
 */
function sendEncrypted(wsTunnel, clientId, buffer) {
    const encrypted = encrypt(buffer); // Buffer chiffré
    if (wsTunnel.isSecure) {
        // Envoi en binaire : ID (4 octets) + payload chiffré
        const idBuf = Buffer.alloc(4);
        idBuf.writeUInt32BE(clientId);
        wsTunnel.send(Buffer.concat([idBuf, encrypted]), { binary: true });
    } else {
        wsTunnel.send(JSON.stringify({
            id: clientId,
            data: encrypted.toString("base64"),
        }));
    }
}
