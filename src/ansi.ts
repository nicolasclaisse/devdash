/**
 * ANSI SGR → HTML for log lines.
 *
 * Colours and text attributes become <span> elements with inline styles; every
 * other escape sequence (cursor movement, screen clears, OSC hyperlinks, …) is
 * dropped, since none of them leaves a visible trace in a terminal's scrollback.
 */

interface SgrState {
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
  strike: boolean
}

const RESET: SgrState = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false, strike: false }

// ESC [ params intermediates final → CSI (SGR when the final byte is "m")
// ESC [ params <end of line>       → CSI cut by a chunk boundary: dropped
// ESC ] … BEL | ESC \              → OSC (hyperlinks, window title…)
// ESC ( x | ESC ) x                → charset selection
// ESC x                            → other single-char sequences (ESC c = full reset, …)
const ANSI_RE = /\x1b(?:\[([0-9;:?<=>]*)[ -\/]*([@-~])|\[[0-9;:?<=>]*[ -\/]*$|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[()][0-9A-Za-z]|[@-_0-9a-z])/g

/** xterm 256-colour index → CSS colour. The first 16 map to the theme's palette. */
function color256(n: number): string {
  if (n < 16) return `var(--ansi-${n})`
  if (n < 232) {
    const i = n - 16
    const step = (x: number) => (x === 0 ? 0 : 55 + x * 40)
    return `rgb(${step(Math.floor(i / 36))},${step(Math.floor(i / 6) % 6)},${step(i % 6)})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

function clamp(n: number): number {
  return Number.isFinite(n) ? Math.min(255, Math.max(0, Math.trunc(n))) : 0
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export class AnsiRenderer {
  private state: SgrState = { ...RESET }

  /** Forget any attribute still open from previous lines. */
  reset(): void {
    Object.assign(this.state, RESET)
  }

  /**
   * Renders one line. Attributes left open at the end of a line stay in effect
   * for the next call, exactly as in a terminal — call reset() between
   * unrelated streams. `text` is the line with every escape sequence removed.
   */
  render(line: string): { html: string; text: string } {
    // A carriage return sends the cursor back to column 0 and what follows
    // overwrites the line (progress bars): keep the last non-empty frame.
    let out = { html: '', text: '' }
    for (const frame of line.split('\r')) {
      const rendered = this.renderFrame(frame)
      if (rendered.text !== '') out = rendered
    }
    return out
  }

  private renderFrame(frame: string): { html: string; text: string } {
    let html = ''
    let text = ''
    let last = 0
    ANSI_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ANSI_RE.exec(frame)) !== null) {
      if (m.index > last) {
        const seg = frame.slice(last, m.index)
        html += this.span(seg)
        text += seg
      }
      last = m.index + m[0].length
      if (m[2] === 'm') this.applySgr(m[1])
      else if (m[0] === '\x1bc') this.reset()
    }
    if (last < frame.length) {
      const seg = frame.slice(last)
      html += this.span(seg)
      text += seg
    }
    return { html, text }
  }

  private span(seg: string): string {
    const safe = escHtml(seg.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ''))
    const s = this.state
    const classes: string[] = []
    if (s.bold) classes.push('ansi-bold')
    if (s.dim) classes.push('ansi-dim')
    if (s.italic) classes.push('ansi-italic')
    if (s.underline) classes.push('ansi-underline')
    if (s.strike) classes.push('ansi-strike')
    let fg = s.fg
    let bg = s.bg
    if (s.inverse) [fg, bg] = [bg ?? 'var(--bg)', fg ?? 'var(--text)']
    const style = (fg ? `color:${fg};` : '') + (bg ? `background:${bg};` : '')
    if (!classes.length && !style) return safe
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : ''
    const styleAttr = style ? ` style="${style}"` : ''
    return `<span${classAttr}${styleAttr}>${safe}</span>`
  }

  private applySgr(params: string): void {
    const codes = params === '' ? [0] : params.split(/[;:]/).map(p => (p === '' ? 0 : Number(p)))
    const s = this.state
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) this.reset()
      else if (c === 1) s.bold = true
      else if (c === 2) s.dim = true
      else if (c === 3) s.italic = true
      else if (c === 4) s.underline = true
      else if (c === 7) s.inverse = true
      else if (c === 9) s.strike = true
      else if (c === 22) { s.bold = false; s.dim = false }
      else if (c === 23) s.italic = false
      else if (c === 24) s.underline = false
      else if (c === 27) s.inverse = false
      else if (c === 29) s.strike = false
      else if (c >= 30 && c <= 37) s.fg = `var(--ansi-${c - 30})`
      else if (c === 39) s.fg = null
      else if (c >= 40 && c <= 47) s.bg = `var(--ansi-${c - 40})`
      else if (c === 49) s.bg = null
      else if (c >= 90 && c <= 97) s.fg = `var(--ansi-${c - 90 + 8})`
      else if (c >= 100 && c <= 107) s.bg = `var(--ansi-${c - 100 + 8})`
      else if (c === 38 || c === 48) {
        const color = extendedColor(codes, i)
        if (!color) break // malformed: ignore the rest of the sequence
        if (c === 38) s.fg = color.css
        else s.bg = color.css
        i += color.consumed
      }
    }
  }
}

/** Parses the "5;n" / "2;r;g;b" tail that follows a 38 or 48 code at codes[i]. */
function extendedColor(codes: number[], i: number): { css: string; consumed: number } | null {
  const mode = codes[i + 1]
  if (mode === 5 && codes.length > i + 2) return { css: color256(clamp(codes[i + 2])), consumed: 2 }
  if (mode === 2 && codes.length > i + 4) {
    const [r, g, b] = codes.slice(i + 2, i + 5).map(clamp)
    return { css: `rgb(${r},${g},${b})`, consumed: 4 }
  }
  return null
}

/** Stateless one-shot conversion, for lines that are not part of a continuous stream. */
export function ansiToHtml(line: string): { html: string; text: string } {
  return new AnsiRenderer().render(line)
}
