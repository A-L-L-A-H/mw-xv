# ADR 0018: Internal R&D Observatory, Discovery & Monitoring Lab (`tools/agent-observatory`)

- **Status:** Superseded (consolidated into `apps/desktop/desktop-web/observatory/`)
- **Date:** 2026-11-25
- **Audience & Distribution Scope:** **INTERNAL R&D WORKSTATION LAB ONLY** (non-product developer workbench for live observability, discovery, monitoring, and rapid R&D prototyping; never deployed to end-users, production SaaS, or packaged apps).
- **Decision owners:** MoonWitness maintainers
- **Related:** [ADR 0006](0006-mandatory-addon-thin-api.md), [ADR 0007](0007-ai-corporation-addon-first-architecture.md), [ADR 0016](0016-single-authority-interactive-coding-sessions.md), [ADR 0017](0017-single-authority-swarm-observability.md), and learned invariants `INV-004`, `INV-007`, `INV-009`, `INV-014`.

## Scope & Internal R&D Lab Charter

This ADR originally governed the standalone local workstation workbench at `tools/agent-observatory/` (`v6`), which has since been consolidated into `apps/desktop/desktop-web/observatory/`.

**Strict Classification & Charter:**

- `tools/agent-observatory/` is MoonWitness's **Internal R&D Multi-Domain Lab** — a single local loopback sandbox combining:
  1. **Observatory:** Live multi-runtime coding-agent visualization (p5.js Warzone Cinema, Plan DAG Quest Map, OTel GenAI span waterfalls).
  2. **Discovery:** Auto-discovery of workspace apps, packages, ADRs (`docs/decisions/`), agent skills (`.agents/skills/`), deploy compose topologies (`deploy/compose/`), and local Magpie Memory Vault card counts with live read-only markdown inspection.
  3. **Monitoring:** Real-time host CPU/RAM oscilloscope, Magpie gateway `:3425` latency (`p50`/avg/TTFT) & `429` tracking, SSRF-guarded VPS/localhost probes, 6-signal MAST/TrajAD/AgentDiet trajectory health, and multi-agent file-collision alerts.
  4. **Internal R&D Prototyping ("Anything Lab"):** Safe, zero-product-impact playground for engineers to prototype experimental visualizations, telemetry heuristics, and diagnostic tools before any vetted concept is formally promoted into an ORM addon under [ADR 0017](0017-single-authority-swarm-observability.md).
- It is **NOT** a product application, **NOT** an operator console for customer deployments, and **NOT** an execution, scheduling, queue, or persistence authority.
- Production observability and operator UI remain exclusively under the single authority defined in [ADR 0017](0017-single-authority-swarm-observability.md):
  `apps/board -> apps/api -> packages/orm-observability -> PostgreSQL`.

## Context & Problem Statement

During intensive multi-agent R&D on `mw-xv`, engineers routinely run 5–15 concurrent local coding sessions across heterogeneous runtimes on the same workstation:

- Antigravity conversations (`~/.gemini/antigravity/brain/*` + local RPC)
- OpenCode SQLite v2 sessions (`~/.local/share/opencode/opencode.db`)
- Magpie local router/gateway (`~/.config/magpie/` on loopback `:3425`, whose `usage.jsonl` can exceed `100 MB`)
- Claude Code (`~/.claude/projects/`), Codex (`~/.codex/sessions/`), Qoder (`~/.qoder/projects/`), and Gemini CLI (`~/.gemini/tmp/`)
- Local repository execution plans (`.plan/*.md`), visual-swarm manifests (`.swarm/swarm.json`), Git working tree status, and remote VPS health endpoints.

Without a unified local R&D lens, four failure modes repeatedly occur during internal development:

1. **Multi-agent file collisions:** Two parallel runtimes (e.g., OpenCode and Claude Code) editing the same file or committing over each other's `HEAD`.
2. **Silent loops & wasted context compute:** As documented in `MAST` (`arXiv:2503.13657`), `TrajAD` (`arXiv:2602.06443`), `FailureAtlas` (`arXiv:2607.17525`), and `AgentDiet` (`arXiv:2509.23586`), agents burn tokens repeating identical HTTP-200 tool invocations with zero forward progress while health indicators stay green.
3. **Gateway & rate-limit opacity:** Local Magpie multi-provider routing (`429` spikes, tail-latency outliers skewing mean vs `p50`, memory recall stats) is invisible across terminal tabs.
4. **Cognitive fatigue:** Plain scrolling JSONL logs hide real-time plan DAG readiness, critical paths, subagent fan-out, and cross-runtime topology.

## Evaluated Alternatives

