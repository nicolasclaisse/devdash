import './style.css'

declare global {
  interface Window {
    webkit?: { messageHandlers?: { devdash?: { postMessage: (msg: unknown) => void } } }
  }
}
import { TerminalPane } from './components/terminal'
import {
  getProcesses, startGroup, stopGroup, getOrphans, killOrphans, type Orphan,
  getCustomCommands, saveCustomCommands, startCustomCommand, stopCustomCommand, getCustomLogs,
  restartProcess,
} from './api'
import { Sidebar } from './components/sidebar'
import { LogViewer } from './components/logviewer'
import { setGroups } from './groups'
import type { Process, CustomCommands } from './types'

// ── Config bootstrap ──────────────────────────────────────────────────────
interface PublicConfig { name: string; groups: Array<{ id: string; label: string; match: Record<string, unknown> }>; hasS3: boolean; devenv: boolean }
const config: PublicConfig = await fetch('/api/config').then(r => r.json()).catch(() => ({ name: 'DevDash', groups: [], hasS3: false, devenv: false }))
if (config.groups.length) setGroups(config.groups as Parameters<typeof setGroups>[0])
document.title = config.name

// ── App shell ─────────────────────────────────────────────────────────────
const app = document.getElementById('app')!
app.innerHTML = `
  <header>
    <h1>${config.name}</h1>
    <span class="badge" title="PATH prepend mode (cfg.devenv)">${config.devenv ? 'devenv' : 'no-devenv'}</span>
    <span class="badge" id="running-count">— running</span>
    <div id="starting-procs" style="display:flex;gap:4px;flex-wrap:wrap"></div>
    <span class="badge devenv-badge" id="devenv-badge">checking…</span>
    <span id="btn-devenv-start"></span>
    <button class="btn btn-danger"  id="btn-devenv-stop"  style="display:none">Stop devenv</button>
    <div class="search">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input type="text" id="search" placeholder="Filter processes…">
    </div>
    <button class="btn btn-icon" id="btn-sysmon" title="System processes">⚡</button>
  </header>

  <div class="layout" id="main-layout">
    <div id="sidebar-container"></div>
    <main id="log-container"></main>
    <div id="sysmon-panel" class="sysmon-panel hidden"></div>
  </div>

  <!-- SSE log overlay (shown while starting/stopping) -->
  <div id="spawn-overlay" class="spawn-overlay hidden">
    <div id="terminal-pane" class="spawn-terminal-pane"></div>
    <div class="spawn-logs-pane">
      <div class="spawn-header">
        <span>devenv output</span>
        <button id="btn-close-overlay" class="clear-btn">Close</button>
      </div>
      <div id="spawn-log" class="spawn-log"></div>
    </div>
  </div>
`

// ── State ─────────────────────────────────────────────────────────────────
let processes: Process[] = []
let selected: string | null = null
let terminalOpen = false
let logsOpen = false

// ── DOM refs ──────────────────────────────────────────────────────────────
const devenvBadge = document.getElementById('devenv-badge')!
const btnStop = document.getElementById('btn-devenv-stop') as HTMLButtonElement
const spawnOverlay = document.getElementById('spawn-overlay')!
const spawnLog = document.getElementById('spawn-log')!
const searchInput = document.getElementById('search') as HTMLInputElement

// ── Sidebar + LogViewer ───────────────────────────────────────────────────
const sidebar = new Sidebar(document.getElementById('sidebar-container')!, (name) => {
  selected = name
  sidebar.setSelected(name)
  const proc = processes.find((p) => p.name === name)!
  if (name === 'prisma-studio' && proc?.status === 'healthy') {
    logViewer.showIframe('prisma-studio', 'http://localhost:5557', proc.status)
  } else {
    logViewer.select(name, proc)
  }
  sidebar.render(processes, searchInput.value)
})

sidebar.setStartGroupHandler(async (_groupId, members) => {
  appendSpawnLog(`[devdash] Starting group: ${members.join(', ')}`)
  await showOverlay()
  await startGroup(members)
  setTimeout(refresh, 1500)
})

sidebar.setStopGroupHandler(async (_groupId, members) => {
  appendSpawnLog(`[devdash] Stopping group: ${members.join(', ')}`)
  await stopGroup(members)
  setTimeout(refresh, 1000)
})

sidebar.setActionHandler(refresh)

const logViewer = new LogViewer(document.getElementById('log-container')!, refresh)
logViewer.showEmpty()


