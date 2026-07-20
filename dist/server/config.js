import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_DIR } from './env.js';
const OTHER_GROUP = { id: 'other', label: 'Other', match: {} };
const BUILTIN_PORTS = [
    { port: 52800, label: 'devdash (vite)' },
    { port: 52801, label: 'devdash (vite hmr)' },
    { port: 52802, label: 'devdash (server)' },
];
const BUILTIN_READY_PATTERNS = [
    'VITE v[\\d.]+ {2}ready in \\d+',
    '✓ Ready in \\d+',
    'Nest application successfully started',
    'Application started on port',
    'Server ready at http',
    'Prisma Studio is running at',
    'Development Server .* started',
    'worker ready',
];
let cached = null;
export function loadConfig() {
    if (cached)
        return cached;
    const path = join(PROJECT_DIR, 'devdash.config.json');
    const user = existsSync(path)
        ? JSON.parse(readFileSync(path, 'utf-8'))
        : {};
    const userGroups = (user.groups ?? []).filter(g => g.id !== OTHER_GROUP.id);
    cached = {
        name: user.name ?? 'DevDash',
        devenv: user.devenv ?? false,
        logsDir: user.logsDir ?? `${PROJECT_DIR}/logs`,
        groups: [...userGroups, OTHER_GROUP],
        ports: [...BUILTIN_PORTS, ...(user.ports ?? [])],
        readyPatterns: [...BUILTIN_READY_PATTERNS, ...(user.readyPatterns ?? [])],
        s3: user.s3,
    };
    return cached;
}
export function reloadConfig() {
    cached = null;
    return loadConfig();
}
/** Inline services declared across all groups, each tagged with its owning group id. */
export function inlineServices(cfg) {
    return cfg.groups.flatMap(g => (g.services ?? []).map(s => ({ ...s, groupId: g.id })));
}
export function matches(spec, name) {
    if (!spec)
        return false;
    if (spec.in && spec.in.includes(name))
        return true;
    if (spec.startsWith && name.startsWith(spec.startsWith))
        return true;
    if (spec.endsWith && name.endsWith(spec.endsWith))
        return true;
    if (spec.equals && name === spec.equals)
        return true;
    if (spec.regex && new RegExp(spec.regex).test(name))
        return true;
    if (!spec.in && !spec.startsWith && !spec.endsWith && !spec.equals && !spec.regex)
        return true;
    return false;
}
/** Public view of the config (strips secrets) — exposed via /api/config to the frontend. */
export function publicConfig() {
    const c = loadConfig();
    const serviceGroups = {};
    for (const s of inlineServices(c))
        serviceGroups[s.name] = s.groupId;
    return {
        name: c.name,
        groups: c.groups.map(({ id, label, match }) => ({ id, label, match })),
        serviceGroups,
        hasS3: !!c.s3,
    };
}
