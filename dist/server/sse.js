export const sseClients = new Set();
export function broadcast(line) {
    for (const c of sseClients)
        c.send(line);
}
export const serverLogs = [];
export function log(line) {
    const s = `[${new Date().toISOString()}] ${line}`;
    serverLogs.push(s);
    if (serverLogs.length > 2000)
        serverLogs.shift();
    console.log(s);
    broadcast(s);
}