// ── Terminal ──────────────────────────────────────────────────────────────
const terminalPane = new TerminalPane(document.getElementById('terminal-pane')!)

terminalPane.registerCommand(async (cmd, args) => {
  if (cmd !== 'restart') return false
  const name = args[0]
  if (!name) { terminalPane.print('\x1b[33mUsage: restart <process-name>\x1b[0m'); return true }
  const match = processes.find(p => p.name === name)
  if (!match) { terminalPane.print(`\x1b[31mProcess "${name}" not found\x1b[0m`); return true }
  terminalPane.print(`\x1b[36m↺ Restarting ${name}…\x1b[0m`)
  selected = name
  sidebar.setSelected(name)
  await logViewer.selectAndClear(name, match)
  await restartProcess(name)
  setTimeout(() => refresh(), 800)
  return true
})


sidebar.setCustomHandlers({
  onStart: async (name) => { await startCustomCommand(name); setTimeout(refreshCustom, 500) },
  onStop: async (name) => { await stopCustomCommand(name); setTimeout(refreshCustom, 500) },
  onLogs: async (name) => {
    selected = name
    sidebar.setSelected(name)
    sidebar.render(processes, searchInput.value)
    const cmd = (await getCustomCommands()).find(c => c.name === name)
    if (name === 'pgweb' && cmd?.running) {
      logViewer.showIframe('pgweb', 'http://localhost:8091', 'healthy')
      return
    }
    const logs = await getCustomLogs(name)
    logViewer.showCustomLogs(name, logs)
  },
  onEdit: openCustomEditor,
})

async function refreshCustom() {
  const commands = await getCustomCommands()
  sidebar.setCustomCommands(commands)
  sidebar.render(processes, searchInput.value)
}

searchInput.addEventListener('input', () => sidebar.render(processes, searchInput.value))

// ── Overlay state ─────────────────────────────────────────────────────────
const termPane = document.getElementById('terminal-pane') as HTMLElement
const logsPane = spawnOverlay.querySelector<HTMLElement>('.spawn-logs-pane')!

// Initial state: both panes hidden (overlay starts with .hidden)
termPane.style.display = 'none'
logsPane.style.display = 'none'

function updateOverlayState() {
  const anyOpen = terminalOpen || logsOpen
  spawnOverlay.classList.toggle('hidden', !anyOpen)
  termPane.style.display = terminalOpen ? '' : 'none'
  logsPane.style.display = logsOpen ? '' : 'none'
  termPane.classList.toggle('pane-with-sibling', terminalOpen && logsOpen)

  const btnTerminal = document.getElementById('btn-show-terminal')
  const btnLogs = document.getElementById('btn-show-logs')
  btnTerminal?.classList.toggle('active', terminalOpen)
  btnLogs?.classList.toggle('active', logsOpen)
}

// ── SSE log stream ────────────────────────────────────────────────────────
let sseSource: EventSource | null = null

function connectSse() {
  if (sseSource) return
  sseSource = new EventSource('/shell/logs/stream')
  sseSource.onmessage = (e: MessageEvent<string>) => {
    let line: string
    try {
      line = JSON.parse(e.data) as string
    } catch {
      line = e.data
    }
    appendSpawnLog(line)
  }
  sseSource.onerror = () => {
    sseSource?.close()
    sseSource = null
    setTimeout(connectSse, 3000)
  }
}

function appendSpawnLog(line: string) {
  const div = document.createElement('div')
  div.className = 'log-line'
  div.textContent = line
  spawnLog.appendChild(div)
  spawnLog.scrollTop = spawnLog.scrollHeight
}

// ── Spawn overlay ─────────────────────────────────────────────────────────
let logsHistoryLoaded = false

async function showOverlay() {
  logsOpen = true
  if (!logsHistoryLoaded) {
    logsHistoryLoaded = true
    try {
      const res = await fetch('/shell/logs/history')
      const { logs } = await res.json() as { logs: string[] }
      logs.forEach(appendSpawnLog)
    } catch { /* ignore */ }
  }
  spawnLog.scrollTop = spawnLog.scrollHeight
  updateOverlayState()
}

document.getElementById('btn-close-overlay')!.addEventListener('click', () => {
  terminalOpen = false
  logsOpen = false
  updateOverlayState()
})

