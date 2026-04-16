import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InfraDef } from '../gen.js'
import { PROJECT_DIR } from './env.js'

export interface MatchSpec {
  in?: string[]
  startsWith?: string
  endsWith?: string
  equals?: string
  regex?: string
}

export interface GroupDef {
  id: string
  label: string
  match: MatchSpec
}

export interface PortDef {
  port: number
  label: string
}

export interface OrphanPattern {
  name: string
  pattern: string
}

export interface S3Config {
  endpoint: string
  region?: string
  accessKey: string
  secretKey: string
  forcePathStyle?: boolean
}

export interface DevDashConfig {
  name: string
  devenv: boolean
  groups: GroupDef[]
  ports: PortDef[]
  orphans: OrphanPattern[]
  readyPatterns: string[]
  s3?: S3Config
  infra: InfraDef[]
}

const BUILTIN_GROUPS: GroupDef[] = [
  { id: 'infra',   label: 'Infrastructure', match: { in: ['postgres', 'redis', 'minio', 'mailpit'] } },
  { id: 'workers', label: 'Workers',        match: { regex: '-workers?$' } },
  { id: 'other',   label: 'Other',          match: {} },
]

const BUILTIN_PORTS: PortDef[] = [
  { port: 52800, label: 'devdash (vite)' },
  { port: 52802, label: 'devdash (server)' },
  { port: 5432, label: 'postgres' },
  { port: 6379, label: 'redis' },
  { port: 1025, label: 'mailpit SMTP' },
  { port: 8025, label: 'mailpit UI' },
  { port: 9000, label: 'minio' },
  { port: 9001, label: 'minio console' },
]

const BUILTIN_READY_PATTERNS = [
  'VITE v[\\d.]+ {2}ready in \\d+',
  '✓ Ready in \\d+',
  'Nest application successfully started',
  'Application started on port',
  'Server ready at http',
  'Prisma Studio is running at',
  'Development Server .* started',
  'worker ready',
]

let cached: DevDashConfig | null = null

export function loadConfig(): DevDashConfig {
  if (cached) return cached
  const path = join(PROJECT_DIR, 'devdash.config.json')
  const user = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf-8')) as Partial<DevDashConfig>)
    : {}
  cached = {
    name: user.name ?? 'DevDash',
    devenv: user.devenv ?? false,
    groups: mergeGroups(user.groups ?? []),
    ports: [...BUILTIN_PORTS, ...(user.ports ?? [])],
    orphans: user.orphans ?? [],
    readyPatterns: [...BUILTIN_READY_PATTERNS, ...(user.readyPatterns ?? [])],
    s3: user.s3,
    infra: user.infra ?? [],
  }
  return cached
}

export function reloadConfig(): DevDashConfig {
  cached = null
  return loadConfig()
}

/** Insert user groups between the built-in 'infra' group and the 'workers'/'other' fallback groups. */
function mergeGroups(userGroups: GroupDef[]): GroupDef[] {
  const infra = BUILTIN_GROUPS.find(g => g.id === 'infra')!
  const workers = BUILTIN_GROUPS.find(g => g.id === 'workers')!
  const other = BUILTIN_GROUPS.find(g => g.id === 'other')!
  const filtered = userGroups.filter(g => !['infra', 'workers', 'other'].includes(g.id))
  return [infra, ...filtered, workers, other]
}

export function matches(spec: MatchSpec, name: string): boolean {
  if (spec.in && spec.in.includes(name)) return true
  if (spec.startsWith && name.startsWith(spec.startsWith)) return true
  if (spec.endsWith && name.endsWith(spec.endsWith)) return true
  if (spec.equals && name === spec.equals) return true
  if (spec.regex && new RegExp(spec.regex).test(name)) return true
  if (!spec.in && !spec.startsWith && !spec.endsWith && !spec.equals && !spec.regex) return true
  return false
}

/** Public view of the config (strips secrets) — exposed via /api/config to the frontend. */
export function publicConfig() {
  const c = loadConfig()
  return {
    name: c.name,
    groups: c.groups,
    hasS3: !!c.s3,
  }
}
