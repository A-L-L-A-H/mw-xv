# ADR 0017: Single-Authority Swarm Orchestration and Observability

- **Status:** Accepted
- **Date:** 2026-11-25
- **Accepted:** 2026-11-25
- **Decision owners:** MoonWitness maintainers
- **Related:** ADR 0007 (AI corporation), ADR 0015 (delivery governance), ADR 0016 (interactive coding sessions), and learned invariants INV-004, INV-007, INV-009, and INV-014.

## Implementation status

The addon-owned telemetry authority is implemented in the local candidate: OTLP/Qoder ingest, SQL-backed correlation and persistence, credential-derived tenant attribution, company-scoped reads, and Board Mission Control use the canonical API path. Local package, focused API and structural-gate evidence is recorded in [`DURABLE-AGENT-OPERATIONS.md`](../roadmap/evidence/DURABLE-AGENT-OPERATIONS.md).

Acceptance records the architecture decision, not production readiness. Local PostgreSQL checks and all 8 Chromium scenarios passed. Hosted multi-replica validation and production cutover remain open, and the source SHA is not immutable until the candidate is committed.

## Scope

This decision unifies the control-plane boundary for coding-agent coordination, execution evidence, and operational stability:

`apps/board -> apps/api addon HTTP plugins -> packages/orm-ai / packages/orm-observability -> packages/jobs -> PostgreSQL`

`apps/agent-sandbox` remains the isolated execution sidecar. `apps/desktop` remains a local edge harness and PCW synchronization client, not a second server-side domain authority. The portable `visual-swarm` skill is a coordinator workflow and read-only visualization aid, not a scheduler, database, telemetry receiver, or control plane.

## Context

MoonWitness had three related but separate surfaces:

1. `AgentRun` and `packages/jobs` owned durable execution, leases, fencing, retries, cancellation, and evidence.
2. `apps/agent-observability` ran its own Fastify listener, optional shared ingest/read token, in-memory or SQLite store, and static dashboard.
3. `visual-swarm` rendered a file-backed task DAG and agent activity from `.swarm/swarm.json` through a local HTTP/SSE server.

The standalone observability application was not named `apps/otel`. Its browser dashboard and Qoder hooks did not send the optional receiver token, so enabling that token protected neither audience correctly: legitimate browser reads and hook ingestion failed while both surfaces shared one ambiguous credential boundary. Running a second receiver also duplicated lifecycle, retention, deployment, authentication, and failure handling.

A swarm DAG is not an execution ledger. `task.dependsOn` describes intended coordination; `AgentRun`, job attempts, and observed spans describe what actually ran. Conflating them would let a visually complete task mask a stale worker, failed effect, missing span, or retried run.

## Alternatives

### A. Keep the standalone observability server and add links from Board

This preserves the existing receiver but leaves two API authorities, two security models, separate retention, and a static dashboard outside the Board shell. It also cannot provide trustworthy company attribution because telemetry models have no trusted tenant dimension.

**Decision:** Rejected.

### B. Embed an external agent canvas or terminal control plane with its own observability

This may provide a polished agent UI quickly, but imports another session loop, model registry, event order, storage, and health model. It conflicts with ADR 0016 and duplicates the authority this decision is intended to remove.

**Decision:** Rejected.

### C. One Board/API authority with addon-owned telemetry

Move OTLP decoding, Qoder lifecycle bridging, redaction, queries, and retention into `packages/orm-observability`; expose them through its addon HTTP plugin; use the API-owned PostgreSQL connection; and render the only operator UI in Board Mission Control. Keep the skill dashboard local, read-only, and explicitly non-authoritative.

**Decision:** Chosen. This reuses the existing addon, authentication, database, and UI boundaries and provides one place to evolve credential-derived tenant attribution, retention, incident evidence, and agent health.

## Decision

### 1. Authority map

| Concern                                           | Sole authority                                        |
| ------------------------------------------------- | ----------------------------------------------------- |
| Operator UI                                       | `apps/board`, with shared primitives in `packages/ui` |
| HTTP host and authentication                      | `apps/api`                                            |
| Domain routes                                     | Owning addon `manifest.httpPlugins`                   |
| Agent identity, runs, effects, approvals          | `packages/orm-ai` and related owning ORM addons       |
| Queue, leases, fencing, retries, outbox           | `packages/jobs`                                       |
| Telemetry decoding, redaction, queries, retention | `packages/orm-observability`                          |
| Production persistence                            | API-owned PostgreSQL                                  |
| Isolated execution                                | `apps/agent-sandbox`                                  |
| Coordination instructions and local visualization | Portable `visual-swarm` skill; no execution authority |

