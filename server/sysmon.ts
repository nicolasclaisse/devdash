import { execSync } from 'node:child_process'
import { Hono } from 'hono'

export interface SysProcess {
  pid: number
  name: string
  mem: number  // bytes
  cpu: number  // percent
}

export function getSysProcesses(): SysProcess[] {
  const groups = new Map<string, { mem: number; cpu: number; pid: number }>()

  try {
    const out = execSync('ps aux', { stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }).toString()
    for (const line of out.trim().split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 11) continue
      const pid = Number(parts[1])
      const cpu = parseFloat(parts[2]) || 0
      const rss = Number(parts[5]) * 1024
      const fullCmd = parts.slice(10).join(' ')

      const name = categorize(fullCmd)
      const existing = groups.get(name)
      if (existing) {
        existing.mem += rss
        existing.cpu += cpu
      } else {
        groups.set(name, { mem: rss, cpu, pid })
      }
    }
  } catch { /* ignore */ }

  return [...groups.entries()]
    .map(([name, { mem, cpu, pid }]) => ({ pid, name, mem, cpu }))
    .sort((a, b) => b.mem - a.mem)
    .slice(0, 30)
}

function categorize(cmd: string): string {
  if (cmd.match(/Slack/)) return 'Slack'
  if (cmd.match(/Arc.*Renderer|arc.*renderer/)) return 'Arc (renderers)'
  if (cmd.match(/Arc/)) return 'Arc'
  if (cmd.match(/Brave.*Renderer|Brave.*Helper \(Renderer\)/)) return 'Brave (renderers)'
  if (cmd.match(/Brave/)) return 'Brave'
  if (cmd.match(/Google Chrome.*Renderer/)) return 'Chrome (renderers)'
  if (cmd.match(/Google Chrome/)) return 'Chrome'
  if (cmd.match(/tsserver/)) return 'VSCode tsserver'
  if (cmd.match(/eslintServer/)) return 'VSCode ESLint'
  if (cmd.match(/Code Helper \(Plugin\)/)) return 'VSCode (plugins)'
  if (cmd.match(/Code Helper \(Renderer\)/)) return 'VSCode (renderers)'
  if (cmd.match(/Visual Studio Code|Code\.app/)) return 'VSCode'
  if (cmd.match(/node.*devdash/)) return 'devdash'
  if (cmd.match(/next-server|next start/)) return 'Next.js'
  if (cmd.match(/nest/)) return 'NestJS'
  if (cmd.match(/[Nn]ode/)) return 'Node.js (other)'
  if (cmd.match(/postgres/)) return 'PostgreSQL'
  if (cmd.match(/redis/)) return 'Redis'
  if (cmd.match(/mds_stores/)) return 'Spotlight'
  if (cmd.match(/WebKit|WebContent/)) return 'WebKit'
  if (cmd.match(/claude/)) return 'Claude Code'
  if (cmd.match(/Dock|Finder|WindowServer|loginwindow|SystemUIServer/)) return 'macOS UI'
  if (cmd.match(/Xcode/)) return 'Xcode'
  if (cmd.match(/simulator/i)) return 'Simulator'
  // Generic: keep binary name only
  const bin = cmd.split('/').pop()?.split(' ')[0] ?? cmd
  return bin.length > 40 ? bin.slice(0, 40) + '…' : bin
}

export function getTotalMem(): number {
  try {
    const out = execSync('ps aux', { stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }).toString()
    let total = 0
    for (const line of out.trim().split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 6) total += Number(parts[5]) * 1024
    }
    return total
  } catch { return 0 }
}

export interface MemBreakdown {
  active: number
  wired: number
  compressed: number
  fileCache: number
  free: number
}

export function getMemBreakdown(): MemBreakdown {
  try {
    const out = execSync('vm_stat', { stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }).toString()
    const pageMatch = out.match(/page size of (\d+) bytes/)
    const page = pageMatch ? Number(pageMatch[1]) : 16384
    const get = (key: string) => {
      const m = out.match(new RegExp(key + ':\\s+(\\d+)'))
      return m ? Number(m[1]) * page : 0
    }
    const free = get('Pages free')
    const fileCache = get('File-backed pages')
    return {
      active:     get('Pages active'),
      wired:      get('Pages wired down'),
      compressed: get('Pages occupied by compressor'),
      fileCache,
      free:       free + fileCache, // free + reclaimable cache = mémoire réellement disponible
    }
  } catch { return { active: 0, wired: 0, compressed: 0, fileCache: 0, free: 0 } }
}

export const sysmonRoutes = new Hono()
sysmonRoutes.get('/', (c) => {
  const processes = getSysProcesses()
  const total = processes.reduce((acc, p) => acc + p.mem, 0)
  const mem = getMemBreakdown()
  return c.json({ processes, total, mem })
})
