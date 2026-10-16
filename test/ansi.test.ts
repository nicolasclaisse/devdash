import assert from 'node:assert/strict'
import { AnsiRenderer, ansiToHtml } from '../src/ansi'

const S = (fg: string, body: string) => `<span style="color:${fg};">${body}</span>`
const cases: Array<[string, string, string]> = [
  ['\x1b[1m\x1b[31mbold red\x1b[0m plain', '<span class="ansi-bold" style="color:var(--ansi-1);">bold red</span> plain', 'bold red plain'],
  ['\x1b[32m[Nest] 1  - \x1b[39m10/13 \x1b[38;5;3m[HTTP] \x1b[39m\x1b[32m→ GET /x\x1b[39m',
    S('var(--ansi-2)', '[Nest] 1  - ') + '10/13 ' + S('var(--ansi-3)', '[HTTP] ') + S('var(--ansi-2)', '→ GET /x'),
    '[Nest] 1  - 10/13 [HTTP] → GET /x'],
  ['\x1b[38;2;255;0;0m✖ fail\x1b[0m', S('rgb(255,0,0)', '✖ fail'), '✖ fail'],
  ['\x1b[43;33mwarn\x1b[0m', '<span style="color:var(--ansi-3);background:var(--ansi-3);">warn</span>', 'warn'],
  ['\x1b[38;5;208mcube\x1b[0m', S('rgb(255,135,0)', 'cube'), 'cube'],
  ['\x1b[38;5;244mgray\x1b[0m', S('rgb(128,128,128)', 'gray'), 'gray'],
  ['<b>&amp;</b>', '&lt;b&gt;&amp;amp;&lt;/b&gt;', '<b>&amp;</b>'],
  ['\x1b[2K\x1b[1G\x1b[?25lcleared', 'cleared', 'cleared'],
  ['\x1b]8;;http://x\x07link\x1b]8;;\x07', 'link', 'link'],
  ['\x1bc11:22 restart', '11:22 restart', '11:22 restart'],
  ['50%\r100%', '100%', '100%'],
  ['done\r', 'done', 'done'],
  ['\x1b[7minv\x1b[27m ok', '<span style="color:var(--bg);background:var(--text);">inv</span> ok', 'inv ok'],
  ['\x1b[90mdim gray\x1b[39m', S('var(--ansi-8)', 'dim gray'), 'dim gray'],
  ['\x1b[2mfaint\x1b[22m', '<span class="ansi-dim">faint</span>', 'faint'],
  ['\x1b[38;5mtext', 'text', 'text'],
  ['\x1b[38;2;255mtext', 'text', 'text'],
  ['\x1b[3;4;9mall\x1b[0m', '<span class="ansi-italic ansi-underline ansi-strike">all</span>', 'all'],
  ['\x1b[mreset-empty', 'reset-empty', 'reset-empty'],
  ['abc\x1b[3', 'abc', 'abc'],
  ['\x1b[1;31mx\x1b[0m', '<span class="ansi-bold" style="color:var(--ansi-1);">x</span>', 'x'],
  ['\x1b[38:5:3mc\x1b[0m', S('var(--ansi-3)', 'c'), 'c'],
  ['\x1b[32m200\x1b[0m 3ms\x1b[0m', S('var(--ansi-2)', '200') + ' 3ms', '200 3ms'],
]
let n = 0
for (const [input, html, text] of cases) {
  const out = ansiToHtml(input)
  assert.equal(out.html, html, `html for ${JSON.stringify(input)}`)
  assert.equal(out.text, text, `text for ${JSON.stringify(input)}`)
  n++
}

// State carries over between lines until reset(), like a terminal.
const r = new AnsiRenderer()
assert.deepEqual(r.render('\x1b[32m'), { html: '', text: '' })
assert.equal(r.render('green\x1b[0m').html, S('var(--ansi-2)', 'green'))
assert.equal(r.render('\x1b[31mstill').html, S('var(--ansi-1)', 'still'))
r.reset()
assert.equal(r.render('plain').html, 'plain')
n += 4
console.log(`${n} assertions ok`)