### A. Expand `apps/board` + `packages/orm-observability` to read local `~/.claude`, `~/.codex`, `~/.local/share/opencode`, and `~/.config/magpie`

- **Pros:** Single UI surface.
- **Cons:** Violates production security and tenant-isolation boundaries ([ADR 0017](0017-single-authority-swarm-observability.md)), couples production SaaS bundles to workstation-specific private dotfile schemas, and risks leaking local developer machine artifacts into customer-facing codebases.
- **Decision:** Rejected.

### B. Adopt an external third-party agent dashboard (e.g., Electron pixel-office apps or hosted SaaS tracers)

- **Pros:** Zero upfront code.
- **Cons:** Adds external cloud telemetry egress or heavy native dependencies, lacks native MoonWitness `.plan/*.md` wave/DAG parsing, lacks SQLite v2 OpenCode + bounded Magpie `:3425` support, and cannot enforce MoonWitness redaction or Riot visual DNA.
- **Decision:** Rejected.

### C. Zero-dependency, loopback-only Internal R&D Observatory under `tools/agent-observatory/`

- **Pros:** Zero npm runtime dependencies (pure Node.js 24 built-ins including `node:sqlite` read-only mode + offline-vendored `p5.js 1.11.3`), completely isolated from `apps/*` and `packages/*`, strict loopback-only read-only observer, rich Riot Anime Cinema visualization + frontier research diagnostics + standard OpenTelemetry GenAI (`gen_ai.*`) OTLP/JSON export for interoperability with external OTel tools.
- **Cons:** Must be explicitly fenced off from production packaging, CI deployment targets, and `apps/*`/`packages/*` imports.
- **Decision:** Chosen.

## Decision

### 1. Strict Internal R&D Isolation & Non-Authority Membrane

| Boundary Dimension         | Mandate                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Location                   | Exclusively `tools/agent-observatory/` (historical; superseded by `apps/desktop/desktop-web/observatory/`).  |
| Product Coupling           | `apps/*` and `packages/*` MUST NEVER import from `tools/agent-observatory/`.                                                          |
| Deployment Exclusion       | Excluded from production Docker/Compose files, Cloudflare Workers deployments, and end-user desktop installers.                       |
| Network Exposure           | Binds strictly to loopback `127.0.0.1` by default (`--port 4190`), `GET`-only HTTP API (`405` on all mutating verbs).                 |
| Execution / State Mutation | Strictly read-only. Never mutates `.plan/`, `.git/`, SQLite databases (`{ readOnly: true }`), Magpie state, jobs, or running agents.  |
| Authority Relationship     | Non-authoritative R&D diagnostic aid; [ADR 0017](0017-single-authority-swarm-observability.md) remains sole production observability. |

### 2. Frontier Research Telemetry Engine (`v5`)

`tools/agent-observatory/server.mjs` implements deterministic, zero-LLM-cost diagnostics derived from 2025–2026 multi-agent observability literature:

1. **6-Signal Failure-Aware Trajectory Health (`arXiv:2606.01365`, `MAST` `arXiv:2503.13657`, `TrajAD` `arXiv:2602.06443`, `AgentDiet` `arXiv:2509.23586`):**
   - Computes per-session and fleet-wide signals (`toolReliability`, `loopFreedom`, `recovery`, `cacheEfficiency`, `dietScore`, `budgetHealth`), composite score (`0–100`), rank (`S`/`A`/`B`/`C`/`D`), `AgentDiet` estimated context-bloat percentage, and `MAST` failure class (`HEALTHY`, `SILENT-LOOP`, `TOOL-FAILURE`, `CONTEXT-BLOAT`).
   - Detects **Silent Loops** (`3+` consecutive identical `tool + summary` steps even on HTTP `200` / zero exit code).
2. **Multi-Agent Operational Alert Radar:**
   - Detects real-time cross-runtime **File Collisions** (2+ active/recent coding agents touching the exact same repo file), **Error Loops**, **Silent Loops**, **Magpie 429 rate-limit pressure**, **Down VPS probes**, and **Dirty Tree Surges**.
   - Surfaces collision pairs directly on the p5 topology canvas as hazard lightning links.
