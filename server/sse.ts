type SseClient = { send: (data: string) => void }

export const sseClients = new Set<SseClient>()

export function broadcast(line: string) {
  for (const c of sseClients) c.send(line)
}

export const serverLogs: string[] = []

export function log(line: string) {
  const s = `[${new Date().toISOString()}] ${line}`
  serverLogs.push(s)
  if (serverLogs.length > 2000) serverLogs.shift()
  console.log(s)
  broadcast(s)
}
