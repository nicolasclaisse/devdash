import type { Process, CustomCommand } from '../types'
import { GROUPS, groupFor } from '../groups'
import { startProcess, stopProcess, restartProcess } from '../api'

export class Sidebar {
  private el: HTMLElement
  private collapsed = new Set<string>()
  private onSelect: (name: string) => void
  private onStartGroup: ((groupId: string, members: string[]) => void) | null = null
  private onStopGroup: ((groupId: string, members: string[]) => void) | null = null
  private onAction: (() => void) | null = null
  private selected: string | null = null
  private customCommands: CustomCommand[] = []
  private onCustomStart: ((name: string) => void) | null = null
  private onCustomStop: ((name: string) => void) | null = null
  private onCustomLogs: ((name: string) => void) | null = null
  private onCustomEdit: (() => void) | null = null

  constructor(container: HTMLElement, onSelect: (name: string) => void) {
    this.onSelect = onSelect
    container.innerHTML = `
      <aside>
        <div class="sidebar-header">
          <span>Processes</span>
        </div>
        <div class="process-list" id="process-list"></div>
      </aside>
    `
    this.el = container.querySelector('#process-list')!
  }

  setSelected(name: string | null) {
    this.selected = name
  }

  setStartGroupHandler(handler: (groupId: string, members: string[]) => void) {
    this.onStartGroup = handler
  }

  setStopGroupHandler(handler: (groupId: string, members: string[]) => void) {
    this.onStopGroup = handler
  }

  setActionHandler(handler: () => void) {
    this.onAction = handler
  }

  setCustomCommands(commands: CustomCommand[]) {
    this.customCommands = commands
  }

  setCustomHandlers(handlers: {
    onStart: (name: string) => void
    onStop: (name: string) => void
    onLogs: (name: string) => void
    onEdit: () => void
  }) {
    this.onCustomStart = handlers.onStart
    this.onCustomStop = handlers.onStop
    this.onCustomLogs = handlers.onLogs
    this.onCustomEdit = handlers.onEdit
  }

