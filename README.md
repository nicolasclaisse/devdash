# DevDash

A lightweight web dashboard to launch and monitor a **process-compose / nix** dev environment. Start, stop, restart, and tail logs for any number of local processes defined in `processes.nix` — with per-group actions, orphan detection, port tracking, terminal, S3 browser, and system monitor.

Built with Vite + Hono. Picks the first free port starting at `52800` (so multiple instances coexist).

## Install

```sh
brew install nicolasclaisse/tap/devdash
```

To upgrade later:

```sh
brew upgrade devdash
```

## Quickstart

In any directory that contains a `processes.nix`:

```sh
devdash
```

Or point it at a specific directory:

```sh
devdash ~/project/my-stack
```

DevDash logs the URL on startup (`devdash listening on http://localhost:52800`). Open it in a browser.

## Configuration

DevDash runs out of the box with sensible defaults. To customize, drop a `devdash.config.json` next to your `processes.nix`:

```json
{
  "name": "My Stack",
  "devenv": true,
  "groups": [
    { "id": "api",    "label": "APIs",       "match": { "endsWith": "-api" } },
    { "id": "front",  "label": "Frontends",  "match": { "endsWith": "-front" } }
  ],
  "ports": [
    { "port": 3006, "label": "my-api" },
    { "port": 3001, "label": "my-front" }
  ],
  "orphans": [
    { "name": "my-api", "pattern": "nest.*my-api" }
  ],
  "readyPatterns": [
    "My custom ready marker"
  ],
  "infra": [
    {
      "name": "postgres",
      "brew": "postgresql@16",
      "exec": "export PATH=\"$(brew --prefix postgresql@16)/bin:$PATH\"\nPGDATA=\".devdash/postgres\"\nmkdir -p /tmp/devdash-pg\n[ -d \"$PGDATA/global\" ] || initdb -D \"$PGDATA\" --no-locale --encoding=UTF8\nexec postgres -D \"$PGDATA\" -c unix_socket_directories=/tmp/devdash-pg -c listen_addresses=localhost -p 5432",
      "health_check": { "type": "exec", "command": "$(brew --prefix postgresql@16)/bin/pg_isready -h localhost -p 5432", "period_seconds": 2, "failure_threshold": 15 }
    }
  ],
  "utils": [
    {
      "name": "pgweb",
      "brew": "pgweb",
      "exec": "exec pgweb --bind=localhost --listen=8091 --sessions",
      "depends_on": { "postgres": { "condition": "process_healthy" } }
    }
  ],
  "s3": {
    "endpoint": "https://s3.example.com",
    "region": "us-east-1",
    "accessKey": "...",
    "secretKey": "...",
    "forcePathStyle": true
  }
}
```

### Fields

| Field | Purpose |
|---|---|
| `name` | Displayed in the header and browser title. |
| `devenv` | If `true`, prepends `.devenv/profile/bin` to the PATH of every spawned process (so processes can find devenv-installed binaries without absolute paths). Default: `false`. |
| `groups` | UI grouping for the sidebar. Each entry has a `match` spec: `in` (array), `startsWith`, `endsWith`, `equals`, or `regex`. Groups are evaluated in order; first match wins. |
| `ports` | Labels for known ports in the "Ports" panel. Any additional listening port on the machine is shown with its command name. |
| `orphans` | `pgrep -f` patterns for processes that may outlive DevDash (e.g. crashed children). Built-ins for `postgres`/`redis`/`mailpit` are always included. |
| `readyPatterns` | Regex strings matched against process stdout/stderr to flip status to `healthy`. Merged with sensible built-ins (Vite, Nest, Next, Prisma Studio, etc.). |
| `infra` | User-declared infra processes (postgres, redis, minio, mailpit, ...). Each entry: `name`, `exec`, optional `brew` (hint shown when the process crashes), `working_dir`, `depends_on`, `health_check`. Merged into the process list alongside `processes.nix` entries. The `/shell/start/core` endpoint starts these. |
| `utils` | Same shape as `infra`, but auto-grouped under "Utils" and **not** included in `/shell/start/core`. For dev-only tools (pgweb, prisma studio, ...) that should start on demand or via `depends_on`. |
| `s3` | Optional. If present, the S3 browser tab is active. No defaults — credentials live here only. |

## Custom commands

Ad-hoc one-off commands (e.g. `stripe listen`, a `pgweb` shortcut) are stored in `devdash.commands.json` at your project root and edited directly from the UI:

```json
{
  "stripe": { "cmd": "stripe listen --forward-to http://localhost:4000/webhooks", "group": "Utils" }
}
```

## Example `processes.nix`

DevDash parses the `processes` attrset in a `processes.nix` at the project root. Minimal example:

```nix
{ ... }:
{
  processes = {
    api = {
      exec = ''
        cd api && yarn dev
      '';
      process-compose = {
        depends_on.postgres.condition = "process_healthy";
        readiness_probe = {
          http_get = { host = "localhost"; port = 4000; path = "/health"; };
          period_seconds = 2;
          failure_threshold = 30;
        };
      };
    };
    front = {
      exec = ''
        cd front && yarn dev
      '';
    };
  };
}
```

Supported attributes per process: `exec` (multiline string), `process-compose.working_dir`, `process-compose.depends_on.<name>.condition`, `process-compose.readiness_probe` (`http_get` or `exec`, with `initial_delay_seconds` / `period_seconds` / `failure_threshold`).

## Native macOS app

A tiny Swift wrapper (`DevDash.app`) ships alongside — a WebKit window that connects to the devdash server (port chosen dynamically per instance). To install one for the project in your current dir:

```sh
cd ~/project/my-stack
devdash --app
```

This installs `/Applications/DevDash - my-stack.app`, hardcoded to launch with `DEVDASH_PROJECT=~/project/my-stack`. You can install one app per env this way — they coexist in `/Applications/` (`DevDash - foo.app`, `DevDash - bar.app`, …). Override the label with `--name`:

```sh
devdash --app --name "Production"
```

Requires `swiftc` (bundled with Xcode Command Line Tools).

## Local dev (hacking on DevDash itself)

```sh
yarn install
yarn dev-app    # server on 52802, vite on 52800
```

## License

MIT © Nicolas Claisse
