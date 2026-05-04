import { appendFile, stat, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOG_SIZE_LIMIT = 1024 * 1024 // 1 MB
const ROTATION_KEEP = 500
const ROTATION_CHECK = 100

const lineCounts = new Map<string, number>()
let _logsDir = ''

export function initLogsDir(dir: string): void {
  _logsDir = dir
  mkdirSync(dir, { recursive: true })
}

function logPath(name: string) {
  return join(_logsDir, `${name}.log`)
}

export function appendLog(name: string, line: string): void {
  if (!_logsDir) return
  const path = logPath(name)
  appendFile(path, line + '\n').catch(() => {})
  const count = (lineCounts.get(name) ?? 0) + 1
  lineCounts.set(name, count)
  if (count % ROTATION_CHECK === 0) rotateIfNeeded(name, path)
}

async function rotateIfNeeded(name: string, path: string): Promise<void> {
  try {
    const { size } = await stat(path)
    if (size <= LOG_SIZE_LIMIT) return
    const content = await readFile(path, 'utf-8')
    const lines = content.split('\n').filter(l => l.length > 0)
    const kept = lines.slice(-ROTATION_KEEP)
    await writeFile(path, kept.join('\n') + '\n')
    lineCounts.set(name, kept.length)
  } catch { /* ignore */ }
}

export function readLogs(name: string, offset: number, limit: number): { logs: string[]; offset: number } {
  if (!_logsDir) return { logs: [], offset }
  const path = logPath(name)
  if (!existsSync(path)) return { logs: [], offset }
  try {
    const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.length > 0)
    const slice = lines.slice(offset, offset + limit)
    return { logs: slice, offset: offset + slice.length }
  } catch {
    return { logs: [], offset }
  }
}

export function clearLog(name: string): void {
  if (!_logsDir) return
  writeFile(logPath(name), '').catch(() => {})
  lineCounts.set(name, 0)
}

export function readServerLogs(): string[] {
  return readLogs('devdash', 0, 10000).logs
}
