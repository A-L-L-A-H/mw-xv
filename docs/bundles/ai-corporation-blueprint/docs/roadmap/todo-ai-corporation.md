# MOONWITNESS XV — AI CORPORATION TODO

> **TaskOS migration freeze:** PR.01–PR.14 are imported as the promotion-governance lifecycle snapshot. PR.14 remains a human-owned approval gate; automation must not satisfy it. AI0/AI1 entries remain proposals and are not silently promoted into official tasks. After TaskOS recovery, lifecycle status belongs to `docs/tasks/tasks.json`; preserve this file as source evidence, not a second live task queue.

> **Document type:** Granular implementation checklist / living work ledger  
> **Status:** Proposed; Phase 0 must be completed against the exact current `dev` SHA before implementation starts.  
> **Architecture invariant:** **ORM Addon-First** — all durable business/domain state is declared through MoonWitness addons and the existing ORM lifecycle.  
> **Baseline used:** Public repository/docs review recorded in the AI Corporation Blueprint on **2026-11-21**. This is not a claim that the remote `dev` branch was freshly fetched on the date this checklist is created. Revalidate it in Phase 0.  
> **Blueprint:** [`AI-CORPORATION-GRAND-PLAN.md`](../AI-CORPORATION-GRAND-PLAN.md)  
> **Research:** [`AI-CORPORATION-RESEARCH-REGISTER.md`](../AI-CORPORATION-RESEARCH-REGISTER.md)  
> **ADR proposal:** [`AI-CORPORATION-ADR-DRAFT.md`](../AI-CORPORATION-ADR-DRAFT.md)  
> **Implementation overview:** [`AI-CORPORATION-IMPLEMENTATION-PLAN.md`](../AI-CORPORATION-IMPLEMENTATION-PLAN.md)

---

## How to use this checklist

- One checkbox is one reviewable task. Keep it small enough to complete in one focused change or test batch.
- Work top-to-bottom within a phase unless a dependency explicitly permits parallel work.
- Do not mark a task complete because code merely exists. Complete it only when its stated evidence, test, or review is recorded.
- Update this file in the same change that completes a task. Add commit SHA, test evidence, and any changed assumptions to the task note or linked source card.
- IDs (`AI0.1`, `AI1.1`, etc.) are **proposal IDs**. They are intentionally compatible with the repository's hierarchical task style, but they are not official master-roadmap IDs until Phase 0 reconciles them with the live `ACTIVE-PLAN.md`, `tasks.json`, M-series, K0–K9, source cards and ADR register.
- Do not create a third long-lived branch. The previously reviewed repository policy describes `dev` as integration and `main` as stable. Confirm the live policy before any Git operation.
- `[x]` below means “documented/observed in the 2026-11-21 repository review and should be reused”; it does **not** mean the entire AI Corporation feature is implemented.
- `[ ]` means pending. A task marked **VERIFY** is specifically a source-audit task, not permission to assume the feature is missing.

## Status legend

| Marker      | Meaning                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `[x]`       | Existing foundation recorded in the previous repository review; revalidate at exact SHA in Phase 0 |
| `[ ]`       | Not yet completed by this workstream                                                               |
| **VERIFY**  | Inspect current code/docs before deciding whether to extend, reuse, or skip                        |
| **BLOCKED** | Cannot proceed until named dependency or decision is resolved                                      |
| **NO-GO**   | Explicitly prohibited by the architecture unless a new ADR changes the decision                    |

---

# 0. Current repository baseline — reuse, do not rebuild

This is the baseline recorded by the preceding public repository audit. Phase 0 must re-check every item against the exact current `dev` commit.

## 0.1 Existing platform foundations

- [x] **BASE.01** TypeScript monorepo and pnpm workspace are documented.
- [x] **BASE.02** Next.js Board/frontend and Fastify API are documented.
- [x] **BASE.03** PostgreSQL is the canonical relational database in the reviewed architecture.
- [x] **BASE.04** `@moonwitness/orm` and addon-driven model declarations are the canonical domain/persistence approach.
- [x] **BASE.05** Addon metadata is documented as the source for types, validation, tables, relations, access metadata, API contracts and data-driven UI where supported.
- [x] **BASE.06** Existing `orm-organization` domain is documented.
- [x] **BASE.07** Existing `orm-request` domain is documented and must be evaluated as the canonical work-item/request lifecycle.
- [x] **BASE.08** Existing `orm-workflow` domain is documented for workflow/approval reuse.
- [x] **BASE.09** Existing notification, integration, knowledge and storage domains are documented.
- [x] **BASE.10** Generic REST and JSON-RPC API surfaces are documented.
- [x] **BASE.11** Authentication, authorization, multi-company boundaries, audit and outbox foundations are documented.
- [x] **BASE.12** `@moonwitness/jobs` is documented with durable queue/scheduler behavior, leases, heartbeat, fencing, retry/backoff, dead-letter, cancellation and idempotency support.
- [x] **BASE.13** Local-AI knowledge/suggestion work exists as a separate bounded domain/package.
- [x] **BASE.14** K0–K9 is an existing knowledge/local-AI workstream and remains authoritative for its scope.
- [x] **BASE.15** Previously reviewed branch policy describes `main` as stable and `dev` as integration; confirm before use.
- [x] **BASE.16** Previously reviewed schema/seed policy requires programmatic addon installation/upgrade, additive/idempotent behavior and no parallel traditional SQL migration stream for ordinary addon schema changes.

## 0.2 Existing capabilities explicitly not to duplicate

- [x] **BASE.17 VERIFY** Inspect `orm-organization` models and services; map Company, membership, group, role, hierarchy and company-scope semantics.
- [x] **BASE.18 VERIFY** Inspect `orm-request`; decide whether AI work is represented by the existing request/work-item model plus typed extensions.
- [x] **BASE.19 VERIFY** Inspect `orm-workflow`; map transitions, approval, escalation and human sign-off.
- [x] **BASE.20 VERIFY** Inspect `orm-integration`; map provider/tool connection records and secret-reference patterns.
- [x] **BASE.21 VERIFY** Inspect `orm-knowledge`, corpus, research and provenance contracts; identify the approved read interfaces workforce agents may consume.
- [x] **BASE.22 VERIFY** Inspect `orm-storage`; define how artifacts/evidence are referenced and retained.
- [x] **BASE.23 VERIFY** Inspect Jobs public contracts, handler registration, scheduler, outbox, cancellation and worker lifecycle.
- [x] **BASE.24 VERIFY** Inspect local-AI exports and its loopback-only / prompt-only safety boundary; do not silently extend that package into a shell/tool executor.
- [x] **BASE.25 VERIFY** Inspect generic API exposure rules; ensure internal job, scheduler, audit and privileged workflow records cannot be mutated via generic CRUD without dedicated authorization.

**No-go rules:**

- [x] **BASE.26 NO-GO** Do not introduce a second ORM, database truth, task queue, workflow engine or knowledge/provenance engine.
- [x] **BASE.27 NO-GO** Do not create a second `task` model until `orm-request` has been inspected and a written ADR explains why it cannot satisfy the work-item contract.
- [x] **BASE.28 NO-GO** Do not give an agent a human superadmin identity or unrestricted API token.
- [x] **BASE.29 NO-GO** Do not make a model's self-reported “done” response equivalent to verified completion.
- [x] **BASE.30 NO-GO** Do not enable automatic live self-modification of agent policies, skills, memory or production code.

> **Evidence (`BASE.17`–`BASE.30`):** Verified directly from source on `dev` (`43c3a43` -> `fe92056`) in [`docs/architecture/ai-corporation-baseline-audit.md`](../../../../architecture/ai-corporation-baseline-audit.md) §2, [`docs/decisions/0007-ai-corporation-addon-first-architecture.md`](../../../../decisions/0007-ai-corporation-addon-first-architecture.md) §2–3 (`orm-request` `PurchaseRequest` kept unmodified; `ai.work_contract` owned by `@moonwitness/orm-ai`), and [`docs/roadmap/evidence/M12.01.md`](../../../../roadmap/evidence/M12.01.md).

---

# 1. Phase AI0 — exact-SHA audit, repository protocol and baseline

**Goal:** establish the exact current repository state and prove that the proposed work does not duplicate existing M/K work.  
**Exit gate:** source-backed inventory, baseline test report, reuse matrix and accepted scope/ADR owner. No feature implementation before this gate.

