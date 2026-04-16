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
export const DEVENV_BIN = join(PROJECT_DIR, '.devenv/profile/bin');
export const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3280);
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
