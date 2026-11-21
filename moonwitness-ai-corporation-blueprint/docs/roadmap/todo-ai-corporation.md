# MOONWITNESS XV — AI CORPORATION TODO

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

- [ ] **BASE.17 VERIFY** Inspect `orm-organization` models and services; map Company, membership, group, role, hierarchy and company-scope semantics.
- [ ] **BASE.18 VERIFY** Inspect `orm-request`; decide whether AI work is represented by the existing request/work-item model plus typed extensions.
- [ ] **BASE.19 VERIFY** Inspect `orm-workflow`; map transitions, approval, escalation and human sign-off.
- [ ] **BASE.20 VERIFY** Inspect `orm-integration`; map provider/tool connection records and secret-reference patterns.
- [ ] **BASE.21 VERIFY** Inspect `orm-knowledge`, corpus, research and provenance contracts; identify the approved read interfaces workforce agents may consume.
- [ ] **BASE.22 VERIFY** Inspect `orm-storage`; define how artifacts/evidence are referenced and retained.
- [ ] **BASE.23 VERIFY** Inspect Jobs public contracts, handler registration, scheduler, outbox, cancellation and worker lifecycle.
- [ ] **BASE.24 VERIFY** Inspect local-AI exports and its loopback-only / prompt-only safety boundary; do not silently extend that package into a shell/tool executor.
- [ ] **BASE.25 VERIFY** Inspect generic API exposure rules; ensure internal job, scheduler, audit and privileged workflow records cannot be mutated via generic CRUD without dedicated authorization.

**No-go rules:**

- [ ] **BASE.26 NO-GO** Do not introduce a second ORM, database truth, task queue, workflow engine or knowledge/provenance engine.
- [ ] **BASE.27 NO-GO** Do not create a second `task` model until `orm-request` has been inspected and a written ADR explains why it cannot satisfy the work-item contract.
- [ ] **BASE.28 NO-GO** Do not give an agent a human superadmin identity or unrestricted API token.
- [ ] **BASE.29 NO-GO** Do not make a model's self-reported “done” response equivalent to verified completion.
- [ ] **BASE.30 NO-GO** Do not enable automatic live self-modification of agent policies, skills, memory or production code.

---

# 1. Phase AI0 — exact-SHA audit, repository protocol and baseline

**Goal:** establish the exact current repository state and prove that the proposed work does not duplicate existing M/K work.  
**Exit gate:** source-backed inventory, baseline test report, reuse matrix and accepted scope/ADR owner. No feature implementation before this gate.

## 1.1 Fetch and record the authoritative repository state

- [ ] **AI0.1** Read the repository's current `AGENTS.md` (and nested `AGENTS.md` files relevant to touched packages).
- [ ] **AI0.2** Read the current contribution/development instructions and execution protocol.
- [ ] **AI0.3** Fetch the current `dev` branch and record its full commit SHA, commit date and tree state.
- [ ] **AI0.4** Confirm `main` and `dev` are still the only permitted long-lived branches.
- [ ] **AI0.5** Record the current `main` SHA and the merge/promotion relationship from `dev` to `main`.
- [ ] **AI0.6** Locate the canonical master `ROADMAP.md` and read the complete current roadmap.
- [ ] **AI0.7** Locate and read `ACTIVE-PLAN.md` (or the current canonical active-plan equivalent).
- [ ] **AI0.8** Locate and parse `tasks.json` (or the current canonical structured task ledger).
- [ ] **AI0.9** Read the current source cards and record their IDs, status, dependencies and acceptance criteria.
- [ ] **AI0.10** Read the ADR index and determine the next valid ADR number/name.
- [ ] **AI0.11** Record the current M-series status and all active M-series dependencies that could overlap AI runtime, addons, API, Board or jobs.
- [ ] **AI0.12** Record K0–K9 status and mark all knowledge/provenance/privacy/local-AI tasks that must remain owned by that track.
- [ ] **AI0.13** Search for existing AI/agent/provider/MCP/A2A/run/memory/workforce models, routes, handlers, packages and partially completed code.
- [ ] **AI0.14** Search for unmerged or in-progress implementation already present on `dev`; do not trust a README-only inventory.
- [ ] **AI0.15** Record the exact repository tree paths for all relevant addons, services, API routes, Board pages, tests and docs.

## 1.2 Understand the existing engineering patterns

- [ ] **AI0.16** Inspect one representative addon from manifest through `defineAddon` registration.
- [ ] **AI0.17** Inspect one representative addon model declaration using `defineModel`.
- [ ] **AI0.18** Inspect how addon dependencies are declared and dependency closure is validated.
- [ ] **AI0.19** Inspect how addon IDs/external IDs remain stable across install and upgrade.
- [ ] **AI0.20** Inspect field types, relations, constraints, computed fields and validation conventions.
- [ ] **AI0.21** Inspect access metadata, company rules and record-level authorization patterns.
- [ ] **AI0.22** Inspect addon menus, views, actions and Board metadata conventions.
- [ ] **AI0.23** Inspect seed patterns and how user-edited values are preserved during upgrade.
- [ ] **AI0.24** Inspect upgrade hooks and retry/resume behavior for interrupted addon installation.
- [ ] **AI0.25** Inspect addon test structure, fixtures and conformance tests.
- [ ] **AI0.26** Inspect service registration, dependency injection and transaction boundaries.
- [ ] **AI0.27** Inspect REST route schemas and JSON-RPC operation conventions.
- [ ] **AI0.28** Inspect error types, error envelopes, correlation IDs and logging conventions.
- [ ] **AI0.29** Inspect UI design tokens, shared components, loading/empty/error states and accessibility rules.
- [ ] **AI0.30** Inspect test naming, test placement, lint/format rules and CI workflows.

## 1.3 Establish the baseline before adding code

- [ ] **AI0.31** Discover the repository's actual package scripts; record exact supported verify/build/lint/typecheck/test commands (do not guess command names).
- [ ] **AI0.32** Run the canonical fast verification command and preserve its complete result.
- [ ] **AI0.33** Run relevant ORM/addon tests and preserve the result.
- [ ] **AI0.34** Run relevant API and authorization tests and preserve the result.
- [ ] **AI0.35** Run Jobs Engine tests, including lease/retry/idempotency coverage, and preserve the result.
- [ ] **AI0.36** Run relevant Board/UI tests and preserve the result.
- [ ] **AI0.37** Run integration/E2E tests required by the repository's current execution protocol.
- [ ] **AI0.38** Record database setup, addon install, addon upgrade and restore/backup test procedures.
- [ ] **AI0.39** Record current CI workflows and their required checks for a documentation-only and a code PR.
- [ ] **AI0.40** Record baseline runtime/resource measurements only where reproducible; label estimates separately.
- [ ] **AI0.41** Capture existing failures as baseline debt; do not attribute them to this workstream.
- [ ] **AI0.42** Create a source-backed reuse matrix with columns: existing owner, capability, API, test, extension point, gap and proposed action.

