// server/httpServer.js
import http from "http";
import fs from "fs";
import path from "path";
import * as dashboard from "../routes/dashboard.js";
import { getIp, checkRateLimit } from "../core/rateLimiter.js";

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 Mo
const indexPath = path.join(process.cwd(), "views", "index.html");

export function createHttpServer(wsTunnelRef, tcpClients) {
  return http.createServer((req, res) => {
    const ip = getIp(req);
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { "Content-Type": "text/plain" });
      return res.end("Too many requests, try again later.\n");
    }

    // Routes Dashboard & API
    if (
      req.url === "/dashboard" ||
      req.url === "/download" ||
      req.url.startsWith("/api/")
    ) {
      dashboard.handle(req, res, { wsTunnel: wsTunnelRef.wsTunnel, tcpClients });
      return;
    }

    // Accueil / si pas de tunnel WS ouvert
    if (!wsTunnelRef.wsTunnel || wsTunnelRef.wsTunnel.readyState !== 1) {
      if (fs.existsSync(indexPath)) {
        const html = fs.readFileSync(indexPath);
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(html);
      } else {
        res.writeHead(502);
        return res.end("Aucun client proxy connecté.");
      }
    }

    // Proxy HTTP via tunnel WS
    const bodyChunks = [];
    let bodySize = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE) {
        aborted = true;
        res.writeHead(413);
        res.end("Payload Too Large");
        req.destroy();
        return;
      }
      bodyChunks.push(chunk);
    });

    req.on("end", () => {
      if (aborted) return;
      const toProxy = {
        method: req.method,
        path: req.url,
        headers: req.headers,
        body: bodyChunks.length ? Buffer.concat(bodyChunks).toString("base64") : undefined,
      };
      const reqId = Math.random().toString(36).slice(2);

      const onMessage = (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.reqId !== reqId) return;
          wsTunnelRef.wsTunnel.off("message", onMessage);
          res.writeHead(data.status || 200, data.headers || {});
          res.end(data.body ? Buffer.from(data.body, "base64") : undefined);
        } catch {
          // ignore JSON parse errors
        }
      };

      wsTunnelRef.wsTunnel.on("message", onMessage);
      wsTunnelRef.wsTunnel.send(JSON.stringify({ type: "http-proxy", reqId, req: toProxy }));
    });
  });
}
