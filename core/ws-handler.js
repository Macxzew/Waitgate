// core/ws-handler.js
import { decrypt } from './crypto-utils.js';

export function handle(ws, tcpClients) {
    ws.on('message', msg => {
        let obj;
        try {
            obj = JSON.parse(msg);
        } catch {
            return;
        }
        const { id, data } = obj || {};
        if (!id || !data) return;
        const sock = tcpClients.get(id);
        if (sock && !sock.destroyed) {
            try {
                sock.write(decrypt(Buffer.from(data, 'base64')));
            } catch {
            }
        }
    });

    ws.on('close', () => {
        for (const sock of tcpClients.values()) sock.destroy();
        tcpClients.clear();
    });

    ws.on('error', () => {
        for (const sock of tcpClients.values()) sock.destroy();
        tcpClients.clear();
    });
}
