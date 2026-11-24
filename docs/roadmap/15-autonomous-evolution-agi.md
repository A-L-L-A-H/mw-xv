# M14 — Autonomous Evolution & Decentralized Mesh Swarm Plan (Path to AGI-Class Workforce)

Status: **in progress (foundation modules & ADR 0009 landed)** — this document defines the next-phase evolution milestones built 100% from scratch on MoonWitness's canonical stack. Foundation modules (`evolution-loop.ts`, `ablation-gate.ts`, `obligation-monitor.ts`, `a2a-protocol.ts`) and [ADR 0009](../decisions/0009-a2a-mesh-federation.md) are now implemented; it does not alter current release blockers or bypass [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md).

## Architectural Foundation & Rejection of External Agent Frameworks

M14 builds exclusively on MoonWitness's native domain and execution planes:

- **Domain Plane:** `@moonwitness/orm-ai`, `@moonwitness/orm-workflow`, `@moonwitness/orm-storage`, `@moonwitness/orm-organization`, `@moonwitness/orm-base`, and `@moonwitness/jobs` (PostgreSQL single source of truth).
- **Execution & Evaluation Plane:** `@moonwitness/ai-runtime`, `@moonwitness/ai-evaluation`, `@moonwitness/ai-mcp`, `apps/desktop`, and `apps/control-plane`.
- **Interoperability Plane:** Thin, stateless open protocol adapters (**MCP** for tools/resources and **A2A** for bounded peer delegation) rather than monolithic orchestration frameworks.

### Why External Monolith Frameworks (Mastra, LangChain, CrewAI) Are Rejected

| Concern                                                  | External Monolith Frameworks (Mastra / LangChain / CrewAI)                                                      | MoonWitness Canonical Stack (`orm-ai` + `ai-runtime` + `ai-evaluation` + MCP/A2A)                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source of truth (ADR 0007 D1–D2)**                     | Introduce shadow state stores, opaque memory tables, and framework-specific runners outside `@moonwitness/orm`. | All contracts, runs, grants, obligations, skills, and memories live in PostgreSQL via `defineModel`/`defineAddon`.                                        |
| **Authority & tenant isolation (ADR 0007 D8, ADR 0006)** | Derive tool access from prompt chains or global process env; weak multi-company and `superadmin` isolation.     | Immutable single-company `ai.agent` (`role: 'user'`), execution-time `ai.capability_grant` checks, and `INTERNAL_PREFIXES` protection.                    |
| **Acceptance & verification (ADR 0007 D6, D12)**         | Treat LLM self-reported completion as done; lack deterministic Proof-Carrying Work (PCW) gates.                 | Server-authoritative Proof Gate v2 (5-state check matrix, `validateDiffScope`, SHA-256 evidence digests, independent review).                             |
| **Learning safety (ADR 0007 D10)**                       | Mutate prompts or vector stores live without ablation or rollback governance.                                   | Candidate-first `ai.skill_version` / `ai.memory_candidate`, offline `G0`–`G6` ablation/harm evaluation, `orm-workflow` promotion, and instant revocation. |
| **Durability & protocol hygiene (ADR 0007 D9, D11)**     | Couple business logic to volatile framework SDKs and custom queue backends.                                     | Reuses `@moonwitness/jobs` (`SKIP LOCKED`, leases, monotonic fencing tokens, `AbortSignal`) and thin stateless MCP/A2A adapters.                          |

---

## M14.01 — Closed-Loop Self-Improvement (`Skill & Memory Evolution`)

- **Status:** foundation implemented (`packages/ai-runtime/src/evolution-loop.ts`, `packages/ai-evaluation/src/ablation-gate.ts`)
- **Prerequisites:** M12.08–M12.14, [M13.06](14-desktop-engineering.md), [M13.08](14-desktop-engineering.md), [M13.10](14-desktop-engineering.md).
- **Governing decisions:** [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) (D6, D10, D12), [ADR 0006](../decisions/0006-mandatory-addon-thin-api.md).
- **Canonical owners:** `@moonwitness/orm-ai` (`ai.skill_version`, `ai.memory_candidate`), `@moonwitness/ai-runtime`, `@moonwitness/ai-evaluation`, `@moonwitness/orm-workflow`.

### Goal

Close the learning loop safely so Proof-Gate-verified runs automatically synthesize candidate procedural skills (`ai.skill_version`) and semantic/episodic memories (`ai.memory_candidate`), subject them to deterministic offline ablation and harm evaluation in `@moonwitness/ai-evaluation` (`G0`–`G6`), and gate promotion through `@moonwitness/orm-workflow` with independent approval and instant revocation.

