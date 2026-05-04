import { execSync } from 'node:child_process'
import { Hono } from 'hono'
import { loadConfig } from './config.js'

export interface PortInfo {
  port: number
  pid?: number
  command?: string
  label: string
  active: boolean
  mem?: number  // RSS in KB
}

function getActivePorts(): Map<number, { pid: number; command: string }> {
  const map = new Map<number, { pid: number; command: string }>()
  try {
    const out = execSync('lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null', { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    for (const line of out.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 9) continue
      const [command, pid, , , , , , , name] = parts
      const portMatch = name?.match(/:(\d+)$/)
      if (!portMatch) continue
      const port = Number(portMatch[1])
      if (!map.has(port)) map.set(port, { pid: Number(pid), command })
    }
  } catch { /* ignore */ }
  return map
}

function getMemForPids(pids: number[]): Map<number, number> {
  const map = new Map<number, number>()
  if (!pids.length) return map
  try {
    const out = execSync(`ps -p ${pids.join(',')} -o pid=,rss=`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    for (const line of out.trim().split('\n')) {
      const [pid, rss] = line.trim().split(/\s+/)
      if (pid && rss) map.set(Number(pid), Number(rss))
    }
  } catch { /* ignore */ }
  return map
}

function expandPidTree(rootPids: Set<number>): Set<number> {
  try {
    const out = execSync('ps -A -o pid=,ppid=', { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    const children = new Map<number, number[]>()
    for (const line of out.trim().split('\n')) {
      const parts = line.trim().split(/\s+/)
      const pid = Number(parts[0]); const ppid = Number(parts[1])
      if (!children.has(ppid)) children.set(ppid, [])
      children.get(ppid)!.push(pid)
    }
    const result = new Set<number>(rootPids)
    const stack = [...rootPids]
    while (stack.length) {
      const pid = stack.pop()!
      for (const child of children.get(pid) ?? []) {
        if (!result.has(child)) { result.add(child); stack.push(child) }
      }
    }
    return result
  } catch { return rootPids }
}

export function getListeningPorts(managedRootPids?: Set<number>): PortInfo[] {
  const known = loadConfig().ports
  const active = getActivePorts()
  const managedPids = managedRootPids ? expandPidTree(managedRootPids) : null

  const result: PortInfo[] = known.map(({ port, label }) => {
    const info = active.get(port)
    return { port, label, active: !!info, pid: info?.pid, command: info?.command }
  })

  const knownSet = new Set(known.map(p => p.port))
  for (const [port, info] of active) {
    if (knownSet.has(port)) continue
    if (managedPids && !managedPids.has(info.pid)) continue
    result.push({ port, label: info.command, active: true, pid: info.pid, command: info.command })
  }

  const pids = result.map(p => p.pid).filter(Boolean) as number[]
  const memMap = getMemForPids(pids)
  for (const p of result) {
    if (p.pid) p.mem = memMap.get(p.pid)
  }

  return result.sort((a, b) => a.port - b.port)
}

export function createPortsRoutes(getManagedPids: () => Set<number>) {
  const routes = new Hono()
  routes.get('/', (c) => c.json({ ports: getListeningPorts(getManagedPids()) }))
  routes.delete('/:port', (c) => {
    const port = Number(c.req.param('port'))
    return c.json({ ok: killPort(port) })
  })
  return routes
}

export function killPort(port: number): boolean {
  try {
    const pids = execSync(
      `lsof -ti TCP:${port} 2>/dev/null`,
      { stdio: ['ignore', 'pipe', 'pipe'] }
    ).toString().trim()
    if (!pids) return false
    for (const pid of pids.split('\n').map(Number).filter(Boolean)) {
      try { process.kill(pid, 'SIGKILL') } catch { /* already dead */ }
    }
    return true
  } catch { return false }
}