3. **OpenTelemetry GenAI Semantic Conventions (`llmmas-otel` `arXiv:2608.24271`):**
   - `GET /api/export?format=otel` exports live agent runs and tool calls as valid OTLP/JSON (`resourceSpans -> scopeSpans -> spans`) using `gen_ai.operation.name`, `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, `gen_ai.tool.name`, and `moonwitness.trajectory.*` attributes.
   - Hero inspection drawers render an interactive Gantt-style `gen_ai.*` trace span waterfall.
4. **Bounded Multi-Runtime Collectors & Cache Freshness:**
   - OpenCode SQLite v2 (`opencode.db`) is opened strictly `{ open: true, readOnly: true }`.
   - Magpie `usage.jsonl` uses bounded `256 KB` tail reads (never full-file reads) and computes both mean and `p50` median latency of `2xx/3xx` responses.
   - Cached OpenCode and Magpie sessions re-evaluate wall-clock status decay (`running -> recent -> idle`) on every snapshot tick even when file `mtime` is unchanged.

### 3. Security, Privacy & Asset Membrane

- **Secret & PII Redaction:** `redactSecrets()` strips Bearer tokens, JWTs, API keys, passwords, and Postgres DSN credentials across all transcripts, OpenCode tool inputs/errors, and Magpie route summaries. Personal emails are stripped, and credential/billing files (`credits-daily.json`, `logins.json`, `served.json`, `plugin-auth.json`) are never read.
- **SSRF Guard:** `GET /api/probe?url=...` validates `http:`/`https:` schemes and blocks cloud metadata, link-local (`169.254.x.x`), and `0.0.0.0` targets.
- **Static Confinement & CSP:** Serves strict `Content-Security-Policy` (`script-src 'self'`), confined path traversal guards on `/`, `/vendor/p5.min.js`, `/mw-assets/*`, and `/mw-art/*` (reusing existing local MoonWitness Riot art/audio assets purely in-repo for R&D visualization).

## Falsifiable Invariants

| ID         | Invariant                                                                                                            | Verification Evidence                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| RD-OBS-001 | No `apps/*` or `packages/*` module imports from `tools/agent-observatory/`.                                          | `node scripts/evolution/check-constitution.mjs` and `node scripts/preflight-fast.mjs`.    |
| RD-OBS-002 | Observatory HTTP API is read-only (`GET` only; non-`GET` returns `405`) and binds loopback `127.0.0.1` by default.   | `node --test tools/agent-observatory/server.test.mjs`.                                    |
| RD-OBS-003 | Secrets, tokens, DSN credentials, and account emails never appear in `/api/state`, `/api/session`, or `/api/export`. | `redactSecrets`, OpenCode, and Magpie redaction unit tests in `server.test.mjs`.          |
| RD-OBS-004 | `/api/probe` blocks non-HTTP schemes, link-local, and cloud metadata SSRF targets with `400`.                        | `validateProbeUrl` and HTTP probe integration assertions in `server.test.mjs`.            |
| RD-OBS-005 | Static mounts block `..` traversal outside `public/`, `vendor/p5/`, `packages/assets/`, and `art/`.                  | HTTP `404` traversal tests in `server.test.mjs`.                                          |
| RD-OBS-006 | Cached OpenCode/Magpie sessions decay from `running` to `idle` as wall-clock time elapses without file mtime change. | Cache freshness decay test in `server.test.mjs`.                                          |
| RD-OBS-007 | Trajectory health detects 3+ consecutive silent loops and `/api/export?format=otel` emits valid OTLP `gen_ai.*`.     | `analyzeTrajectoryHealth` and `formatSnapshotOtel` unit/HTTP tests in `server.test.mjs`.  |
| RD-OBS-008 | All p5 canvases load 100% offline from `vendor/p5/p5.min.js` with zero external CDN requests or console errors.      | Vendored p5 HTTP check in `server.test.mjs` + Playwright visual/network audit on `:4190`. |

## Verification

```powershell
bunx eslint tools/agent-observatory/
node --test tools/agent-observatory/server.test.mjs
node scripts/evolution/check-constitution.mjs
node scripts/preflight-fast.mjs
```

## Consequences

### Positive

- Gives internal engineers an instant, zero-dependency, offline-capable live R&D cockpit across Antigravity, OpenCode, Magpie, Claude Code, Codex, Qoder, Gemini CLI, `.plan/` DAGs, Git, and VPS probes.
- Surfaces silent loops, context bloat, file collisions, and Magpie `429` pressure mid-flight without risking production app coupling.
- Emits portable OTLP/JSON GenAI traces that can feed downstream research benchmarks or external OTel viewers.

### Limitations & Non-Goals

- **Strictly Internal R&D Only:** Must never be exposed publicly, shipped to customers, or granted write/control authority over agents, Git, or production databases.
- Workstation dotfile collectors assume local filesystem access on the developer's machine and are intentionally unsupported in multi-tenant cloud deployments (which use [ADR 0017](0017-single-authority-swarm-observability.md)).
