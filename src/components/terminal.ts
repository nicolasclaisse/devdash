import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

type CommandHandler = (cmd: string, args: string[]) => Promise<boolean> // return true = intercepted

export class TerminalPane {
  private term: Terminal
  private fitAddon: FitAddon
  private ws: WebSocket | null = null
  private container: HTMLElement
  private xtermEl: HTMLElement
  private lineBuf = ''
  private commandHandlers: CommandHandler[] = []

  constructor(container: HTMLElement) {
    this.container = container

    container.innerHTML = `
      <div class="terminal-header">
        <span class="terminal-title">Terminal</span>
        <div style="display:flex;gap:6px;margin-left:auto">
          <button class="clear-btn" id="btn-term-close">Clear</button>
          <button class="clear-btn" id="btn-term-reconnect">Reconnect</button>
        </div>
      </div>
      <div class="terminal-body" id="xterm-container"></div>
    `

    this.xtermEl = container.querySelector('#xterm-container')!

    this.term = new Terminal({
      theme: {
        background: '#0d0f14',
        foreground: '#e2e8f0',
        cursor: '#6366f1',
        selectionBackground: 'rgba(99,102,241,0.3)',
        black: '#1e2230',
        brightBlack: '#64748b',
        red: '#ef4444',
        brightRed: '#fca5a5',
        green: '#22c55e',
        brightGreen: '#86efac',
        yellow: '#f59e0b',
        brightYellow: '#fcd34d',
        blue: '#6366f1',
        brightBlue: '#818cf8',
        magenta: '#a855f7',
        brightMagenta: '#c084fc',
        cyan: '#06b6d4',
        brightCyan: '#67e8f9',
        white: '#e2e8f0',
        brightWhite: '#f8fafc',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowProposedApi: true,
    })

    this.fitAddon = new FitAddon()
    this.term.loadAddon(this.fitAddon)
    this.term.open(this.xtermEl)

    // Fit on resize
    const ro = new ResizeObserver(() => this.fit())
    ro.observe(this.xtermEl)

    // Key input → buffer + WebSocket
    this.term.onData(async (data) => {
      if (data === '\r') {
        const line = this.lineBuf.trim()
        this.lineBuf = ''
        if (line) {
          const [cmd, ...args] = line.split(/\s+/)
          for (const handler of this.commandHandlers) {
            const intercepted = await handler(cmd, args)
            if (intercepted) {
              // swallow the Enter — show newline ourselves
              if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'input', data: '\x15' })) // Ctrl+U clear line
                this.ws.send(JSON.stringify({ type: 'input', data: '\r' }))
              }
              return
            }
          }
        }
      } else if (data === '\x7f') {
        // backspace
        this.lineBuf = this.lineBuf.slice(0, -1)
      } else if (data === '\x03') {
        // Ctrl+C
        this.lineBuf = ''
      } else if (data.length === 1 && data >= ' ') {
        this.lineBuf += data
      } else {
        // arrows, tab, etc. — reset buffer (can't track cursor position)
        this.lineBuf = ''
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Clipboard: Cmd+C copies selection, Cmd+V pastes
    this.xtermEl.addEventListener('keydown', async (e: KeyboardEvent) => {
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

    container.querySelector('#btn-term-close')!.addEventListener('click', () => this.term.clear())
    container.querySelector('#btn-term-reconnect')!.addEventListener('click', () => this.connect())

    this.connect()
  }

  private fit(): void {
    try {
      this.fitAddon.fit()
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }))
      }
    } catch { /* ignore resize errors */ }
  }

  connect(): void {
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }

    const wsUrl = `ws://${location.host}/ws/terminal`
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.fit()
    }

    this.ws.onmessage = (e) => {
      this.term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
    }

    this.ws.onclose = () => {
      this.term.writeln('\r\n\x1b[31m● Disconnected — click Reconnect to restart\x1b[0m')
    }

    this.ws.onerror = () => {
      this.term.writeln('\r\n\x1b[31m● Connection error\x1b[0m')
    }
  }

  registerCommand(handler: CommandHandler): void {
    this.commandHandlers.push(handler)
  }

  print(text: string): void {
    this.term.writeln('\r\n' + text)
  }

  focus(): void {
    this.term.focus()
  }
}