---

# 2. Phase AI1 — architecture decisions and workstream registration

**Goal:** turn the grand plan into repository-governed work without changing unrelated roadmap tracks.  
**Exit gate:** approved ADR, task IDs reconciled with the live ledger, explicit non-goals and owner for every durable domain.

## 2.1 Resolve domain ownership before designing models

- [ ] **AI1.1** Map each proposed AI entity to an existing addon or a documented new addon candidate.
- [ ] **AI1.2** Decide whether an agent is an organization member, a service principal, or a separately typed identity linked to organization membership.
- [ ] **AI1.3** Define tenant/company ownership and company-switching rules for agent identities.
- [ ] **AI1.4** Map AI work items to `orm-request`; document the missing fields/lifecycle before considering extensions.
- [ ] **AI1.5** Map delegation and approval to `orm-workflow` before adding new workflow state.
- [ ] **AI1.6** Map model/provider connections to `orm-integration` before adding connection models.
- [ ] **AI1.7** Map knowledge retrieval to approved `orm-knowledge` / research interfaces.
- [ ] **AI1.8** Map files, logs and evidence artifacts to `orm-storage` and the existing retention policy.
- [ ] **AI1.9** Map run dispatch/recovery to `@moonwitness/jobs`; list only measured gaps.
- [ ] **AI1.10** Decide which high-volume or ephemeral runtime data must remain outside ORM and define its retention/reference contract.
- [ ] **AI1.11** Decide whether the first release needs one cohesive `orm-ai` addon or an extension to an existing addon; justify the smallest viable boundary.
- [ ] **AI1.12** Reject proposed package splits that have no independent lifecycle, owner or dependency boundary.

## 2.2 Write and approve architecture records

- [ ] **AI1.13** Convert the ADR draft into the repository's actual ADR format and numbering.
- [ ] **AI1.14** Record the ORM Addon-First invariant and all forbidden bypasses in the ADR.
- [ ] **AI1.15** Record the domain-plane versus execution-plane boundary.
- [ ] **AI1.16** Record provider versus agent-harness distinction; a model API adapter is not a complete agent runtime.
- [ ] **AI1.17** Record the relationship between MCP (tool interface), optional A2A (peer-agent protocol), Jobs (durable dispatch) and ORM (source of truth).
- [ ] **AI1.18** Record identity, company isolation, capability grants, expiry and revocation semantics.
- [ ] **AI1.19** Record data classification and local-only versus cloud-eligible routing rules.
- [ ] **AI1.20** Record evidence, reviewer independence and human-approval requirements.
- [ ] **AI1.21** Record memory lifecycle and prohibit automatic promotion of unverified memory/skills.
- [ ] **AI1.22** Record sandboxing and tool-execution threat model.
- [ ] **AI1.23** Record compatibility, addon upgrade, rollback/recovery and deprecation policy.
- [ ] **AI1.24** Record explicit non-goals for the first release (no unrestricted shell, no self-modifying policy, no open-ended swarm).
- [ ] **AI1.25** Obtain maintainer review/approval for the ADR before implementing domain schema.

## 2.3 Register tasks according to repository governance

- [ ] **AI1.26** Reconcile proposal IDs in this file with current task ID naming and numbering.
- [ ] **AI1.27** Add a single AI Corporation workstream to the canonical active plan; do not create a second master task ledger.
- [ ] **AI1.28** Add only agreed tasks to the existing structured task ledger (`tasks.json` or its current successor).
- [ ] **AI1.29** Add cross-links to the existing M-series/K0–K9 tasks that AI Corporation depends on.
- [ ] **AI1.30** Confirm no existing task is duplicated or re-opened without maintainer decision.
- [ ] **AI1.31** Add acceptance criteria, test evidence expectations and dependencies to every registered task.
- [ ] **AI1.32** Add this checklist to the repository's canonical documentation location after path conventions are confirmed.
- [ ] **AI1.33** Confirm whether checkboxes are accepted as the canonical progress ledger or whether each item must also have a source card.
- [ ] **AI1.34** Define how completion is synchronized between this checklist, source cards, `tasks.json` and master roadmap.

---

# 3. Phase AI2 — Addon-First domain foundation

**Goal:** register the minimum durable AI domain using existing ORM/addon patterns.  
**Exit gate:** fresh install, upgrade, idempotency, tenant isolation and generated API/UI metadata all pass. No runtime execution yet.

## 3.1 Design the minimum domain contract

- [ ] **AI2.1** Define the minimum `Agent` concept and separate stable identity from mutable display/profile data.
- [ ] **AI2.2** Define agent lifecycle states (for example draft, active, paused, disabled, retired) using existing enum conventions.
- [ ] **AI2.3** Define the relationship between agent identity and organization/company membership.
- [ ] **AI2.4** Define agent role/position references without duplicating organization role models.
- [ ] **AI2.5** Define capability names as stable, versioned identifiers.
- [ ] **AI2.6** Define capability grants with scope, issuer, expiry, revocation and audit references.
- [ ] **AI2.7** Define model profile references separately from agent identity.
- [ ] **AI2.8** Define provider profile metadata without storing raw API keys or secrets.
- [ ] **AI2.9** Define execution policy references and default risk tier.
- [ ] **AI2.10** Define the durable run record needed to correlate ORM state with the existing Jobs Engine.
- [ ] **AI2.11** Define delegation references using the canonical request/work item and workflow domains.
- [ ] **AI2.12** Define evidence/artifact references using existing storage/knowledge contracts.
- [ ] **AI2.13** Define company scope for every proposed model and relation.
- [ ] **AI2.14** Identify fields that are derived or transient and therefore must not be persisted as canonical facts.
- [ ] **AI2.15** Review the model set for minimum viable scope; remove entities that do not support the first bounded agent.

## 3.2 Implement the addon declaration

- [ ] **AI2.16** Create or extend the approved addon directory following the nearest existing addon structure.
- [ ] **AI2.17** Add addon manifest metadata using the current repository schema.
- [ ] **AI2.18** Declare dependencies on existing organization/request/workflow/integration/storage addons only where required.
- [ ] **AI2.19** Implement the first model declaration through `defineModel` (or the current canonical ORM API).
- [ ] **AI2.20** Implement the agent identity/profile relation with explicit company scope.
- [ ] **AI2.21** Implement provider/model profile references, not secret values.
- [ ] **AI2.22** Implement capability grant metadata and expiry/revocation fields.
- [ ] **AI2.23** Implement durable run metadata linked to the canonical Jobs record using the supported relation/reference pattern.
- [ ] **AI2.24** Add unique constraints and indexes only from demonstrated query and integrity requirements.
- [ ] **AI2.25** Add field-level validation using the existing typed validation conventions.
- [ ] **AI2.26** Add access metadata for human owner, administrator/operator and agent/service principal roles.
- [ ] **AI2.27** Add record/company rules and deny cross-company access by default.
- [ ] **AI2.28** Add stable external IDs for system-owned seeds.
- [ ] **AI2.29** Ensure seeds are safe, repeatable and never overwrite user-customized records.
- [ ] **AI2.30** Add Board list/detail/form views through the addon metadata conventions.
- [ ] **AI2.31** Add menu/action metadata only through the existing addon mechanism.
- [ ] **AI2.32** Add docs describing each model, field, lifecycle and access rule.

