// routes/dashboard.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { DASH_USER, DASH_PASS, LOGIN_SECRET } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let sessionActive = false;

const rawLoginHtml = fs.readFileSync(
    path.join(__dirname, "../views/login.html"),
    "utf-8"
);
const panelHtml = fs.readFileSync(
    path.join(__dirname, "../views/panel.html"),
    "utf-8"
);
const indexHtml = fs.readFileSync(
    path.join(__dirname, "../views/index.html"),
    "utf-8"
);

// Injecte key b64 dans login.html
const loginHtml = rawLoginHtml.replace(
    "{{LOGIN_SECRET}}",
    Buffer.from(LOGIN_SECRET, "hex").toString("base64")
);

// Déchiffrement
function decryptPass(encryptedB64, secret) {
    // secret
    let key;
    if (/^[0-9a-f]{64}$/i.test(secret)) {
        key = Buffer.from(secret, "hex");
    } else {
        key = Buffer.from(secret, "base64");
    }
    const input = Buffer.from(encryptedB64, "base64");
    const nonce = input.slice(0, 12);                // 12 bytes
    const ciphertextAndTag = input.slice(12);        // data + tag
    const tag = ciphertextAndTag.slice(-16);         // 16 bytes
    const ciphertext = ciphertextAndTag.slice(0, -16);
    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString();
}

// Rendu dyn du panel
function renderPanel(ctx) {
    const tcpClientsSafe = ctx.tcpClients || new Map();
    return panelHtml
        .replace("{{TUNNEL_STATUS}}", ctx.wsTunnel ? "EN LIGNE" : "HORS LIGNE")
        .replace(
            "{{EXPOSER_IP}}",
            ctx.wsTunnel ? ctx.wsTunnel._socket.remoteAddress : "-"
        )
        .replace(
            "{{USER_IPS}}",
            Array.from(tcpClientsSafe.values()).length === 0
                ? "<i>Personne</i>"
                : Array.from(tcpClientsSafe.values())
                    .map((sock) => `<span class="chip">${sock.remoteAddress}</span>`)
                    .join(" ")
        );
}

// Handler principal
export function handle(req, res, ctx) {
    const tcpClientsSafe = ctx.tcpClients || new Map();

    if (req.url === "/" || req.url === "/index") {
        let msg, wait;
        if (!ctx.wsTunnel) {
            msg = "No services exposed at this time.";
            wait = "Waiting for a client...";
        } else if (!tcpClientsSafe.size) {
            msg = "A tunnel is currently active.";
            wait = "A client is connected..";
        } else {
            msg = "A tunnel is currently active.";
            wait = "A client is connected.";
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(indexHtml.replace("{{MSG}}", msg).replace("{{WAIT}}", wait));
    }

    if (req.url === "/dashboard") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(sessionActive ? renderPanel(ctx) : loginHtml);
    }

    if (req.url === "/api/login" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                const { u, p } = JSON.parse(body);
                const decryptedPass = decryptPass(p, LOGIN_SECRET);

                if (u === DASH_USER && decryptedPass === DASH_PASS) {
                    sessionActive = true;
                    res.writeHead(200, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify({ ok: 1 }));
                }
            } catch (err) { }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: 0 }));
        });
        return;
    }

    if (req.url === "/api/logout" && req.method === "POST") {
        sessionActive = false;
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: 1 }));
    }

    if (req.url === "/download") {
        if (!sessionActive) {
            res.writeHead(401, { "Content-Type": "text/plain" });
            return res.end("Authentication required.");
        }
        import("./download.js").then((download) => download.handle(req, res));
        return;
    }

    if (req.url === "/api/wait-tunnel" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: 1 }));
    }

    if (req.url === "/api/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
            JSON.stringify({
                tunnel: !!ctx.wsTunnel,
                exposerIp: ctx.wsTunnel ? ctx.wsTunnel._socket.remoteAddress : null,
                userIps: Array.from(tcpClientsSafe.values()).map(
                    (sock) => sock.remoteAddress
                ),
            })
        );
    }

    res.writeHead(404);
    res.end("Not found");
}
