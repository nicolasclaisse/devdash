import { appendLog } from './logWriter.js';
export const sseClients = new Set();
export function broadcast(line) {
    for (const c of sseClients)
        c.send(line);
}
export function log(line) {
    const s = `[${new Date().toISOString()}] ${line}`;
    appendLog('devdash', s);
    console.log(s);
    broadcast(s);
}