## 3.3 Prove install and upgrade safety

- [ ] **AI2.33** Test clean installation into an empty supported database.
- [ ] **AI2.34** Test installation when dependencies are already installed.
- [ ] **AI2.35** Test repeated installation/upgrade for idempotency.
- [ ] **AI2.36** Test interrupted installation and retry/resume behavior using the current addon installer contract.
- [ ] **AI2.37** Test that upgrades preserve user-edited agent profiles and settings.
- [ ] **AI2.38** Test duplicate external IDs and conflicting definitions fail safely.
- [ ] **AI2.39** Test a company-A user cannot list/read/update company-B agent records.
- [ ] **AI2.40** Test an agent identity cannot inherit a human administrator role.
- [ ] **AI2.41** Test generic REST/JSON-RPC access cannot bypass capability checks for privileged fields/actions.
- [ ] **AI2.42** Run addon conformance, type, lint and relevant integration checks.
- [ ] **AI2.43** Record test commands, fixture IDs and results in the source card.

---

# 4. Phase AI3 — provider and model abstraction (local + cloud)

**Goal:** support multiple model providers without coupling domain state to one vendor.  
**Exit gate:** local and cloud adapters pass the same contract suite and policy prevents disallowed data egress.

## 4.1 Provider contract

- [ ] **AI3.1** Define a typed provider interface in the runtime/service layer, not in an ORM model package.
- [ ] **AI3.2** Separate provider (API transport), model profile (model identity/capabilities) and agent harness (tool loop/runtime).
- [ ] **AI3.3** Define request/response envelopes with correlation ID, timeout, cancellation and token usage.
- [ ] **AI3.4** Define structured-output support and validation behavior.
- [ ] **AI3.5** Define tool-call capability separately from text-generation capability.
- [ ] **AI3.6** Define streaming support as optional capability, not a universal assumption.
- [ ] **AI3.7** Define model context-window, modality, rate-limit and pricing metadata where provider supplies it.
- [ ] **AI3.8** Define retryable versus non-retryable provider errors.
- [ ] **AI3.9** Define provider health checks without transmitting sensitive prompt content.
- [ ] **AI3.10** Define deterministic mock provider for tests.

## 4.2 Implement the minimum adapters

- [ ] **AI3.11** Audit the existing local-AI package and document what can be reused without changing K0–K9 safety semantics.
- [ ] **AI3.12** Decide whether local inference needs a separate workforce adapter rather than changing the research suggestion adapter.
- [ ] **AI3.13** Implement one local adapter against the repository-approved local model endpoint contract.
- [ ] **AI3.14** Verify the exact Ollama API/endpoint compatibility; do not assume `/v1/generate` compatibility with a standard Ollama endpoint.
- [ ] **AI3.15** Implement one cloud adapter behind the same provider interface.
- [ ] **AI3.16** Add a second provider only after the first two pass the shared contract suite.
- [ ] **AI3.17** Add per-provider timeout, concurrency and rate-limit settings.
- [ ] **AI3.18** Add provider/model capability registry using addon metadata where durable business configuration is needed.
- [ ] **AI3.19** Add model selection policy by task class, cost, latency and capability.
- [ ] **AI3.20** Add explicit local-only, cloud-eligible and restricted data classifications.
- [ ] **AI3.21** Block cloud routing for local-only/restricted data unless an explicit approved policy permits it.
- [ ] **AI3.22** Ensure fallback never silently changes the data classification boundary.
- [ ] **AI3.23** Store credentials only through approved secret references/environment bindings.
- [ ] **AI3.24** Redact authorization headers, keys and secret-bearing provider errors from logs.
- [ ] **AI3.25** Add provider contract tests for success, malformed response, timeout, quota, outage and cancellation.
- [ ] **AI3.26** Add a provider-offline integration test proving no run record or task is corrupted.
- [ ] **AI3.27** Add token/cost accounting with explicit “estimated” versus “provider-reported” labels.
- [ ] **AI3.28** Document supported provider/model capabilities and known limitations.

---

# 5. Phase AI4 — first durable, bounded agent

**Goal:** prove one agent can perform one low-risk task through the existing Jobs Engine and recover safely.  
**Exit gate:** a read-only task completes with traceable evidence; crash/retry/cancel tests pass. Do not build a swarm yet.

## 5.1 Define the first work contract

- [ ] **AI4.1** Select one read-only task type: inspect a bounded repository/package and produce a source-backed report.
- [ ] **AI4.2** Define the input schema, allowed scope, output schema and maximum duration.
- [ ] **AI4.3** Define required acceptance criteria before a run can start.
- [ ] **AI4.4** Define what files/repos the agent may read and explicitly deny all writes for the first proof.
- [ ] **AI4.5** Define the allowed tools for this task and deny all unspecified tools.
- [ ] **AI4.6** Define the completion envelope: summary, findings, evidence references, limitations, provider metadata and status.
- [ ] **AI4.7** Define terminal run states using existing state/enum conventions and avoid duplicating the Jobs Engine's own states.
- [ ] **AI4.8** Define correlation from request → run → job → provider call → artifact → verification.

## 5.2 Integrate with Jobs Engine

- [ ] **AI4.9** Implement a job handler using the existing handler registration pattern.
- [ ] **AI4.10** Persist the domain run record before dispatch using the repository's transaction/outbox pattern.
- [ ] **AI4.11** Pass a stable idempotency key for the logical task/effect.
- [ ] **AI4.12** Bind the agent identity, company context, capability grant and policy version to the run.
- [ ] **AI4.13** Enforce a hard deadline and cooperative cancellation.
- [ ] **AI4.14** Use existing leases, heartbeat and fencing; do not create a second lease scheduler.
- [ ] **AI4.15** Persist a checkpoint only at documented safe boundaries.
- [ ] **AI4.16** Ensure a stale worker cannot commit a result after losing its lease/fencing token.
- [ ] **AI4.17** Ensure duplicate job delivery does not duplicate a durable result or external side effect.
- [ ] **AI4.18** Ensure a failed provider call returns a typed failure and does not falsely mark the request complete.
- [ ] **AI4.19** Ensure cancellation reaches the provider/runtime where supported and reaches a known terminal state otherwise.
- [ ] **AI4.20** Ensure retries respect idempotency and bounded retry/backoff policy.

