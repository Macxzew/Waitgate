// core/tcp-tunnel.js
import { encrypt } from "./crypto-utils.js";

let nextId = 1;
const clientBuffers = new Map();

const MAX_INIT_BUFFER = 256 * 1024; // 256 Ko max first buffer
const INIT_TIMEOUT = 30000; // 30s max d'inactivité

export function forward(socket, firstBuffer, wsTunnel, tcpClients) {
    const clientId = nextId++;
    tcpClients.set(clientId, socket);

    let totalInitBuffer = firstBuffer.length;
    clientBuffers.set(clientId, firstBuffer);

    // Timer buffer après 50 ms
    const timer = setTimeout(() => {
        const buffered = clientBuffers.get(clientId);
        if (!buffered) return;
        wsTunnel.send(JSON.stringify({
            id: clientId,
            data: encrypt(buffered).toString("base64"),
        }));
        clientBuffers.delete(clientId);
    }, 50);

    // Timeout anti-idle sur socket
    const idleTimeout = setTimeout(() => {
        socket.destroy();
        clientBuffers.delete(clientId);
        tcpClients.delete(clientId);
        clearTimeout(timer);
    }, INIT_TIMEOUT);

    socket.on("data", (chunk) => {
        clearTimeout(idleTimeout); // reset timeout à chaque data
        // Limite sur le buffer initial
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
            wsTunnel.send(
                JSON.stringify({
                    id: clientId,
                    data: encrypt(chunk).toString("base64"),
                })
            );
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