### Execution flow

1. **Verified-run synthesis:** Only runs that pass server-authoritative Proof Gate v2 (`accepted` with valid SHA-256 evidence manifests) may emit `ai.skill_version` or `ai.memory_candidate` proposals in `candidate` status. Raw unverified runs never enter the synthesis pipeline.
2. **Offline ablation & harm evaluation (`G0`–`G6`):** `@moonwitness/ai-evaluation` runs deterministic replay, with-vs-without ablation benchmarks, and adversarial/harm regression suites (`G0`–`G6`). Candidates that regress safety, inflate token/latency budgets beyond policy, or fail to show measurable lift are rejected automatically.
3. **Mathematically gated promotion:** Passing candidates open a company-scoped `@moonwitness/orm-workflow` instance (`ai.skill_promotion` or `ai.memory_promotion`) enforcing `requireDifferentActor: true` and evidence-digest verification before transitioning to `active`.
4. **Instant revocation:** Revoking an active `ai.skill_version` or `ai.memory_candidate` immediately excludes it from future run context assembly and records an append-only `AuditLog` event without mutating historical run artifacts.

### Acceptance criteria

- Zero live self-modification of security policies, capability grants, or production code; promoted memories/skills remain untrusted context that can never grant authority.
- Every promoted `ai.skill_version` and `ai.memory_candidate` links to a reproducible `@moonwitness/ai-evaluation` (`G0`–`G6`) report SHA-256 and an independent `WorkflowApproval` (`requireDifferentActor: true`).
- Revocation takes effect on the very next run dispatch and is verified by deterministic unit and integration tests.

### Verification

- `pnpm --filter @moonwitness/ai-evaluation test` (ablation, harm, and `G0`–`G6` gate suites)
- `pnpm --filter @moonwitness/ai-runtime test` and `pnpm --filter @moonwitness/orm-ai test`
- `pnpm api:addon:check`, `pnpm automation:check:roadmap`, and `node scripts/check-docs.mjs`

---

## M14.02 — Continuous Obligation & World-Model Loop (`ai.obligation` + `base.cron`)

- **Status:** foundation implemented (`packages/ai-runtime/src/obligation-monitor.ts`)
- **Prerequisites:** M14.01, [M13.02](14-desktop-engineering.md), [M13.06](14-desktop-engineering.md), [M13.12](14-desktop-engineering.md).
- **Governing decisions:** [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) (D1, D3, D7, D11).
- **Canonical owners:** `@moonwitness/orm-ai` (`ai.obligation`, `ai.work_contract`), `@moonwitness/jobs` (`base.cron`, `base.job`), `@moonwitness/ai-runtime` (`RepoSnapshot`, `validateDiffScope`), `apps/control-plane`.

### Goal

Turn accepted deliverables into persistent, living invariants by pairing `ai.obligation` records with scheduled `@moonwitness/jobs` (`base.cron`) sweeps that continuously monitor repository drift, dependency changes, and Coolify-class PaaS VPS node metrics (`apps/control-plane`), automatically opening bounded re-verification `ai.work_contract` items whenever prior invariants break.

### Execution flow

1. **Obligation emission:** Accepted `ai.work_contract` deliverables emit one or more company-scoped `ai.obligation` records specifying target invariant checks, monitored paths/dependencies/node metrics, cadence, and risk tier.
2. **Scheduled world-model sweeps (`base.cron`):** `@moonwitness/jobs` executes periodic read-only (`R0`) probes across three signal classes:
   - **Repository drift:** Revision-pinned `RepoSnapshot` diffs and `validateDiffScope` boundary checks.
   - **Dependency changes:** Lockfile, workspace manifest, and advisory/version drift detection.
   - **Infrastructure telemetry:** Coolify-class PaaS VPS node health, container liveness, and resource-envelope metrics surfaced by `apps/control-plane`.
3. **Scoped re-verification dispatch:** When an invariant breaks, the loop idempotently opens a bounded re-verification `ai.work_contract` linked to the triggering `ai.obligation` (preventing duplicate storm creation via active-contract deduplication and budget caps).
4. **Evidence-backed resolution:** Re-verification runs follow standard PCW Proof Gate v2 and independent review before marking the `ai.obligation` healthy again.

### Acceptance criteria