## 5.3 Add a minimal safe execution environment

- [ ] **AI4.21** Choose the first harness/runtime adapter after a documented comparison; do not assume provider API alone is an agent harness.
- [ ] **AI4.22** Run the first agent without shell, browser, write access or arbitrary network tools.
- [ ] **AI4.23** If repository reading is needed, expose a read-only repository adapter with explicit path allowlist.
- [ ] **AI4.24** Prevent path traversal and symlink escapes in file-reading tools.
- [ ] **AI4.25** Apply output-size, context-size, wall-clock and concurrency limits.
- [ ] **AI4.26** Treat repository content, web pages, issue text and documents as untrusted data, not agent instructions.
- [ ] **AI4.27** Store logs with redaction and bounded retention; store large artifacts via the existing storage abstraction.

## 5.4 Failure and recovery proof

- [ ] **AI4.28** Test provider timeout during a run.
- [ ] **AI4.29** Test worker process termination after job claim.
- [ ] **AI4.30** Test restart after output is generated but before the result is committed.
- [ ] **AI4.31** Test lease expiry and stale-worker fencing.
- [ ] **AI4.32** Test duplicate delivery and duplicate outbox notification.
- [ ] **AI4.33** Test cancellation before start, during provider call and after safe checkpoint.
- [ ] **AI4.34** Test malformed model output and schema validation rejection.
- [ ] **AI4.35** Test exhausted retry moves to the existing dead-letter/error path.
- [ ] **AI4.36** Test that a failed run remains inspectable and can be safely retried by an authorized operator.
- [ ] **AI4.37** Record recovery success rate and time-to-recovery from repeatable test fixtures.

---

# 6. Phase AI5 — capability gateway, tool permissions and MCP

**Goal:** expose narrowly scoped MoonWitness operations to agents; keep policy enforcement outside the model.  
**Exit gate:** read-only MCP conformance first, then individually approved low-risk write operations.

## 6.1 Internal capability/tool gateway

- [ ] **AI5.1** Define a typed tool contract with stable name, version, input schema, output schema and risk tier.
- [ ] **AI5.2** Define tool ownership by domain addon/service; do not let MCP call the database directly.
- [ ] **AI5.3** Bind each tool call to authenticated human/agent identity, company, run and correlation ID.
- [ ] **AI5.4** Validate capability grant, scope, expiry, revocation and policy version before execution.
- [ ] **AI5.5** Re-check permission at execution time, not only when a plan is created.
- [ ] **AI5.6** Add argument validation, size limits and output redaction per tool.
- [ ] **AI5.7** Add deterministic policy denial responses and audit denied attempts.
- [ ] **AI5.8** Add per-agent and per-run tool quotas.
- [ ] **AI5.9** Add explicit confirmation for write/destructive/external-effect tools according to risk tier.
- [ ] **AI5.10** Ensure a prompt or tool output cannot expand the agent's capability grant.

## 6.2 MCP server — read-only first

- [ ] **AI5.11** Select and document the MCP SDK/version supported by the repository's runtime.
- [ ] **AI5.12** Implement MCP server startup/shutdown using the existing service lifecycle and health reporting conventions.
- [ ] **AI5.13** Expose a minimal read-only tool set for agent registry, assigned work item, approved knowledge retrieval and evidence references.
- [ ] **AI5.14** Expose only data the current identity/company policy permits.
- [ ] **AI5.15** Add explicit tool descriptions that state scope, side effects and data sensitivity.
- [ ] **AI5.16** Add MCP protocol initialization, tool listing and tool invocation conformance tests.
- [ ] **AI5.17** Add authentication and scoped credentials for remote MCP transport, if remote transport is supported.
- [ ] **AI5.18** Reject unauthenticated, expired, revoked and wrong-company MCP requests.
- [ ] **AI5.19** Add request correlation and audit entries for MCP calls.
- [ ] **AI5.20** Add prompt-injection and malicious tool-output tests.
- [ ] **AI5.21** Add a documented local development client configuration without committing secrets.
- [ ] **AI5.22** Verify an external MCP client can read an assigned task but cannot enumerate unrelated company data.

## 6.3 Carefully scoped write tools

- [ ] **AI5.23** Add one low-risk write tool only after read-only conformance is green.
- [ ] **AI5.24** Make write tools call domain services/workflows, never generic privileged CRUD.
- [ ] **AI5.25** Require an idempotency key for operations that may be retried.
- [ ] **AI5.26** Return typed outcome and audit reference, not just “success”.
- [ ] **AI5.27** Test authorization revocation between planning and tool execution.
- [ ] **AI5.28** Test replayed MCP requests and duplicate side effects.
- [ ] **AI5.29** Document the MCP tool catalog and the permission required by each tool.

## 6.4 A2A decision (optional, later)

- [ ] **AI5.30** Determine whether MoonWitness-to-MoonWitness/external-agent peer communication is a real requirement.
- [ ] **AI5.31** If needed, write an ADR for A2A instead of conflating it with MCP.
- [ ] **AI5.32** Define authentication, trust, task status, cancellation and evidence exchange before implementing A2A.
- [ ] **AI5.33** Add protocol conformance and spoofed-agent tests before enabling external peer delegation.

---

# 7. Phase AI6 — Proof-Carrying Work (PCW) and independent verification

**Goal:** completion means acceptance criteria are satisfied by evidence, not merely claimed by a model.  
**Exit gate:** a deliberately false completion claim is rejected; every accepted criterion has verifiable evidence.

## 7.1 Work contract and acceptance criteria

- [ ] **AI6.1** Define a typed work contract using the canonical request/work-item domain.
- [ ] **AI6.2** Define required outcome, scope, constraints, non-goals and expected deliverables.
- [ ] **AI6.3** Define acceptance criteria as individually addressable records/metadata using the existing addon conventions.
- [ ] **AI6.4** Define verification method per criterion (test, source inspection, reviewer, human decision or other deterministic check).
- [ ] **AI6.5** Define required evidence type, origin, digest/reference and retention policy.
- [ ] **AI6.6** Define the difference between proposed, produced, checked, accepted, rejected and superseded evidence.
- [ ] **AI6.7** Ensure acceptance criteria cannot be silently edited after work begins; changes must be versioned/audited.

## 7.2 Evidence and verification pipeline

