# DevDash

A lightweight web dashboard to launch and monitor a **process-compose / nix** dev environment. Start, stop, restart, and tail logs for any number of local processes defined in `processes.nix` — with per-group actions, orphan detection, port tracking, terminal, S3 browser, and system monitor.

Built with Vite + Hono. Runs on `localhost:3280`.

## Install

```sh
npm install -g @ncl/devdash
# or
yarn global add @ncl/devdash
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

Open [http://localhost:3280](http://localhost:3280).

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
| `devenv` | If `true`, DevDash injects built-in postgres/redis/mailpit services configured for a `devenv`-managed project (requires `.devenv/profile/bin`). Default: `false`. |
| `groups` | UI grouping for the sidebar. Each entry has a `match` spec: `in` (array), `startsWith`, `endsWith`, `equals`, or `regex`. Groups are evaluated in order; first match wins. |
| `ports` | Labels for known ports in the "Ports" panel. Any additional listening port on the machine is shown with its command name. |
| `orphans` | `pgrep -f` patterns for processes that may outlive DevDash (e.g. crashed children). Built-ins for `postgres`/`redis`/`mailpit` are always included. |
| `readyPatterns` | Regex strings matched against process stdout/stderr to flip status to `healthy`. Merged with sensible built-ins (Vite, Nest, Next, Prisma Studio, etc.). |
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

## Native macOS wrapper

A tiny Swift wrapper (`DevDash.app`) ships alongside — a WebKit window pointing at `localhost:3280` with standard keyboard shortcuts. Build and install it to `/Applications` with:

```sh
yarn deploy
```

This requires `swiftc` (bundled with Xcode Command Line Tools).

## Local dev (hacking on DevDash itself)

```sh
yarn install
yarn dev-app    # server on 3282, vite on 3280
```

## License

MIT © Nicolas Claisse
