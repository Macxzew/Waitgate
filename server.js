// server.js
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import WebSocket, { WebSocketServer } from "ws";
import { createHttpServer } from "./server/httpServer.js";
import { createTcpServer } from "./server/tcpServer.js";
import { createWsServer } from "./server/wsServer.js";
import * as wsHandler from "./core/ws-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;
const tcpClients = new Map();
const wsTunnelRef = { wsTunnel: null };
const httpServer = createHttpServer(wsTunnelRef, tcpClients);
const tcpServer = createTcpServer(httpServer, wsTunnelRef, tcpClients);
const wss = new WebSocketServer({ noServer: true });
const setupWsUpgrade = createWsServer(process.env.TUNNEL_TOKEN, wss, wsTunnelRef, tcpClients, wsHandler);
const _log = console.log;

console.log = function (...args) {
  if (
    typeof args[0] === "string" &&
    args[0].startsWith("[dotenv@")
  ) return;
  _log.apply(console, args);
};

dotenv.config();
console.log = _log;
setupWsUpgrade(httpServer);

tcpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[INFO] Server listens on port ${PORT}`);
  console.log("[INFO] Waiting for a WS tunnel client on /tunnel...");
});