- [ ] **AI6.8** Reuse the existing provenance/evidence model where its semantics fit; record any gap before extending.
- [ ] **AI6.9** Define an artifact manifest with artifact reference, digest, producer, run, commit/source SHA and timestamp.
- [ ] **AI6.10** Link each artifact to the acceptance criteria it supports.
- [ ] **AI6.11** Add deterministic verifier hooks for automated tests and schema checks.
- [ ] **AI6.12** Add an independent reviewer role that cannot be the same run/identity as the worker for required risk levels.
- [ ] **AI6.13** Add reviewer decision and rationale records through the existing workflow/audit conventions.
- [ ] **AI6.14** Add a completeness check: no acceptance criterion means no accepted work.
- [ ] **AI6.15** Add evidence digest and provenance validation before acceptance.
- [ ] **AI6.16** Add expiry/invalidity rules for evidence that can become stale.
- [ ] **AI6.17** Add human sign-off for the risk classes defined in the governance policy.
- [ ] **AI6.18** Ensure worker cannot approve its own high-risk action or final acceptance.
- [ ] **AI6.19** Test a model claiming success with missing evidence; verification must reject it.
- [ ] **AI6.20** Test fabricated, mismatched, stale and partially passing evidence.
- [ ] **AI6.21** Test reviewer conflict-of-interest and reviewer outage paths.
- [ ] **AI6.22** Produce an auditable acceptance report for the first bounded research task.

## 7.3 Obligation continuity

- [ ] **AI6.23** Define the difference between a one-time acceptance criterion and an ongoing obligation.
- [ ] **AI6.24** Define obligation owner, scope, trigger, due condition, evidence required and expiry/supersession.
- [ ] **AI6.25** Link accepted artifacts/decisions to their continuing obligations.
- [ ] **AI6.26** Define impact links from future changes to affected obligations.
- [ ] **AI6.27** Define re-verification triggers for code changes, source changes, policy changes and time-based expiry.
- [ ] **AI6.28** Prevent normal task closure from silently deleting unresolved obligations.
- [ ] **AI6.29** Require explicit decision/evidence when an obligation is superseded or retired.
- [ ] **AI6.30** Add tests showing a later change invalidates or reopens the correct verification obligation.
- [ ] **AI6.31** Add a read-only obligation timeline/report before creating a complex graph UI.

---

# 8. Phase AI7 — AI Company, workforce and multi-agent orchestration

**Goal:** evolve from one durable agent to a governed organization; scale only when measured task decomposition justifies it.  
**Exit gate:** delegation, parallel work, review and escalation work without cycles, duplicate work or authority escalation.

## 8.1 Organizational identity and roles

- [ ] **AI7.1** Reuse `orm-organization` company/team/department structures where semantics match.
- [ ] **AI7.2** Define agent-as-member/service-identity mapping without duplicating human membership.
- [ ] **AI7.3** Define stable job positions (CEO/planner, manager, researcher, builder, reviewer) as templates, not privileged identities.
- [ ] **AI7.4** Define role capability bundles as defaults that still require explicit grants.
- [ ] **AI7.5** Define reporting lines and allowed delegation directions.
- [ ] **AI7.6** Define temporary taskforce membership with purpose, scope, expiry and budget.
- [ ] **AI7.7** Define how an agent is paused, disabled, replaced or retired without losing its run/audit history.
- [ ] **AI7.8** Add a seeded demonstration organization only if seeds follow stable IDs and preserve customization.

## 8.2 Planning and delegation

- [ ] **AI7.9** Define a planner output schema: goal, decomposition, dependencies, criteria, risk, estimated cost and required skills.
- [ ] **AI7.10** Validate every proposed subtask against the parent scope and company boundary.
- [ ] **AI7.11** Require a plan critique or deterministic consistency check before high-impact delegation.
- [ ] **AI7.12** Assign tasks by capability, availability, budget and policy—not by model-written title alone.
- [ ] **AI7.13** Define parent/child work-item links using canonical request/workflow semantics.
- [ ] **AI7.14** Detect delegation loops and cyclic dependencies before scheduling.
- [ ] **AI7.15** Detect duplicate active tasks with equivalent scope/acceptance criteria.
- [ ] **AI7.16** Define when the CEO/planner should keep work single-agent instead of spawning a team.
- [ ] **AI7.17** Define maximum delegation depth and maximum active agents per company/project.
- [ ] **AI7.18** Define cancellation propagation from parent request to child jobs and agents.
- [ ] **AI7.19** Define replanning behavior when a child task fails, times out or reports an unmet dependency.
- [ ] **AI7.20** Define escalation when no eligible agent/provider is available.

## 8.3 Parallel execution and review

- [ ] **AI7.21** Define workspace ownership and conflict policy for parallel code-writing agents.
- [ ] **AI7.22** Require isolated workspaces/branches or another explicit conflict-control mechanism for concurrent writes.
- [ ] **AI7.23** Prevent two agents from modifying the same protected artifact concurrently without a lock/conflict plan.
- [ ] **AI7.24** Require each child task to return a typed completion/evidence envelope.
- [ ] **AI7.25** Require reviewer/QA to inspect output independently from the worker's completion claim.
- [ ] **AI7.26** Prevent parent completion while mandatory children or obligations remain unresolved.
- [ ] **AI7.27** Aggregate child outcomes with failed/blocked/partial status preserved; do not turn partial success into success.
- [ ] **AI7.28** Add a small test company with one manager, two workers and one reviewer.
- [ ] **AI7.29** Test one decomposable task where parallel execution is faster or better than single-agent execution.
- [ ] **AI7.30** Test one non-decomposable task where multi-agent overhead makes it worse; planner should choose one agent.
- [ ] **AI7.31** Measure coordination overhead, contradictions, duplicate work and cost per accepted result.
- [ ] **AI7.32** Add organization/team dashboard data only after lifecycle and state transitions are real.

---

# 9. Phase AI8 — memory, procedural learning and controlled improvement

**Goal:** make experience useful to future work without turning unverified output into truth or policy.  
**Exit gate:** memory promotion is measured, reversible, scoped and traceable; memory ablation tests prove utility.

## 9.1 Keep knowledge and workforce memory separate

- [ ] **AI8.1** Document the boundary between trusted/source-backed knowledge and agent-generated experience.
- [ ] **AI8.2** Reuse K0–K9 knowledge interfaces for approved facts; do not create a parallel provenance system.
- [ ] **AI8.3** Define episodic memory (what happened in a run) separately from semantic knowledge and procedural skill.
- [ ] **AI8.4** Define task/project/company scope for every memory item.
- [ ] **AI8.5** Define retention, privacy, deletion and access rules for agent memory.
- [ ] **AI8.6** Define memory source references, confidence/quality labels and the model/run that produced it.

## 9.2 Memory candidate lifecycle

