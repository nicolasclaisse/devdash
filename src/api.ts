import type { Process } from './types'

const PC_API = '/api'
const SHELL_API = '/shell'

// ── process-compose REST API ───────────────────────────────────────────────

export async function getProcesses(): Promise<Process[]> {
  const res = await fetch(`${PC_API}/processes`)
  const json = (await res.json()) as { data?: Process[] }
  return (json.data ?? []).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getLogs(name: string, offset: number, limit = 200): Promise<{ logs: string[]; offset: number }> {
  const res = await fetch(`${PC_API}/process/logs/${name}/${offset}/${limit}`)
  const json = (await res.json()) as { logs?: string[] }
  const lines = json.logs ?? []
  return { logs: lines, offset: offset + lines.length }
}

export async function clearLogs(name: string): Promise<void> {
  await fetch(`${PC_API}/process/logs/${name}`, { method: 'DELETE' })
}

export async function startProcess(name: string): Promise<void> {
  await fetch(`${SHELL_API}/start/${name}`, { method: 'POST' })
}

export async function stopProcess(name: string): Promise<void> {
  await fetch(`${SHELL_API}/stop/${name}`, { method: 'POST' })
}

export async function restartProcess(name: string): Promise<void> {
  await fetch(`${SHELL_API}/restart/${name}`, { method: 'POST' })
}

// ── Shell control API ─────────────────────────────────────────────────────


export async function startGroup(processNames: string[]): Promise<void> {
  await Promise.all(processNames.map((name) => clearLogs(name)))
  await Promise.all(processNames.map((name) => fetch(`${SHELL_API}/start/${name}`, { method: 'POST' })))
}

export async function stopGroup(processNames: string[]): Promise<void> {
  await Promise.all(
    processNames.map((name) => fetch(`${SHELL_API}/stop/${name}`, { method: 'POST' }))
  )
}

// ── Ports API ─────────────────────────────────────────────────────────────

export interface PortInfo { port: number; pid?: number; command?: string; label: string; active: boolean; mem?: number; url?: string }

export async function getPorts(): Promise<PortInfo[]> {
  const res = await fetch('/ports')
  const { ports } = await res.json() as { ports: PortInfo[] }
  return ports
}

// ── Custom commands API ───────────────────────────────────────────────────

import type { CustomCommand, CustomCommands } from './types'

const CUSTOM_API = '/custom'

export async function getCustomCommands(): Promise<CustomCommand[]> {
  const res = await fetch(CUSTOM_API)
  return res.json() as Promise<CustomCommand[]>
}

export async function saveCustomCommands(commands: CustomCommands): Promise<void> {
  await fetch(CUSTOM_API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  })
}

export async function startCustomCommand(name: string): Promise<void> {
  await fetch(`${CUSTOM_API}/${name}/start`, { method: 'POST' })
}

export async function stopCustomCommand(name: string): Promise<void> {
  await fetch(`${CUSTOM_API}/${name}/stop`, { method: 'POST' })
}

export async function getCustomLogs(name: string): Promise<string[]> {
  const res = await fetch(`${CUSTOM_API}/${name}/logs`)
  const json = await res.json() as { logs: string[] }
  return json.logs
}
