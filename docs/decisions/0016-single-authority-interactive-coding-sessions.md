# ADR 0016: Single-Authority Interactive Coding Sessions

- **Status:** Accepted
- **Date:** 2026-11-25
- **Accepted:** 2026-11-25
- **Decision owners:** MoonWitness maintainers
- **Supersedes:** None
- **Related:** ADR 0007 (addon-first AI corporation), ADR 0014 (bounded cloud coding agent), `docs/architecture/rock-soul-flow-reuse-map.md`, and learned invariants INV-004, INV-007, INV-009, and INV-014.

## Implementation status

The single-authority decision is implemented in the local candidate: `packages/orm-ai` owns the interactive aggregate, durable events/checkpoints, commands, approvals and addon HTTP routes; Board consumes the resumable snapshot/replay contract; execution remains behind the existing durable run boundary. The first implementation delivers bounded typed command, control, approval, and completion events, not general agent-output streaming, a PTY, or an arbitrary terminal byte stream. Local package, focused API and structural-gate evidence is recorded in [`DURABLE-AGENT-OPERATIONS.md`](../roadmap/evidence/DURABLE-AGENT-OPERATIONS.md).

Acceptance records the architecture decision, not production readiness. The evidence remains candidate/incomplete until all local gates finish; hosted rollout and immutable committed-SHA evidence remain separate requirements.

## Scope

This decision covers the architecture and structural boundary for adding resumable browser-based interactive coding sessions to MoonWitness. The affected authority path is:

`Board UI -> API addon HTTP plugin -> packages/orm-ai -> PostgreSQL`, with durable work in `packages/jobs`, large evidence in `packages/orm-storage`, approvals in the owning ORM addon, and execution in the existing typed/allowlisted `apps/agent-sandbox` boundary.

In scope are the implementation and subsequent changes to `packages/orm-ai`, `packages/jobs`, `packages/ai-runtime`, `packages/orm-storage`, `packages/ui`, `apps/board`, the `orm-ai` addon's `manifest.httpPlugins` registration, `apps/desktop`, `apps/agent-sandbox`, and production Compose. `vendor/opencode` is in scope only as an exclusion boundary: it remains an untouched upstream snapshot.

This ADR authorizes no upstream modification or production rollout by itself. It is Accepted because the chosen authority and boundary are implemented locally; browser, database, hosted and remaining falsification gates still require the evidence recorded in the candidate evidence document.

## Context and exact problem

MoonWitness already has a bounded, non-interactive cloud coding agent. It can execute a trusted work contract through `DurableRunEffects`, persist compact run checkpoints, lease work through `packages/jobs`, use fencing and cooperative cancellation, request human approval, and produce deterministic evidence. It does not provide a persistent browser session in which a user can issue commands, inspect delivered bounded typed command/control/approval/completion events, approve a risky step, disconnect, and later resume the same logical run.

The problem is therefore: **how can MoonWitness add resumable, browser-based interactive coding without creating a second session/model authority, bypassing jobs/outbox/approval/tenant controls, or giving the browser or model host privileges?**

Embedding a mature terminal UI is tempting, but Agent Canvas or OpenCode would bring its own session loop, model registry, storage, event ordering, runtime, and approval semantics. Running it beside MoonWitness would create two control planes that must reconcile company ownership, work contracts, capability grants, cancellation, and evidence. `docs/architecture/rock-soul-flow-reuse-map.md` explicitly rejects a second desktop shell/session loop/Bun runtime; INV-009 keeps Desktop as an execution harness rather than a domain authority.

## Alternatives

### A. Embed or run Agent Canvas or OpenCode as a second control plane

**Advantages**

- Reuses a mature terminal/editor interaction model and may shorten time to a visible demo.
- An upstream project can supply provider integrations and UI components independently.
- A sidecar could be replaced without immediately changing MoonWitness's existing non-interactive runner.

**Disadvantages**