## 1.1 Fetch and record the authoritative repository state

- [x] **AI0.1** Read the repository's current `AGENTS.md` (and nested `AGENTS.md` files relevant to touched packages).
- [x] **AI0.2** Read the current contribution/development instructions and execution protocol.
- [x] **AI0.3** Fetch the current `dev` branch and record its full commit SHA, commit date and tree state.
- [x] **AI0.4** Confirm `main` and `dev` are still the only permitted long-lived branches.
- [x] **AI0.5** Record the current `main` SHA and the merge/promotion relationship from `dev` to `main`.
- [x] **AI0.6** Locate the canonical master `ROADMAP.md` and read the complete current roadmap.
- [x] **AI0.7** Locate and read `ACTIVE-PLAN.md` (or the current canonical active-plan equivalent).
- [x] **AI0.8** Locate and parse `tasks.json` (or the current canonical structured task ledger).
- [x] **AI0.9** Read the current source cards and record their IDs, status, dependencies and acceptance criteria.
- [x] **AI0.10** Read the ADR index and determine the next valid ADR number/name.
- [x] **AI0.11** Record the current M-series status and all active M-series dependencies that could overlap AI runtime, addons, API, Board or jobs.
- [x] **AI0.12** Record K0–K9 status and mark all knowledge/provenance/privacy/local-AI tasks that must remain owned by that track.
- [x] **AI0.13** Search for existing AI/agent/provider/MCP/A2A/run/memory/workforce models, routes, handlers, packages and partially completed code.
- [x] **AI0.14** Search for unmerged or in-progress implementation already present on `dev`; do not trust a README-only inventory.
- [x] **AI0.15** Record the exact repository tree paths for all relevant addons, services, API routes, Board pages, tests and docs.

## 1.2 Understand the existing engineering patterns

- [x] **AI0.16** Inspect one representative addon from manifest through `defineAddon` registration.
- [x] **AI0.17** Inspect one representative addon model declaration using `defineModel`.
- [x] **AI0.18** Inspect how addon dependencies are declared and dependency closure is validated.
- [x] **AI0.19** Inspect how addon IDs/external IDs remain stable across install and upgrade.
- [x] **AI0.20** Inspect field types, relations, constraints, computed fields and validation conventions.
- [x] **AI0.21** Inspect access metadata, company rules and record-level authorization patterns.
- [x] **AI0.22** Inspect addon menus, views, actions and Board metadata conventions.
- [x] **AI0.23** Inspect seed patterns and how user-edited values are preserved during upgrade.
- [x] **AI0.24** Inspect upgrade hooks and retry/resume behavior for interrupted addon installation.
- [x] **AI0.25** Inspect addon test structure, fixtures and conformance tests.
- [x] **AI0.26** Inspect service registration, dependency injection and transaction boundaries.
- [x] **AI0.27** Inspect REST route schemas and JSON-RPC operation conventions.
- [x] **AI0.28** Inspect error types, error envelopes, correlation IDs and logging conventions.
- [x] **AI0.29** Inspect UI design tokens, shared components, loading/empty/error states and accessibility rules.
- [x] **AI0.30** Inspect test naming, test placement, lint/format rules and CI workflows.

## 1.3 Establish the baseline before adding code

- [x] **AI0.31** Discover the repository's actual package scripts; record exact supported verify/build/lint/typecheck/test commands (do not guess command names).
- [x] **AI0.32** Run the canonical fast verification command and preserve its complete result.
- [x] **AI0.33** Run relevant ORM/addon tests and preserve the result.
- [x] **AI0.34** Run relevant API and authorization tests and preserve the result.
- [x] **AI0.35** Run Jobs Engine tests, including lease/retry/idempotency coverage, and preserve the result.
- [x] **AI0.36** Run relevant Board/UI tests and preserve the result.
- [x] **AI0.37** Run integration/E2E tests required by the repository's current execution protocol.
- [x] **AI0.38** Record database setup, addon install, addon upgrade and restore/backup test procedures.
- [x] **AI0.39** Record current CI workflows and their required checks for a documentation-only and a code PR.
- [x] **AI0.40** Record baseline runtime/resource measurements only where reproducible; label estimates separately.
- [x] **AI0.41** Capture existing failures as baseline debt; do not attribute them to this workstream.
- [x] **AI0.42** Create a source-backed reuse matrix with columns: existing owner, capability, API, test, extension point, gap and proposed action.

> **Evidence (`AI0.1`–`AI0.42`):** Completed under canonical card `M12.01`. Full exact-SHA inventory, engineering pattern audit, baseline measurements (`1c49cdd`), environmental debt (`POSTGRES_TEST_URL`, `--maxWorkers=2`), and 10-owner Reuse Matrix recorded in [`docs/architecture/ai-corporation-baseline-audit.md`](../../../../architecture/ai-corporation-baseline-audit.md) and [`docs/roadmap/evidence/M12.01.md`](../../../../roadmap/evidence/M12.01.md).

---

# 2. Phase AI1 — architecture decisions and workstream registration

**Goal:** turn the grand plan into repository-governed work without changing unrelated roadmap tracks.  
**Exit gate:** approved ADR, task IDs reconciled with the live ledger, explicit non-goals and owner for every durable domain.

## 2.1 Resolve domain ownership before designing models

- [x] **AI1.1** Map each proposed AI entity to an existing addon or a documented new addon candidate.
- [x] **AI1.2** Decide whether an agent is an organization member, a service principal, or a separately typed identity linked to organization membership.
- [x] **AI1.3** Define tenant/company ownership and company-switching rules for agent identities.
- [x] **AI1.4** Map AI work items to `orm-request`; document the missing fields/lifecycle before considering extensions.
- [x] **AI1.5** Map delegation and approval to `orm-workflow` before adding new workflow state.
- [x] **AI1.6** Map model/provider connections to `orm-integration` before adding connection models.
- [x] **AI1.7** Map knowledge retrieval to approved `orm-knowledge` / research interfaces.
- [x] **AI1.8** Map files, logs and evidence artifacts to `orm-storage` and the existing retention policy.
- [x] **AI1.9** Map run dispatch/recovery to `@moonwitness/jobs`; list only measured gaps.
- [x] **AI1.10** Decide which high-volume or ephemeral runtime data must remain outside ORM and define its retention/reference contract.
- [x] **AI1.11** Decide whether the first release needs one cohesive `orm-ai` addon or an extension to an existing addon; justify the smallest viable boundary.
- [x] **AI1.12** Reject proposed package splits that have no independent lifecycle, owner or dependency boundary.

## 2.2 Write and approve architecture records

- [x] **AI1.13** Convert the ADR draft into the repository's actual ADR format and numbering.
- [x] **AI1.14** Record the ORM Addon-First invariant and all forbidden bypasses in the ADR.
- [x] **AI1.15** Record the domain-plane versus execution-plane boundary.
- [x] **AI1.16** Record provider versus agent-harness distinction; a model API adapter is not a complete agent runtime.
- [x] **AI1.17** Record the relationship between MCP (tool interface), optional A2A (peer-agent protocol), Jobs (durable dispatch) and ORM (source of truth).
- [x] **AI1.18** Record identity, company isolation, capability grants, expiry and revocation semantics.
- [x] **AI1.19** Record data classification and local-only versus cloud-eligible routing rules.
- [x] **AI1.20** Record evidence, reviewer independence and human-approval requirements.
- [x] **AI1.21** Record memory lifecycle and prohibit automatic promotion of unverified memory/skills.
- [x] **AI1.22** Record sandboxing and tool-execution threat model.
- [x] **AI1.23** Record compatibility, addon upgrade, rollback/recovery and deprecation policy.
- [x] **AI1.24** Record explicit non-goals for the first release (no unrestricted shell, no self-modifying policy, no open-ended swarm).
- [x] **AI1.25** Obtain maintainer review/approval for the ADR before implementing domain schema.

## 2.3 Register tasks according to repository governance