- [ ] **AI8.7** Create memory as a candidate, not an automatically trusted fact.
- [ ] **AI8.8** Store the source run, evidence and reviewer status for each candidate.
- [ ] **AI8.9** Define promotion criteria for an episodic lesson, semantic note and procedural skill separately.
- [ ] **AI8.10** Add versioning for reusable skills/SOPs.
- [ ] **AI8.11** Add approval/review for skills that can invoke tools or change execution behavior.
- [ ] **AI8.12** Add expiry/staleness metadata and a revocation path.
- [ ] **AI8.13** Add a way to identify which future runs consumed a memory/skill version.
- [ ] **AI8.14** Ensure memory retrieval respects company, project, data classification and current authorization.
- [ ] **AI8.15** Treat retrieved memories as context/data; they cannot grant new authority or override policy.

## 9.3 Learning evaluation

- [ ] **AI8.16** Build a deterministic benchmark set from approved, non-sensitive task fixtures.
- [ ] **AI8.17** Record baseline performance with memory disabled.
- [ ] **AI8.18** Record performance with candidate memory enabled under the same task/model/tool conditions.
- [ ] **AI8.19** Measure transfer gain on a related but unseen task.
- [ ] **AI8.20** Measure memory harm: stale, poisoned or incorrect memory that degrades results.
- [ ] **AI8.21** Add an ablation report comparing no-memory, episodic-only, skill-only and combined memory.
- [ ] **AI8.22** Promote memory only when predefined utility and safety thresholds pass.
- [ ] **AI8.23** Test memory revocation and prove affected future runs no longer consume the revoked version.
- [ ] **AI8.24** Prohibit live autonomous modification of production prompts, role policies and capability grants.

---

# 10. Phase AI9 — Mission Control UI and human experience

**Goal:** build a premium, useful operations console whose visual state always comes from real persisted/run state.  
**Exit gate:** operators can understand ownership, execution, evidence, cost and risk; UI cannot bypass backend policy.

## 10.1 Information architecture

- [ ] **AI9.1** Map proposed screens to existing Board routes, menus and design system before adding pages.
- [ ] **AI9.2** Define Company HQ / organization overview.
- [ ] **AI9.3** Define Agent Registry / profile detail.
- [ ] **AI9.4** Define Mission Control / project and task graph.
- [ ] **AI9.5** Define Live Operations / job and run timeline.
- [ ] **AI9.6** Define Evidence & Continuity / artifact and obligation inspector.
- [ ] **AI9.7** Define Model & Provider settings with masked secret references.
- [ ] **AI9.8** Define Governance / grants / approval queue.
- [ ] **AI9.9** Define Cost & Usage reporting.
- [ ] **AI9.10** Define Research & Evaluation Lab as a read-only view of reproducible benchmark results.
- [ ] **AI9.11** Define operator emergency controls: pause agent, revoke grant, stop run and disable provider.

## 10.2 Build from existing UI conventions

- [ ] **AI9.12** Reuse existing layout, navigation, tokens, table, form, modal and notification components.
- [ ] **AI9.13** Generate ordinary model list/form/detail views from addon metadata where supported.
- [ ] **AI9.14** Build specialized graph/timeline views with typed API contracts and existing UI patterns.
- [ ] **AI9.15** Show whether each status is persisted, derived or ephemeral.
- [ ] **AI9.16** Add loading, empty, error, offline, stale-data and permission-denied states.
- [ ] **AI9.17** Add explicit confirmation and consequence text for pause/revoke/cancel actions.
- [ ] **AI9.18** Add filters for company, project, agent, provider, risk, state and time.
- [ ] **AI9.19** Add drill-down from company → team → agent → task → run → evidence.
- [ ] **AI9.20** Add a visible source/evidence inspector for accepted results.
- [ ] **AI9.21** Add keyboard navigation and screen-reader alternatives for graph-only interactions.
- [ ] **AI9.22** Test responsive behavior at supported desktop and mobile breakpoints.
- [ ] **AI9.23** Add UI tests for permission boundaries and cross-company data isolation.
- [ ] **AI9.24** Add a UI test proving optimistic state cannot display a privileged action as successful before server confirmation.
- [ ] **AI9.25** Verify the dashboard remains useful with animation disabled and with a large number of agents/runs.

---

# 11. Phase AI10 — security, reliability, observability and operations

**Goal:** make the system safe to operate continuously and diagnosable when it fails.  
**Exit gate:** adversarial, recovery, backup/restore and cost-control tests pass for the supported deployment profile.

## 11.1 Risk tiers and authority

- [ ] **AI10.1** Define risk tiers R0–R4 in the repository's policy format.
- [ ] **AI10.2** Map each tool/action type to a risk tier with examples.
- [ ] **AI10.3** Define permitted autonomy per tier (read-only, reversible internal write, external effect, destructive/high-impact, prohibited).
- [ ] **AI10.4** Define who may grant/revoke capabilities and who may approve each risk tier.
- [ ] **AI10.5** Make grants short-lived and scoped to company/project/task/run where possible.
- [ ] **AI10.6** Add emergency stop that prevents new dispatch and safely handles in-flight jobs.
- [ ] **AI10.7** Add operator ability to revoke a provider/tool capability without deleting history.
- [ ] **AI10.8** Ensure policy is enforced by deterministic code outside the model prompt.

## 11.2 Sandbox and prompt-injection resistance

- [ ] **AI10.9** Threat-model untrusted repository files, webpages, issue comments, documents and tool outputs.
- [ ] **AI10.10** Define the runtime isolation boundary and allowed filesystem/network/process capabilities.
- [ ] **AI10.11** Set CPU, memory, disk, process count, network and wall-clock limits for execution sandboxes.
- [ ] **AI10.12** Separate agent workspace from host secrets and application runtime credentials.
- [ ] **AI10.13** Prevent agents from reading unrelated workspace paths and environment secrets.
- [ ] **AI10.14** Require explicit policy for network egress; default deny where feasible.
- [ ] **AI10.15** Test malicious file instructions that attempt to override agent goals or reveal secrets.
- [ ] **AI10.16** Test tool-result injection and cross-agent prompt contamination.
- [ ] **AI10.17** Test symlink, path traversal, archive extraction and oversized-output abuse.
- [ ] **AI10.18** Test privilege escalation attempts through generic API, MCP and delegated child runs.

## 11.3 Reliability and observability

