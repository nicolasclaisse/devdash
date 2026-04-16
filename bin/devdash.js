#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const serverPath = resolve(here, '..', 'dist', 'server.js')

if (!existsSync(serverPath)) {
  console.error('[devdash] dist/server.js not found — run `yarn build` first')
  process.exit(1)
}

await import(serverPath)
