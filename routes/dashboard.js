// routes/dashboard.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { DASH_USER, DASH_PASS, LOGIN_SECRET, TUNNEL_CHACHA_KEY  } from "../config.js";
import { authenticator } from "otplib";
import { encrypt } from "../core/crypto-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, "../.env");
const loginAttempts = new Map();
const MAX_ATTEMPTS = 7;
const BLOCK_TIME_MS = 2 * 60 * 1000; // 2 min

const rawLoginHtml = fs.readFileSync(
    path.join(__dirname, "../views/login.html"),
    "utf-8"
);
const panelHtml = fs.readFileSync(
    path.join(__dirname, "../views/panel.html"),
    "utf-8"
);
const renderedPanelHtml = panelHtml.replace(
    "{{LOGIN_SECRET}}",
    Buffer.from(TUNNEL_CHACHA_KEY, "hex").toString("base64")
);
const indexHtml = fs.readFileSync(
    path.join(__dirname, "../views/index.html"),
    "utf-8"
);
const loginHtml = rawLoginHtml.replace(
    "{{LOGIN_SECRET}}",
    Buffer.from(LOGIN_SECRET, "hex").toString("base64")
);

let sessionActive = false;

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

// Encrypt ChaCha20-Poly1305 POST
function encryptTfaPayload(obj) {
    const key = base64ToUint8(window._loginKey);
    const nonce = window.crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(obj));
    const chacha = new ChaCha20Poly1305(key);
    const ct = chacha.seal(nonce, plain);
    // Concatène nonce + ct (Uint8Array)
    const out = new Uint8Array(nonce.length + ct.length);
    out.set(nonce, 0);
    out.set(ct, nonce.length);
    return out;
}

export function decrypt(buf) {
    const key = Buffer.from(TUNNEL_CHACHA_KEY, "hex");
    const nonce = buf.slice(0, 12);
    const ciphertextAndTag = buf.slice(12);
    const tag = ciphertextAndTag.slice(-16);
    const ciphertext = ciphertextAndTag.slice(0, -16);
    const decipher = crypto.createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted;
}

// Recup Info TOTP
function getTotpConfig() {
    let TOTP_ENABLED = false;
    let TOTP_SECRET = "";
    if (fs.existsSync(ENV_PATH)) {
        const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
        for (let l of lines) {
            if (l.startsWith("TOTP_ENABLED=")) TOTP_ENABLED = l.split("=")[1].trim() === "true";
            if (l.startsWith("TOTP_SECRET=")) TOTP_SECRET = l.split("=")[1].trim();
        }
    }
    return { TOTP_ENABLED, TOTP_SECRET };
}

function updateTOTPConfig(enabled, secret) {
    // Charge .env
    let env = {};
    if (fs.existsSync(ENV_PATH)) {
        env = Object.fromEntries(
            fs.readFileSync(ENV_PATH, "utf-8")
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l && !l.startsWith("#"))
                .map((l) => l.split("="))
                .map(([k, ...v]) => [k.trim(), v.join("=").trim()])
        );
    }
    env.TOTP_ENABLED = enabled ? "true" : "false";
    env.TOTP_SECRET = secret || "";
    // Écrase .env
    fs.writeFileSync(
        ENV_PATH,
        Object.entries(env)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")
    );
}

// Rendu dyn du panel
function renderPanel(ctx) {
    const tcpClientsSafe = ctx.tcpClients || new Map();
    return renderedPanelHtml
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
        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        // Init tracking
        if (!loginAttempts.has(ip)) {
            loginAttempts.set(ip, { count: 0, blockedUntil: 0 });
        }
        const entry = loginAttempts.get(ip);
        // Si bloqué -> refuse direct
        if (entry.blockedUntil && Date.now() < entry.blockedUntil) {
            res.writeHead(429, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: 0, error: "Too many attempts. Try again later." }));
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            const { TOTP_ENABLED, TOTP_SECRET } = getTotpConfig();
            try {
                const { u, p, tfa } = JSON.parse(body);

                // Déchiffre tout
                const decryptedUser = decryptPass(u, LOGIN_SECRET);
                const decryptedPass = decryptPass(p, LOGIN_SECRET);
                let decryptedTfa = null;
                if (tfa) decryptedTfa = decryptPass(tfa, LOGIN_SECRET);

                if (decryptedUser === DASH_USER && decryptedPass === DASH_PASS) {
                    if (TOTP_ENABLED) {
                        if (!decryptedTfa || !authenticator.check(decryptedTfa, TOTP_SECRET)) {
                            entry.count++;
                            res.writeHead(200, { "Content-Type": "application/json" });
                            return res.end(JSON.stringify({ ok: 0, tfa: true }));
                        }
                    }
                    // SUCCÈS -> reset le compteur
                    entry.count = 0;
                    entry.blockedUntil = 0;
                    sessionActive = true;
                    res.writeHead(200, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify({ ok: 1 }));
                }
            } catch (err) {}
            // Échec de login -> incrémente le compteur
            entry.count++;
            // Si dépasse le max -> bloque
            if (entry.count >= MAX_ATTEMPTS) {
                entry.blockedUntil = Date.now() + BLOCK_TIME_MS;
                entry.count = 0;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: 0 }));
        });
        return;
    }

    if (req.url === "/api/tfa-setup") {
        const { TOTP_ENABLED, TOTP_SECRET } = getTotpConfig();

        if (req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
                enabled: TOTP_ENABLED,
                secret: TOTP_SECRET ? "********" : "",
            }));
        }

        if (!sessionActive) {
            res.writeHead(401, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ error: "Not authenticated" }));
        }

        let bufs = [];
        req.on("data", chunk => bufs.push(chunk));
        req.on("end", () => {
            try {
                let action, secret, code;
                if (req.headers["content-type"]?.includes("application/json")) {
                    const { action: act } = JSON.parse(Buffer.concat(bufs).toString());
                    action = act;
                } else if (req.headers["content-type"]?.includes("application/octet-stream")) {
                    const decrypted = decrypt(Buffer.concat(bufs));
                    ({ action, secret, code } = JSON.parse(decrypted.toString()));
                } else {
                    throw new Error("Unsupported Content-Type");
                }
                if (action === "enable") {
                    const tfaSecret = secret || authenticator.generateSecret();
                    if (code) {
                        if (authenticator.check(code, tfaSecret)) {
                            updateTOTPConfig(true, tfaSecret);
                            res.writeHead(200, { "Content-Type": "application/json" });
                            return res.end(JSON.stringify({ ok: 1 }));
                        } else {
                            res.writeHead(200, { "Content-Type": "application/json" });
                            return res.end(JSON.stringify({ ok: 0 }));
                        }
                    }
                    const uri = authenticator.keyuri(DASH_USER, "Waitgate", tfaSecret);
                    const payload = Buffer.from(JSON.stringify({ ok: 1, secret: tfaSecret, uri }));
                    const encryptedPayload = encrypt(payload);
                    res.writeHead(200, { "Content-Type": "application/octet-stream" });
                    return res.end(encryptedPayload);
                }

                if (action === "disable") {
                    updateTOTPConfig(false, "");
                    res.writeHead(200, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify({ ok: 1 }));
                }
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid action" }));

            } catch (e) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Malformed request" }));
            }
        });
        return;
    }



    // (Facultatif) /api/tfa-test inchangé
    if (req.url === "/api/tfa-test" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                const { code, secret } = JSON.parse(body);
                if (authenticator.check(code, secret)) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify({ ok: 1 }));
                }
            } catch (e) { }
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
