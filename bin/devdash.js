#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

const args = process.argv.slice(2)

if (args.some(a => a === '--version' || a === '-v')) {
  const { version } = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8'))
  console.log(version)
  process.exit(0)
}

if (args.some(a => a === '--help' || a === '-h')) {
  console.log(`devdash - dashboard for a multi-process dev environment

usage:
  devdash [project-dir]        start the dashboard (defaults to the current directory)
  devdash --app [project-dir]  install a macOS app that launches it
                               --name <label> overrides the app name
  devdash --version            print the version
  devdash --help               print this message

The project directory must hold a processes.json or processes.nix.`)
  process.exit(0)
}

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
