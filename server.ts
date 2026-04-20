import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { SERVER_PORT, PROJECT_DIR } from './server/env.js'
import { sseClients, serverLogs, log } from './server/sse.js'
import { ProcessManager } from './server/processManager.js'
import { getOrphans, killOrphans } from './server/orphans.js'
import { portsRoutes } from './server/ports.js'
import { createCustomRoutes } from './server/customCommands.js'
import { handleUpgrade } from './server/terminal.js'
import { s3Routes } from './server/s3.js'
import { sysmonRoutes } from './server/sysmon.js'
import { loadConfig, reloadConfig, publicConfig } from './server/config.js'

// ── Process manager ────────────────────────────────────────────────────────
loadConfig()
const pm = new ProcessManager()
pm.load()

// Reload defs when processes.nix or devdash.config.json changes (poll-based, fs.watch is unreliable on macOS)
const watchFiles = [
  { path: join(PROJECT_DIR, 'processes.nix'), label: 'processes.nix', mtime: 0 },
  { path: join(PROJECT_DIR, 'devdash.config.json'), label: 'devdash.config.json', mtime: 0 },
]
for (const f of watchFiles) {
  try { f.mtime = statSync(f.path).mtimeMs } catch { /* file may not exist yet */ }
}
setInterval(() => {
  for (const f of watchFiles) {
    try {
      const mt = statSync(f.path).mtimeMs
      if (mt !== f.mtime) {
        f.mtime = mt
        reloadConfig(); pm.load(); log(`[devdash] Reloaded ${f.label}`)
      }
    } catch { /* file may not exist */ }
  }
}, 2000)

const getCoreProcesses = () => loadConfig().infra.map(i => i.name)
const ALL_PROCESSES = pm.defs.map(d => d.name)

// ── Hono app ───────────────────────────────────────────────────────────────
const app = new Hono()

// Status & lifecycle
app.get('/shell/status', (c) => c.json({ running: pm.isAnyRunning() }))

app.post('/shell/start', (c) => {
  pm.load()
  pm.startMany(ALL_PROCESSES)
  return c.json({ ok: true })
})
app.post('/shell/start/core', (c) => {
  pm.load()
  pm.startMany(getCoreProcesses())
  return c.json({ ok: true })
})
app.post('/shell/stop', (c) => { pm.stopAll(); return c.json({ ok: true }) })

app.post('/shell/start/:process', (c) => { pm.startOne(c.req.param('process')); return c.json({ ok: true }) })
app.post('/shell/stop/:process',  (c) => { pm.stop(c.req.param('process'));    return c.json({ ok: true }) })
app.post('/shell/restart/:process', (c) => { pm.restart(c.req.param('process')); return c.json({ ok: true }) })

// Shutdown
function doShutdown() {
  log('[devdash] Shutting down...')
  pm.stopAll()
  const fallback = setTimeout(() => process.exit(0), 8_000)
  fallback.unref()
  const check = () => {
    if (!pm.isAnyRunning()) { log('[devdash] All stopped.'); process.exit(0) }
    else setTimeout(check, 500)
  }
  setTimeout(check, 500)
}
app.post('/shell/shutdown', (c) => { setTimeout(doShutdown, 100); return c.json({ ok: true }) })
process.on('SIGTERM', doShutdown)
process.on('SIGINT', doShutdown)

// Process list & logs
app.get('/api/processes', (c) => c.json({ data: pm.getAll() }))
app.get('/api/process/logs/:name/:offset/:limit', (c) => {
  const { name, offset, limit } = c.req.param()
  return c.json(pm.getLogs(name, Number(offset), Number(limit)))
})
app.delete('/api/process/logs/:name', (c) => { pm.clearLogs(c.req.param('name')); return c.json({ ok: true }) })

// Orphans
app.get('/shell/orphans',       (c) => c.json({ orphans: getOrphans() }))
app.post('/shell/orphans/kill', (c) => c.json({ killed: killOrphans() }))

// SSE
app.get('/shell/logs/history', (c) => c.json({ logs: serverLogs }))
app.get('/shell/logs/stream', (c) => {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const client = { send: (d: string) => writer.write(encoder.encode(`data: ${JSON.stringify(d)}\n\n`)) }
  sseClients.add(client)
  c.req.raw.signal.addEventListener('abort', () => { sseClients.delete(client); writer.close().catch(() => {}) })
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
})

// Config (public view, no secrets)
app.get('/api/config', (c) => c.json(publicConfig()))

// Custom commands
app.route('/custom', createCustomRoutes(pm))

// S3 browser (returns 501 if not configured)
app.route('/s3', s3Routes)

// System monitor
app.route('/sysmon', sysmonRoutes)

// Ports
app.route('/ports', portsRoutes)


// Static frontend
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
const distPath = existsSync(join(import.meta.dirname, 'index.html')) ? import.meta.dirname : join(import.meta.dirname, 'dist')
if (existsSync(distPath)) {
  app.get('*', (c) => {
    const filePath = join(distPath, new URL(c.req.url).pathname)
    if (existsSync(filePath) && !filePath.endsWith('/')) {
      return new Response(readFileSync(filePath), { headers: { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' } })
    }
    return c.html(readFileSync(join(distPath, 'index.html'), 'utf-8'))
  })
}

// ── Start ──────────────────────────────────────────────────────────────────
const server = serve({ fetch: app.fetch, port: SERVER_PORT }, (info) => {
  console.log(`devdash listening on http://localhost:${info.port}`)
})
server.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head))