// ── Header buttons: Terminal + Logs ──────────────────────────────────────
const btnTerminal = document.createElement('button')
btnTerminal.className = 'btn'
btnTerminal.id = 'btn-show-terminal'
btnTerminal.textContent = 'Terminal'
btnTerminal.style.fontSize = '11px'
btnTerminal.addEventListener('click', () => {
  terminalOpen = !terminalOpen
  updateOverlayState()
  if (terminalOpen) terminalPane.focus()
})
document.querySelector('header')!.insertBefore(btnTerminal, document.getElementById('btn-devenv-start'))

const btnLogs = document.createElement('button')
btnLogs.className = 'btn'
btnLogs.id = 'btn-show-logs'
btnLogs.textContent = 'Logs'
btnLogs.style.fontSize = '11px'
btnLogs.addEventListener('click', async () => {
  if (!logsOpen) {
    await showOverlay()
  } else {
    logsOpen = false
    updateOverlayState()
  }
})
document.querySelector('header')!.insertBefore(btnLogs, document.getElementById('btn-devenv-start'))

// ── S3 browser ────────────────────────────────────────────────────────────
const btnS3 = document.createElement('button')
btnS3.className = 'btn'
btnS3.textContent = 'S3'
btnS3.style.fontSize = '11px'
btnS3.addEventListener('click', openS3Browser)
document.querySelector('header')!.insertBefore(btnS3, document.getElementById('btn-devenv-start'))

interface S3Object { key: string; size: number; lastModified?: string }