- [ ] **AI10.19** Define structured event names and correlation fields across request, job, run, provider, tool, artifact and verifier.
- [ ] **AI10.20** Add metrics for queue wait, run duration, retries, failure class, provider latency and cancellation.
- [ ] **AI10.21** Add metrics for accepted-task success, evidence completeness and reviewer disagreement.
- [ ] **AI10.22** Add metrics for token/cost usage with source and estimate labels.
- [ ] **AI10.23** Add alert conditions for stuck jobs, retry storms, budget exhaustion and provider outage.
- [ ] **AI10.24** Add a run inspection record that shows last checkpoint, last successful action and failure reason.
- [ ] **AI10.25** Verify log redaction and ensure prompt/response retention follows privacy policy.
- [ ] **AI10.26** Add backup/restore coverage for new addon-owned records and artifact references.
- [ ] **AI10.27** Test database restore while queued/in-flight jobs exist; document reconciliation behavior.
- [ ] **AI10.28** Test service restart, worker restart and provider outage without duplicate external effects.
- [ ] **AI10.29** Define retention/cleanup for temporary workspaces, logs, artifacts and orphaned runs.
- [ ] **AI10.30** Publish an operator runbook for stuck run, failed provider, compromised credential, runaway cost and emergency stop.

## 11.4 Deployment and supported platforms

- [ ] **AI10.31** Define the first supported deployment topology (local Windows/WSL2, Docker, or server) from actual repository support.
- [ ] **AI10.32** Document prerequisites and supported runtime versions from package/container manifests.
- [ ] **AI10.33** Add health/readiness checks for API, worker, database, provider and MCP service as applicable.
- [ ] **AI10.34** Add a clean-install smoke test for the documented deployment topology.
- [ ] **AI10.35** Add upgrade smoke test from the previous supported version.
- [ ] **AI10.36** Add rollback/recovery instructions consistent with addon upgrade semantics.
- [ ] **AI10.37** Verify secrets are injected at runtime and absent from images, lockfiles, fixtures and sample configs.
- [ ] **AI10.38** Document minimum/recommended CPU, RAM, disk and model requirements based on measurements, not guesswork.

---

# 12. Phase AI11 — evaluation lab, generalization research and capability promotion

**Goal:** measure improvement honestly; avoid presenting narrow benchmark success as AGI.  
**Exit gate:** reproducible evaluation with baselines, failed runs, cost, safety regression and independent replication where feasible.

## 12.1 Evaluation corpus and baselines

- [ ] **AI11.1** Define an approved, non-sensitive task corpus across repository analysis, coding, testing, research, documentation and operations.
- [ ] **AI11.2** Add task fixtures with explicit requirements, ground truth and acceptance tests.
- [ ] **AI11.3** Record a single-agent baseline for each task family.
- [ ] **AI11.4** Record a multi-agent baseline for only those task families that can be decomposed.
- [ ] **AI11.5** Record provider/model version, harness version, tool versions, commit SHA, decoding settings and fixture hashes per run.
- [ ] **AI11.6** Preserve failed, partial and cancelled runs in the evaluation dataset.
- [ ] **AI11.7** Calculate verified task success rather than relying on model self-report.
- [ ] **AI11.8** Measure regression/retained-functionality rate across sequential changes to the same project.
- [ ] **AI11.9** Measure cost per accepted deliverable, not just cost per token or per run.
- [ ] **AI11.10** Measure coordination overhead and contradiction/duplicate-work rate.
- [ ] **AI11.11** Measure recovery success after crash, provider outage and worker lease expiry.
- [ ] **AI11.12** Measure unauthorized action rate in adversarial tests; release target is zero in the defined test suite.
- [ ] **AI11.13** Measure memory utility and memory harm using ablation.
- [ ] **AI11.14** Measure cross-domain transfer on unseen but related tasks.

## 12.2 Capability gates (not AGI claims)

- [ ] **AI11.15** Define G0: governed assistant — read, retrieve, summarize and propose within policy.
- [ ] **AI11.16** Define G1: bounded actor — complete one scoped task with auditable tool actions.
- [ ] **AI11.17** Define G2: persistent worker — resume long-running work with checkpoint/recovery and evidence.
- [ ] **AI11.18** Define G3: coordinated team — delegate and verify decomposable tasks with measured net benefit.
- [ ] **AI11.19** Define G4: adaptive organization — change temporary staffing/plans within fixed authority/budget.
- [ ] **AI11.20** Define G5: experience-driven improvement — promote only evaluated/reversible skills and memories.
- [ ] **AI11.21** Define G6: cross-domain generalization research — demonstrate transfer on held-out task families.
- [ ] **AI11.22** Define measurable pass/fail criteria for each gate before running the evaluation.
- [ ] **AI11.23** Require no safety regression and no material retained-functionality regression before promoting a capability level.
- [ ] **AI11.24** Publish the limits of each result; do not describe any level as “AGI achieved”.

---

# 13. Documentation, release and maintenance checklist

- [ ] **DOC.1** Update the architecture index to link the accepted Grand Plan, ADR and this TODO.
- [ ] **DOC.2** Update the canonical roadmap only after task IDs/statuses are approved.
- [ ] **DOC.3** Add addon README/docs for every new durable AI domain model.
- [ ] **DOC.4** Add provider setup docs for local and cloud configurations.
- [ ] **DOC.5** Add secret setup and rotation guidance without real credentials.
- [ ] **DOC.6** Add MCP client setup docs and tool permission matrix.
- [ ] **DOC.7** Add operator runbook and emergency stop procedure.
- [ ] **DOC.8** Add model/provider compatibility matrix and tested versions.
- [ ] **DOC.9** Add threat model and data-flow diagram.
- [ ] **DOC.10** Add evaluation methodology and reproducibility instructions.
- [ ] **DOC.11** Add upgrade, backup and restore notes.
- [ ] **DOC.12** Check links, paths, package names and commands against the actual repository before merge.
- [ ] **DOC.13** Ensure no TODO text claims a feature is already implemented when it is only proposed.
- [ ] **DOC.14** Ensure screenshots/visual mockups are labelled conceptual until backed by functional screens.
- [ ] **DOC.15** Add a changelog entry following the repository's actual release-note convention, if required.
- [ ] **DOC.16** Have a second reviewer check the checklist for duplication with M-series/K0–K9 and stale file paths.

---

# 14. Pull request / change-batch checklist

Use the repository's current branch/PR protocol. Each implementation batch should be reviewable and should not mix unrelated phases.

- [ ] **PR.1** Confirm the target is the permitted integration path (`dev` if policy remains unchanged).
- [ ] **PR.2** Confirm task IDs and dependencies exist in the canonical task ledger.
- [ ] **PR.3** Confirm touched packages/addons and generated outputs are listed.
- [ ] **PR.4** Confirm all durable schema/seed changes are addon-owned and use the official installer/upgrade path.
- [ ] **PR.5** Confirm no generated file or lockfile was changed unintentionally.
- [ ] **PR.6** Confirm no credentials, prompt secrets, private data or unapproved artifacts are committed.
- [ ] **PR.7** Run the exact relevant commands discovered in AI0.31.
- [ ] **PR.8** Attach test output, failure analysis and before/after behavior.
- [ ] **PR.9** Attach addon install/upgrade/idempotency/tenant test evidence when models changed.
- [ ] **PR.10** Attach authorization/security test evidence when tools, agents or API scopes changed.
- [ ] **PR.11** Attach recovery/cancellation/idempotency test evidence when jobs/runtime changed.
- [ ] **PR.12** Update this checklist and canonical source cards in the same change.
- [ ] **PR.13** Record the resulting commit SHA and CI run URLs after push (never invent them).
- [ ] **PR.14** Obtain required maintainer approval before promotion to `main`.