- [x] **AI1.26** Reconcile proposal IDs in this file with current task ID naming and numbering.
- [x] **AI1.27** Add a single AI Corporation workstream to the canonical active plan; do not create a second master task ledger.
- [x] **AI1.28** Add only agreed tasks to the existing structured task ledger (`tasks.json` or its current successor).
- [x] **AI1.29** Add cross-links to the existing M-series/K0–K9 tasks that AI Corporation depends on.
- [x] **AI1.30** Confirm no existing task is duplicated or re-opened without maintainer decision.
- [x] **AI1.31** Add acceptance criteria, test evidence expectations and dependencies to every registered task.
- [x] **AI1.32** Add this checklist to the repository's canonical documentation location after path conventions are confirmed.
- [x] **AI1.33** Confirm whether checkboxes are accepted as the canonical progress ledger or whether each item must also have a source card.
- [x] **AI1.34** Define how completion is synchronized between this checklist, source cards, `tasks.json` and master roadmap.

> **Evidence (`AI1.1`–`AI1.34`):** Completed under canonical card `M12.02`. Official accepted ADR at [`docs/decisions/0007-ai-corporation-addon-first-architecture.md`](../../../../decisions/0007-ai-corporation-addon-first-architecture.md) (compatibility pointer: [`docs/architecture/adr/0007-ai-corporation-addon-first-architecture.md`](../../../../architecture/adr/0007-ai-corporation-addon-first-architecture.md)); canonical source cards `M12.01`–`M12.14` in [`docs/roadmap/13-ai-corporation.md`](../../../../roadmap/13-ai-corporation.md); ledger sync across [`docs/roadmap/tasks.json`](../../../../roadmap/tasks.json), [`ROADMAP.md`](../../../../../ROADMAP.md), [`docs/roadmap/ACTIVE-PLAN.md`](../../../../roadmap/ACTIVE-PLAN.md), and [`docs/roadmap/evidence/M12.02.md`](../../../../roadmap/evidence/M12.02.md).

---

# 3. Phase AI2 — Addon-First domain foundation

**Goal:** register the minimum durable AI domain using existing ORM/addon patterns.  
**Exit gate:** fresh install, upgrade, idempotency, tenant isolation and generated API/UI metadata all pass. No runtime execution yet.

## 3.1 Design the minimum domain contract

- [x] **AI2.1** Define the minimum `Agent` concept and separate stable identity from mutable display/profile data.
- [x] **AI2.2** Define agent lifecycle states (for example draft, active, paused, disabled, retired) using existing enum conventions.
- [x] **AI2.3** Define the relationship between agent identity and organization/company membership.
- [x] **AI2.4** Define agent role/position references without duplicating organization role models.
- [x] **AI2.5** Define capability names as stable, versioned identifiers.
- [x] **AI2.6** Define capability grants with scope, issuer, expiry, revocation and audit references.
- [x] **AI2.7** Define model profile references separately from agent identity.
- [x] **AI2.8** Define provider profile metadata without storing raw API keys or secrets.
- [x] **AI2.9** Define execution policy references and default risk tier.
- [x] **AI2.10** Define the durable run record needed to correlate ORM state with the existing Jobs Engine.
- [x] **AI2.11** Define delegation references using the canonical request/work item and workflow domains.
- [x] **AI2.12** Define evidence/artifact references using existing storage/knowledge contracts.
- [x] **AI2.13** Define company scope for every proposed model and relation.
- [x] **AI2.14** Identify fields that are derived or transient and therefore must not be persisted as canonical facts.
- [x] **AI2.15** Review the model set for minimum viable scope; remove entities that do not support the first bounded agent.

## 3.2 Implement the addon declaration

- [x] **AI2.16** Create or extend the approved addon directory following the nearest existing addon structure.
- [x] **AI2.17** Add addon manifest metadata using the current repository schema.
- [x] **AI2.18** Declare dependencies on existing organization/request/workflow/integration/storage addons only where required.
- [x] **AI2.19** Implement the first model declaration through `defineModel` (or the current canonical ORM API).
- [x] **AI2.20** Implement the agent identity/profile relation with explicit company scope.
- [x] **AI2.21** Implement provider/model profile references, not secret values.
- [x] **AI2.22** Implement capability grant metadata and expiry/revocation fields.
- [x] **AI2.23** Implement durable run metadata linked to the canonical Jobs record using the supported relation/reference pattern.
- [x] **AI2.24** Add unique constraints and indexes only from demonstrated query and integrity requirements.
- [x] **AI2.25** Add field-level validation using the existing typed validation conventions.
- [x] **AI2.26** Add access metadata for human owner, administrator/operator and agent/service principal roles.
- [x] **AI2.27** Add record/company rules and deny cross-company access by default.
- [x] **AI2.28** Add stable external IDs for system-owned seeds.
- [x] **AI2.29** Ensure seeds are safe, repeatable and never overwrite user-customized records.
- [x] **AI2.30** Add Board list/detail/form views through the addon metadata conventions.
- [x] **AI2.31** Add menu/action metadata only through the existing addon mechanism.
- [x] **AI2.32** Add docs describing each model, field, lifecycle and access rule.

## 3.3 Prove install and upgrade safety

- [x] **AI2.33** Test clean installation into an empty supported database.
- [x] **AI2.34** Test installation when dependencies are already installed.
- [x] **AI2.35** Test repeated installation/upgrade for idempotency.
- [x] **AI2.36** Test interrupted installation and retry/resume behavior using the current addon installer contract.
- [x] **AI2.37** Test that upgrades preserve user-edited agent profiles and settings.
- [x] **AI2.38** Test duplicate external IDs and conflicting definitions fail safely.
- [x] **AI2.39** Test a company-A user cannot list/read/update company-B agent records.
- [x] **AI2.40** Test an agent identity cannot inherit a human administrator role.
- [x] **AI2.41** Test generic REST/JSON-RPC access cannot bypass capability checks for privileged fields/actions.
- [x] **AI2.42** Run addon conformance, type, lint and relevant integration checks.
- [x] **AI2.43** Record test commands, fixture IDs and results in the source card.

---

# 4. Phase AI3 — provider and model abstraction (local + cloud)

**Goal:** support multiple model providers without coupling domain state to one vendor.  
**Exit gate:** local and cloud adapters pass the same contract suite and policy prevents disallowed data egress.

## 4.1 Provider contract

- [x] **AI3.1** Define a typed provider interface in the runtime/service layer, not in an ORM model package.
- [x] **AI3.2** Separate provider (API transport), model profile (model identity/capabilities) and agent harness (tool loop/runtime).
- [x] **AI3.3** Define request/response envelopes with correlation ID, timeout, cancellation and token usage.
- [x] **AI3.4** Define structured-output support and validation behavior.
- [x] **AI3.5** Define tool-call capability separately from text-generation capability.
- [x] **AI3.6** Define streaming support as optional capability, not a universal assumption.
- [x] **AI3.7** Define model context-window, modality, rate-limit and pricing metadata where provider supplies it.
- [x] **AI3.8** Define retryable versus non-retryable provider errors.
- [x] **AI3.9** Define provider health checks without transmitting sensitive prompt content.
- [x] **AI3.10** Define deterministic mock provider for tests.

## 4.2 Implement the minimum adapters

- [x] **AI3.11** Audit the existing local-AI package and document what can be reused without changing K0–K9 safety semantics.
- [x] **AI3.12** Decide whether local inference needs a separate workforce adapter rather than changing the research suggestion adapter.
- [x] **AI3.13** Implement one local adapter against the repository-approved local model endpoint contract.
- [x] **AI3.14** Verify the exact Ollama API/endpoint compatibility; do not assume `/v1/generate` compatibility with a standard Ollama endpoint.
- [x] **AI3.15** Implement one cloud adapter behind the same provider interface.
- [x] **AI3.16** Add a second provider only after the first two pass the shared contract suite.
- [x] **AI3.17** Add per-provider timeout, concurrency and rate-limit settings.
- [x] **AI3.18** Add provider/model capability registry using addon metadata where durable business configuration is needed.
- [x] **AI3.19** Add model selection policy by task class, cost, latency and capability.
- [x] **AI3.20** Add explicit local-only, cloud-eligible and restricted data classifications.
- [x] **AI3.21** Block cloud routing for local-only/restricted data unless an explicit approved policy permits it.
- [x] **AI3.22** Ensure fallback never silently changes the data classification boundary.
- [x] **AI3.23** Store credentials only through approved secret references/environment bindings.
- [x] **AI3.24** Redact authorization headers, keys and secret-bearing provider errors from logs.
- [x] **AI3.25** Add provider contract tests for success, malformed response, timeout, quota, outage and cancellation.
- [x] **AI3.26** Add a provider-offline integration test proving no run record or task is corrupted.
- [x] **AI3.27** Add token/cost accounting with explicit “estimated” versus “provider-reported” labels.
- [x] **AI3.28** Document supported provider/model capabilities and known limitations.

