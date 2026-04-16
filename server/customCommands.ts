import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { PROJECT_DIR } from './env.js'
import { broadcast } from './sse.js'

const COMMANDS_FILE = join(PROJECT_DIR, 'devdash.commands.json')

type CommandEntry = { cmd: string; group?: string; working_dir?: string }
type RunningCustom = { process: ChildProcess; logs: string[] }
const running = new Map<string, RunningCustom>()

function readFile(): Record<string, CommandEntry> {
  if (!existsSync(COMMANDS_FILE)) return {}
  try {
    const raw = JSON.parse(readFileSync(COMMANDS_FILE, 'utf-8')) as Record<string, CommandEntry | string>
    return Object.fromEntries(Object.entries(raw).map(([k, v]) =>
      [k, typeof v === 'string' ? { cmd: v } : v]
    ))
  } catch { return {} }
}
function writeFile(c: Record<string, CommandEntry>): void {
  writeFileSync(COMMANDS_FILE, JSON.stringify(c, null, 2) + '\n', 'utf-8')
}

export function startCustomCommand(name: string, cmd: string, working_dir?: string): void {
  if (running.has(name)) return
  const cwd = working_dir ? join(PROJECT_DIR, working_dir) : PROJECT_DIR
  const child = spawn('sh', ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  const entry: RunningCustom = { process: child, logs: [] }
  running.set(name, entry)
  const onLine = (data: Buffer) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue
      entry.logs = [...entry.logs, line].slice(-500)
      broadcast(`[custom:${name}] ${line}`)
    }
  }
  child.stdout?.on('data', onLine)
  child.stderr?.on('data', onLine)
  child.on('exit', () => running.delete(name))
}

export function stopCustomCommand(name: string): void {
  running.get(name)?.process.kill('SIGTERM')
  running.delete(name)
}

export const customRoutes = new Hono()

customRoutes.get('/', (c) => {
  const commands = readFile()
  return c.json(Object.entries(commands).map(([name, entry]) => ({
    name, cmd: entry.cmd, group: entry.group, working_dir: entry.working_dir,
    running: running.has(name),
    pid: running.get(name)?.process.pid,
  })))
})

customRoutes.put('/', async (c) => {
  const body = await c.req.json<Record<string, CommandEntry>>()
  for (const name of Object.keys(readFile())) {
    if (!body[name]) stopCustomCommand(name)
  }
  writeFile(body)
  return c.json({ ok: true })
})

customRoutes.post('/:name/start', (c) => {
  const name = c.req.param('name')
  const entry = readFile()[name]
  if (!entry) return c.json({ error: 'unknown command' }, 404)
  startCustomCommand(name, entry.cmd, entry.working_dir)
  return c.json({ ok: true })
})

customRoutes.post('/:name/stop', (c) => {
  stopCustomCommand(c.req.param('name'))
  return c.json({ ok: true })
})

customRoutes.get('/:name/logs', (c) => {
  return c.json({ logs: running.get(c.req.param('name'))?.logs ?? [] })
})