- Duplicates session identity, model selection, event sequencing, checkpoints, cancellation, and approval state.
- Requires synchronization and conflict resolution between OpenCode state and MoonWitness's `AgentRun`, jobs, outbox, artifacts, and ORM records; either system can become authoritative after a partial failure.
- Introduces another UI stack and, for OpenCode, another runtime and dependency/update surface, contrary to the reuse map.
- Makes company/user isolation and evidence provenance harder to prove because effects can originate outside `DurableRunEffects`.
- Importing or copying upstream code couples MoonWitness to vendor internals and can mutate the reference snapshot.

**Decision:** Rejected. It optimizes initial UI velocity at the cost of the primary authority and safety invariants.

### B. Native single-authority interactive adapter on existing MoonWitness contracts

**Advantages**

- Keeps one company-scoped authority and one durable execution path.
- Reuses leases, fencing, retries, dead-lettering, outbox delivery, approvals, sandboxing, artifact manifests, and deterministic acceptance evidence.
- Keeps UI in `packages/ui`/`apps/board` and HTTP ownership in addon plugins, preserving INV-007 and INV-014.
- Produces a small, auditable protocol whose ordering, reconnect, cancellation, and duplicate-effect behavior can be tested directly.

**Disadvantages**

- MoonWitness must implement resumable typed event transport, bounded output rendering, and command backpressure rather than adopt an upstream control plane wholesale. A PTY is explicitly outside this first implementation.
- Interactive latency and reconnect UX require load and failure testing beyond the existing request/response coding-agent path.
- Coalescing high-volume output into durable, bounded events is less convenient than storing every token or terminal frame.

**Decision:** Chosen. The additional protocol work is preferable to reconciling two authorities or weakening tenant, approval, and evidence guarantees.

### C. Add polling to the existing non-interactive coding agent

This is simpler than streaming, but it does not provide timely typed output, interactive steering, or a satisfactory reconnect experience. It is useful as an interim delivery mechanism, not as the target architecture.

## Decision

### 1. Domain and authority

1. `packages/orm-ai` exclusively owns the interactive-session aggregate, legal state transitions, commands, durable event envelopes, and checkpoints. Models use its existing addon/model conventions; no equivalent schema belongs in Desktop, Board, OpenCode, or application-local SQLite.
2. Every session and related record is company-scoped and has an owning user. Provider profiles, model profiles, agents, work contracts, capability grants, and approvals remain the existing ORM authorities.
3. `AgentRun` remains the durable execution identity. An interactive session references its runs; it does not replace `AgentRun`, jobs, approval records, or artifact manifests.
4. Durable event envelopes contain compact facts or storage references. Large transcripts and output blobs live in `packages/orm-storage`; delivered command, control, approval, and completion events are bounded rather than creating one ORM row per token or terminal frame.

### 2. Execution and transport

1. The native execution adapter is reachable only behind the existing `DurableRunEffects` boundary. It receives the trusted run snapshot and `AbortSignal` and returns a compact checkpointable result. Any additional streaming capability must be an additive, reviewed extension of that contract in `packages/orm-ai`, not a parallel runner interface.
2. The adapter may live in `packages/ai-runtime` and use the existing sandbox transport, but it has no database authority. The durable session loop remains under ORM/jobs orchestration. Desktop and Board never run that loop.
3. `packages/jobs` supplies leases, heartbeats, fencing, retries, dead-lettering, outbox delivery, and cooperative cancellation. A worker revalidates the company, run, execution fingerprint, grant, approval, and fencing token before every effect.
4. Reuse `AgentRunEffect`'s idempotency key and argument hash for tool side effects. The effect key includes the logical session command/tool-call identity, not a transport attempt number. A retry with the same key returns the recorded result; a changed argument hash fails closed.
5. Browser commands and independent-reviewer reads use addon HTTP endpoints. The first implementation delivers bounded, typed, replayable command, control, approval, and completion events under the same addon ownership; this is not general agent-output streaming. Reconnection is transport-only and never creates a new logical run. A WebSocket or PTY, if later required, must use the same command/event contracts and addon ownership and requires a separate reviewed extension.

### 3. UI, routes, and upstream boundary

