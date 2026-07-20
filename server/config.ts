import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ServiceDef } from '../gen.js'
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
  match?: MatchSpec
  services?: ServiceDef[]
}

export interface PortDef {
  port: number
  label: string
  url?: string
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
  logsDir: string
  groups: GroupDef[]
  ports: PortDef[]
  readyPatterns: string[]
  s3?: S3Config
}

const OTHER_GROUP: GroupDef = { id: 'other', label: 'Other', match: {} }

const BUILTIN_PORTS: PortDef[] = [
  { port: 52800, label: 'devdash (vite)' },
  { port: 52801, label: 'devdash (vite hmr)' },
  { port: 52802, label: 'devdash (server)' },
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
  const userGroups = (user.groups ?? []).filter(g => g.id !== OTHER_GROUP.id)
  cached = {
    name: user.name ?? 'DevDash',
    devenv: user.devenv ?? false,
    logsDir: user.logsDir ?? `${PROJECT_DIR}/logs`,
    groups: [...userGroups, OTHER_GROUP],
    ports: [...BUILTIN_PORTS, ...(user.ports ?? [])],
    readyPatterns: [...BUILTIN_READY_PATTERNS, ...(user.readyPatterns ?? [])],
    s3: user.s3,
  }
  return cached
}

export function reloadConfig(): DevDashConfig {
  cached = null
  return loadConfig()
}

/** Inline services declared across all groups, each tagged with its owning group id. */
export function inlineServices(cfg: DevDashConfig): Array<ServiceDef & { groupId: string }> {
  return cfg.groups.flatMap(g => (g.services ?? []).map(s => ({ ...s, groupId: g.id })))
}

export function matches(spec: MatchSpec | undefined, name: string): boolean {
  if (!spec) return false
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
  const serviceGroups: Record<string, string> = {}
  for (const s of inlineServices(c)) serviceGroups[s.name] = s.groupId
  return {
    name: c.name,
    groups: c.groups.map(({ id, label, match }) => ({ id, label, match })),
    serviceGroups,
    hasS3: !!c.s3,
  }
}
