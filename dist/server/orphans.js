import { execSync } from 'node:child_process';
import { loadConfig } from './config.js';
const BUILTIN_PATTERNS = [
    { name: 'postgres', pattern: 'postgres -D' },
    { name: 'redis', pattern: 'redis-server' },
    { name: 'mailpit', pattern: 'mailpit' },
];
function pgrepPids(pattern) {
    try {
        const out = execSync(`pgrep -f ${JSON.stringify(pattern)}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
        return out ? out.split('\n').map(Number).filter(Boolean) : [];
    }
    catch {
        return [];
    }
}
export function getOrphans() {
    const patterns = [...BUILTIN_PATTERNS, ...loadConfig().orphans];
    return patterns.flatMap(({ name, pattern }) => {
        const pids = pgrepPids(pattern);
        return pids.length ? [{ name, pids }] : [];
    });
}
export function killOrphans() {
    const orphans = getOrphans();
    for (const { pids } of orphans) {
        for (const pid of pids) {
            try {
                process.kill(pid, 'SIGKILL');
            }
            catch { /* already dead */ }
        }
    }
    return orphans.map(o => o.name);
}