1. All interactive UI belongs in `packages/ui` and `apps/board`. The browser uses server APIs and sanitized event payloads; it cannot import ORM, PTY, SQLite, Tauri, or `node:*` runtime modules.
2. Interactive commands, reads, approvals, and stream endpoints are registered only by the owning addon's `manifest.httpPlugins`. No custom interactive-session route file may be added under `apps/api/src/routes`.
3. `apps/desktop` remains the local execution harness and Desktop/Board membrane. It must not define `defineModel`/`defineAddon`, a session/model store, registry, authority, aggregate, event/checkpoint table, or second interactive runner.
4. First-party `apps` and `packages` must not import `vendor/opencode`, `@opencode/*`, `opencode`, or related upstream SDK packages. `vendor/opencode` must not be executed, copied into first-party code, patched, or mounted as a runtime dependency. Behavioral study is allowed; code reuse requires a separate decision and must not mutate the snapshot.

## Lifecycle, ordering, reconnect, and cancellation

The only session states are:

`created -> running -> waiting_approval -> completed | failed | cancelled`

`waiting_approval -> running` is permitted only after a valid approval. `created`, `running`, and `waiting_approval` may transition to `cancelled`; `running` may transition to `failed`. Terminal states never reopen.

- **created:** The session, owning user/company, initial checkpoint, and outbox enqueue intent are committed together. No provider, PTY, or tool effect has occurred.
- **running:** A leased worker reconstructs trusted ORM state, validates fencing and the execution fingerprint, and invokes the adapter. Delivered command, control, approval, and completion events advance the session version and checkpoint.
- **waiting_approval:** A risky effect is proposed with exact tool arguments, capability scope, argument hash, expiry, and requesting run. Entering this state writes a pause intent; its consumer cancels the matching old job and clears only that job reference before externally visible effects can run. The execution entry point independently checks for waiting/terminal session state and fails closed. Approval completion idempotently enqueues/requeues the same logical work with compare-and-set fencing.
- **resume:** Approval atomically records the decision and returns the session to `running` using the current fencing token. Any change to the approved fingerprint requires a new approval. Denial, revocation, or expiry cancels the affected session in the initial implementation rather than retrying the risky effect.
- **completed:** Acceptance evidence and artifact references are committed before the terminal transition. A provider's claim of success is not completion evidence.
- **failed/cancelled:** Unrecoverable execution/invariant failure records a sanitized error. Cancellation records an outbox intent, aborts the adapter, and fences any subsequent stale attempt. An effect already committed is recorded; an uncommitted effect must not run after cancellation is durable.
- **Reconnect/resume:** A browser reconnecting with a sequence cursor receives the current snapshot followed by replayable events. A stale cursor receives a gap notice plus a fresh snapshot; it never silently invents missing events. A worker restart resumes a nonterminal session from its checkpoint under a new lease and fencing token. Reconnect to `waiting_approval` cannot execute work without a valid approval.
- **Ordering:** Each session has a unique, monotonically increasing durable event sequence starting at 1. Event append, session/checkpoint advancement, and outbox insertion are atomic. Events are immutable and are not reused or renumbered.
- **Delivery:** Outbox and event transport are at least once. Consumers deduplicate by `(session_id, sequence, event_id)`; commands carry an idempotency key and return their original result on retry. Transport delivery is not the authority for state transitions.
- **Duplicate effects:** Sequence uniqueness prevents duplicate logical events, but it does not make side effects exactly once. The execution ledger keyed by command/tool-call identity, argument hash, and fencing token is the effect guard. A stale lease cannot append a checkpoint, transition state, or commit an effect after a newer lease or terminal state exists.

## Security boundary

