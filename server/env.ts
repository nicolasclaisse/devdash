import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

function resolveProjectDir(): string {
  const fromEnv = process.env.DEVDASH_PROJECT
  if (fromEnv) return resolve(fromEnv)
  const fromArg = process.argv[2]
  if (fromArg && !fromArg.startsWith('-')) return resolve(fromArg)
  return process.cwd()
}

export const PROJECT_DIR = resolveProjectDir()

if (!existsSync(join(PROJECT_DIR, 'processes.nix'))) {
  console.error(`[devdash] processes.nix not found in ${PROJECT_DIR}`)
  console.error(`[devdash] run \`devdash <project-dir>\` or set DEVDASH_PROJECT=<dir>`)
  process.exit(1)
}

function isPortFree(port: number): boolean {
  try {
    execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { stdio: 'pipe' })
    return false
  } catch {
    return true
  }
}

/** Pick the first free port in [start, start+max). Lets multiple devdash instances coexist. */
function pickFreePort(start: number, max = 100): number {
  for (let p = start; p < start + max; p++) {
    if (isPortFree(p)) return p
  }
  throw new Error(`[devdash] no free port found in ${start}-${start + max - 1}`)
}

export const DEVENV_BIN = join(PROJECT_DIR, '.devenv/profile/bin')
export const SERVER_PORT = process.env.SERVER_PORT
  ? Number(process.env.SERVER_PORT)
  : pickFreePort(52800)

// Spawned processes must run the node version the project pins (.nvmrc), not whatever node happens to be first on the system PATH.
function resolveProjectNodeBin(projectDir: string): string | null {
  const nvmrc = join(projectDir, '.nvmrc')
  if (!existsSync(nvmrc)) return null
  const major = readFileSync(nvmrc, 'utf8').trim().replace(/^v/, '').split('.')[0]
  const nvmDir = join(process.env.HOME!, '.nvm/versions/node')
  const match = existsSync(nvmDir)
    ? readdirSync(nvmDir).filter(v => v.startsWith(`v${major}.`)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
    : undefined
  if (!match) {
    console.error(`[devdash] node ${major} requis (.nvmrc) mais introuvable via nvm - lance \`nvm install ${major}\``)
    process.exit(1)
  }
  return join(nvmDir, match, 'bin')
}

const PROJECT_NODE_BIN = resolveProjectNodeBin(PROJECT_DIR)

export const SPAWN_ENV = {
  ...process.env,
  PATH: [
    ...(PROJECT_NODE_BIN ? [PROJECT_NODE_BIN] : []),
    DEVENV_BIN,
    `${process.env.HOME}/.nix-profile/bin`,
    '/nix/var/nix/profiles/default/bin',
    process.env.PATH ?? '',
  ].join(':'),
}
