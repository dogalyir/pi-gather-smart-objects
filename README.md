# pi-gather-smart-objects

Pi Coding Agent (`@earendil-works/pi-coding-agent`) extension that mirrors agent presence in **Gather 2.0 Smart Objects** (visual state, indicator icon, and color variant) via lifecycle hooks, and exposes a single model-facing tool (`gather_send`) to dispatch events, activity updates, and counter changes.

[![CI](https://github.com/dogalyir/pi-gather-smart-objects/actions/workflows/ci.yml/badge.svg)](https://github.com/dogalyir/pi-gather-smart-objects/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-gather-smart-objects.svg)](https://www.npmjs.com/package/pi-gather-smart-objects)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## Features

- **Automated Visual Presence via Hooks**: Maps Pi lifecycle events (`session_start`, `agent_start`, `ui_prompt_*`, `agent_settled`, `session_shutdown`) directly to Gather states (`on`, `working`, `question`, `alert`, `off`) and colors.
- **Single Model Tool (`gather_send`)**: Keeps context small and eliminates tool proliferation while supporting all Gather event capabilities (`status`, `signal`, `switch`, `counter`, `activity`, `variant`, `info`, and `webhook.ping`).
- **Context-Aware Prompt Injection**: Automatically injects a concise (`< 500` characters) prompt section informing the LLM of `gather_send` usage rules and privacy constraints. The prompt automatically withdraws when the tool is excluded or disabled.
- **Strict Valibot Validation & Public Schema**: All configuration in `pi-gather-hooks.json` is strictly validated, with editor autocomplete and validation powered by a published JSON Schema (`dist/pi-gather-hooks.schema.json`).
- **Security & Privacy First**: Signing secrets (`whsec_...`) never enter LLM context, tool results, prompt sections, or session logs. Enforces POSIX `0600` permissions on credentials files.
- **Zero Runtime Dependencies**: Pre-bundled with Bun into a tiny self-contained Node ESM module (~55 KiB uncompressed, ~18 KiB gzipped). Consuming Pi installations need no external package downloads or build tools.
- **Concurrency & Local Ownership**: Single-flight queues per object, event debouncing, and local file locking prevent multi-session flapping and respect manual overrides.

---

## Installation

### In Pi Coding Agent

Install directly as a Pi package:

```bash
pi install npm:pi-gather-smart-objects
```

Or test locally without modifying global settings:

```bash
pi -e ./path/to/pi-gather-smart-objects
# or load the prebuilt extension directly:
pi --extension ./path/to/pi-gather-smart-objects/dist/gather.js
```

Verify that the extension is active:

```bash
/gather
```

---

## Configuration

The extension looks for configuration in:
1. `PI_GATHER_CONFIG` environment variable (if set).
2. `~/.pi/agent/pi-gather-hooks.json` (default).

If the configuration file does not exist, the extension remains completely inactive without sending network traffic or errors.

### Example `pi-gather-hooks.json`

```json
{
  "$schema": "https://unpkg.com/pi-gather-smart-objects@0.1.0/dist/pi-gather-hooks.schema.json",
  "version": 1,
  "enabled": true,
  "defaultObject": "pi",
  "credentialsFile": "~/.pi/agent/gather-objects.env",
  "objects": {
    "pi": {
      "urlEnv": "GSO_PI_URL",
      "secretEnv": "GSO_PI_SECRET"
    }
  },
  "hooks": {
    "enabled": true,
    "object": "pi",
    "modes": ["tui"],
    "states": {
      "ready": { "state": "on", "color": "green" },
      "working": { "state": "working", "color": "blue" },
      "waiting": { "state": "question", "color": "yellow" },
      "error": { "state": "alert", "color": "red" },
      "stopped": { "state": "off", "color": "black" }
    }
  },
  "prompt": {
    "enabled": true
  }
}
```

### Credentials File (`gather-objects.env`)

Secrets must **never** be written directly into `pi-gather-hooks.json`. Instead, store them in a dedicated `.env` file referenced by `credentialsFile`:

```bash
# ~/.pi/agent/gather-objects.env (must have chmod 600)
GSO_PI_URL="https://api.v2.gather.town/api/v2/hooks/spaces/<space-id>/objects/<object-id>"
GSO_PI_SECRET="whsec_<base64-secret>"
```

Ensure strict file permissions:

```bash
chmod 600 ~/.pi/agent/gather-objects.env
```

---

## Tool: `gather_send`

The extension registers exactly one tool for the LLM: `gather_send`.

### Parameters

```ts
{
  object?: string; // Target object alias from config (defaults to defaultObject)
  event: GatherEventType; // e.g. "webhook.ping", "status.set", "activity.add", etc.
  data?: {
    name?: string;        // info.set (<= 120 chars)
    description?: string; // info.set (<= 2000 chars)
    color?: string;       // variant.set (validated against ping colors)
    state?: string;       // status.set ('off'|'on'|'question'|'alert'|'working') or signal.set
    on?: boolean;         // switch.set_state
    count?: number;       // counter.set (>= 0)
    by?: number;          // counter.increment / decrement (>= 1)
    id?: string;          // activity.add / remove (<= 128 chars)
    text?: string;        // activity.add (<= 500 chars)
    url?: string;         // activity.add link (<= 2048 chars, http/https)
  };
}
```

### Supported Events

| Category | Events | Description |
|---|---|---|
| **Discovery** | `webhook.ping` | Inspects preset, current status, capabilities, and accepted colors |
| **Identity** | `info.set` | Sets object name and description |
| **Appearance** | `variant.set` | Sets color (e.g. `green`, `red`, `blue`, `coffee`, `teal`) |
| **5-State Status** | `status.set`, `status.reset` | Indicator state (`off`, `on`, `question`, `alert`, `working`) |
| **Traffic Light** | `signal.set`, `signal.reset` | 3-state signal (`off`, `on`, `alert`) |
| **Switch** | `switch.set_state`, `switch.toggle` | Binary switch (`on: true/false`) |
| **Counter** | `counter.set`, `counter.increment`, `counter.decrement`, `counter.reset` | Integer counter |
| **Activity Feed** | `activity.add`, `activity.remove`, `activity.clear` | Bounded activity feed (stable `id` updates in-place) |

---

## Automated Presence Hooks

When `hooks.enabled: true` is set, Pi automatically drives the Gather Smart Object during execution:

| Pi Event | Trigger | Default State | Default Color |
|---|---|---|---|
| `session_start` | Session initiated / resumed | `on` | `green` |
| `agent_start` | User submitted prompt; agent is working | `working` | `blue` |
| `ui_prompt_start` | Extension UI dialog is waiting for human input | `question` | `yellow` |
| `ui_prompt_end` | Dialog answered | `working` | `blue` |
| `agent_settled` (success/abort) | Turn finished normally | `on` | `green` |
| `agent_settled` (error) | Turn encountered fatal error | `alert` | `red` |
| `session_shutdown` | Clean terminal quit | `off` | `black` |

### Manual Overrides

If the user or agent explicitly calls `gather_send` with `status.set` or `variant.set`, the automated presence hooks pause on that specific property for the remainder of the turn. This ensures manual status changes are not overwritten by automated hooks. Overrides reset on the next `agent_start`.

---

## Human Slash Command (`/gather`)

- `/gather`: Displays integration diagnostics, loaded configuration, and lock statuses.
- `/gather ping [object]`: Directly pings the Gather object and prints capabilities and supported colors.
- `/gather debug`: Displays currently active tools in session and the exact injected prompt section.
- `/gather reload`: Reloads configuration from disk without restarting Pi.
- `/gather auto pause` / `/gather auto resume`: Manually pauses or resumes presence hooks.

---

## Development & Publishing

### Local Development

```bash
bun install
bun run check     # Typecheck, lint, test, build, and verify package
bun run report:size # Inspect bundle and schema size budgets
```

### Automated Release Pipeline

Releases publish automatically to npm via [`.github/workflows/publish.yml`](.github/workflows/publish.yml) using npm Trusted Publishing (OIDC) when a GitHub Release is published:

1. Bump version and create tag:
   ```bash
   npm version patch -m "chore: release v%s"
   git push origin main --tags
   ```
2. Create GitHub Release for tag:
   ```bash
   gh release create v0.1.0 --generate-notes
   ```
3. GitHub Actions checks the release tag against `package.json`, runs the full verification gate on the built tarball, and publishes with public access and provenance.

---

## License

[MIT](LICENSE) © Carmelo Campos. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled dependencies notices.
