#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

const args = process.argv.slice(2)
const appFlagIdx = args.findIndex(a => a === '--app' || a === '-app' || a === '-a')

if (appFlagIdx !== -1) {
  // Strip flags + their values to find the optional positional project dir
  const nameIdx = args.findIndex(a => a === '--name' || a === '-n')
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined
  const skipIdx = new Set([appFlagIdx, nameIdx, nameIdx + 1].filter(i => i >= 0))
  const positional = args.filter((a, i) => !skipIdx.has(i) && !a.startsWith('-'))
  const projectDir = resolve(positional[0] ?? process.cwd())
  const { installApp } = await import(resolve(here, 'install-app.js'))
  installApp(pkgRoot, projectDir, { name })
  process.exit(0)
}

const serverPath = resolve(pkgRoot, 'dist', 'server.js')
if (!existsSync(serverPath)) {
  console.error('[devdash] dist/server.js not found — run `yarn build` first')
  process.exit(1)
}

await import(serverPath)
