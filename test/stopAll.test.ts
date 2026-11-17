import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'

test('stopAll stops regular and custom processes and cancels pending starts and restarts', async () => {
  const project = mkdtempSync(join(tmpdir(), 'devdash-stop-all-'))
  writeFileSync(join(project, 'processes.json'), JSON.stringify([
    { name: 'dependency', exec: 'exec sleep 30' },
    { name: 'dependent', exec: 'touch dependent-started', depends_on: { dependency: 'process_healthy' } },
    { name: 'restarting', exec: 'exec sleep 30' },
  ]))
  const previousProject = process.env.DEVDASH_PROJECT
  const previousPort = process.env.SERVER_PORT
  process.env.DEVDASH_PROJECT = project
  process.env.SERVER_PORT = '52800'
  const { ProcessManager } = await import('../server/processManager.js')
  const manager = new ProcessManager()
  manager.load()

  let pendingStart: Promise<void> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    pendingStart = manager.startOne('dependent')
    await manager.startOne('restarting')
    manager.startDynamic('custom', 'exec sleep 30')
    const pids = Array.from(manager.getManagedPids())
    assert.equal(pids.length, 3)
    assert.equal(manager.getStatus('dependent'), 'starting')
    manager.restart('restarting')

    manager.stopAll()
    const names = ['dependency', 'dependent', 'restarting', 'custom']
    names.forEach(name => assert.equal(manager.getStatus(name), 'stopped', name))
    await Promise.race([
      pendingStart,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Pending start was not cancelled')), 2500)
      }),
    ])
    await delay(1100)
    names.forEach(name => assert.equal(manager.getStatus(name), 'stopped', name))
    assert.equal(manager.isAnyRunning(), false)
    assert.equal(existsSync(join(project, 'dependent-started')), false)
    pids.forEach(pid => assert.equal(manager.isAlive(pid), false, `PID ${pid} should have stopped`))
  } finally {
    manager.stopAll()
    clearTimeout(timeout)
    await pendingStart
    if (previousProject === undefined) delete process.env.DEVDASH_PROJECT
    else process.env.DEVDASH_PROJECT = previousProject
    if (previousPort === undefined) delete process.env.SERVER_PORT
    else process.env.SERVER_PORT = previousPort
    rmSync(project, { recursive: true, force: true })
  }
})