- Company/user ownership is checked on every command, event replay, approval, artifact read, and stream resumption. ORM scoping is mandatory; identifiers supplied by the browser are untrusted.
- Interactive and sandbox service ingress is loopback or private networking only. TLS, VPN, and SSO terminate at the authenticated edge. The browser reaches only the Board/API edge, never PostgreSQL, the jobs worker, or the sandbox directly.
- Provider credentials and host secrets are server-side only. Browser payloads, event envelopes, checkpoints, typed output, errors, and logs must be secret-free and redacted. Secrets must not be accepted as command input, tool arguments, or environment expansion.
- The sandbox runs non-root with network disabled, read-only root filesystem, `cap_drop: [ALL]`, `no-new-privileges`, bounded writable tmpfs/named volumes, and no published sandbox port. Canonical production Compose must not mount or address a Docker socket or bind a host repository/workspace. Repository access uses a per-run snapshot uploaded through the typed artifact/tool boundary.
- Tools are typed and allowlisted. Model output is data, not a shell command, Docker request, network destination, or file path outside the run workspace. Host repository bind mounts and generic host environment access are prohibited.
- Each interactive session delivers only bounded typed command, control, approval, and completion events in the first implementation, not general agent-output streaming. Prompt, approval, command, and delivered-event payload sizes are capped; replay is bounded and oversized payloads are rejected or truncated explicitly. OSC/control-sequence handling is required before any future terminal renderer is introduced.
- Risky effects require a human approval bound to exact arguments, scope, expiry, and execution fingerprint. The requesting model cannot approve its own effect. Approval reuse across changed arguments or companies is forbidden. A dedicated reviewer projection exposes only the pending approval fingerprint, capability, expiry, session identity/status, owner, and requester; full session reads remain owner-only, and neither owner nor requester may decide the approval.
- Git writes, if allowed, affect only the sandbox workspace and produce a reviewed diff artifact. The session has no autonomous merge, push, deploy, release, or publication capability; those remain separate human-controlled workflows.

## Falsifiable invariants

| ID     | Invariant                                                                                            | Required falsification/evidence                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IS-001 | Only `packages/orm-ai` defines interactive-session models, events, checkpoints, and addon ownership. | Schema/addon diff review plus a Desktop negative fixture; no second `defineModel`/`defineAddon`, store, registry, authority, or session table.                                                                    |
| IS-002 | Interactive routes are addon-owned.                                                                  | Negative fixtures for interactive route filenames and route literals fail; addon HTTP integration tests show routes registered through `manifest.httpPlugins`; no host route file is added.                       |
| IS-003 | No first-party OpenCode import or runtime dependency exists, and the vendor snapshot is unchanged.   | Static gate negative fixtures for static, dynamic, `require`, re-export, and relative vendor imports fail; a CI diff rejects changes under `vendor/opencode`.                                                     |
| IS-004 | Board/shared UI has no native/runtime import.                                                        | Negative fixtures for `node-pty`, Tauri, `better-sqlite3`, and `node:*` fail; a browser bundle inspection finds no such module.                                                                                   |
| IS-005 | Event sequence is unique, monotonic, and replayable per session.                                     | Database uniqueness/concurrency tests plus reconnect tests prove no duplicate/reordered durable sequence and deterministic replay from a checkpoint/cursor.                                                       |
| IS-006 | At-least-once delivery does not duplicate commands or logical effects.                               | Replay each outbox/event/command/approval at least twice; consumers converge to one state transition and `AgentRunEffect` records one result per effect key; changed arguments fail closed.                       |
| IS-007 | Resume/reconnect never creates a second logical run or bypasses approval.                            | Kill the stream and worker, reconnect with current/stale cursors, and restart from checkpoint; assert the same `AgentRun` identity, no duplicate provider/tool effect, and no execution while approval is absent. |
| IS-008 | Fencing and cancellation dominate stale work.                                                        | Start worker A, fence it with worker B, cancel, then let A resume; assert A cannot transition, append, or commit an effect and its `AbortSignal` is observed.                                                     |
| IS-009 | Lifecycle transitions and approval fingerprints are exact.                                           | Table-driven tests cover every legal/illegal transition, approval expiry/revocation, changed arguments, terminal immutability, and company/user mismatch.                                                         |
| IS-010 | Production sandbox has no host privilege path.                                                       | Compose gate rejects sockets/binds/aliases; runtime tests prove non-root UID, read-only root, dropped capabilities, no new privileges, no network, no published port, and no Docker socket/host repository mount. |
| IS-011 | Output and execution are bounded and secret-free.                                                    | Quota/backpressure/idle-timeout tests force truncation and cancellation; secret canaries do not appear in browser events, logs, checkpoints, or artifacts.                                                        |
| IS-012 | Completion and publication are evidence-bound and human-controlled.                                  | Missing/stale acceptance evidence prevents `completed`; no tool/grant permits autonomous merge, push, deploy, or release.                                                                                         |

