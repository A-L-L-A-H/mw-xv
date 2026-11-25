# MoonWitness Riot Agent Observatory (`tools/agent-observatory`)

> **INTERNAL R&D ONLY — NOT A PRODUCT APPLICATION**
>
> This tool is a **local-only, read-only internal R&D workstation observatory** for MoonWitness maintainers debugging parallel AI coding agents during development.
>
> - **Never** deploy publicly, publish in production Docker/Compose/Workers/desktop releases, or import from `apps/*` or `packages/*`.
> - **Zero execution authority:** it observes local files/telemetry only and never mutates `.plan/`, `.git/`, SQLite databases, jobs, or running agents.
> - Production telemetry and operator UI belong exclusively to the single authority defined in [ADR 0017](../../docs/decisions/0017-single-authority-swarm-observability.md). Architectural scope and invariants for this tool are codified in [ADR 0018](../../docs/decisions/0018-internal-rd-agent-observatory.md).

---

## Quickstart (Local Loopback Only)

```bash
node tools/agent-observatory/server.mjs --port 4190
```

Open `http://127.0.0.1:4190` in a local browser.

### CLI Options

| Flag                   | Default           | Description                                                 |
| ---------------------- | ----------------- | ----------------------------------------------------------- |
| `--host <addr>`        | `127.0.0.1`       | Bind address (keep loopback-only).                          |
| `--port <num>`         | `4190`            | HTTP + SSE port (`0` for ephemeral test port).              |
| `--repo <path>`        | Workspace root    | Repository root scanned for `.plan/`, `.swarm/`, and `git`. |
| `--no-network-probes`  | Off (probes on)   | Disable remote VPS HTTP health probes.                      |
| `--no-antigravity-api` | Off (RPC enabled) | Disable local Antigravity conversation RPC polling.         |

---

## Covered Local Runtimes & Sources (Read-Only)

| Source           | Local Path / Mechanism                                             | Telemetry Captured                                                                  |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Antigravity**  | `~/.gemini/antigravity/brain/*/transcript.jsonl` + local RPC       | Sessions, subagent delegations, native swarm boards, tool calls, tokens, errors.    |
| **OpenCode**     | `~/.local/share/opencode/opencode.db` (`node:sqlite`, `readOnly`)  | `session_v2`, `session_part`, `session_message`, parent/child links, cost, tokens.  |
| **Magpie**       | `~/.config/magpie/{gateway.json,usage.jsonl,memory-stats.json}`    | Gateway `:3425` status, bounded `256 KB` tail read, providers, `p50`/avg ms, `429`. |
| **Claude Code**  | `~/.claude/projects/**/*.jsonl`                                    | Sessions, branches, subagents, tokens, tool counts, errors.                         |
| **Codex**        | `~/.codex/sessions/**/*.jsonl`                                     | Rollout sessions, goal state, tokens, tools, errors.                                |
| **Qoder**        | `~/.qoder/projects/**/*.jsonl`                                     | Generic JSONL sessions and recent events.                                           |
| **Gemini CLI**   | `~/.gemini/tmp/**/*.jsonl`                                         | Generic JSONL sessions and recent events.                                           |
| **Plans & Git**  | `.plan/*.md`, `.swarm/swarm.json`, `git status/log/diff`           | Wave progress, task DAG, critical path, commit SHAs, dirty zones.                   |
| **Infra Probes** | Configured VPS URLs + localhost TCP ports (`:3425`, `:4190`, etc.) | Live latency, HTTP status, open local dev ports, host CPU/RAM.                      |

---

## Key Capabilities (`v5`)

### 1. Living p5.js MoonWitness Riot Anime Cinema (`public/js/p5-flow-canvas.js`)