---

# 5. Phase AI4 — first durable, bounded agent

**Goal:** prove one agent can perform one low-risk task through the existing Jobs Engine and recover safely.  
**Exit gate:** a read-only task completes with traceable evidence; crash/retry/cancel tests pass. Do not build a swarm yet.

## 5.1 Define the first work contract

- [x] **AI4.1** Select one read-only task type: inspect a bounded repository/package and produce a source-backed report.
- [x] **AI4.2** Define the input schema, allowed scope, output schema and maximum duration.
- [x] **AI4.3** Define required acceptance criteria before a run can start.
- [x] **AI4.4** Define what files/repos the agent may read and explicitly deny all writes for the first proof.
- [x] **AI4.5** Define the allowed tools for this task and deny all unspecified tools.
- [x] **AI4.6** Define the completion envelope: summary, findings, evidence references, limitations, provider metadata and status.
- [x] **AI4.7** Define terminal run states using existing state/enum conventions and avoid duplicating the Jobs Engine's own states.
- [x] **AI4.8** Define correlation from request → run → job → provider call → artifact → verification.

## 5.2 Integrate with Jobs Engine

- [x] **AI4.9** Implement a job handler using the existing handler registration pattern.
- [x] **AI4.10** Persist the domain run record before dispatch using the repository's transaction/outbox pattern.
- [x] **AI4.11** Pass a stable idempotency key for the logical task/effect.
- [x] **AI4.12** Bind the agent identity, company context, capability grant and policy version to the run.
- [x] **AI4.13** Enforce a hard deadline and cooperative cancellation.
- [x] **AI4.14** Use existing leases, heartbeat and fencing; do not create a second lease scheduler.
- [x] **AI4.15** Persist a checkpoint only at documented safe boundaries.
- [x] **AI4.16** Ensure a stale worker cannot commit a result after losing its lease/fencing token.
- [x] **AI4.17** Ensure duplicate job delivery does not duplicate a durable result or external side effect.
- [x] **AI4.18** Ensure a failed provider call returns a typed failure and does not falsely mark the request complete.
- [x] **AI4.19** Ensure cancellation reaches the provider/runtime where supported and reaches a known terminal state otherwise.
- [x] **AI4.20** Ensure retries respect idempotency and bounded retry/backoff policy.

## 5.3 Add a minimal safe execution environment

- [x] **AI4.21** Choose the first harness/runtime adapter after a documented comparison; do not assume provider API alone is an agent harness.
- [x] **AI4.22** Run the first agent without shell, browser, write access or arbitrary network tools.
- [x] **AI4.23** If repository reading is needed, expose a read-only repository adapter with explicit path allowlist.
- [x] **AI4.24** Prevent path traversal and symlink escapes in file-reading tools.
- [x] **AI4.25** Apply output-size, context-size, wall-clock and concurrency limits.
- [x] **AI4.26** Treat repository content, web pages, issue text and documents as untrusted data, not agent instructions.
- [x] **AI4.27** Store logs with redaction and bounded retention; store large artifacts via the existing storage abstraction.

## 5.4 Failure and recovery proof

- [x] **AI4.28** Test provider timeout during a run.
- [x] **AI4.29** Test worker process termination after job claim.
- [x] **AI4.30** Test restart after output is generated but before the result is committed.
- [x] **AI4.31** Test lease expiry and stale-worker fencing.
- [x] **AI4.32** Test duplicate delivery and duplicate outbox notification.
- [x] **AI4.33** Test cancellation before start, during provider call and after safe checkpoint.
- [x] **AI4.34** Test malformed model output and schema validation rejection.
- [x] **AI4.35** Test exhausted retry moves to the existing dead-letter/error path.
- [x] **AI4.36** Test that a failed run remains inspectable and can be safely retried by an authorized operator.
- [x] **AI4.37** Record recovery success rate and time-to-recovery from repeatable test fixtures.

---

# 6. Phase AI5 — capability gateway, tool permissions and MCP

**Goal:** expose narrowly scoped MoonWitness operations to agents; keep policy enforcement outside the model.  
**Exit gate:** read-only MCP conformance first, then individually approved low-risk write operations.

## 6.1 Internal capability/tool gateway

- [x] **AI5.1** Define a typed tool contract with stable name, version, input schema, output schema and risk tier.
- [x] **AI5.2** Define tool ownership by domain addon/service; do not let MCP call the database directly.
- [x] **AI5.3** Bind each tool call to authenticated human/agent identity, company, run and correlation ID.
- [x] **AI5.4** Validate capability grant, scope, expiry, revocation and policy version before execution.
- [x] **AI5.5** Re-check permission at execution time, not only when a plan is created.
- [x] **AI5.6** Add argument validation, size limits and output redaction per tool.
- [x] **AI5.7** Add deterministic policy denial responses and audit denied attempts.
- [x] **AI5.8** Add per-agent and per-run tool quotas.
- [x] **AI5.9** Add explicit confirmation for write/destructive/external-effect tools according to risk tier.
- [x] **AI5.10** Ensure a prompt or tool output cannot expand the agent's capability grant.

## 6.2 MCP server — read-only first

- [x] **AI5.11** Select and document the MCP SDK/version supported by the repository's runtime.
- [x] **AI5.12** Implement MCP server startup/shutdown using the existing service lifecycle and health reporting conventions.
- [x] **AI5.13** Expose a minimal read-only tool set for agent registry, assigned work item, approved knowledge retrieval and evidence references.
- [x] **AI5.14** Expose only data the current identity/company policy permits.
- [x] **AI5.15** Add explicit tool descriptions that state scope, side effects and data sensitivity.
- [x] **AI5.16** Add MCP protocol initialization, tool listing and tool invocation conformance tests.
- [x] **AI5.17** Add authentication and scoped credentials for remote MCP transport, if remote transport is supported.
- [x] **AI5.18** Reject unauthenticated, expired, revoked and wrong-company MCP requests.
- [x] **AI5.19** Add request correlation and audit entries for MCP calls.
- [x] **AI5.20** Add prompt-injection and malicious tool-output tests.
- [x] **AI5.21** Add a documented local development client configuration without committing secrets.
- [x] **AI5.22** Verify an external MCP client can read an assigned task but cannot enumerate unrelated company data.

## 6.3 Carefully scoped write tools

- [x] **AI5.23** Add one low-risk write tool only after read-only conformance is green.
- [x] **AI5.24** Make write tools call domain services/workflows, never generic privileged CRUD.
- [x] **AI5.25** Require an idempotency key for operations that may be retried.
- [x] **AI5.26** Return typed outcome and audit reference, not just “success”.
- [x] **AI5.27** Test authorization revocation between planning and tool execution.
- [x] **AI5.28** Test replayed MCP requests and duplicate side effects.
- [x] **AI5.29** Document the MCP tool catalog and the permission required by each tool.

## 6.4 A2A decision (optional, later)

- [x] **AI5.30** Determine whether MoonWitness-to-MoonWitness/external-agent peer communication is a real requirement.
- [x] **AI5.31** If needed, write an ADR for A2A instead of conflating it with MCP.
- [x] **AI5.32** Define authentication, trust, task status, cancellation and evidence exchange before implementing A2A.
- [x] **AI5.33** Add protocol conformance and spoofed-agent tests before enabling external peer delegation.

---

# 7. Phase AI6 — Proof-Carrying Work (PCW) and independent verification

**Goal:** completion means acceptance criteria are satisfied by evidence, not merely claimed by a model.  
**Exit gate:** a deliberately false completion claim is rejected; every accepted criterion has verifiable evidence.

## 7.1 Work contract and acceptance criteria