The static gate covers the structural subset of IS-001 through IS-004 and IS-010. ORM, integration, concurrency, runtime, browser, PostgreSQL, hosted, and threat-model tests are still required for the remaining behavior; passing a static gate is not evidence that those behaviors work. Current local results and open gates are tracked in [`DURABLE-AGENT-OPERATIONS.md`](../roadmap/evidence/DURABLE-AGENT-OPERATIONS.md).

## Verification protocol

Verification must use executable **FAIL_TO_PASS** and **PASS_TO_PASS** evidence, not agent self-report or a statement that the architecture looks correct.

1. Record a clean baseline and run existing relevant gates as PASS_TO_PASS evidence.
2. For each boundary rule, run a negative temporary fixture before the rule is considered complete: the assertion must fail against the baseline/unguarded behavior (FAIL_TO_PASS) and the same CLI assertion must pass once the guard exists. Run clean positive fixtures as PASS_TO_PASS so comments, named volumes, legitimate Desktop harness code, and non-import strings are not rejected.
3. Preserve the exact commands, exit status, machine-readable JSON, test output, Node version, and reviewed diff as execution evidence. JSON reports list checked files and violations in stable order and contain no timestamps.
4. Required architecture-slice commands are:

   ```sh
   node --test scripts/check-interactive-session-boundary.test.mjs
   node scripts/check-interactive-session-boundary.mjs --json
   node --check scripts/check-interactive-session-boundary.mjs
   ```

5. A current-repository violation is reported with its file/line evidence and fixed or explicitly adjudicated; it is not hidden by weakening an invariant. A failed or unexecuted check is not a pass.

## Consequences

### Positive

- One authority remains understandable, company-scoped, auditable, and recoverable.
- Existing jobs/outbox/approval/sandbox/evidence investment is reused rather than forked.
- Browser interactivity can evolve behind a small versioned protocol without adopting another runtime or desktop shell.
- The upstream OpenCode snapshot remains useful as a reference without becoming a hidden control plane.

### Negative and costs

- MoonWitness owns typed event rendering, bounded output, reconnect UX, and adapter hardening.
- Durable event volume and retention must be budgeted; raw per-token persistence is intentionally avoided.
- Interactive failure modes require chaos, soak, approval, and sandbox tests beyond static architecture checks.
- The first implementation will favor safe cancellation/denial and bounded output over uninterrupted or token-perfect interaction.

## Explicit non-goals

- No Agent Canvas/OpenCode embedding, sidecar control plane, vendor patch, copied upstream runtime, or Bun runtime.
- No second desktop shell, session loop, local ORM/database, queue, model registry, or session authority.
- No replacement of `AgentRun`, `DurableRunEffects`, `packages/jobs`, outbox, approvals, artifacts, or sandboxing.
- No autonomous merge, push, deploy, release, publication, or self-approval.
- No direct browser access to PostgreSQL, workers, sandbox ports, host repositories, Docker, provider secrets, or unrestricted networks.
- No shared multi-user terminal, persistent developer VM, general IDE/editor replacement, arbitrary internet execution, or agent marketplace.
- No PTY, arbitrary terminal byte stream, per-token durable event stream, or interactive shell in the first implementation.
- No claim that ADR acceptance or local package tests complete Board browser, PostgreSQL, hosted rollout, chaos/soak, or production acceptance gates.

## Coordinator follow-ups

- Keep the ADR register and candidate evidence aligned with the implemented addon ownership and boundary gates; add a root aggregate command/required CI wiring only through a separately reviewed tooling change.
- Complete Board browser, PostgreSQL, hosted multi-replica, runtime, chaos/soak, approval, and sandbox falsification gates before claiming production readiness.
- Review any further additive ORM migration, adapter extension, terminal component, threat-model change, and rollout/rollback plan against this Accepted decision; record the resulting immutable commit SHA and CI evidence.