- `ai.obligation` sweeps run strictly through `@moonwitness/jobs` (`base.cron`) with company isolation, lease/fencing safety, and zero duplicate queue infrastructure.
- Triggered re-verification `ai.work_contract` items are idempotent, bounded by company budget and risk tier (`R0`–`R2` auto-triage; `R3` requires explicit human sign-off), and cite exact drift/metric evidence digests.
- `apps/control-plane` telemetry ingestion remains read-only and SSRF-guarded (`@moonwitness/orm-integration`).

### Verification

- `pnpm --filter @moonwitness/jobs test` and `pnpm --filter @moonwitness/orm-ai test`
- `pnpm --filter @moonwitness/ai-runtime test` (obligation drift and re-verification contract tests)
- `pnpm api:addon:check`, `pnpm automation:check:roadmap`, and `node scripts/check-docs.mjs`

---

## M14.03 — Decentralized Multi-Node Agent Swarm (`A2A` over EasyTier P2P Mesh)

- **Status:** foundation implemented ([ADR 0009](../decisions/0009-a2a-mesh-federation.md), `packages/ai-runtime/src/a2a-protocol.ts`)
- **Prerequisites:** M14.01, M14.02, [ADR 0009](../decisions/0009-a2a-mesh-federation.md), [ADR 0001](../decisions/0001-platform-contracts.md) alignment.
- **Governing decisions:** [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) (D1, D6, D8, D9, D11, D12), [ADR 0009](../decisions/0009-a2a-mesh-federation.md).
- **Canonical owners:** `@moonwitness/ai-runtime` (`DataClassificationRouter`, `pcw-verifier`), `@moonwitness/orm-ai`, `@moonwitness/jobs`, `apps/control-plane`, and a future stateless A2A adapter package.

### Goal

Federate bounded sub-contracts across heterogeneous multi-VPS and local GPU nodes over a private **EasyTier P2P mesh** using a thin, stateless **A2A** adapter — preserving MoonWitness as the single control-plane authority with strict data-classification routing, monotonic fencing tokens, and server-side PCW SHA-256 verification.

### Mandatory pre-enablement gate (ADR 0007 D9)

No live A2A peer delegation or EasyTier mesh dispatch may be enabled until a **dedicated A2A ADR** is authored and accepted specifying peer identity/attestation, mTLS/mesh trust boundaries, sub-contract delegation depth caps, timeout/revocation semantics, and failure-mode isolation.

### Execution architecture

1. **Private EasyTier P2P mesh transport:** Multi-VPS workers and local GPU nodes join an encrypted private EasyTier overlay mesh managed via `apps/control-plane`; no public internet exposure of internal agent RPC endpoints is permitted.
2. **Data classification enforcement (`DataClassificationRouter`):** Every delegated sub-contract carries an explicit `restricted`, `local_only`, or `cloud_eligible` classification. Fail-closed routing guarantees `restricted` and `local_only` payloads never traverse unauthorized nodes or fall back to cloud providers.
3. **Monotonic fencing tokens & lease authority:** `@moonwitness/jobs` issues monotonically increasing fencing tokens per delegated `ai.agent_run` lease. Stale or partitioned mesh workers presenting superseded fencing tokens are rejected server-side on checkpoint or artifact submission.
4. **Server-side PCW SHA-256 verification:** Remote nodes never self-certify completion. All returned artifacts and 5-state check matrices are hashed and verified server-side against `ai.artifact_manifest` and `ai.acceptance_criterion` before `orm-workflow` review or parent contract aggregation.

### Acceptance criteria

- Dedicated A2A ADR is accepted prior to enabling any live mesh delegation feature flag (`ai.a2a_mesh_enabled` defaults to `false`).
- `DataClassificationRouter` fail-closed tests prove `restricted` and `local_only` sub-contracts cannot route to disallowed mesh or cloud peers.
- Split-brain / stale-worker tests prove superseded monotonic fencing tokens are rejected without mutating `ai.agent_run` or `ai.work_contract` state.
- Tampered remote evidence digests fail closed (`422`) during server-side PCW SHA-256 verification.

### Verification

- `pnpm --filter @moonwitness/ai-runtime test` (classification router, fencing-token rejection, and PCW SHA-256 verification)
- `pnpm --filter @moonwitness/ai-evaluation test` (adversarial delegation and isolation benchmarks)
- `pnpm api:addon:check`, `pnpm automation:check:roadmap`, and `node scripts/check-docs.mjs`