- **Warzone Mode (`⚔️ WAR`, default):** Active coding agents (Antigravity, OpenCode Ronin, Claude/Vesper, Codex Striker, Qoder, and Magpie Hyper-Router turret) render with MoonWitness full-body action pose sprites, spiky battle auras, afterimage trails, and combat attacks (`laser`, `slash`, `bolt`, `rocket`, `boost`) targeting the live **Plan Boss Core** (`Boss HP = 100 - plan.percent`).
- **Additional Formations:** `STAGE`, `BEAMS` (pipeline), `ORBIT`, and `LANES`.
- **Chaos & Cinema Controls:** `CHILL / RIOT / MAX!!` chaos switch, `⚔️ CLASH!!` team ultimate barrage, `📺 ZEN` fullscreen theater mode (`Z`), live bottom-left anime killfeed, and `VHS` snapshot time-travel scrubber (`Space`).
- **Procedural Cartoon Audio (`public/js/sfx-engine.js`):** Web Audio battle SFX (`slash`, `laser`, `clash`, `punch`, `dash`, `boing`, `pop`, `bonk`, `spawn`, `levelup`, `ultimate`), interactive **SFX DJ Soundboard** (`S`), 128 BPM punk-funk breakbeat, and MoonWitness ambient WAV tracks (`NIGHT` / `RAIN` / `HUM`).

### 2. Frontier Research Diagnostics (`server.mjs`, `p5-telemetry-viz.js`, `p5-dag-canvas.js`)

- **6-Signal MAST / TrajAD / AgentDiet Health:** Evaluates every coding session across `toolReliability`, `loopFreedom`, `recovery`, `cacheEfficiency`, `dietScore`, and `budgetHealth`, assigning Fighting-Game Ranks (`S`–`D`), detecting **Silent Loops** (`3+` identical consecutive calls even on HTTP `200`), and estimating context bloat (`AgentDiet`).
- **Multi-Agent Collision & Alert Radar:** Flags simultaneous multi-agent edits to the same repo file (`collision` hazard sparks on Warzone canvas), error loops, Magpie `429` spikes, down VPS endpoints, and dirty tree surges.
- **OpenTelemetry GenAI (`gen_ai.*`) Export & Waterfall:** `GET /api/export?format=otel` exports valid OTLP/JSON traces, and the Hero Manga Dossier renders an interactive Gantt span waterfall per session.
- **5 Unified MoonWitness Comic p5 Instruments (Beat Lab + Quest Map):** Amp Oscilloscope, 60m Tool Equalizer, Street VPS Radar, 6-Signal Hexagonal Spider Radar, 7-Day × 24h Activity Heatmap, plus interactive Plan DAG Quest Map.

---

## HTTP Endpoints (`GET`-Only)

| Route                                   | Description                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `GET /health`                           | Server version (`5`), bound port, SSE client count, vendored p5 verification. |
| `GET /api/state[?fresh=1]`              | Full live snapshot (`sessions`, `plans`, `magpie`, `battle`, `alerts`, etc.). |
| `GET /api/stream`                       | Server-Sent Events (`event: snapshot`) pushed every `2s` on changes.          |
| `GET /api/session?runtime=<rt>&id=<id>` | Detailed hero transcript tail, tool counts, and subagents.                    |
| `GET /api/git/commit?sha=<sha>`         | Git commit header and per-file `+/-` diff stat.                               |
| `GET /api/probe?url=<http(s)://...>`    | SSRF-guarded ad-hoc HTTP health probe.                                        |
| `GET /api/export?format=json\|md\|otel` | Export snapshot as JSON, Markdown report, or OTLP/JSON GenAI traces.          |

---

## Keyboard Shortcuts

- `1`–`6`: Switch Cinema / Quest Map / Beat Lab / Cast / Squad / City & Git
- `Z`: Toggle Fullscreen Zen Anime Cinema Mode
- `S`: Toggle Interactive Cartoon SFX DJ Soundboard
- `Space`: Pause / VHS Time-Travel Replay
- `F`: Fit active p5 camera
- `R`: Force fresh scan
- `Ctrl+K` or `/`: Quick Jump Command Palette
- `Esc`: Close modals, exit Zen mode, return to Cinema

---

## Security & Privacy Guarantees

- **Strict Redaction:** `redactSecrets()` masks Bearer tokens, JWTs, API keys, passwords, and Postgres credentials; personal emails are stripped. Credential/billing files (`credits-daily.json`, `logins.json`, `served.json`, `plugin-auth.json`) are never read.
- **Offline Assets:** Uses vendored `vendor/p5/p5.min.js` (`1.11.3`) and local repo assets under confined path-traversal guards with `Content-Security-Policy: script-src 'self'`.

## Verification

```bash
bunx eslint tools/agent-observatory/
node --test tools/agent-observatory/server.test.mjs
```
