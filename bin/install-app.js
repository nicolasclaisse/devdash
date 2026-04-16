import { existsSync, cpSync, writeFileSync, chmodSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execSync } from 'node:child_process'

function abort(msg) {
  console.error(`[devdash] ${msg}`)
  process.exit(1)
}

export function installApp(pkgRoot, projectDir, opts = {}) {
  if (!existsSync(join(projectDir, 'processes.nix'))) {
    abort(`processes.nix not found in ${projectDir}`)
  }

  const skeleton = join(pkgRoot, 'DevDash.app')
  const swiftSrc = join(pkgRoot, 'DevDash.swift')
  if (!existsSync(skeleton)) abort('DevDash.app skeleton missing in package')
  if (!existsSync(swiftSrc)) abort('DevDash.swift missing in package')

  try { execSync('which swiftc', { stdio: 'ignore' }) }
  catch { abort('swiftc not found — run `xcode-select --install`') }

  // Derive app name from project basename so multiple envs can coexist.
  // User can override with --name <label>.
  const label = opts.name ?? basename(projectDir)
  const displayName = `DevDash - ${label}`
  const target = `/Applications/${displayName}.app`

  try { execSync(`osascript -e 'quit app "${displayName}"' 2>/dev/null`, { stdio: 'ignore' }) } catch {}

  if (existsSync(target)) rmSync(target, { recursive: true, force: true })
  cpSync(skeleton, target, { recursive: true })

  const macosDir = join(target, 'Contents', 'MacOS')
  mkdirSync(macosDir, { recursive: true })

  // Patch Info.plist so dock shows the env-specific name
  const plistPath = join(target, 'Contents', 'Info.plist')
  const plist = readFileSync(plistPath, 'utf-8')
    .replace(/(<key>CFBundleName<\/key>\s*<string>)[^<]+/, `$1${displayName}`)
    .replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]+/, `$1${displayName}`)
    .replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]+/, `$1com.nicolasclaisse.devdash.${label.replace(/[^a-zA-Z0-9-]/g, '-')}`)
  writeFileSync(plistPath, plist)

  console.log('[devdash] Compiling Swift wrapper...')
  execSync(
    `swiftc "${swiftSrc}" -o "${join(macosDir, 'DevDashNative')}" -framework Cocoa -framework WebKit`,
    { stdio: 'inherit' }
  )

  const wrapper = `#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:$PATH"

export DEVDASH_PROJECT=${JSON.stringify(projectDir)}

lsof -ti :3280 | xargs kill -9 2>/dev/null
sleep 1

devdash "$DEVDASH_PROJECT" &>/tmp/devdash.log &

for i in $(seq 1 120); do
  sleep 1
  if lsof -i :3280 -sTCP:LISTEN -t &>/dev/null; then break; fi
done

"$(dirname "$0")/DevDashNative"
`
  const wrapperPath = join(macosDir, 'devdash')
  writeFileSync(wrapperPath, wrapper)
  chmodSync(wrapperPath, 0o755)

  console.log(`\n✓ Installed`)
  console.log(`  app     → ${target}`)
  console.log(`  project → ${projectDir}`)
}
