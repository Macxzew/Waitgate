// server.js
import net from "net";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import WebSocket, { WebSocketServer } from "ws";

import * as dashboard from "./routes/dashboard.js";
import * as tcpTunnel from "./core/tcp-tunnel.js";
import * as wsHandler from "./core/ws-handler.js";
import { TUNNEL_TOKEN } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;
const indexPath = path.join(__dirname, "views", "index.html");

const wss = new WebSocketServer({ noServer: true });
const tcpClients = new Map();
let wsTunnel = null;

// Limite de taille pour le body HTTP proxy (ex: 10 Mo)
const MAX_BODY_SIZE = 10 * 1024 * 1024;

// SRV HTTP
const httpServer = http.createServer((req, res) => {

    // Dashboard & API
    if (
        req.url === "/dashboard" ||
        req.url === "/download" ||
        req.url.startsWith("/api/")
    ) {
        dashboard.handle(req, res, { wsTunnel, tcpClients });
        return;
    }

    // Accueil / si pas de tunnel
    if (!wsTunnel || wsTunnel.readyState !== WebSocket.OPEN) {
        if (fs.existsSync(indexPath)) {
            const html = fs.readFileSync(indexPath);
            res.writeHead(200, { "Content-Type": "text/html" });
            return res.end(html);
        } else {
            res.writeHead(502);
            return res.end("Aucun client proxy connecté.");
        }
    }

    // Proxy HTTP via WS tunnel, version sécurisée
    const body = [];
    let bodySize = 0;
    let aborted = false;

    req.on("data", (chunk) => {
        if (aborted) return;
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_SIZE) {
            aborted = true;
            res.writeHead(413); // Payload Too Large
            res.end("Payload Too Large");
            req.destroy();
            return;
        }
        body.push(chunk);
    });
    req.on("end", () => {
        if (aborted) return;
        const toProxy = {
            method: req.method,
            path: req.url,
            headers: req.headers,
            body: body.length ? Buffer.concat(body).toString("base64") : undefined,
        };

        const reqId = Math.random().toString(36).slice(2);

        const onMessage = (msg) => {
            try {
                const data = JSON.parse(msg);
                if (data.reqId !== reqId) return;
                wsTunnel.off("message", onMessage);
                res.writeHead(data.status || 200, data.headers || {});
                res.end(data.body ? Buffer.from(data.body, "base64") : undefined);
            } catch (_) { }
        };

        wsTunnel.on("message", onMessage);
        wsTunnel.send(
            JSON.stringify({ type: "http-proxy", reqId, req: toProxy })
        );
    });
});

// SRV TCP brut
const tcpServer = net.createServer((socket) => {
    socket.once("data", (buffer) => {
        const str = buffer.toString();
        if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS) /.test(str)) {
            socket.unshift(buffer);
            httpServer.emit("connection", socket);
        } else if (wsTunnel && wsTunnel.readyState === WebSocket.OPEN) {
            tcpTunnel.forward(socket, buffer, wsTunnel, tcpClients);
        } else {
            socket.destroy();
        }
    });
});

// Upgrade WS sécurisé
httpServer.on("upgrade", (req, socket, head) => {
    if (req.url.startsWith("/tunnel")) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get("token");

        if (token !== TUNNEL_TOKEN) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            return socket.destroy();
        }

        if (wsTunnel && wsTunnel.readyState === WebSocket.OPEN) {
            return socket.destroy();
        }

        wss.handleUpgrade(req, socket, head, (ws) =>
            wss.emit("connection", ws, req)
        );
    } else {
        socket.destroy();
    }
});

// Gestion connexion WS client
wss.on("connection", (ws) => {
    wsTunnel = ws;
    wsHandler.handle(ws, tcpClients);

    ws.on("close", () => {
        wsTunnel = null;
        for (const sock of tcpClients.values()) sock.destroy();
        tcpClients.clear();
    });

    ws.on("error", () => {
        wsTunnel = null;
        for (const sock of tcpClients.values()) sock.destroy();
        tcpClients.clear();
    });
});

// Lancement SRV
tcpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listens on port ${PORT}`);
    console.log("Waiting for a WS tunnel client on /tunnel...");
});