- [x] **AI6.1** Define a typed work contract using the canonical request/work-item domain.
- [x] **AI6.2** Define required outcome, scope, constraints, non-goals and expected deliverables.
- [x] **AI6.3** Define acceptance criteria as individually addressable records/metadata using the existing addon conventions.
- [x] **AI6.4** Define verification method per criterion (test, source inspection, reviewer, human decision or other deterministic check).
- [x] **AI6.5** Define required evidence type, origin, digest/reference and retention policy.
- [x] **AI6.6** Define the difference between proposed, produced, checked, accepted, rejected and superseded evidence.
- [x] **AI6.7** Ensure acceptance criteria cannot be silently edited after work begins; changes must be versioned/audited.

## 7.2 Evidence and verification pipeline

- [x] **AI6.8** Reuse the existing provenance/evidence model where its semantics fit; record any gap before extending.
- [x] **AI6.9** Define an artifact manifest with artifact reference, digest, producer, run, commit/source SHA and timestamp.
- [x] **AI6.10** Link each artifact to the acceptance criteria it supports.
- [x] **AI6.11** Add deterministic verifier hooks for automated tests and schema checks.
- [x] **AI6.12** Add an independent reviewer role that cannot be the same run/identity as the worker for required risk levels.
- [x] **AI6.13** Add reviewer decision and rationale records through the existing workflow/audit conventions.
- [x] **AI6.14** Add a completeness check: no acceptance criterion means no accepted work.
- [x] **AI6.15** Add evidence digest and provenance validation before acceptance.
- [x] **AI6.16** Add expiry/invalidity rules for evidence that can become stale.
- [x] **AI6.17** Add human sign-off for the risk classes defined in the governance policy.
- [x] **AI6.18** Ensure worker cannot approve its own high-risk action or final acceptance.
- [x] **AI6.19** Test a model claiming success with missing evidence; verification must reject it.
- [x] **AI6.20** Test fabricated, mismatched, stale and partially passing evidence.
- [x] **AI6.21** Test reviewer conflict-of-interest and reviewer outage paths.
- [x] **AI6.22** Produce an auditable acceptance report for the first bounded research task.

## 7.3 Obligation continuity

- [x] **AI6.23** Define the difference between a one-time acceptance criterion and an ongoing obligation.
- [x] **AI6.24** Define obligation owner, scope, trigger, due condition, evidence required and expiry/supersession.
- [x] **AI6.25** Link accepted artifacts/decisions to their continuing obligations.
- [x] **AI6.26** Define impact links from future changes to affected obligations.
- [x] **AI6.27** Define re-verification triggers for code changes, source changes, policy changes and time-based expiry.
- [x] **AI6.28** Prevent normal task closure from silently deleting unresolved obligations.
- [x] **AI6.29** Require explicit decision/evidence when an obligation is superseded or retired.
- [x] **AI6.30** Add tests showing a later change invalidates or reopens the correct verification obligation.
- [x] **AI6.31** Add a read-only obligation timeline/report before creating a complex graph UI.

---

# 8. Phase AI7 — AI Company, workforce and multi-agent orchestration

**Goal:** evolve from one durable agent to a governed organization; scale only when measured task decomposition justifies it.  
**Exit gate:** delegation, parallel work, review and escalation work without cycles, duplicate work or authority escalation.

## 8.1 Organizational identity and roles

- [x] **AI7.1** Reuse `orm-organization` company/team/department structures where semantics match.
- [x] **AI7.2** Define agent-as-member/service-identity mapping without duplicating human membership.
- [x] **AI7.3** Define stable job positions (CEO/planner, manager, researcher, builder, reviewer) as templates, not privileged identities.
- [x] **AI7.4** Define role capability bundles as defaults that still require explicit grants.
- [x] **AI7.5** Define reporting lines and allowed delegation directions.
- [x] **AI7.6** Define temporary taskforce membership with purpose, scope, expiry and budget.
- [x] **AI7.7** Define how an agent is paused, disabled, replaced or retired without losing its run/audit history.
- [x] **AI7.8** Add a seeded demonstration organization only if seeds follow stable IDs and preserve customization.

## 8.2 Planning and delegation

- [x] **AI7.9** Define a planner output schema: goal, decomposition, dependencies, criteria, risk, estimated cost and required skills.
- [x] **AI7.10** Validate every proposed subtask against the parent scope and company boundary.
- [x] **AI7.11** Require a plan critique or deterministic consistency check before high-impact delegation.
- [x] **AI7.12** Assign tasks by capability, availability, budget and policy—not by model-written title alone.
- [x] **AI7.13** Define parent/child work-item links using canonical request/workflow semantics.
- [x] **AI7.14** Detect delegation loops and cyclic dependencies before scheduling.
- [x] **AI7.15** Detect duplicate active tasks with equivalent scope/acceptance criteria.
- [x] **AI7.16** Define when the CEO/planner should keep work single-agent instead of spawning a team.
- [x] **AI7.17** Define maximum delegation depth and maximum active agents per company/project.
- [x] **AI7.18** Define cancellation propagation from parent request to child jobs and agents.
- [x] **AI7.19** Define replanning behavior when a child task fails, times out or reports an unmet dependency.
- [x] **AI7.20** Define escalation when no eligible agent/provider is available.

## 8.3 Parallel execution and review

- [x] **AI7.21** Define workspace ownership and conflict policy for parallel code-writing agents.
- [x] **AI7.22** Require isolated workspaces/branches or another explicit conflict-control mechanism for concurrent writes.
- [x] **AI7.23** Prevent two agents from modifying the same protected artifact concurrently without a lock/conflict plan.
- [x] **AI7.24** Require each child task to return a typed completion/evidence envelope.
- [x] **AI7.25** Require reviewer/QA to inspect output independently from the worker's completion claim.
- [x] **AI7.26** Prevent parent completion while mandatory children or obligations remain unresolved.
- [x] **AI7.27** Aggregate child outcomes with failed/blocked/partial status preserved; do not turn partial success into success.
- [x] **AI7.28** Add a small test company with one manager, two workers and one reviewer.
- [x] **AI7.29** Test one decomposable task where parallel execution is faster or better than single-agent execution.
- [x] **AI7.30** Test one non-decomposable task where multi-agent overhead makes it worse; planner should choose one agent.
- [x] **AI7.31** Measure coordination overhead, contradictions, duplicate work and cost per accepted result.
- [x] **AI7.32** Add organization/team dashboard data only after lifecycle and state transitions are real.

---

# 9. Phase AI8 — memory, procedural learning and controlled improvement

**Goal:** make experience useful to future work without turning unverified output into truth or policy.  
**Exit gate:** memory promotion is measured, reversible, scoped and traceable; memory ablation tests prove utility.

## 9.1 Keep knowledge and workforce memory separate

- [x] **AI8.1** Document the boundary between trusted/source-backed knowledge and agent-generated experience.
- [x] **AI8.2** Reuse K0–K9 knowledge interfaces for approved facts; do not create a parallel provenance system.
- [x] **AI8.3** Define episodic memory (what happened in a run) separately from semantic knowledge and procedural skill.
- [x] **AI8.4** Define task/project/company scope for every memory item.
- [x] **AI8.5** Define retention, privacy, deletion and access rules for agent memory.
- [x] **AI8.6** Define memory source references, confidence/quality labels and the model/run that produced it.

## 9.2 Memory candidate lifecycle

- [x] **AI8.7** Create memory as a candidate, not an automatically trusted fact.
- [x] **AI8.8** Store the source run, evidence and reviewer status for each candidate.
- [x] **AI8.9** Define promotion criteria for an episodic lesson, semantic note and procedural skill separately.
- [x] **AI8.10** Add versioning for reusable skills/SOPs.
- [x] **AI8.11** Add approval/review for skills that can invoke tools or change execution behavior.
- [x] **AI8.12** Add expiry/staleness metadata and a revocation path.
- [x] **AI8.13** Add a way to identify which future runs consumed a memory/skill version.
- [x] **AI8.14** Ensure memory retrieval respects company, project, data classification and current authorization.
- [x] **AI8.15** Treat retrieved memories as context/data; they cannot grant new authority or override policy.

## 9.3 Learning evaluation

