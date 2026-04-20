import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { PROJECT_DIR } from './env.js'
import type { ProcessManager } from './processManager.js'

const COMMANDS_FILE = join(PROJECT_DIR, 'devdash.commands.json')

type CommandEntry = { cmd: string; group?: string; working_dir?: string }
const customNames = new Set<string>()

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

export function isCustomProcess(name: string): boolean {
  return customNames.has(name)
}

export function createCustomRoutes(pm: ProcessManager): Hono {
  const routes = new Hono()

  routes.get('/', (c) => {
    const commands = readFile()
    return c.json(Object.entries(commands).map(([name, entry]) => ({
      name, cmd: entry.cmd, group: entry.group, working_dir: entry.working_dir,
      running: ['running', 'healthy', 'starting'].includes(pm.getStatus(name)),
      pid: pm.getProcessInfo(name)?.pid,
    })))
  })

  routes.put('/', async (c) => {
    const body = await c.req.json<Record<string, CommandEntry>>()
    const old = readFile()
    for (const name of Object.keys(old)) {
      if (!body[name] && customNames.has(name)) {
        pm.stop(name)
        customNames.delete(name)
      }
    }
    writeFile(body)
    return c.json({ ok: true })
  })

  routes.post('/:name/start', (c) => {
    const name = c.req.param('name')
    const entry = readFile()[name]
    if (!entry) return c.json({ error: 'unknown command' }, 404)
    customNames.add(name)
    pm.startDynamic(name, entry.cmd, entry.working_dir)
    return c.json({ ok: true })
  })

  routes.post('/:name/stop', (c) => {
    pm.stop(c.req.param('name'))
    return c.json({ ok: true })
  })

  // Logs are served via the regular /api/process/logs/:name endpoint now
  routes.get('/:name/logs', (c) => {
    const name = c.req.param('name')
    const { logs } = pm.getLogs(name, 0, 1000)
    return c.json({ logs })
  })

  return routes
}
