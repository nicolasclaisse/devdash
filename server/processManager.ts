import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { getProcessDefs, type ProcessDef } from '../gen.js'
import { PROJECT_DIR, DEVENV_BIN, SPAWN_ENV } from './env.js'
import { loadConfig } from './config.js'
import { log, broadcast } from './sse.js'

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'healthy' | 'completed' | 'failed'

interface ProcessState {
  def: ProcessDef
  child?: ChildProcess
  pid?: number
  status: ProcessStatus
  exitCode?: number
  logs: string[]
  restarts: number
  startedAt?: Date
  removeListeners?: () => void
}

export class ProcessManager {
  private states = new Map<string, ProcessState>()
  defs: ProcessDef[] = []

  load() {
    const cfg = loadConfig()
    this.defs = getProcessDefs(PROJECT_DIR, [...cfg.infra, ...cfg.utils])
    for (const def of this.defs) {
      if (!this.states.has(def.name)) {
        this.states.set(def.name, { def, status: 'stopped', logs: [], restarts: 0 })
      } else {
        this.states.get(def.name)!.def = def
      }
      log(`[devdash] loaded ${def.name}: ${def.exec.trim().split('\n').pop()?.trim()}`)
    }
  }

  isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true } catch { return false }
  }

  getStatus(name: string): ProcessStatus {
    const s = this.states.get(name)
    if (!s) return 'stopped'
    if (s.pid && !this.isAlive(s.pid)) {
      s.status = s.exitCode === 0 ? 'completed' : 'failed'
      s.pid = undefined
    }
    return s.status
  }

  private async runHealthCheck(def: ProcessDef): Promise<boolean> {
    const hc = def.health_check
    if (!hc) return true
    try {
      if (hc.type === 'exec' && hc.command) {
        execSync(hc.command, { stdio: 'ignore', timeout: 3000, env: SPAWN_ENV })
        return true
      }
      if (hc.type === 'http') {
        const res = await fetch(`http://${hc.host ?? 'localhost'}:${hc.port}${hc.path ?? '/'}`)
        return res.ok
      }
    } catch { /* not healthy yet */ }
    return false
  }

  private async waitFor(name: string, condition: string, timeoutMs = 120_000): Promise<boolean> {
    const start = Date.now()
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
    const state = this.states.get(name)

    while (Date.now() - start < timeoutMs) {
      const status = this.getStatus(name)

      if (condition === 'process_completed_successfully') {
        if (status === 'completed') return true
        if (status === 'failed') return false
      } else if (condition === 'process_started') {
        if (['running', 'healthy', 'completed'].includes(status)) return true
        if (status === 'failed') return false
      } else if (condition === 'process_healthy') {
        if (status === 'healthy') return true
        if (status === 'failed' || status === 'completed') return false
        if (status === 'running' && state?.def) {
          if (await this.runHealthCheck(state.def)) return true
        }
      }

      await delay(1000)
    }
    return false
  }

  private getReadyPatterns(): RegExp[] {
    return loadConfig().readyPatterns.map(p => new RegExp(p))
  }

  private addLog(name: string, line: string) {
    const s = this.states.get(name)
    if (!s) return
    s.logs.push(line)
    if (s.logs.length > 2000) s.logs.shift()
    broadcast(`[${name}] ${line}`)

    // Auto-detect healthy from log output
    if (s.status === 'running' || s.status === 'starting') {
      if (this.getReadyPatterns().some(re => re.test(line))) {
        s.status = 'healthy'
        log(`[devdash] ${name} is healthy (log pattern)`)
      }
    }
  }

  private doSpawn(name: string): void {
    const s = this.states.get(name)
    if (!s) return
    const { def } = s

    const workDir = def.working_dir ? join(PROJECT_DIR, def.working_dir) : PROJECT_DIR
    const script = loadConfig().devenv
      ? `export PATH="${DEVENV_BIN}:$PATH"\n${def.exec}`
      : def.exec

    log(`[devdash] Starting: ${name}`)
    const child = spawn('sh', ['-c', script], {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: SPAWN_ENV,
      detached: true,
    })

    s.child = child
    s.pid = child.pid
    s.status = 'starting'
    s.startedAt = new Date()

    let stopped = false

    const onData = (data: Buffer) => {
      if (stopped) return
      for (const line of data.toString().split('\n')) {
        if (line.trim()) this.addLog(name, line)
      }
    }

    const onExit = (code: number | null) => {
      if (stopped) return
      s.pid = undefined
      s.child = undefined
      s.exitCode = code ?? -1
      s.status = code === 0 ? 'completed' : 'failed'
      log(`[devdash] ${name} exited with code ${code}`)
      if (code !== 0 && def.brew) {
        log(`[devdash] ${name} crashed — if the binary is missing, try: brew install ${def.brew}`)
      }
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', onExit)
    child.on('error', (err) => { if (!stopped) this.addLog(name, `[error] ${err.message}`) })

    s.removeListeners = () => {
      stopped = true
      child.stdout?.removeListener('data', onData)
      child.stderr?.removeListener('data', onData)
      child.removeListener('exit', onExit)
    }

    setTimeout(() => {
      if (s.status === 'starting') s.status = 'running'
      if (def.health_check) this.pollHealthy(name)
    }, (def.health_check?.initial_delay_seconds ?? 1) * 1000)
  }

  private pollHealthy(name: string): void {
    const s = this.states.get(name)
    if (!s?.def.health_check) return
    const period = (s.def.health_check.period_seconds ?? 2) * 1000
    const maxAttempts = s.def.health_check.failure_threshold ?? 15

    let attempts = 0
    const check = async () => {
      if (this.getStatus(name) !== 'running') return
      if (await this.runHealthCheck(s.def)) {
        s.status = 'healthy'
        log(`[devdash] ${name} is healthy`)
        return
      }
      attempts++
      if (attempts < maxAttempts) setTimeout(check, period)
      else log(`[devdash] ${name} health check failed after ${maxAttempts} attempts`)
    }
    setTimeout(check, period)
  }

  async startOne(name: string): Promise<void> {
    const s = this.states.get(name)
    if (!s) { log(`[devdash] Unknown process: ${name}`); return }
    if (['running', 'healthy', 'starting', 'completed'].includes(s.status)) return

    // Mark as starting immediately to prevent concurrent startOne calls
    s.status = 'starting'

    for (const [dep, condition] of Object.entries(s.def.depends_on)) {
      const depStatus = this.getStatus(dep)
      if (depStatus === 'stopped' || depStatus === 'failed') {
        this.startOne(dep).catch((e: Error) => log(`[devdash] ${dep} error: ${e.message}`))
      }
      log(`[devdash] ${name} waiting for ${dep} (${condition})`)
      const ok = await this.waitFor(dep, condition)
      if (!ok) { log(`[devdash] ${name} dep ${dep} not satisfied — aborting`); s.status = 'failed'; return }
    }

    this.doSpawn(name)
  }

  startMany(names: string[]): void {
    for (const name of names) {
      if (this.states.has(name)) {
        this.startOne(name).catch((e: Error) => log(`[devdash] ${name} error: ${e.message}`))
      }
    }
  }

  stop(name: string): void {
    const s = this.states.get(name)
    if (!s?.child) return
    const pid = s.child.pid
    s.removeListeners?.()
    s.removeListeners = undefined
    if (pid) {
      try { process.kill(-pid, 'SIGTERM') } catch { s.child.kill('SIGTERM') }
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL') } catch { /* already dead */ }
      }, 5000)
    }
    s.status = 'stopped'
    s.pid = undefined
    s.child = undefined
    log(`[devdash] Stopped: ${name}`)
  }

  stopAll(): void {
    for (const name of this.states.keys()) this.stop(name)
  }

  restart(name: string): void {
    this.stop(name)
    setTimeout(() => this.startOne(name), 1000)
  }

  isAnyRunning(): boolean {
    return [...this.states.values()].some(s => ['running', 'healthy', 'starting'].includes(s.status))
  }

  private sampleStats(): Map<number, { cpu: number; mem: number }> {
    const map = new Map<number, { cpu: number; mem: number }>()
    const roots = [...this.states.values()].map(s => s.pid).filter(Boolean) as number[]
    if (!roots.length) return map

    try {
      // Collect all processes: pid → { ppid, cpu, mem }
      const out = execSync(
        'ps -A -o pid=,ppid=,pcpu=,rss=',
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: 2000 }
      ).toString()

      const all = new Map<number, { ppid: number; cpu: number; mem: number }>()
      for (const line of out.trim().split('\n')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 4) continue
        const [pid, ppid, cpu, rss] = parts
        all.set(Number(pid), { ppid: Number(ppid), cpu: parseFloat(cpu) || 0, mem: Number(rss) * 1024 })
      }

      // Build children map for fast tree traversal
      const children = new Map<number, number[]>()
      for (const [pid, { ppid }] of all) {
        if (!children.has(ppid)) children.set(ppid, [])
        children.get(ppid)!.push(pid)
      }

      // Sum all descendants of a root PID (inclusive)
      const sumTree = (root: number): { cpu: number; mem: number } => {
        const acc = { cpu: 0, mem: 0 }
        const stack = [root]
        while (stack.length) {
          const pid = stack.pop()!
          const entry = all.get(pid)
          if (entry) { acc.cpu += entry.cpu; acc.mem += entry.mem }
          for (const child of children.get(pid) ?? []) stack.push(child)
        }
        return acc
      }

      for (const root of roots) map.set(root, sumTree(root))
    } catch { /* ps failed */ }

    return map
  }

  getAll(): object[] {
    const stats = this.sampleStats()
    return [...this.states.values()].map(s => {
      const status = this.getStatus(s.def.name)
      const st = s.pid ? stats.get(s.pid) : undefined

      // Deps not yet satisfied (only relevant while starting)
      const waitingFor = status === 'starting'
        ? Object.entries(s.def.depends_on)
            .filter(([dep]) => !['healthy', 'running', 'completed'].includes(this.getStatus(dep)))
            .map(([dep]) => dep)
        : []

      return {
        name: s.def.name,
        status,
        is_running: ['running', 'healthy', 'starting'].includes(status),
        pid: s.pid,
        restarts: s.restarts,
        exit_code: s.exitCode,
        system_time: s.startedAt ? formatDuration(Date.now() - s.startedAt.getTime()) : '',
        mem: st?.mem ?? 0,
        cpu: st?.cpu ?? 0,
        waiting_for: waitingFor,
      }
    })
  }

  getLogs(name: string, offset: number, limit: number): { logs: string[]; offset: number } {
    const s = this.states.get(name)
    const all = s?.logs ?? []
    const slice = all.slice(offset, offset + limit)
    return { logs: slice, offset: offset + slice.length }
  }

  clearLogs(name: string): void {
    const s = this.states.get(name)
    if (s) s.logs = []
  }
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m${s % 60}s`
}
