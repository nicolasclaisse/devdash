import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import * as pty from 'node-pty'
import { PROJECT_DIR, SPAWN_ENV } from './env.js'
import { log } from './sse.js'

const wss = new WebSocketServer({ noServer: true })

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  if (req.url !== '/ws/terminal') return
  wss.handleUpgrade(req, socket as any, head, (ws) => {
    wss.emit('connection', ws, req)
    spawnPty(ws)
  })
}

function spawnPty(ws: WebSocket): void {
  const shell = process.env.SHELL ?? 'bash'

  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: PROJECT_DIR,
    env: {
      ...(SPAWN_ENV as Record<string, string>),
      TERM: 'xterm-256color',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
      LSCOLORS: 'ExGxBxDxCxegedabagacad',
      BASH_SILENCE_DEPRECATION_WARNING: '1',
    },
  })

  log(`[devdash] Terminal PTY spawned (PID: ${term.pid})`)

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data)
  })

  term.onExit(({ exitCode }) => {
    log(`[devdash] Terminal PTY exited (code: ${exitCode})`)
    if (ws.readyState === ws.OPEN) ws.close()
  })

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; data?: string; cols?: number; rows?: number }
      if (msg.type === 'input' && msg.data != null) term.write(msg.data)
      else if (msg.type === 'resize' && msg.cols && msg.rows) term.resize(msg.cols, msg.rows)
    } catch {
      term.write(raw.toString())
    }
  })

  ws.on('close', () => {
    try { term.kill() } catch { /* already dead */ }
  })
}