  render(processes: Process[], search: string) {
    this.el.innerHTML = ''

    // Custom commands that match a known group label get merged in
    const mergedCustom = new Set<string>()

    GROUPS.forEach((group) => {
      const members = processes.filter((p) => {
        const inGroup = groupFor(p.name).id === group.id
        const visible = !search || p.name.includes(search.toLowerCase())
        return inGroup && visible
      })
      const customMembers = this.customCommands.filter(c => {
        const matches = (c.group ?? '') === group.label
        const visible = !search || c.name.includes(search.toLowerCase())
        if (matches && visible) mergedCustom.add(c.name)
        return matches && visible
      })
      if (!members.length && !customMembers.length) return

      const collapsed = this.collapsed.has(group.id)
      const runningCustom = customMembers.filter(c => c.running).length
      const running = members.filter((p) => p.is_running).length + runningCustom
      const total = members.length + customMembers.length
      const allRunning = running === total

      const groupEl = document.createElement('div')
      groupEl.className = 'group'
      groupEl.innerHTML = `
        <div class="group-header ${collapsed ? 'collapsed' : ''}" data-group="${group.id}">
          <svg class="group-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="m6 9 6 6 6-6"/>
          </svg>
          ${group.label}
          <span class="group-count">${running}/${total}</span>
          ${!allRunning ? `<button class="btn-start-group" data-group="${group.id}" title="Start ${group.label}">Start</button>` : ''}
          ${running > 0 ? `<button class="btn-stop-group" data-group="${group.id}" title="Stop ${group.label}">Stop</button>` : ''}
        </div>
        <div class="group-body" style="${collapsed ? 'display:none' : ''}"></div>
      `

      const header = groupEl.querySelector('.group-header')!
      header.addEventListener('click', (e) => {
        // Don't toggle collapse when clicking the start button
        if ((e.target as HTMLElement).classList.contains('btn-start-group')) return
        this.collapsed.has(group.id) ? this.collapsed.delete(group.id) : this.collapsed.add(group.id)
        this.render(processes, search)
      })

      const startBtn = groupEl.querySelector<HTMLButtonElement>('.btn-start-group')
      startBtn?.addEventListener('click', (e) => {
        e.stopPropagation()
        if (this.onStartGroup) {
          this.onStartGroup(group.id, members.map((p) => p.name))
        }
      })

      const stopBtn = groupEl.querySelector<HTMLButtonElement>('.btn-stop-group')
      stopBtn?.addEventListener('click', (e) => {
        e.stopPropagation()
        if (this.onStopGroup) {
          this.onStopGroup(group.id, members.filter((p) => p.is_running).map((p) => p.name))
        }
      })

      const body = groupEl.querySelector('.group-body')!
      members.forEach((p) => {
        const item = document.createElement('div')
        item.className = `process-item${p.name === this.selected ? ' active' : ''}`
        item.dataset.name = p.name
        const isActive = ['running', 'healthy', 'starting'].includes(p.status)
        item.innerHTML = `
          <div class="status-dot ${statusDot(p.status)}"></div>
          <div class="process-info">
            <div class="process-name">${p.name}</div>
            <div class="process-meta">
              ${p.mem ? `<span>${fmtMem(p.mem)}</span>` : ''}
              ${p.cpu ? `<span>${fmtCpu(p.cpu)}</span>` : ''}
            </div>
          </div>
          ${p.restarts > 0 ? `<span class="restarts-badge">${p.restarts}x</span>` : ''}
          <div class="process-actions">
            ${isActive ? `<button class="btn-process-action btn-process-restart" title="Restart ${p.name}">↺</button>` : ''}
            <button class="btn-process-action ${isActive ? 'btn-process-stop' : 'btn-process-start'}" title="${isActive ? 'Stop' : 'Start'} ${p.name}">
              ${isActive ? '■' : '▶'}
            </button>
          </div>
        `
        item.addEventListener('click', () => this.onSelect(p.name))
        item.querySelector('.btn-process-restart')?.addEventListener('click', async (e) => {
          e.stopPropagation()
          await restartProcess(p.name)
          setTimeout(() => this.onAction?.(), 800)
        })
        item.querySelector('.btn-process-action:last-child')!.addEventListener('click', async (e) => {
          e.stopPropagation()
          if (isActive) await stopProcess(p.name)
          else { await startProcess(p.name); this.onSelect(p.name) }
          setTimeout(() => this.onAction?.(), 800)
        })
        body.appendChild(item)
      })

      // Append merged custom commands at the end of the group body
      customMembers.forEach((cmd) => {
        const item = document.createElement('div')
        item.className = `process-item${cmd.name === this.selected ? ' active' : ''}`
        item.innerHTML = `
          <div class="status-dot ${cmd.running ? 'dot-healthy' : 'dot-stopped'}"></div>
          <div class="process-info">
            <div class="process-name">${cmd.name}</div>
            <div class="process-meta"><span class="pid-badge">${cmd.cmd}</span></div>
          </div>
          <button class="btn-process-action ${cmd.running ? 'btn-process-stop' : 'btn-process-start'}" title="${cmd.running ? 'Stop' : 'Start'} ${cmd.name}">
            ${cmd.running ? '■' : '▶'}
          </button>
        `
        item.addEventListener('click', () => this.onCustomLogs?.(cmd.name))
        item.querySelector('.btn-process-action')!.addEventListener('click', (e) => {
          e.stopPropagation()
          if (cmd.running) this.onCustomStop?.(cmd.name)
          else { this.onCustomStart?.(cmd.name); this.onCustomLogs?.(cmd.name) }
        })
        body.appendChild(item)
      })

      this.el.appendChild(groupEl)
    })

    // ── Custom commands — one section per group ─────────────────────────────
    const visibleCustom = this.customCommands.filter(
      c => !mergedCustom.has(c.name) && (!search || c.name.includes(search.toLowerCase()))
    )

    // Collect unique group names (preserve insertion order, ungrouped = 'Custom')
    const customGroupNames = [
      ...new Set(visibleCustom.map(c => c.group || 'Custom'))
    ]

    // Show Edit button once, in the first group header (or a standalone row if no commands)
    let editButtonRendered = false

    if (customGroupNames.length === 0 && !search) customGroupNames.push('Custom')

    for (const groupName of customGroupNames) {
      const groupKey = `custom:${groupName}`
      const members = visibleCustom.filter(c => (c.group || 'Custom') === groupName)
      const collapsed = this.collapsed.has(groupKey)
      const running = members.filter(c => c.running).length
      const showEdit = !editButtonRendered
      editButtonRendered = true

      const groupEl = document.createElement('div')
      groupEl.className = 'group'
      groupEl.innerHTML = `
        <div class="group-header ${collapsed ? 'collapsed' : ''}" data-group="${groupKey}">
          <svg class="group-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="m6 9 6 6 6-6"/>
          </svg>
          ${groupName}
          <span class="group-count">${running}/${members.length}</span>
          ${showEdit ? `<button class="btn-start-group btn-custom-edit">Edit</button>` : ''}
        </div>
        <div class="group-body" style="${collapsed ? 'display:none' : ''}"></div>
      `

      groupEl.querySelector('.group-header')!.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('btn-custom-edit')) return
        this.collapsed.has(groupKey) ? this.collapsed.delete(groupKey) : this.collapsed.add(groupKey)
        this.render(processes, search)
      })
      groupEl.querySelector('.btn-custom-edit')?.addEventListener('click', (e) => {
        e.stopPropagation()
        this.onCustomEdit?.()
      })

      const body = groupEl.querySelector('.group-body')!
      members.forEach((cmd) => {
        const item = document.createElement('div')
        item.className = `process-item${cmd.name === this.selected ? ' active' : ''}`
        item.innerHTML = `
          <div class="status-dot ${cmd.running ? 'dot-healthy' : 'dot-stopped'}"></div>
          <div class="process-info">
            <div class="process-name">${cmd.name}</div>
            <div class="process-meta"><span class="pid-badge">${cmd.cmd}</span></div>
          </div>
          <button class="btn-process-action ${cmd.running ? 'btn-process-stop' : 'btn-process-start'}" title="${cmd.running ? 'Stop' : 'Start'} ${cmd.name}">
            ${cmd.running ? '■' : '▶'}
          </button>
        `
        item.addEventListener('click', () => this.onCustomLogs?.(cmd.name))
        item.querySelector('.btn-process-action')!.addEventListener('click', (e) => {
          e.stopPropagation()
          if (cmd.running) this.onCustomStop?.(cmd.name)
          else { this.onCustomStart?.(cmd.name); this.onCustomLogs?.(cmd.name) }
        })
        body.appendChild(item)
      })

      this.el.appendChild(groupEl)
    }
  }
}

function statusDot(status: string) {
  const s = status.toLowerCase()
  if (s === 'healthy') return 'dot-healthy'
  if (s === 'starting' || s === 'running') return 'dot-starting'
  if (s === 'failed' || s === 'error') return 'dot-error'
  if (s === 'completed') return 'dot-disabled'
  return 'dot-stopped'
}

function fmtMem(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(0) + 'MB'
}

function fmtCpu(cpu: number) {
  return cpu.toFixed(1) + '%'
}