No additional observability receiver, queue, database, static operator dashboard, or interactive runner may be introduced under `apps/` or `packages/`.

### 2. HTTP contract

The observability addon owns these routes:

- `POST /v1/traces`
- `POST /v1/metrics`
- `POST /v1/logs`
- `POST /v1/qoder`
- `GET /api/observability/summary`
- `GET /api/observability/traces`
- `GET /api/observability/traces/:traceId`
- `GET /api/observability/logs`
- `GET /api/observability/metrics`
- `GET /api/observability/config`
- `GET /api/observability/credentials`
- `POST /api/observability/credentials`
- `POST /api/observability/credentials/:id/revoke`

Ingest routes use `config: { public: true }` only to bypass the browser JWT prehandler. They must independently require a dedicated ingest credential of at least 32 characters, accept `Authorization: Bearer` or `x-observability-token`, and fail closed when ingest is not configured. Registry credentials are stored as hashes, support expiry/revocation, and may carry a server-side company/user binding. The legacy environment token remains supported without tenant attribution and is compared in constant time. Missing or invalid credentials return `401`; an unconfigured server returns `503`; neither path falls back to anonymous ingestion.

Telemetry read routes require a valid JWT. `system` and `superadmin` read the global scope. A company user may read only the active company from authenticated server-side context, after active company membership is revalidated and `observability.telemetry_span` read access is granted. Client-supplied company or agent identifiers never establish tenant scope. Ingest-credential management routes remain administrator-only.

Responses use `{ success: true, data }` or `{ success: false, error }`. Collection data is wrapped as `{ traces: [] }`, `{ logs: [] }`, or `{ metrics: [] }` where applicable so the Board client has one stable response contract.

### 3. Persistence and lifecycle

- Production ingest and reads use the API-owned `SqlTelemetryStore` and PostgreSQL connection.
- The addon must construct the store with non-owning database lifecycle (`closeDb: false`) and must never call `destroy()` on the shared Knex instance. The API owns connection shutdown.
- The existing SQLite store remains an addon/test harness for isolated environments; it is not a second production receiver or operator authority.
- OTLP payload decoding and Qoder lifecycle bridging move into `packages/orm-observability` so app-local instrumentation does not own domain behavior.
- Qoder prompt/tool/subagent correlation state and counters are persisted in the SQL telemetry store with tenant-scoped keys and expiry. Separate store instances and API replicas therefore share correlation state instead of relying on process-local memory; hosted multi-replica validation remains an open gate.
- `apps/agent-observability` becomes an instrumentation/client package only. It must not start a listener, serve static assets, create a database, or expose `dev` or `start` server scripts.

### 4. Security and data handling

- Ingest and read credentials are separate. A telemetry ingest token cannot read traces, logs, or metrics.
- Tenant attribution comes only from the server-side ingest credential registry. Telemetry attributes and browser parameters cannot assert a company. Persisted span/log/metric identities and Qoder correlation keys include the tenant boundary.
- OTLP/Qoder input is bounded and redacted before persistence. Qoder hooks store lifecycle metadata, identifiers, timing, and lengths, not raw prompts, responses, messages, tool payloads, or error bodies.
- The API body limit remains the host security boundary. The addon must reject oversized or malformed batches without buffering unbounded data.
- No browser receives database credentials, provider secrets, ingest tokens, host environment values, or direct worker/sandbox access.
- Production Compose does not publish an observability or sandbox port and does not mount a Docker socket or host repository.

### 5. Swarm visualization contract

- `.swarm/swarm.json` is local coordination state. It contains no secrets or sensitive user content and is never a source of execution truth.
- Task `dependsOn` is the intended DAG. Runtime parentage comes from trusted span data such as `span.parentSpanId`; it must not be inferred from a task owner or visually drawn edge.
- The local dashboard may show plan, reported agent state, and telemetry health side by side, but labels their provenance and never changes jobs, runs, approvals, or telemetry.
- Live updates use manifest changes for local coordination. Operational health uses canonical API telemetry reads. The dashboard remains loopback-only unless public exposure is explicitly requested and reviewed.
- The skill is canonical under `.agents/skills/visual-swarm`; `.qoder/skills/visual-swarm` is only a compatibility bridge and must not maintain duplicate scripts or assets.

