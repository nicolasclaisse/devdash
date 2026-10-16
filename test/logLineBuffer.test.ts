import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LogLineBuffer } from '../server/logLineBuffer.js'
import { AnsiRenderer } from '../src/ansi'

test('ANSI sequences and UTF-8 characters survive every possible chunk boundary', () => {
  const expected = '\x1b[31mÉchec 🔴\x1b[0m'
  const data = Buffer.from(expected + '\n')
  for (let split = 1; split < data.length; split++) {
    const lines: string[] = []
    const buffer = new LogLineBuffer(line => lines.push(line))
    buffer.write(data.subarray(0, split))
    assert.deepEqual(lines, [])
    buffer.write(data.subarray(split))
    buffer.end()
    assert.deepEqual(lines, [expected], `split at byte ${split}`)
    assert.equal(new AnsiRenderer().render(lines[0]).html,
      '<span style="color:var(--ansi-1);">Échec 🔴</span>')
  }
})

test('emits complete lines immediately and flushes the final unterminated line once', () => {
  const lines: string[] = []
  const buffer = new LogLineBuffer(line => lines.push(line))
  buffer.write(Buffer.from('first\nsecond\nlast'))
  assert.deepEqual(lines, ['first', 'second'])
  buffer.end()
  buffer.end()
  assert.deepEqual(lines, ['first', 'second', 'last'])
})

test('keeps carriage-return frames intact for the ANSI renderer', () => {
  const lines: string[] = []
  const buffer = new LogLineBuffer(line => lines.push(line))
  buffer.write(Buffer.from('50%\r'))
  buffer.write(Buffer.from('100%\r\n'))
  assert.deepEqual(lines, ['50%\r100%\r'])
  assert.equal(new AnsiRenderer().render(lines[0]).text, '100%')
})

test('ProcessManager broadcasts reassembled stdout/stderr and flushes on process close', async () => {
  const project = mkdtempSync(join(tmpdir(), 'devdash-log-lines-'))
  writeFileSync(join(project, 'processes.json'), '{}')
  const previousProject = process.env.DEVDASH_PROJECT
  const previousPort = process.env.SERVER_PORT
  process.env.DEVDASH_PROJECT = project
  process.env.SERVER_PORT = '52800'
  const { ProcessManager } = await import('../server/processManager.js')
  const { sseClients } = await import('../server/sse.js')
  const manager = new ProcessManager()
  const lines: string[] = []
  let finished: () => void = () => {}
  const closed = new Promise<void>(resolve => { finished = resolve })
  const client = { send: (line: string) => {
    if (line.startsWith('[ansi-regression] ')) lines.push(line.slice('[ansi-regression] '.length))
    if (line.includes('[devdash] ansi-regression exited with code 0')) finished()
  } }
  sseClients.add(client)
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'"
  const script = `
    const esc = String.fromCharCode(27);
    process.stdout.write(esc + '[3');
    setTimeout(() => {
      process.stderr.write('warning');
      setTimeout(() => {
        process.stdout.write('1mERROR' + esc + '[0m' + '\\n' + 'stdout tail');
        process.stderr.write(' tail');
      }, 40);
    }, 40);
  `
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    manager.startDynamic('ansi-regression', `${quote(process.execPath)} -e ${quote(script)}`)
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('process output did not finish')), 5000)
      }),
    ])
    assert.deepEqual(lines, ['\x1b[31mERROR\x1b[0m', 'stdout tail', 'warning tail'])
    assert.equal(new AnsiRenderer().render(lines[0]).text, 'ERROR')
  } finally {
    clearTimeout(timeout)
    manager.stop('ansi-regression')
    sseClients.delete(client)
    if (previousProject === undefined) delete process.env.DEVDASH_PROJECT
    else process.env.DEVDASH_PROJECT = previousProject
    if (previousPort === undefined) delete process.env.SERVER_PORT
    else process.env.SERVER_PORT = previousPort
    rmSync(project, { recursive: true, force: true })
  }
})
