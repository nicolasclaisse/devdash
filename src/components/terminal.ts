import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

type CommandHandler = (cmd: string, args: string[]) => Promise<boolean>

const XTERM_THEME = {
  background: '#0d0f14',
  foreground: '#e2e8f0',
  cursor: '#6366f1',
  selectionBackground: 'rgba(99,102,241,0.3)',
  black: '#1e2230', brightBlack: '#64748b',
  red: '#ef4444', brightRed: '#fca5a5',
  green: '#22c55e', brightGreen: '#86efac',
  yellow: '#f59e0b', brightYellow: '#fcd34d',
  blue: '#6366f1', brightBlue: '#818cf8',
  magenta: '#a855f7', brightMagenta: '#c084fc',
  cyan: '#06b6d4', brightCyan: '#67e8f9',
  white: '#e2e8f0', brightWhite: '#f8fafc',
}

// ── Single terminal instance ─────────────────────────────────────────────

class TerminalInstance {
  readonly term: Terminal
  private fitAddon: FitAddon
  private ws: WebSocket | null = null
  readonly el: HTMLElement
  private lineBuf = ''
  private commandHandlers: CommandHandler[] = []

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'terminal-body'
    this.el.style.display = 'none'

    this.term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13, lineHeight: 1.5,
      cursorBlink: true, cursorStyle: 'block',
      scrollback: 5000, allowProposedApi: true,
    })

    this.fitAddon = new FitAddon()
    this.term.loadAddon(this.fitAddon)

    const ro = new ResizeObserver(() => this.fit())
    ro.observe(this.el)

    this.term.onData(async (data) => {
      if (data === '\r') {
        const line = this.lineBuf.trim()
        this.lineBuf = ''
        if (line) {
          const [cmd, ...args] = line.split(/\s+/)
          for (const handler of this.commandHandlers) {
            if (await handler(cmd, args)) {
              if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'input', data: '\x15' }))
                this.ws.send(JSON.stringify({ type: 'input', data: '\r' }))
              }
              return
            }
          }
        }
      } else if (data === '\x7f') {
        this.lineBuf = this.lineBuf.slice(0, -1)
      } else if (data === '\x03') {
        this.lineBuf = ''
      } else if (data.length === 1 && data >= ' ') {
        this.lineBuf += data
      } else {
        this.lineBuf = ''
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    this.el.addEventListener('keydown', async (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'c') {
        const sel = this.term.getSelection()
        if (sel) { await navigator.clipboard.writeText(sel); e.preventDefault() }
      } else if (e.metaKey && e.key === 'v') {
        const text = await navigator.clipboard.readText()
        if (text && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', data: text }))
        }
        e.preventDefault()
      }
    })
  }

  open() {
    this.term.open(this.el)
    this.connect()
  }

  show() {
    this.el.style.display = ''
    requestAnimationFrame(() => this.fit())
  }

  hide() {
    this.el.style.display = 'none'
  }

  destroy() {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
    this.term.dispose()
    this.el.remove()
  }

  focus() {
    this.term.focus()
  }

  print(text: string) {
    this.term.writeln('\r\n' + text)
  }

  registerCommand(handler: CommandHandler) {
    this.commandHandlers.push(handler)
  }

  private fit() {
    try {
      this.fitAddon.fit()
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }))
      }
    } catch { /* ignore */ }
  }

  private connect() {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
    const wsUrl = `ws://${location.host}/ws/terminal`
    this.ws = new WebSocket(wsUrl)
    this.ws.onopen = () => this.fit()
    this.ws.onmessage = (e) => {
      this.term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
    }
    this.ws.onclose = () => {
      this.term.writeln('\r\n\x1b[31m● Disconnected\x1b[0m')
    }
    this.ws.onerror = () => {
      this.term.writeln('\r\n\x1b[31m● Connection error\x1b[0m')
    }
  }
}

// ── Multi-tab terminal pane ──────────────────────────────────────────────

interface Tab {
  id: number
  label: string
  instance: TerminalInstance
  tabEl: HTMLElement
}

let nextId = 1