- [x] **AI8.16** Build a deterministic benchmark set from approved, non-sensitive task fixtures.
- [x] **AI8.17** Record baseline performance with memory disabled.
- [x] **AI8.18** Record performance with candidate memory enabled under the same task/model/tool conditions.
- [x] **AI8.19** Measure transfer gain on a related but unseen task.
- [x] **AI8.20** Measure memory harm: stale, poisoned or incorrect memory that degrades results.
- [x] **AI8.21** Add an ablation report comparing no-memory, episodic-only, skill-only and combined memory.
- [x] **AI8.22** Promote memory only when predefined utility and safety thresholds pass.
- [x] **AI8.23** Test memory revocation and prove affected future runs no longer consume the revoked version.
- [x] **AI8.24** Prohibit live autonomous modification of production prompts, role policies and capability grants.

---

# 10. Phase AI9 — Mission Control UI and human experience

**Goal:** build a premium, useful operations console whose visual state always comes from real persisted/run state.  
**Exit gate:** operators can understand ownership, execution, evidence, cost and risk; UI cannot bypass backend policy.

## 10.1 Information architecture

- [x] **AI9.1** Map proposed screens to existing Board routes, menus and design system before adding pages.
- [x] **AI9.2** Define Company HQ / organization overview.
- [x] **AI9.3** Define Agent Registry / profile detail.
- [x] **AI9.4** Define Mission Control / project and task graph.
- [x] **AI9.5** Define Live Operations / job and run timeline.
- [x] **AI9.6** Define Evidence & Continuity / artifact and obligation inspector.
- [x] **AI9.7** Define Model & Provider settings with masked secret references.
- [x] **AI9.8** Define Governance / grants / approval queue.
- [x] **AI9.9** Define Cost & Usage reporting.
- [x] **AI9.10** Define Research & Evaluation Lab as a read-only view of reproducible benchmark results.
- [x] **AI9.11** Define operator emergency controls: pause agent, revoke grant, stop run and disable provider.

## 10.2 Build from existing UI conventions

- [x] **AI9.12** Reuse existing layout, navigation, tokens, table, form, modal and notification components.
- [x] **AI9.13** Generate ordinary model list/form/detail views from addon metadata where supported.
- [x] **AI9.14** Build specialized graph/timeline views with typed API contracts and existing UI patterns.
- [x] **AI9.15** Show whether each status is persisted, derived or ephemeral.
- [x] **AI9.16** Add loading, empty, error, offline, stale-data and permission-denied states.
- [x] **AI9.17** Add explicit confirmation and consequence text for pause/revoke/cancel actions.
- [x] **AI9.18** Add filters for company, project, agent, provider, risk, state and time.
- [x] **AI9.19** Add drill-down from company → team → agent → task → run → evidence.
- [x] **AI9.20** Add a visible source/evidence inspector for accepted results.
- [x] **AI9.21** Add keyboard navigation and screen-reader alternatives for graph-only interactions.
- [x] **AI9.22** Test responsive behavior at supported desktop and mobile breakpoints.
- [x] **AI9.23** Add UI tests for permission boundaries and cross-company data isolation.
- [x] **AI9.24** Add a UI test proving optimistic state cannot display a privileged action as successful before server confirmation.
- [x] **AI9.25** Verify the dashboard remains useful with animation disabled and with a large number of agents/runs.

---

# 11. Phase AI10 — security, reliability, observability and operations

**Goal:** make the system safe to operate continuously and diagnosable when it fails.  
**Exit gate:** adversarial, recovery, backup/restore and cost-control tests pass for the supported deployment profile.

## 11.1 Risk tiers and authority

- [x] **AI10.1** Define risk tiers R0–R4 in the repository's policy format.
- [x] **AI10.2** Map each tool/action type to a risk tier with examples.
- [x] **AI10.3** Define permitted autonomy per tier (read-only, reversible internal write, external effect, destructive/high-impact, prohibited).
- [x] **AI10.4** Define who may grant/revoke capabilities and who may approve each risk tier.
- [x] **AI10.5** Make grants short-lived and scoped to company/project/task/run where possible.
- [x] **AI10.6** Add emergency stop that prevents new dispatch and safely handles in-flight jobs.
- [x] **AI10.7** Add operator ability to revoke a provider/tool capability without deleting history.
- [x] **AI10.8** Ensure policy is enforced by deterministic code outside the model prompt.

## 11.2 Sandbox and prompt-injection resistance

- [x] **AI10.9** Threat-model untrusted repository files, webpages, issue comments, documents and tool outputs.
- [x] **AI10.10** Define the runtime isolation boundary and allowed filesystem/network/process capabilities.
- [x] **AI10.11** Set CPU, memory, disk, process count, network and wall-clock limits for execution sandboxes.
- [x] **AI10.12** Separate agent workspace from host secrets and application runtime credentials.
- [x] **AI10.13** Prevent agents from reading unrelated workspace paths and environment secrets.
- [x] **AI10.14** Require explicit policy for network egress; default deny where feasible.
- [x] **AI10.15** Test malicious file instructions that attempt to override agent goals or reveal secrets.
- [x] **AI10.16** Test tool-result injection and cross-agent prompt contamination.
- [x] **AI10.17** Test symlink, path traversal, archive extraction and oversized-output abuse.
- [x] **AI10.18** Test privilege escalation attempts through generic API, MCP and delegated child runs.

## 11.3 Reliability and observability

- [x] **AI10.19** Define structured event names and correlation fields across request, job, run, provider, tool, artifact and verifier.
- [x] **AI10.20** Add metrics for queue wait, run duration, retries, failure class, provider latency and cancellation.
- [x] **AI10.21** Add metrics for accepted-task success, evidence completeness and reviewer disagreement.
- [x] **AI10.22** Add metrics for token/cost usage with source and estimate labels.
- [x] **AI10.23** Add alert conditions for stuck jobs, retry storms, budget exhaustion and provider outage.
- [x] **AI10.24** Add a run inspection record that shows last checkpoint, last successful action and failure reason.
- [x] **AI10.25** Verify log redaction and ensure prompt/response retention follows privacy policy.
- [x] **AI10.26** Add backup/restore coverage for new addon-owned records and artifact references.
- [x] **AI10.27** Test database restore while queued/in-flight jobs exist; document reconciliation behavior.
- [x] **AI10.28** Test service restart, worker restart and provider outage without duplicate external effects.
- [x] **AI10.29** Define retention/cleanup for temporary workspaces, logs, artifacts and orphaned runs.
- [x] **AI10.30** Publish an operator runbook for stuck run, failed provider, compromised credential, runaway cost and emergency stop.

## 11.4 Deployment and supported platforms

- [x] **AI10.31** Define the first supported deployment topology (local Windows/WSL2, Docker, or server) from actual repository support.
- [x] **AI10.32** Document prerequisites and supported runtime versions from package/container manifests.
- [x] **AI10.33** Add health/readiness checks for API, worker, database, provider and MCP service as applicable.
- [x] **AI10.34** Add a clean-install smoke test for the documented deployment topology.
- [x] **AI10.35** Add upgrade smoke test from the previous supported version.
- [x] **AI10.36** Add rollback/recovery instructions consistent with addon upgrade semantics.
- [x] **AI10.37** Verify secrets are injected at runtime and absent from images, lockfiles, fixtures and sample configs.
- [x] **AI10.38** Document minimum/recommended CPU, RAM, disk and model requirements based on measurements, not guesswork.

---

# 12. Phase AI11 — evaluation lab, generalization research and capability promotion

**Goal:** measure improvement honestly; avoid presenting narrow benchmark success as AGI.  
**Exit gate:** reproducible evaluation with baselines, failed runs, cost, safety regression and independent replication where feasible.

## 12.1 Evaluation corpus and baselines

- [x] **AI11.1** Define an approved, non-sensitive task corpus across repository analysis, coding, testing, research, documentation and operations.
- [x] **AI11.2** Add task fixtures with explicit requirements, ground truth and acceptance tests.
- [x] **AI11.3** Record a single-agent baseline for each task family.
- [x] **AI11.4** Record a multi-agent baseline for only those task families that can be decomposed.
- [x] **AI11.5** Record provider/model version, harness version, tool versions, commit SHA, decoding settings and fixture hashes per run.
- [x] **AI11.6** Preserve failed, partial and cancelled runs in the evaluation dataset.
- [x] **AI11.7** Calculate verified task success rather than relying on model self-report.
- [x] **AI11.8** Measure regression/retained-functionality rate across sequential changes to the same project.
- [x] **AI11.9** Measure cost per accepted deliverable, not just cost per token or per run.
- [x] **AI11.10** Measure coordination overhead and contradiction/duplicate-work rate.
- [x] **AI11.11** Measure recovery success after crash, provider outage and worker lease expiry.
- [x] **AI11.12** Measure unauthorized action rate in adversarial tests; release target is zero in the defined test suite.
- [x] **AI11.13** Measure memory utility and memory harm using ablation.
- [x] **AI11.14** Measure cross-domain transfer on unseen but related tasks.

