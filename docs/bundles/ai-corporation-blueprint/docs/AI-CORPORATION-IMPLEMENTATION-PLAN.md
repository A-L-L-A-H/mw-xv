# MoonWitness AI Corporation — Implementation Workplan

**Status:** Proposed workstream; do not execute until exact-SHA audit and ADR approval.  
**Architecture invariant:** ORM Addon-First.  
**Roadmap rule:** reconcile with current M/K work before assigning official task IDs or GitHub Issues.

## 1. Entry conditions

- Confirm current `dev` SHA and repository branch policy.
- Read current execution protocol, roadmap `ACTIVE-PLAN.md`, `tasks.json`, ADRs and relevant source cards.
- Inventory existing `orm-organization`, `orm-request`, `orm-workflow`, `orm-integration`, `orm-knowledge`, `orm-storage`, `jobs`, `local-ai`, API routes and Board views.
- Identify overlapping M-series/K0–K9 tasks.
- Record a baseline for `pnpm verify`, integration/E2E, package graph, DB restore, runtime health and provider-offline behavior.
- Do not create GitHub issues until task dependencies, owners, files and acceptance are concrete.

## 2. Proposed work packages

IDs below are proposal labels only. They do not exist in the repository roadmap and should be renumbered after maintainers inspect current conventions.

### A0 — Architecture audit and ADR

**Deliverables**

- Existing-domain reuse matrix.
- Agent identity and company-scoping contract.
- Knowledge/research AI vs workforce runtime boundary.
- Data classification and threat model.
- Runtime/harness options review.
- ADR with explicit non-goals and compatibility policy.

**Acceptance**

- Every persistent model has an identified addon owner.
- No second task, workflow, job queue or knowledge truth source is proposed without a documented gap.
- All security-sensitive tool paths have a named deterministic policy enforcement point.
- Maintainer signs off before code begins.

### A1 — Minimal AI domain addon

**Deliverables**

- Minimal agent profile and role/capability contracts.
- Model profile/provider references; secrets remain external.
- Policy reference and risk tier.
- Company membership / tenant isolation.
- Board views and access metadata.

**Acceptance**

- Addon installs and upgrades idempotently.
- Reinstall preserves user-edited values.
- Cross-company list/read/write attempts fail closed.
- No agent receives human superadmin privileges.
- Generic REST/JSON-RPC cannot reach internal run/scheduler controls without a purpose-built authorized operation.

### A2 — Provider abstraction and health

**Deliverables**

- Provider adapter contract.
- One local provider adapter and one cloud provider adapter.
- Model capability registry and test fixtures.
- Cost/latency/deadline metadata.
- Data classification routing policy.

**Acceptance**

- Provider outage does not corrupt a run.
- Cloud fallback is blocked for local-only data class.
- Credentials never enter prompts, client bundles or logs.
- Provider contract tests pass against mock and configured test endpoints.

### A3 — First bounded durable agent

**Deliverables**

- One read-only research or repository-inspection work type.
- Durable run record linked to Jobs Engine identifiers.
- Structured work contract and result envelope.
- Safe tool gateway.
- Cancellation, timeout, retry and resume behavior.

**Acceptance**

- Agent can complete a defined low-risk task and produce evidence.
- Crash injection resumes or enters a known terminal state.
- Duplicate outbox delivery creates no duplicate external effect.
- Tool use is rejected when capability is missing, expired or wrong-company.

### A4 — Proof-Carrying Work and verifier

**Deliverables**

- Required acceptance-criteria records or a compatible extension to existing request models.
- Artifact/evidence manifest.
- Deterministic verification hooks.
- Independent reviewer workflow.
- Human sign-off for required risk classes.

**Acceptance**

- Worker cannot close/accept its own task by self-report.
- A deliberately false completion claim fails verification.
- Every accepted criterion has a valid evidence reference.
- Reviewer identity, policy version and human sign-off are auditable.

### A5 — Obligation Continuity Kernel

**Deliverables**

- Persistent obligations attached to accepted outputs.
- Dependency and impact mapping.
- Reverification triggers.
- Supersession/expiry and owner lifecycle.
- Mission Control obligation view.

**Acceptance**

- A later change that invalidates an earlier deliverable triggers an obligation review.
- Existing obligations can be superseded only with an explicit decision and evidence.
- Active obligations are not silently deleted by a task closure or agent.

### A6 — Multi-agent company and adaptive staffing

**Deliverables**

- CEO/planner, worker, reviewer and researcher role templates.
- Delegation contract and cycle/duplicate detection.
- Temporary taskforce creation with expiry and budget.
- Selective pub/sub routing.
- Escalation and operator queue.

**Acceptance**

- Parallel tasks do not write to the same protected workspace without conflict strategy.
- No duplicate active task for the same scope/acceptance contract.
- Parent task cannot close while required child tasks are unresolved.
- Team adaptation stays inside constitutional roles, capability grants and budget.

### A7 — Memory and reusable procedures

**Deliverables**

- Episodic run summaries.
- Procedural skill/SOP version registry.
- Memory candidate lifecycle, expiry and revocation.
- Replay/ablation evaluation.
- Learning promotion report.

