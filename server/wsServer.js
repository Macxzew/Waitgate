import { getIp, checkRateLimit } from "../core/rateLimiter.js";

export function createWsServer(TUNNEL_TOKEN, wss, wsTunnelRef, tcpClients, wsHandler) {
    // Gestion des connexions WS
    wss.on("connection", (ws) => {
        wsTunnelRef.wsTunnel = ws;
        wsHandler.handle(ws, tcpClients);

        ws.on("close", () => {
            wsTunnelRef.wsTunnel = null;
            for (const sock of tcpClients.values()) sock.destroy();
            tcpClients.clear();
        });

        ws.on("error", () => {
            wsTunnelRef.wsTunnel = null;
            for (const sock of tcpClients.values()) sock.destroy();
            tcpClients.clear();
        });
    });

    // Fonction à appeler pour gérer la montée en WS (upgrade) sur le serveur HTTP
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