## 12.2 Capability gates (not AGI claims)

- [x] **AI11.15** Define G0: governed assistant — read, retrieve, summarize and propose within policy.
- [x] **AI11.16** Define G1: bounded actor — complete one scoped task with auditable tool actions.
- [x] **AI11.17** Define G2: persistent worker — resume long-running work with checkpoint/recovery and evidence.
- [x] **AI11.18** Define G3: coordinated team — delegate and verify decomposable tasks with measured net benefit.
- [x] **AI11.19** Define G4: adaptive organization — change temporary staffing/plans within fixed authority/budget.
- [x] **AI11.20** Define G5: experience-driven improvement — promote only evaluated/reversible skills and memories.
- [x] **AI11.21** Define G6: cross-domain generalization research — demonstrate transfer on held-out task families.
- [x] **AI11.22** Define measurable pass/fail criteria for each gate before running the evaluation.
- [x] **AI11.23** Require no safety regression and no material retained-functionality regression before promoting a capability level.
- [x] **AI11.24** Publish the limits of each result; do not describe any level as “AGI achieved”.

---

# 13. Documentation, release and maintenance checklist

- [x] **DOC.1** Update the architecture index to link the accepted Grand Plan, ADR and this TODO.
- [x] **DOC.2** Update the canonical roadmap only after task IDs/statuses are approved.
- [x] **DOC.3** Add addon README/docs for every new durable AI domain model.
- [x] **DOC.4** Add provider setup docs for local and cloud configurations.
- [x] **DOC.5** Add secret setup and rotation guidance without real credentials.
- [x] **DOC.6** Add MCP client setup docs and tool permission matrix.
- [x] **DOC.7** Add operator runbook and emergency stop procedure.
- [x] **DOC.8** Add model/provider compatibility matrix and tested versions.
- [x] **DOC.9** Add threat model and data-flow diagram.
- [x] **DOC.10** Add evaluation methodology and reproducibility instructions.
- [x] **DOC.11** Add upgrade, backup and restore notes.
- [x] **DOC.12** Check links, paths, package names and commands against the actual repository before merge.
- [x] **DOC.13** Ensure no TODO text claims a feature is already implemented when it is only proposed.
- [x] **DOC.14** Ensure screenshots/visual mockups are labelled conceptual until backed by functional screens.
- [x] **DOC.15** Add a changelog entry following the repository's actual release-note convention, if required.
- [x] **DOC.16** Have a second reviewer check the checklist for duplication with M-series/K0–K9 and stale file paths.

---

# 14. Pull request / change-batch checklist

Use the repository's current branch/PR protocol. Each implementation batch should be reviewable and should not mix unrelated phases.

- [x] **PR.1** Confirm the target is the permitted integration path (`dev` if policy remains unchanged).
- [x] **PR.2** Confirm task IDs and dependencies exist in the canonical task ledger.
- [x] **PR.3** Confirm touched packages/addons and generated outputs are listed.
- [x] **PR.4** Confirm all durable schema/seed changes are addon-owned and use the official installer/upgrade path.
- [x] **PR.5** Confirm no generated file or lockfile was changed unintentionally.
- [x] **PR.6** Confirm no credentials, prompt secrets, private data or unapproved artifacts are committed.
- [x] **PR.7** Run the exact relevant commands discovered in AI0.31.
- [x] **PR.8** Attach test output, failure analysis and before/after behavior.
- [x] **PR.9** Attach addon install/upgrade/idempotency/tenant test evidence when models changed.
- [x] **PR.10** Attach authorization/security test evidence when tools, agents or API scopes changed.
- [x] **PR.11** Attach recovery/cancellation/idempotency test evidence when jobs/runtime changed.
- [x] **PR.12** Update this checklist and canonical source cards in the same change.
- [x] **PR.13** Record the resulting commit SHA and CI run URLs after push (never invent them).
- [ ] **PR.14** Obtain required maintainer approval before promotion to `main`.

---

# 15. Mandatory release gates

Do not mark a phase “done” until all applicable gates are satisfied.

- [x] **GATE.1 ORM:** all durable domain state is addon-declared; install, upgrade, idempotency and recovery tests pass.
- [x] **GATE.2 Reuse:** no duplicate request, workflow, organization, knowledge, storage or job authority has been introduced.
- [x] **GATE.3 Tenant:** cross-company read/write and relation enumeration tests fail closed.
- [x] **GATE.4 Identity:** agents cannot inherit human superadmin or act outside explicit grants.
- [x] **GATE.5 Provider:** local/cloud routing follows data classification; outages do not corrupt state.
- [x] **GATE.6 Runtime:** jobs are bounded, cancellable, recoverable and protected against stale workers/duplicate effects.
- [x] **GATE.7 Tools:** every tool call is authenticated, authorized, scoped, audited and rechecked at execution time.
- [x] **GATE.8 Evidence:** accepted outputs have complete, valid, traceable evidence and independent verification where required.
- [x] **GATE.9 Continuity:** ongoing obligations cannot silently disappear when a request closes.
- [x] **GATE.10 Memory:** memory/skills are versioned, scoped, evaluated, revocable and do not grant authority.
- [x] **GATE.11 Security:** defined adversarial suite has zero unauthorized actions; critical findings are resolved or release is blocked.
- [x] **GATE.12 Operations:** backup/restore, runbook, alerts, cost controls and emergency stop are tested.
- [x] **GATE.13 Evaluation:** results include baselines, failed runs, model/provider/commit metadata and reproducible measurements.
- [x] **GATE.14 Claims:** release notes describe demonstrated capabilities only; no AGI claim is inferred from narrow benchmarks.

---

# 16. First executable milestone — recommended starting slice

Do **not** start by implementing CEO/CTO/department hierarchy. The first slice should prove the vertical path end-to-end with one bounded, read-only agent.

- [x] **SLICE.1** Complete AI0 exact-SHA audit and reuse matrix.
- [x] **SLICE.2** Approve AI1 ADR and register the tasks using the live repository convention.
- [x] **SLICE.3** Add only the minimum ORM addon metadata needed to register one agent and one model/provider profile, if no equivalent model exists.
- [x] **SLICE.4** Implement one local or mock provider adapter and one cloud adapter behind the same provider contract.
- [x] **SLICE.5** Create one read-only request using the existing canonical request/work-item lifecycle.
- [x] **SLICE.6** Dispatch one run through the existing Jobs Engine.
- [x] **SLICE.7** Allow the agent to inspect only an explicitly selected repository/package scope.
- [x] **SLICE.8** Produce one structured report with source paths/line references and limitations.
- [x] **SLICE.9** Run an independent verifier against the required acceptance criteria.
- [x] **SLICE.10** Store the accepted report through the existing storage/evidence conventions.
- [x] **SLICE.11** Inject a worker crash and prove recovery or a known terminal failure state.
- [x] **SLICE.12** Prove duplicate delivery cannot create duplicate accepted results/effects.
- [x] **SLICE.13** Prove a revoked/wrong-company capability blocks access.
- [x] **SLICE.14** Record cost, success, evidence completeness, recovery time and failed runs.
- [x] **SLICE.15** Review whether the vertical slice demonstrates a real gap or suggests reuse/refactor before building additional abstractions.

**First milestone is complete only when:** one request → one durable job/run → one bounded agent → one evidence-backed result → one independent verification → one recovery test passes, with no ORM bypass and no duplicate domain authority.

---

# 17. Progress ledger

Update this section as work proceeds. Keep the latest commit SHA and test evidence in the relevant source card.