async function openS3Browser() {
  const overlay = document.createElement('div')
  overlay.className = 'editor-overlay'
  overlay.innerHTML = `
    <div class="editor-modal s3-modal">
      <div class="editor-header">
        <div class="s3-breadcrumb" id="s3-breadcrumb">
          <span class="s3-crumb s3-crumb-root">S3</span>
        </div>
        <button class="clear-btn" id="btn-s3-close">✕</button>
      </div>
      <div id="s3-body" class="s3-body">
        <span class="s3-loading">Loading…</span>
      </div>
      <div id="s3-preview" class="s3-preview hidden"></div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('#btn-s3-close')!.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  const body = overlay.querySelector<HTMLElement>('#s3-body')!
  const preview = overlay.querySelector<HTMLElement>('#s3-preview')!
  const breadcrumb = overlay.querySelector<HTMLElement>('#s3-breadcrumb')!
  const modal = overlay.querySelector<HTMLElement>('.s3-modal')!

  let currentBucket: string | null = null
  let currentPrefix = ''

  function showPreview(url: string, filename: string) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)
    body.classList.add('hidden')
    modal.classList.add('s3-modal-preview')
    preview.classList.remove('hidden')
    preview.innerHTML = `
      <div class="s3-preview-bar">
        <button class="clear-btn" id="btn-s3-back">← Back</button>
        <span class="s3-preview-name">${filename}</span>
      </div>
      <div class="s3-preview-content">
        ${isImage
          ? `<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain">`
          : `<iframe src="${url}" style="width:100%;height:100%;border:none"></iframe>`
        }
      </div>
    `
    preview.querySelector('#btn-s3-back')!.addEventListener('click', () => {
      preview.classList.add('hidden')
      preview.innerHTML = ''
      body.classList.remove('hidden')
      modal.classList.remove('s3-modal-preview')
    })
  }

  function renderBreadcrumb() {
    const parts = currentPrefix.replace(/\/$/, '').split('/')
    let html = `<span class="s3-crumb s3-crumb-root" data-action="root">S3</span>`
    if (currentBucket) {
      html += `<span class="s3-sep">›</span><span class="s3-crumb" data-action="bucket">${currentBucket}</span>`
      let acc = ''
      for (const part of parts.filter(Boolean)) {
        acc += part + '/'
        const prefix = acc
        html += `<span class="s3-sep">›</span><span class="s3-crumb" data-prefix="${prefix}">${part}</span>`
      }
    }
    breadcrumb.innerHTML = html
    breadcrumb.querySelectorAll<HTMLElement>('.s3-crumb').forEach(el => {
      el.addEventListener('click', () => {
        const action = el.dataset.action
        const prefix = el.dataset.prefix
        if (action === 'root') { currentBucket = null; currentPrefix = ''; loadBuckets() }
        else if (action === 'bucket') { currentPrefix = ''; browseFolder('') }
        else if (prefix) { currentPrefix = prefix; browseFolder(prefix) }
      })
    })
  }

  async function loadBuckets() {
    body.innerHTML = `<span class="s3-loading">Loading…</span>`
    renderBreadcrumb()
    try {
      const res = await fetch('/s3/buckets')
      const { buckets, error } = await res.json() as { buckets?: { name: string }[]; error?: string }
      if (error) { body.innerHTML = `<div class="s3-error">${error}</div>`; return }
      if (!buckets?.length) { body.innerHTML = `<div class="s3-empty">No buckets found</div>`; return }
      body.innerHTML = buckets.map(b => `
        <div class="s3-row s3-bucket" data-bucket="${b.name}">
          <span class="s3-icon">🪣</span>
          <span class="s3-name">${b.name}</span>
        </div>
      `).join('')
      body.querySelectorAll<HTMLElement>('.s3-bucket').forEach(el => {
        el.addEventListener('click', () => {
          currentBucket = el.dataset.bucket!
          currentPrefix = ''
          browseFolder('')
        })
      })
    } catch {
      body.innerHTML = `<div class="s3-error">Failed to connect — check AWS credentials</div>`
    }
  }

  async function browseFolder(prefix: string) {
    currentPrefix = prefix
    body.innerHTML = `<span class="s3-loading">Loading…</span>`
    renderBreadcrumb()
    try {
      const res = await fetch(`/s3/browse/${encodeURIComponent(currentBucket!)}?prefix=${encodeURIComponent(prefix)}`)
      const { folders, objects, truncated, error } = await res.json() as {
        folders?: string[]; objects?: S3Object[]; truncated?: boolean; error?: string
      }
      if (error) { body.innerHTML = `<div class="s3-error">${error}</div>`; return }

      let html = ''
      if (!folders?.length && !objects?.length) {
        html = `<div class="s3-empty">Empty folder</div>`
      } else {
        for (const f of folders ?? []) {
          const name = f.slice(prefix.length).replace(/\/$/, '')
          html += `<div class="s3-row s3-folder" data-prefix="${f}">
            <span class="s3-icon">📁</span>
            <span class="s3-name">${name}/</span>
          </div>`
        }
        for (const o of objects ?? []) {
          const name = o.key.slice(prefix.length)
          const size = formatSize(o.size)
          html += `<div class="s3-row s3-object" data-key="${o.key}">
            <span class="s3-icon">📄</span>
            <span class="s3-name s3-object-name" style="cursor:pointer">${name}</span>
            <span class="s3-meta">${size}</span>
          </div>`
        }
        if (truncated) html += `<div class="s3-truncated">Results truncated at 500 items</div>`
      }
      body.innerHTML = html

      body.querySelectorAll<HTMLElement>('.s3-folder').forEach(el => {
        el.addEventListener('click', () => browseFolder(el.dataset.prefix!))
      })
      body.querySelectorAll<HTMLElement>('.s3-object').forEach(el => {
        el.addEventListener('click', async () => {
          const key = el.dataset.key!
          const name = el.querySelector('.s3-object-name')!
          name.textContent = '…'
          const res = await fetch(`/s3/presign/${encodeURIComponent(currentBucket!)}?key=${encodeURIComponent(key)}`)
          const { url, error } = await res.json() as { url?: string; error?: string }
          if (url) {
            showPreview(url, key.split('/').pop() ?? key)
          } else {
            name.textContent = error ?? 'Error'
            setTimeout(() => { name.textContent = key.split('/').pop() ?? key }, 2000)
          }
        })
      })
    } catch {
      body.innerHTML = `<div class="s3-error">Failed to load</div>`
    }
  }

  loadBuckets()
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ── Sysmon panel ─────────────────────────────────────────────────────────
interface SysProcess { pid: number; name: string; mem: number; cpu: number }
interface MemBreakdown { active: number; wired: number; compressed: number; fileCache: number; free: number }

const btnSysmon = document.getElementById('btn-sysmon') as HTMLButtonElement
const sysmonPanel = document.getElementById('sysmon-panel') as HTMLElement

function fmtSysMem(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB'
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + ' MB'
  return (bytes / 1024).toFixed(0) + ' KB'
}

async function renderSysmon() {
  const body = sysmonPanel.querySelector<HTMLElement>('#sysmon-body')!
  const totalEl = sysmonPanel.querySelector<HTMLElement>('#sysmon-total')!
  body.innerHTML = `<div class="sysmon-loading">Loading…</div>`
  try {
    const res = await fetch('/sysmon')
    const { processes, total, mem } = await res.json() as { processes: SysProcess[]; total: number; mem: MemBreakdown }
    totalEl.textContent = fmtSysMem(total)
    const memHtml = mem ? `
      <div class="sysmon-mem-breakdown">
        <div class="sysmon-mem-row"><span>Active</span><span>${fmtSysMem(mem.active)}</span></div>
        <div class="sysmon-mem-row"><span>Wired</span><span>${fmtSysMem(mem.wired)}</span></div>
        <div class="sysmon-mem-row"><span>Compressed</span><span>${fmtSysMem(mem.compressed)}</span></div>
        <div class="sysmon-mem-row"><span>File cache</span><span>${fmtSysMem(mem.fileCache)}</span></div>
        <div class="sysmon-mem-row"><span>Free</span><span class="sysmon-mem-free">${fmtSysMem(mem.free)}</span></div>
      </div>
    ` : ''
    body.innerHTML = memHtml + processes.map(p => `
      <div class="sysmon-row">
        <span class="sysmon-name">${p.name}</span>
        <span class="sysmon-mem">${fmtSysMem(p.mem)}</span>
      </div>
    `).join('')
  } catch {
    body.innerHTML = `<div class="sysmon-loading">Error loading</div>`
  }
}

sysmonPanel.innerHTML = `
  <div class="sysmon-header">
    <span class="sysmon-title">System</span>
    <span class="sysmon-total" id="sysmon-total"></span>
    <button class="clear-btn" id="btn-sysmon-refresh">↻</button>
  </div>
  <div id="sysmon-body" class="sysmon-body"></div>
`
sysmonPanel.querySelector('#btn-sysmon-refresh')!.addEventListener('click', renderSysmon)

btnSysmon.addEventListener('click', () => {
  const open = sysmonPanel.classList.contains('hidden')
  sysmonPanel.classList.toggle('hidden', !open)
  btnSysmon.classList.toggle('active', open)
  if (open) renderSysmon()
})

// ── Ports modal ───────────────────────────────────────────────────────────
const btnPorts = document.createElement('button')
btnPorts.className = 'btn'
btnPorts.textContent = 'Ports'
btnPorts.style.fontSize = '11px'
btnPorts.addEventListener('click', openPortsModal)
document.querySelector('header')!.insertBefore(btnPorts, document.getElementById('btn-devenv-start'))

interface PortInfo { port: number; pid?: number; command?: string; label: string; active: boolean; mem?: number }

async function openPortsModal() {
  const overlay = document.createElement('div')
  overlay.className = 'editor-overlay'
  overlay.innerHTML = `
    <div class="editor-modal" style="width:460px;max-height:80vh;display:flex;flex-direction:column">
      <div class="editor-header">
        <span>Listening ports</span>
        <button class="clear-btn" id="btn-ports-close">✕</button>
      </div>
      <div id="ports-body" style="flex:1;overflow-y:auto;padding:8px 0">
        <span style="display:block;text-align:center;padding:24px;color:var(--muted);font-size:12px">Scanning…</span>
      </div>
    </div>
  `
  document.body.appendChild(overlay)
  overlay.querySelector('#btn-ports-close')!.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  const body = overlay.querySelector<HTMLElement>('#ports-body')!

  const load = async () => {
    const res = await fetch('/ports')
    const { ports } = await res.json() as { ports: PortInfo[] }
    if (!ports.length) {
      body.innerHTML = `<span style="display:block;text-align:center;padding:24px;color:var(--muted);font-size:12px">No listening ports found</span>`
      return
    }
    body.innerHTML = ports.map(p => `
      <div class="port-row" style="display:flex;align-items:center;gap:10px;padding:7px 16px;border-bottom:1px solid var(--border);opacity:${p.active ? '1' : '0.35'}">
        <div class="status-dot ${p.active ? 'dot-running' : 'dot-disabled'}" style="flex-shrink:0"></div>
        <span style="font-family:var(--mono);font-size:12px;color:var(--accent);width:50px;flex-shrink:0">${p.port}</span>
        <span style="flex:1;font-size:12px;color:var(--text)">${p.label}</span>
        ${p.mem ? `<span style="font-size:10px;color:var(--muted);width:52px;text-align:right;flex-shrink:0">${p.mem > 1024 ? (p.mem / 1024).toFixed(0) + ' MB' : p.mem + ' KB'}</span>` : '<span style="width:52px;flex-shrink:0"></span>'}
        ${p.pid ? `<span style="font-size:10px;color:var(--muted);width:70px;flex-shrink:0">PID ${p.pid}</span>` : '<span style="width:70px;flex-shrink:0"></span>'}
        ${p.active ? `<button class="btn btn-danger btn-kill-port" data-port="${p.port}" style="font-size:10px;padding:2px 8px">Kill</button>` : ''}
      </div>
    `).join('')

    body.querySelectorAll<HTMLButtonElement>('.btn-kill-port').forEach(btn => {
      btn.addEventListener('click', async () => {
        const port = btn.dataset.port!
        btn.textContent = '…'
        btn.disabled = true
        await fetch(`/ports/${port}`, { method: 'DELETE' })
        await load()
      })
    })
  }

  await load()
}

// ── Orphans modal ─────────────────────────────────────────────────────────
const btnOrphans = document.createElement('button')
btnOrphans.className = 'btn'
btnOrphans.textContent = 'Orphans'
btnOrphans.style.fontSize = '11px'
btnOrphans.addEventListener('click', openOrphansModal)
document.querySelector('header')!.insertBefore(btnOrphans, document.getElementById('btn-devenv-start'))

function openOrphansModal() {
  const overlay = document.createElement('div')
  overlay.className = 'editor-overlay'
  overlay.innerHTML = `
    <div class="editor-modal" style="width:420px">
      <div class="editor-header">
        <span>Orphan processes</span>
        <button class="clear-btn" id="btn-orphans-close">✕</button>
      </div>
      <div id="orphans-body" style="padding:12px 16px;min-height:80px;display:flex;align-items:center;justify-content:center">
        <span style="color:var(--muted);font-size:12px">Scanning…</span>
      </div>
      <div class="editor-footer">
        <button class="btn btn-danger" id="btn-kill-all" disabled>Kill all</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const body = overlay.querySelector<HTMLElement>('#orphans-body')!
  const btnKill = overlay.querySelector<HTMLButtonElement>('#btn-kill-all')!

  overlay.querySelector('#btn-orphans-close')!.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  let orphans: Orphan[] = []

  const renderOrphans = () => {
    if (!orphans.length) {
      body.innerHTML = `<span style="color:var(--muted);font-size:12px">No orphan processes found ✓</span>`
      btnKill.disabled = true
      return
    }
    btnKill.disabled = false
    body.innerHTML = orphans.map(o => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div class="status-dot dot-running"></div>
        <span style="flex:1;font-size:12px">${o.name}</span>
        <span style="font-size:10px;color:var(--muted)">PIDs: ${o.pids.join(', ')}</span>
      </div>
    `).join('')
  }

  getOrphans().then(result => { orphans = result; renderOrphans() })

  btnKill.addEventListener('click', async () => {
    btnKill.disabled = true
    btnKill.textContent = 'Killing…'
    await killOrphans()
    orphans = await getOrphans()
    renderOrphans()
    btnKill.textContent = 'Kill all'
  })
}

// ── Custom editor modal ───────────────────────────────────────────────────
function openCustomEditor() {
  getCustomCommands().then(commands => {
    const existingGroups = [...new Set(commands.map(c => c.group).filter(Boolean))] as string[]

    const overlay = document.createElement('div')
    overlay.className = 'editor-overlay'
    overlay.innerHTML = `
      <div class="editor-modal" style="width:720px">
        <div class="editor-header">
          <span>Custom commands</span>
          <button class="clear-btn" id="btn-editor-close">✕</button>
        </div>
        <datalist id="groups-list">
          ${existingGroups.map(g => `<option value="${g}">`).join('')}
        </datalist>
        <div class="editor-rows" id="editor-rows"></div>
        <div class="editor-add-row">
          <button class="btn" id="btn-add-row" style="font-size:11px">+ Add</button>
        </div>
        <div class="editor-footer">
          <button class="btn" id="btn-editor-cancel">Cancel</button>
          <button class="btn btn-primary" id="btn-editor-save">Save</button>
        </div>
      </div>
    `

    const rowsEl = overlay.querySelector<HTMLElement>('#editor-rows')!

    const addRow = (name = '', cmd = '', group = '', dir = '') => {
      const row = document.createElement('div')
      row.className = 'editor-row'
      row.innerHTML = `
        <input class="input-group" type="text" placeholder="group" value="${group}" list="groups-list" spellcheck="false">
        <input class="input-name" type="text" placeholder="name" value="${name}" spellcheck="false">
        <input class="input-dir" type="text" placeholder="dir (optional)" value="${dir}" spellcheck="false">
        <input class="input-cmd" type="text" placeholder="command" value="${cmd}" spellcheck="false">
        <button class="btn-row-delete" title="Remove">✕</button>
      `
      row.querySelector('.btn-row-delete')!.addEventListener('click', () => row.remove())
      row.querySelector<HTMLInputElement>('.input-group')!.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') row.querySelector<HTMLInputElement>('.input-name')!.focus()
      })
      row.querySelector<HTMLInputElement>('.input-name')!.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') row.querySelector<HTMLInputElement>('.input-dir')!.focus()
      })
      row.querySelector<HTMLInputElement>('.input-dir')!.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') row.querySelector<HTMLInputElement>('.input-cmd')!.focus()
      })
      row.querySelector<HTMLInputElement>('.input-cmd')!.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { addRow(); rowsEl.lastElementChild?.querySelector<HTMLInputElement>('.input-group')?.focus() }
      })
      rowsEl.appendChild(row)
      return row
    }

    commands.forEach(c => addRow(c.name, c.cmd, c.group ?? '', c.working_dir ?? ''))

    const close = () => overlay.remove()
    overlay.querySelector('#btn-editor-close')!.addEventListener('click', close)
    overlay.querySelector('#btn-editor-cancel')!.addEventListener('click', close)
    overlay.querySelector('#btn-add-row')!.addEventListener('click', () => {
      addRow()
      rowsEl.lastElementChild?.querySelector<HTMLInputElement>('.input-group')?.focus()
    })
    overlay.querySelector('#btn-editor-save')!.addEventListener('click', async () => {
      const result: CustomCommands = {}
      rowsEl.querySelectorAll<HTMLElement>('.editor-row').forEach(row => {
        const name = row.querySelector<HTMLInputElement>('.input-name')!.value.trim()
        const cmd = row.querySelector<HTMLInputElement>('.input-cmd')!.value.trim()
        const group = row.querySelector<HTMLInputElement>('.input-group')!.value.trim()
        const dir = row.querySelector<HTMLInputElement>('.input-dir')!.value.trim()
        if (name && cmd) result[name] = { cmd, ...(group ? { group } : {}), ...(dir ? { working_dir: dir } : {}) }
      })
      await saveCustomCommands(result)
      close()
      await refreshCustom()
    })

    document.body.appendChild(overlay)
    if (commands.length === 0) addRow()
    rowsEl.querySelector<HTMLInputElement>('.input-group')?.focus()
  })
}

// ── Devenv state ──────────────────────────────────────────────────────────
async function checkDevenv() {
  try {
    const res = await fetch('/shell/status')
    const { running } = (await res.json()) as { running: boolean }
    setDevenvState(running)
  } catch {
    setDevenvState(false)
  }
}

function setDevenvState(running: boolean) {
  devenvBadge.textContent = running ? 'running' : 'stopped'
  devenvBadge.className = `badge devenv-badge ${running ? 'badge-running' : 'badge-stopped'}`

  btnStop.style.display = running ? '' : 'none'

  refreshCustom()
}

async function doStartDevenv() {
  await showOverlay()
  await fetch('/shell/start', { method: 'POST' })
}

async function doStopDevenv() {
  await showOverlay()
  await fetch('/shell/stop', { method: 'POST' })
}

btnStop.addEventListener('click', doStopDevenv)

// ── Refresh ───────────────────────────────────────────────────────────────
async function refresh() {
  try {
    processes = await getProcesses()
  } catch {
    processes = []
  }
  const running = processes.filter((p) => p.is_running).length
  document.getElementById('running-count')!.textContent = `${running} running`

  const startingEl = document.getElementById('starting-procs')!
  const starting = processes.filter((p) => p.status === 'starting')
  startingEl.innerHTML = starting.map(p =>
    `<span class="badge badge-starting">${p.name}</span>`
  ).join('')
  sidebar.render(processes, searchInput.value)
  if (selected) {
    const proc = processes.find((p) => p.name === selected)
    if (proc) logViewer.updateStatus(proc)
  }
}

// ── Auto-refresh ──────────────────────────────────────────────────────────
setInterval(checkDevenv, 5000)
setInterval(refresh, 3000)

// ── Init ──────────────────────────────────────────────────────────────────
connectSse()
checkDevenv()
refresh()