---

# 15. Mandatory release gates

Do not mark a phase “done” until all applicable gates are satisfied.

- [ ] **GATE.1 ORM:** all durable domain state is addon-declared; install, upgrade, idempotency and recovery tests pass.
- [ ] **GATE.2 Reuse:** no duplicate request, workflow, organization, knowledge, storage or job authority has been introduced.
- [ ] **GATE.3 Tenant:** cross-company read/write and relation enumeration tests fail closed.
- [ ] **GATE.4 Identity:** agents cannot inherit human superadmin or act outside explicit grants.
- [ ] **GATE.5 Provider:** local/cloud routing follows data classification; outages do not corrupt state.
- [ ] **GATE.6 Runtime:** jobs are bounded, cancellable, recoverable and protected against stale workers/duplicate effects.
- [ ] **GATE.7 Tools:** every tool call is authenticated, authorized, scoped, audited and rechecked at execution time.
- [ ] **GATE.8 Evidence:** accepted outputs have complete, valid, traceable evidence and independent verification where required.
- [ ] **GATE.9 Continuity:** ongoing obligations cannot silently disappear when a request closes.
- [ ] **GATE.10 Memory:** memory/skills are versioned, scoped, evaluated, revocable and do not grant authority.
- [ ] **GATE.11 Security:** defined adversarial suite has zero unauthorized actions; critical findings are resolved or release is blocked.
- [ ] **GATE.12 Operations:** backup/restore, runbook, alerts, cost controls and emergency stop are tested.
- [ ] **GATE.13 Evaluation:** results include baselines, failed runs, model/provider/commit metadata and reproducible measurements.
- [ ] **GATE.14 Claims:** release notes describe demonstrated capabilities only; no AGI claim is inferred from narrow benchmarks.

---

# 16. First executable milestone — recommended starting slice

Do **not** start by implementing CEO/CTO/department hierarchy. The first slice should prove the vertical path end-to-end with one bounded, read-only agent.

- [ ] **SLICE.1** Complete AI0 exact-SHA audit and reuse matrix.
- [ ] **SLICE.2** Approve AI1 ADR and register the tasks using the live repository convention.
- [ ] **SLICE.3** Add only the minimum ORM addon metadata needed to register one agent and one model/provider profile, if no equivalent model exists.
- [ ] **SLICE.4** Implement one local or mock provider adapter and one cloud adapter behind the same provider contract.
- [ ] **SLICE.5** Create one read-only request using the existing canonical request/work-item lifecycle.
- [ ] **SLICE.6** Dispatch one run through the existing Jobs Engine.
- [ ] **SLICE.7** Allow the agent to inspect only an explicitly selected repository/package scope.
- [ ] **SLICE.8** Produce one structured report with source paths/line references and limitations.
- [ ] **SLICE.9** Run an independent verifier against the required acceptance criteria.
- [ ] **SLICE.10** Store the accepted report through the existing storage/evidence conventions.
- [ ] **SLICE.11** Inject a worker crash and prove recovery or a known terminal failure state.
- [ ] **SLICE.12** Prove duplicate delivery cannot create duplicate accepted results/effects.
- [ ] **SLICE.13** Prove a revoked/wrong-company capability blocks access.
- [ ] **SLICE.14** Record cost, success, evidence completeness, recovery time and failed runs.
- [ ] **SLICE.15** Review whether the vertical slice demonstrates a real gap or suggests reuse/refactor before building additional abstractions.

**First milestone is complete only when:** one request → one durable job/run → one bounded agent → one evidence-backed result → one independent verification → one recovery test passes, with no ORM bypass and no duplicate domain authority.

---

# 17. Progress ledger

Update this section as work proceeds. Keep the latest commit SHA and test evidence in the relevant source card.

| Phase                          | Status      | Exit evidence                                    | Notes                       |
| ------------------------------ | ----------- | ------------------------------------------------ | --------------------------- |
| AI0 — Exact-SHA audit          | Not started | Source inventory, baseline report, reuse matrix  | Must precede implementation |
| AI1 — ADR and registration     | Not started | Approved ADR and canonical task IDs              | No schema before approval   |
| AI2 — ORM domain foundation    | Not started | Addon install/upgrade/security tests             | Addon-First only            |
| AI3 — Provider abstraction     | Not started | Local + cloud contract tests                     | Secrets external            |
| AI4 — First durable agent      | Not started | Bounded read-only task and recovery proof        | No swarm                    |
| AI5 — Tools and MCP            | Not started | Read-only conformance and authorization tests    | Write tools later           |
| AI6 — Proof-Carrying Work      | Not started | Independent verification and evidence            | No self-approval            |
| AI7 — AI Company               | Not started | Delegation/team tests and net-benefit evaluation | Adaptive, bounded staffing  |
| AI8 — Memory/learning          | Not started | Ablation, utility and harm tests                 | No live self-modification   |
| AI9 — Mission Control          | Not started | UI state backed by persisted/run data            | UI after contracts          |
| AI10 — Security/operations     | Not started | Adversarial, restore and runbook evidence        | Required for production     |
| AI11 — Generalization research | Not started | Reproducible cross-domain results                | No AGI overclaim            |

## Change log

| Date       | Change                                                                                                                                                                               | Commit / evidence                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 2026-11-22 | Initial granular AI Corporation checklist generated from the 2026-11-21 blueprint and documented repository baseline. Exact current `dev` SHA still requires Phase AI0 verification. | Documentation proposal; not yet merged |

---

## References and source-of-truth documents

- MoonWitness repository: <https://github.com/A-L-L-A-H/mw-xv>
- MoonWitness master roadmap (verify live path/branch): <https://github.com/A-L-L-A-H/mw-xv/blob/main/ROADMAP.md>
- AI Corporation Grand Plan: `AI-CORPORATION-GRAND-PLAN.md`
- AI Corporation Research Register: `AI-CORPORATION-RESEARCH-REGISTER.md`
- AI Corporation ADR Draft: `AI-CORPORATION-ADR-DRAFT.md`
- AI Corporation Implementation Plan: `AI-CORPORATION-IMPLEMENTATION-PLAN.md`

**Important:** This checklist is deliberately detailed, but its proposal IDs and the new workstream's placement must be reconciled with the current live roadmap/task ledger. Do not create parallel task-tracking sources or mark a phase complete without repository-backed evidence.
