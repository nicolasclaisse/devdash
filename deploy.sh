#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Trap SIGTERM/SIGHUP so the terminal dying doesn't kill us
trap '' TERM HUP

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${1:-$(dirname "$REPO_DIR")/dev-launcher}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
RAW_LABEL="$(basename "$PROJECT_DIR")"
LABEL="$(echo "$RAW_LABEL" | tr '-' '\n' | awk '{print toupper(substr($0,1,1)) substr($0,2)}' | tr -d '\n')"
LOG="/tmp/devdash-${LABEL}.log"

yarn build
mkdir -p DevDash.app/Contents/MacOS
swiftc DevDash.swift -o DevDash.app/Contents/MacOS/DevDashNative -framework Cocoa -framework WebKit

# Génère le wrapper qui lance le serveur local puis ouvre la WebView
cat > DevDash.app/Contents/MacOS/devdash << WRAPPER
#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:\$HOME/.nvm/versions/node/\$(ls \$HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:\$PATH"

export DEVDASH_PROJECT="${PROJECT_DIR}"
LOG="${LOG}"

pgrep -fl "dist/server.js" | grep -F "${PROJECT_DIR}" | awk '{print \$1}' | xargs kill 2>/dev/null
sleep 1
: > "\$LOG"

node "${REPO_DIR}/dist/server.js" "${PROJECT_DIR}" >> "\$LOG" 2>&1 &

PORT=""
for i in \$(seq 1 120); do
  sleep 1
  PORT=\$(grep -m1 -oE 'devdash listening on http://localhost:[0-9]+' "\$LOG" | grep -oE '[0-9]+\$')
  [ -n "\$PORT" ] && break
done

if [ -z "\$PORT" ]; then
  osascript -e 'display alert "DevDash failed to start" message "See \$LOG for details."' >/dev/null 2>&1
  exit 1
fi

export DEVDASH_URL="http://localhost:\$PORT"
"\$(dirname "\$0")/DevDashNative"
WRAPPER
chmod +x DevDash.app/Contents/MacOS/devdash

# Kill DevDash — after this our terminal may die, but we've trapped the signal
pkill -f 'node dist/server.js' 2>/dev/null || true
pkill -f 'bin/devdash.js' 2>/dev/null || true
osascript -e 'quit app "DevDash"' 2>/dev/null || true
sleep 1

TARGET="/Applications/DevDash - ${LABEL}.app"
rm -rf "$TARGET"
cp -R DevDash.app "$TARGET"
xattr -cr "$TARGET"
echo "✓ DevDash deployed → ${TARGET} (project: ${PROJECT_DIR})"
