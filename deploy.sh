#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Trap SIGTERM/SIGHUP so the terminal dying doesn't kill us
trap '' TERM HUP

yarn build
swiftc DevDash.swift -o DevDash.app/Contents/MacOS/DevDashNative -framework Cocoa -framework WebKit

# Kill DevDash — after this our terminal may die, but we've trapped the signal
pkill -f 'node dist/server.js' 2>/dev/null || true
pkill -f 'bin/devdash.js' 2>/dev/null || true
osascript -e 'quit app "DevDash"' 2>/dev/null || true
sleep 1

rm -rf /Applications/DevDash.app
cp -R DevDash.app /Applications/
echo '✓ DevDash deployed'