export class TerminalPane {
  private tabBar: HTMLElement
  private addBtn: HTMLElement
  private body: HTMLElement
  private tabs: Tab[] = []
  private activeId: number | null = null
  private commandHandlers: CommandHandler[] = []

  constructor(container: HTMLElement) {
    container.innerHTML = `
      <div class="terminal-header">
        <div class="terminal-tabs" id="terminal-tab-bar">
          <button class="terminal-tab-add" id="btn-term-add">+</button>
        </div>
        <div style="display:flex;gap:6px;margin-left:auto">
          <button class="clear-btn" id="btn-term-clear">Clear</button>
        </div>
      </div>
      <div class="terminal-bodies" id="terminal-bodies"></div>
    `
    this.tabBar = container.querySelector('#terminal-tab-bar')!
    this.addBtn = container.querySelector('#btn-term-add')!
    this.body = container.querySelector('#terminal-bodies')!

    this.addBtn.addEventListener('click', () => this.addTab())
    container.querySelector('#btn-term-clear')!.addEventListener('click', () => {
      const active = this.tabs.find(t => t.id === this.activeId)
      if (active) active.instance.term.clear()
    })

    this.addTab()
  }

  addTab(): Tab {
    const id = nextId++
    const instance = new TerminalInstance()
    for (const handler of this.commandHandlers) instance.registerCommand(handler)

    this.body.appendChild(instance.el)
    instance.open()

    const tabEl = document.createElement('div')
    tabEl.className = 'terminal-tab'
    tabEl.innerHTML = `<span class="tab-close">×</span><span class="tab-label">Terminal</span>`

    tabEl.querySelector('.tab-close')!.addEventListener('click', (e) => {
      e.stopPropagation()
      this.removeTab(id)
    })
    tabEl.addEventListener('click', () => this.selectTab(id))
    tabEl.addEventListener('dblclick', () => {
      const label = tabEl.querySelector('.tab-label')
      if (!label) return
      const input = document.createElement('input')
      input.className = 'tab-rename'
      input.value = label.textContent ?? ''
      input.size = Math.max(3, input.value.length)
      label.replaceWith(input)
      input.focus()
      input.select()
      const commit = () => {
        const val = input.value.trim() || 'Terminal'
        const span = document.createElement('span')
        span.className = 'tab-label'
        span.textContent = val
        input.replaceWith(span)
        tab.label = val
      }
      input.addEventListener('blur', commit)
      const stopAll = (e: Event) => e.stopPropagation()
      input.addEventListener('keydown', (ke) => {
        ke.stopPropagation()
        if (ke.key === 'Enter') input.blur()
        if (ke.key === 'Escape') { input.value = tab.label; input.blur() }
      })
      input.addEventListener('keyup', stopAll)
      input.addEventListener('keypress', stopAll)
      input.addEventListener('click', stopAll)
    })
    this.tabBar.insertBefore(tabEl, this.addBtn)

    const tab: Tab = { id, label: 'Terminal', instance, tabEl }
    this.tabs.push(tab)
    this.selectTab(id)
    return tab
  }

  removeTab(id: number) {
    const idx = this.tabs.findIndex(t => t.id === id)
    if (idx === -1) return
    const tab = this.tabs[idx]
    tab.instance.destroy()
    tab.tabEl.remove()
    this.tabs.splice(idx, 1)

    if (this.activeId === id) {
      if (this.tabs.length) {
        const next = this.tabs[Math.min(idx, this.tabs.length - 1)]
        this.selectTab(next.id)
      } else {
        this.addTab()
      }
    }
  }

  selectTab(id: number) {
    this.activeId = id
    for (const tab of this.tabs) {
      const isActive = tab.id === id
      tab.tabEl.classList.toggle('active', isActive)
      if (isActive) { tab.instance.show(); tab.instance.focus() }
      else tab.instance.hide()
    }
  }

  registerCommand(handler: CommandHandler) {
    this.commandHandlers.push(handler)
    for (const tab of this.tabs) tab.instance.registerCommand(handler)
  }

  print(text: string) {
    const active = this.tabs.find(t => t.id === this.activeId)
    if (active) active.instance.print(text)
  }

  focus() {
    const active = this.tabs.find(t => t.id === this.activeId)
    if (active) active.instance.focus()
  }
}
