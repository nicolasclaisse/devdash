import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
function resolveProjectDir() {
    const fromEnv = process.env.DEVDASH_PROJECT;
    if (fromEnv)
        return resolve(fromEnv);
    const fromArg = process.argv[2];
    if (fromArg && !fromArg.startsWith('-'))
        return resolve(fromArg);
    return process.cwd();
}
export const PROJECT_DIR = resolveProjectDir();
if (!existsSync(join(PROJECT_DIR, 'processes.nix'))) {
    console.error(`[devdash] processes.nix not found in ${PROJECT_DIR}`);
    console.error(`[devdash] run \`devdash <project-dir>\` or set DEVDASH_PROJECT=<dir>`);
    process.exit(1);
}
function isPortFree(port) {
    try {
        execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { stdio: 'pipe' });
        return false;
    }
    catch {
        return true;
    }
}
/** Pick the first free port in [start, start+max). Lets multiple devdash instances coexist. */
function pickFreePort(start, max = 100) {
    for (let p = start; p < start + max; p++) {
        if (isPortFree(p))
            return p;
    }
    throw new Error(`[devdash] no free port found in ${start}-${start + max - 1}`);
}
export const DEVENV_BIN = join(PROJECT_DIR, '.devenv/profile/bin');
export const SERVER_PORT = process.env.SERVER_PORT
    ? Number(process.env.SERVER_PORT)
    : pickFreePort(52800);
export const SPAWN_ENV = {
    ...process.env,
    PATH: [
        DEVENV_BIN,
        `${process.env.HOME}/.nix-profile/bin`,
        '/nix/var/nix/profiles/default/bin',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        process.env.PATH ?? '',
    ].join(':'),
};