**Acceptance**

- Memory that is wrong, stale or harmful can be revoked and its use traced.
- Promotion requires benchmark evidence and no safety regression.
- Memory utility is measured by downstream task outcome, not recall alone.

### A8 — MCP and A2A adapters

**Deliverables**

- MCP server with read-only tools first.
- Tool list tied to domain-operation access metadata.
- Scoped write capabilities and redaction.
- A2A adapter only where inter-agent external delegation is required.
- Protocol conformance tests.

**Acceptance**

- Unauthenticated/unauthorized calls fail closed.
- Tool schema cannot grant more access than current MoonWitness user/agent context.
- Task state and evidence remain persisted in MoonWitness, not only remote protocol session.

### A9 — Mission Control and evaluation lab

**Deliverables**

- Company HQ, Workforce, Mission Control, Live Operations, Evidence & Continuity, Governance and Research Lab.
- Keyboard/screen-reader alternatives to graph views.
- Correlated traces and cost accounting.
- Reproducible benchmark report and failure atlas.

**Acceptance**

- Every UI status can be traced to persisted state or an explicitly labelled ephemeral signal.
- Operator can locate owner, current status, last successful checkpoint, cost, permissions and evidence for any run.
- UI passes accessibility, responsive and performance budgets.

## 3. Suggested execution sequence

`A0 → A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9`

Some UX and evaluation harness tasks can run in parallel after A0, but schema/runtime dependencies must remain explicit. Do not start with a full company swarm.

## 4. Mandatory test matrix

| Area         | Positive test                          | Adversarial / failure test                                            |
| ------------ | -------------------------------------- | --------------------------------------------------------------------- |
| Addon        | Fresh install and upgrade              | Interrupted install, duplicate seed, stale model version              |
| Tenant       | Same-company permitted access          | Cross-company relations and record enumeration                        |
| Identity     | Agent gets role-limited capability     | Attempt to use human/admin role or revoked token                      |
| Provider     | Local/cloud request succeeds           | Timeout, malformed output, outage, quota exhaustion                   |
| Runtime      | Task produces artifact                 | Crash, stuck process, hostile file, resource limit breach             |
| Jobs         | Lease/heartbeat/retry works            | Stale worker commits after lease loss; duplicate delivery             |
| MCP          | Tool schema and operation match        | Prompt injection, forged arguments, wrong tenant, expired grant       |
| A2A          | Valid task exchange                    | Spoofed Agent Card, auth required, duplicate task, lost status update |
| Verification | Passing evidence accepts work          | Fabricated evidence, partial test run, reviewer conflict              |
| Obligations  | Change triggers relevant recheck       | Stale or superseded obligation incorrectly blocks release             |
| Memory       | Valid skill improves transfer          | Poisoned/stale memory degrades behavior                               |
| Governance   | Budget and approval enforced           | Budget race, approval replay, unauthorized escalation                 |
| UI           | Real status, costs and evidence render | Stale cache, permission leak, broken reconnect                        |

## 5. Required research metrics

- Verified task success rate.
- Retained functionality and requirement conformance across project checkpoints.
- Evidence completeness and evidence validity.
- Duplicate work and contradiction rate.
- Recovery success and time to recovery.
- Unauthorized action rate (release target: zero in defined adversarial suite).
- Memory utility, memory harm and transfer gain.
- Cost per accepted deliverable and provider fallback rate.
- Human interventions per completed milestone.
- Team coordination overhead versus single-agent baseline.

Each result must include exact commit SHA, model/provider version, temperature/decoding configuration, tool versions, dataset/fixture hash, run count, failed runs, and cost. Avoid cherry-picking the best run.

## 6. Initial proof-of-concept scenario

**Scenario:** “Inspect one bounded MoonWitness package, produce a source-backed technical report, and propose a patch plan. Do not edit files or push code.”

1. Human creates a request.
2. Planner creates a work contract with required evidence criteria.
3. Runtime receives read-only repository capability.
4. Research worker inspects selected files and cites exact paths/lines/SHA.
5. Independent reviewer checks that claims match source.
6. Verifier validates all required evidence fields.
7. MoonWitness stores the accepted report reference and creates any continuing obligations.
8. Simulate an interrupted run and confirm recovery/terminal state.

This tests provider abstraction, task lifecycle, identity, audit, tool scopes, evidence, reviewer independence and Jobs recovery without allowing autonomous writes.

## 7. PR and repository integration plan

This workplan is documentation-only. Proposed repository placement:

- `docs/architecture/AI-CORPORATION-GRAND-PLAN.md`
- `docs/research/AI-CORPORATION-RESEARCH-REGISTER.md`
- `docs/roadmap/AI-CORPORATION-IMPLEMENTATION-PLAN.md`
- `docs/adr/AI-CORPORATION-ADR-DRAFT.md` (confirm actual ADR path and numbering)

The public roadmap describes a two-branch `main`/`dev` policy. Therefore, first confirm the live policy and use its established integration path. Do not create a third branch or alter branch rules. The PR/change description is provided separately in `PR-DESCRIPTION.md`.
