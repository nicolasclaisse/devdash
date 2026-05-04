import { appendLog } from './logWriter.js'

type SseClient = { send: (data: string) => void }

export const sseClients = new Set<SseClient>()

export function broadcast(line: string) {
  for (const c of sseClients) c.send(line)
}

export function log(line: string) {
  const s = `[${new Date().toISOString()}] ${line}`
  appendLog('devdash', s)
  console.log(s)
  broadcast(s)
}
