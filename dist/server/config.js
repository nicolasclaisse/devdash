import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_DIR } from './env.js';
const BUILTIN_GROUPS = [
    { id: 'infra', label: 'Infrastructure', match: { in: ['postgres', 'redis', 'minio', 'mailpit'] } },
    { id: 'utils', label: 'Utils', match: { in: [] } },
    { id: 'workers', label: 'Workers', match: { regex: '-workers?$' } },
    { id: 'other', label: 'Other', match: {} },
];
const BUILTIN_PORTS = [
    { port: 52800, label: 'devdash (vite)' },
    { port: 52802, label: 'devdash (server)' },
    { port: 5432, label: 'postgres' },
    { port: 6379, label: 'redis' },
    { port: 1025, label: 'mailpit SMTP' },
    { port: 8025, label: 'mailpit UI' },
    { port: 9000, label: 'minio' },
    { port: 9001, label: 'minio console' },
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
    const utils = user.utils ?? [];
    cached = {
        name: user.name ?? 'DevDash',
        devenv: user.devenv ?? false,
        groups: mergeGroups(user.groups ?? [], utils.map(u => u.name)),
        ports: [...BUILTIN_PORTS, ...(user.ports ?? [])],
        orphans: user.orphans ?? [],
        readyPatterns: [...BUILTIN_READY_PATTERNS, ...(user.readyPatterns ?? [])],
        s3: user.s3,
        infra: user.infra ?? [],
        utils,
    };
    return cached;
}
export function reloadConfig() {
    cached = null;
    return loadConfig();
}
/** Insert user groups between the built-in 'infra'/'utils' groups and the 'workers'/'other' fallback groups. */
function mergeGroups(userGroups, utilsNames) {
    const infra = BUILTIN_GROUPS.find(g => g.id === 'infra');
    const utils = { ...BUILTIN_GROUPS.find(g => g.id === 'utils'), match: { in: utilsNames } };
    const workers = BUILTIN_GROUPS.find(g => g.id === 'workers');
    const other = BUILTIN_GROUPS.find(g => g.id === 'other');
    const filtered = userGroups.filter(g => !['infra', 'utils', 'workers', 'other'].includes(g.id));
    return [infra, utils, ...filtered, workers, other];
}
export function matches(spec, name) {
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
    return {
        name: c.name,
        groups: c.groups,
        hasS3: !!c.s3,
    };
}