## Falsifiable invariants

| ID     | Invariant                                                                                                                                                      | Evidence                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| SO-001 | Only `packages/orm-observability` defines observability addon/models and domain ingest/read routes.                                                            | Boundary gate rejects second `defineModel`, `defineAddon`, and route registration; addon integration tests prove registration.           |
| SO-002 | `apps/agent-observability` cannot run a receiver, static dashboard, or database.                                                                               | Package/source negative fixtures fail; package tests show instrumentation-only exports.                                                  |
| SO-003 | Ingest requires a dedicated strong credential and fails closed when unconfigured.                                                                              | Integration tests cover missing, short, wrong, Bearer, header, constant-time legacy comparison, registry expiry, and revocation paths.   |
| SO-004 | Telemetry reads require JWT global-admin authorization or authenticated company-scoped read authorization; ingest-credential management is administrator-only. | Integration tests cover anonymous access, company-user grant/denial and membership, cross-company isolation, `system`, and `superadmin`. |
| SO-005 | The addon does not own or destroy the API database.                                                                                                            | Source gate rejects `destroy()` in the HTTP plugin; lifecycle tests leave the shared connection usable after addon shutdown.             |
| SO-006 | Raw prompts, secrets, and unbounded payloads are not persisted.                                                                                                | Redaction, malformed-input, size-limit, and secret-canary tests.                                                                         |
| SO-007 | Board is the only operator telemetry UI.                                                                                                                       | Boundary gate rejects telemetry route/static-server code outside the addon; Board uses shared UI and scoped React Query keys.            |
| SO-008 | Swarm plan state is not execution evidence.                                                                                                                    | UI and tests label planned versus observed provenance; no runtime parent edge is derived from `dependsOn`.                               |
| SO-009 | Existing jobs, fencing, approvals, and sandbox boundaries remain authoritative.                                                                                | Negative imports/definitions and the ADR 0016 gate remain clean; runtime fencing tests pass.                                             |

The static gate covers the structural subset of SO-001, SO-002, SO-005, and SO-007. Authentication, redaction, lifecycle, tenant isolation, and runtime correctness require executable integration tests; a clean static scan is not sufficient evidence.

## Verification

Required architecture-slice commands:

```sh
node --test scripts/check-swarm-observability-boundary.test.mjs
node scripts/check-swarm-observability-boundary.mjs --json
node --check scripts/check-swarm-observability-boundary.mjs
```

Required implementation evidence also includes observability addon tests, API registration tests, Board type checking, dashboard CLI tests, browser checks, and the existing interactive-session boundary gate. A failed or unexecuted check is not a pass. Local PostgreSQL checks and all 8 Chromium scenarios passed; hosted multi-replica validation and production cutover remain open. Current local results and remaining gates are tracked in [`DURABLE-AGENT-OPERATIONS.md`](../roadmap/evidence/DURABLE-AGENT-OPERATIONS.md).

## Consequences

### Positive

- One API, authentication model, persistence lifecycle, and operator UI cover agent execution and stability.
- OTLP and Qoder hooks can evolve without maintaining a second server.
- Board can correlate intended work, durable run state, and observed traces without inventing a second scheduler.
- The portable skill works across coding agents while retaining deterministic local visualization.

### Costs and limitations

- Company-scoped telemetry reads and credential-derived tenant attribution are implemented. Telemetry ingested with the legacy or an unscoped registry credential remains global and is not visible to company users; producers requiring tenant reads must use company-bound credentials.
- SQL-backed Qoder correlation is shared across store instances/replicas rather than process-local. PostgreSQL concurrency and hosted multi-replica soak/failover evidence are not yet complete.
- Board telemetry adds API and database read load; queries and retention need benchmarking as volume grows.
- Removing the standalone receiver is a deployment cutover: clients must be repointed to the canonical API and provisioned with ingest credentials before old ingress is disabled.

## Non-goals

- No second observability server, static dashboard, queue, database, model registry, or session authority.
- No unauthenticated ingest, shared ingest/read token, client-asserted tenant attribution, or tenant attribution from telemetry attributes.
- No replacement of `AgentRun`, `packages/jobs`, approvals, outbox, artifacts, or sandboxing.
- No autonomous merge, push, deploy, release, publication, or self-approval.
- No claim that a green task card proves a successful effect or healthy runtime.
