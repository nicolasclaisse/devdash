import type { Process } from '../types'
import { getLogs, clearLogs } from '../api'

export class LogViewer {
  private el: HTMLElement
  private name: string | null = null
  private lines: string[] = []
  private offset = 0
  private autoScroll = true
  private es: EventSource | null = null

  constructor(container: HTMLElement, _onAction: () => void) {
    this.el = container
  }

  async select(name: string, process: Process) {
    this.stop()
    this.name = name
    this.lines = []
    this.offset = 0
    this.renderShell(process)
    await this.fetchLogs()
    this.startSSE(name)
  }

  async selectAndClear(name: string, process: Process) {
    await clearLogs(name)
    await this.select(name, process)
  }

  stop() {
    if (this.es) { this.es.close(); this.es = null }
  }

  private startSSE(name: string) {
    this.es = new EventSource('/shell/logs/stream')
    this.es.onmessage = (e) => {
      const line = JSON.parse(e.data) as string
      const prefix = `[${name}] `
      if (!line.startsWith(prefix)) return
      this.appendLine(line.slice(prefix.length))
    }
  }

  private appendLine(line: string) {
    this.lines = [...this.lines, line].slice(-2000)
    const panel = this.el.querySelector<HTMLElement>('#log-panel')
    const count = this.el.querySelector<HTMLElement>('#log-count')
    if (!panel) return
    if (count) count.textContent = `${this.lines.length} lines`
    const div = document.createElement('div')
    div.className = `log-line ${colorLine(line)}`
    div.textContent = line
    panel.appendChild(div)
    if (panel.children.length > 2000) panel.firstChild?.remove()
    if (this.autoScroll) requestAnimationFrame(() => { panel.scrollTop = panel.scrollHeight })
  }

  showEmpty() {
    this.stop()
    this.name = null
    this.el.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <path d="M8 21h8M12 17v4"/>
        </svg>
        <p>Select a process to view logs</p>
      </div>
    `
  }

  showIframe(name: string, url: string, status: string) {
    this.stop()
    this.name = name
    this.el.innerHTML = `
      <div class="log-header">
        <span class="proc-name">${name}</span>
        <span class="status-pill ${statusPill(status)}">${status}</span>
        <div class="actions">
          <a href="${url}" target="_blank" class="btn" style="text-decoration:none;font-size:11px">Open in browser ↗</a>
        </div>
      </div>
      <iframe src="${url}" style="flex:1;border:none;background:#fff"></iframe>
    `
  }

  showCustomLogs(name: string, logs: string[]) {
    this.stop()
    this.name = null
    this.el.innerHTML = `
      <div class="log-header">
        <span class="proc-name">${name}</span>
        <span class="status-pill pill-running">custom</span>
      </div>
      <div class="log-toolbar">
        <span>${logs.length} lines</span>
      </div>
      <div class="log-panel" id="log-panel">
        ${logs.map(l => `<div class="log-line">${escHtml(l)}</div>`).join('')}
      </div>
    `
    const panel = this.el.querySelector<HTMLElement>('#log-panel')
    if (panel) panel.scrollTop = panel.scrollHeight
  }

  updateStatus(process: Process) {
    const pill = this.el.querySelector<HTMLElement>('.status-pill')
    if (pill) {
      pill.className = `status-pill ${statusPill(process.status)}`
      pill.textContent = process.status
    }
    const header = this.el.querySelector<HTMLElement>('.log-header')
    if (!header) return
    const existing = header.querySelector<HTMLElement>('.proc-waiting, .proc-stats')
    if (!existing) return
    const next = document.createElement('span')
    if (process.waiting_for?.length) {
      next.className = 'proc-waiting'
      next.innerHTML = `waiting for ${process.waiting_for.map(d => `<span class="waiting-dep">${d}</span>`).join(', ')}`
    } else {
      next.className = 'proc-stats'
      next.innerHTML = procStats(process)
    }
    existing.replaceWith(next)
  }

  private renderShell(process: Process) {
    this.el.innerHTML = `
      <div class="log-header">
        <span class="proc-name">${this.name}</span>
        <span class="status-pill ${statusPill(process.status)}">${process.status}</span>
        ${process.waiting_for?.length ? `<span class="proc-waiting">waiting for ${process.waiting_for.map(d => `<span class="waiting-dep">${d}</span>`).join(', ')}</span>` : `<span class="proc-stats">${procStats(process)}</span>`}
        <div class="actions"></div>
      </div>
      <div class="log-toolbar">
        <span id="log-count">0 lines</span>
        <button class="clear-btn" id="btn-clear">Clear view</button>
        <label class="autoscroll-toggle">
          <input type="checkbox" id="autoscroll" checked> Auto-scroll
        </label>
      </div>
      <div class="log-panel" id="log-panel"></div>
    `
    this.el.querySelector('#autoscroll')!.addEventListener('change', (e) => {
      this.autoScroll = (e.target as HTMLInputElement).checked
    })
    this.el.querySelector('#btn-clear')!.addEventListener('click', () => this.clear())
  }

  private async fetchLogs() {
    if (!this.name) return
    const { logs, offset } = await getLogs(this.name, this.offset)
    if (!logs.length) return
    this.lines = [...this.lines, ...logs].slice(-2000)
    this.offset = offset
    this.renderLines()
  }

  private renderLines() {
    const panel = this.el.querySelector<HTMLElement>('#log-panel')
    const count = this.el.querySelector<HTMLElement>('#log-count')
    if (!panel) return
    if (count) count.textContent = `${this.lines.length} lines`
    panel.innerHTML = this.lines.map((line) =>
      `<div class="log-line ${colorLine(line)}">${escHtml(line)}</div>`
    ).join('')
    if (this.autoScroll) requestAnimationFrame(() => { panel.scrollTop = panel.scrollHeight })
  }

  private async clear() {
    if (!this.name) return
    this.lines = []
    this.offset = 0
    this.renderLines()
    await clearLogs(this.name)
  }
}

function statusPill(status: string) {
  const s = status.toLowerCase()
  if (s === 'running' || s === 'healthy') return 'pill-running'
  if (s === 'failed' || s === 'error') return 'pill-stopped'
  if (s === 'starting' || s === 'launching') return 'pill-launching'
  if (s === 'completed') return 'pill-disabled'
  return 'pill-stopped'
}

function colorLine(line: string) {
  const l = line.toLowerCase()
  if (l.includes('error') || l.includes('fatal') || l.includes('exception')) return 'err'
  if (l.includes('warn')) return 'warn'
  if (l.includes('info') || l.includes('ready') || l.includes('listening') || l.includes('started')) return 'info'
  return ''
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function procStats(p: Process): string {
  const parts: string[] = []
  if (p.pid) parts.push(`<span class="proc-stat">PID ${p.pid}</span>`)
  if (p.mem) parts.push(`<span class="proc-stat">${(p.mem / 1024 / 1024).toFixed(0)} MB</span>`)
  if (p.cpu) parts.push(`<span class="proc-stat">CPU ${p.cpu.toFixed(1)}%</span>`)
  if (p.system_time) parts.push(`<span class="proc-stat">⏱ ${p.system_time}</span>`)
  return parts.join('')
}
