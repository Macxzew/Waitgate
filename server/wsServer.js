// server/wsServer.js
import { getIp, checkRateLimit, addDynamicWhitelist } from "../core/rateLimiter.js";
import { setExposerIpEnv, clearExposerIpEnv } from "../core/exposer-ip.js";

// Vide l'IP exposée au démarrage
clearExposerIpEnv();

/**
 * Crée le SRV WS pour tunnel reverse.
 * @param {string} TUNNEL_TOKEN
 * @param {WebSocketServer} wss
 * @param {object} wsTunnelRef
 * @param {Map} tcpClients
 * @param {object} wsHandler
 * @param {object} ctx
 */

export function createWsServer(TUNNEL_TOKEN, wss, wsTunnelRef, tcpClients, wsHandler, ctx) {
    wss.on("connection", (ws, req) => {
        wsTunnelRef.wsTunnel = ws;
        ctx.wsTunnel = ws;
        wsHandler.handle(ws, tcpClients);

        // whitelist dynamique
        const ip = getIp(req);
        addDynamicWhitelist(ip);

        // Reset l'IP exposée
        ctx.exposerIp = null;

        // Attend handshake HELLO pour exposer IP WAN
        ws.on('message', function handleHello(msg) {
            try {
                const obj = JSON.parse(msg);
                if (obj && obj.type === "HELLO" && obj.ip) {
                    ctx.exposerIp = obj.ip;
                    setExposerIpEnv(obj.ip);
                    ws.off('message', handleHello);
                }
            } catch {}
        });

        ws.on("close", () => {
            wsTunnelRef.wsTunnel = null;
            ctx.wsTunnel = null;
            ctx.exposerIp = null;
            clearExposerIpEnv();
            for (const sock of tcpClients.values()) sock.destroy();
            tcpClients.clear();
        });

        ws.on("error", () => {
            wsTunnelRef.wsTunnel = null;
            ctx.wsTunnel = null;
            ctx.exposerIp = null;
            clearExposerIpEnv();
            for (const sock of tcpClients.values()) sock.destroy();
            tcpClients.clear();
        });
    });

    return (httpServer) => {
        httpServer.on("upgrade", (req, socket, head) => {
            const ip = getIp(req);
            if (!checkRateLimit(ip)) {
                socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
                socket.destroy();
                return;
            }

            if (req.url.startsWith("/tunnel")) {
                const authHeader = req.headers["authorization"];
                if (!authHeader || !authHeader.startsWith("Bearer ")) {
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                    socket.destroy();
                    return;
                }

                const token = authHeader.slice(7);
                if (token !== TUNNEL_TOKEN) {
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                    socket.destroy();
                    return;
                }

                // Un seul tunnel à la fois
                if (wsTunnelRef.wsTunnel && wsTunnelRef.wsTunnel.readyState === 1) {
                    socket.destroy();
                    return;
                }

                wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
            } else {
                socket.destroy();
            }
        });
    };
}