| Phase                          | Status                                         | Exit evidence                                                                                                                                                                                                     | Notes                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI0 — Exact-SHA audit          | Complete                                       | [`docs/architecture/ai-corporation-baseline-audit.md`](../../../../architecture/ai-corporation-baseline-audit.md), [`M12.01`](../../../../roadmap/evidence/M12.01.md)                                         | Owner: M1 (`M12.01`); verified `pnpm test:roadmap`, `pnpm automation:check:roadmap`, `node scripts/check-docs.mjs`, `@moonwitness/api --maxWorkers=2`     |
| AI1 — ADR and registration     | Complete                                       | [`ADR 0007`](../../../../decisions/0007-ai-corporation-addon-first-architecture.md), [`13-ai-corporation.md`](../../../../roadmap/13-ai-corporation.md), [`M12.02`](../../../../roadmap/evidence/M12.02.md) | Owner: M1 (`M12.02`); ADR `0007` Accepted, `M12.01`–`M12.14` synced across `tasks.json`/`ROADMAP.md`/`ACTIVE-PLAN.md`                                     |
| AI2 — ORM domain foundation    | Complete (`M12.03`)                            | [`packages/orm-ai`](../../../../../packages/orm-ai/src/index.ts), [`M12.03`](../../../../roadmap/evidence/M12.03.md)                                                                                                  | 15 `ai.*` models registered in `API_ADDONS`, blocked in `INTERNAL_PREFIXES`, `orm-ai` 7/7 & `addon-conformance` 4/4 passed                                |
| AI3 — Provider abstraction     | Complete (`M12.04`)                            | [`packages/ai-runtime`](../../../../../packages/ai-runtime/src/classification-router.ts), [`M12.04`](../../../../roadmap/evidence/M12.04.md)                                                                          | `MockProvider`, `OllamaAdapter`, `OpenAiProviderAdapter`, `AnthropicProviderAdapter`, `DataClassificationRouter`, redaction, `ai-runtime` 16/16 passed    |
| AI4 — First durable agent      | Complete (`M12.05`)                            | [`agent-runner.ts`](../../../../../packages/ai-runtime/src/agent-runner.ts), [`M12.05`](../../../../roadmap/evidence/M12.05.md)                                                                                       | Bounded read-only runner, Jobs handler (`ensureAiJobHandlersRegistered`), fencing rejection (`409`), `ai-corporation.routes` 4/4 passed                   |
| AI5 — Tools and MCP            | Complete (`M12.06`)                            | [`capability-gateway.ts`](../../../../../packages/ai-runtime/src/capability-gateway.ts), [`packages/ai-mcp`](../../../../../packages/ai-mcp/src/index.ts), [`M12.06`](../../../../roadmap/evidence/M12.06.md)               | Execution-time grant recheck, `ai-mcp` 3/3 passed, `desktop` MCP tests 25/25 passed; A2A deferred per `ADR 0007` D9 (`ADR 0009+` reserved)                |
| AI6 — Proof-Carrying Work      | Complete (`M12.07`)                            | [`pcw-verifier.ts`](../../../../../packages/ai-runtime/src/pcw-verifier.ts), [`M12.07`](../../../../roadmap/evidence/M12.07.md)                                                                                       | `verifyProofCarryingWork`, SHA-256 verification (`409` on tamper, `403` on self-approval), `ObligationContinuityLedger`                                   |
| AI7 — AI Company               | Complete (`M12.08`)                            | [`workforce-planner.ts`](../../../../../packages/ai-runtime/src/workforce-planner.ts), [`M12.08`](../../../../roadmap/evidence/M12.08.md)                                                                             | `Taskforce`/`WorkforceAssignment` models, cycle/scope/conflict-lock validation, cancellation propagation                                                  |
| AI8 — Memory/learning          | Complete (`M12.09`)                            | [`memory-evaluator.ts`](../../../../../packages/ai-runtime/src/memory-evaluator.ts), [`M12.09`](../../../../roadmap/evidence/M12.09.md)                                                                               | `MemoryCandidate`/`SkillVersion` isolated from `K0–K9`, 4-arm ablation (`ai-evaluation` 3/3 passed), instant revocation                                   |
| AI9 — Mission Control          | Complete (`M12.10`)                            | [`apps/board/src/app/board/ai/`](../../../../../apps/board/src/app/board/ai/page.tsx), [`M12.10`](../../../../roadmap/evidence/M12.10.md)                                                                             | 7 Mission Control routes (`/board/ai/*`) using `@moonwitness/ui`, source attribution badges, `board:ui:check`, `typecheck`, `lint`, `board:budget` passed |
| AI10 — Security/operations     | Complete (`M12.11`)                            | [`risk-policy.ts`](../../../../../packages/ai-runtime/src/risk-policy.ts), [`restore-drill-fixture.ts`](../../../../../apps/api/src/commands/restore-drill-fixture.ts), [`M12.11`](../../../../roadmap/evidence/M12.11.md)  | `R0`–`R4` risk gate, `EmergencyStopController`, GenAI telemetry, adversarial suite (`desktop` 25/25), `orm-ai` in restore drill fixture                   |
| AI11 — Generalization research | Complete (`M12.12`)                            | [`packages/ai-evaluation`](../../../../../packages/ai-evaluation/src/index.ts), [`M12.12`](../../../../roadmap/evidence/M12.12.md)                                                                                    | Synchronous `validateEvaluationReport`, 4-arm memory ablation, `G0`–`G6` & `G1`–`G14` offline gates (`agiClaimed: false`), `ai-evaluation` 3/3 passed     |
| DOC / SLICE / GATE / PR        | Complete on `dev` (`PR.14` pending maintainer) | [`M12.13`](../../../../roadmap/evidence/M12.13.md), [`M12.14`](../../../../roadmap/evidence/M12.14.md)                                                                                                        | `docs/ai-corporation/*`, `packages/orm-ai/README.md`, `check-docs.mjs` 386 files passed; only `PR.14` human approval for `dev -> main` remains open       |

## Change log

| Date       | Change                                                                                                                                                                                                                                                                                  | Commit / evidence                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2026-11-22 | Initial granular AI Corporation checklist generated from the 2026-11-21 blueprint and documented repository baseline. Exact current `dev` SHA still requires Phase AI0 verification.                                                                                                    | Documentation proposal; not yet merged                                                     |
| 2026-11-22 | Closed `BASE.17`–`BASE.30`, `AI0.1`–`AI0.42`, and `AI1.1`–`AI1.34` under `M12.01` & `M12.02`; updated `ROADMAP.md`, `tasks.json`, and Progress Ledger `AI0`/`AI1`.                                                                                                                      | `a43f47f`, `fe92056`, `docs/roadmap/evidence/M12.01.md`, `docs/roadmap/evidence/M12.02.md` |
| 2026-11-22 | Verified `@moonwitness/orm-ai` (7/7), `@moonwitness/ai-runtime` (15/15), `@moonwitness/desktop` (9/9), and Desktop Harness docs (`ADR 0008`, `docs/tasks/sources/todo-desktop.md`); updated `AI2`–`AI8`, `AI10`–`AI11` checkboxes and progress ledger.                                                     | Verified `tsc`, `vitest`, `eslint --max-warnings 0`, `check-docs.mjs`                      |
| 2026-11-22 | Fixed `validateEvaluationReport` sync contract (`ai-evaluation` 3/3), wired AI/local-AI packages into `test:unit:built`/`run-unit-tests.mjs` & `addon-conformance`, added `packages/orm-ai/README.md` & `restore-drill-fixture.ts` `orm-ai` coverage, and reconciled `M12.03`–`M12.14`. | `docs/roadmap/evidence/M12.03.md`–`M12.14.md`, `ROADMAP.md`, `docs/roadmap/tasks.json`     |

---

## References and source-of-truth documents

- MoonWitness repository: <https://github.com/A-L-L-A-H/mw-xv>
- MoonWitness master roadmap (verify live path/branch): <https://github.com/A-L-L-A-H/mw-xv/blob/main/ROADMAP.md>
- AI Corporation Grand Plan: `AI-CORPORATION-GRAND-PLAN.md`
- AI Corporation Research Register: `AI-CORPORATION-RESEARCH-REGISTER.md`
- AI Corporation ADR Draft: `AI-CORPORATION-ADR-DRAFT.md`
- AI Corporation Implementation Plan: `AI-CORPORATION-IMPLEMENTATION-PLAN.md`

**Important:** This checklist is deliberately detailed, but its proposal IDs and the new workstream's placement must be reconciled with the current live roadmap/task ledger. Do not create parallel task-tracking sources or mark a phase complete without repository-backed evidence.
