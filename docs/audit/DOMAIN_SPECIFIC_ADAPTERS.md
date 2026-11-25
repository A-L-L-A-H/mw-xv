# Domain-Specific Audit and Innovation Adapters

Aktifkan hanya adapter yang relevan berdasarkan bukti repository. Beberapa adapter dapat dipakai bersamaan. Jangan memaksakan seluruh checklist ke sistem yang tidak memiliki karakteristik tersebut.

## 1. Universal adapter selection

Sebelum audit:

1. Identifikasi archetype utama dan secondary archetype.
2. Jelaskan bukti yang mengaktifkan adapter.
3. Tandai dimensi yang tidak relevan.
4. Ambil hanya pemeriksaan dan discovery lenses yang menambah nilai.
5. Jangan menyimpulkan domain dari nama project saja.

## 2. AI, LLM, and agent platforms

Audit:

- Model/provider abstraction, routing, fallback, quotas, token/cost accounting, and provider-specific behavior.
- Prompt/version management, context assembly, tool/function contracts, and structured output validation.
- Agent orchestration, state, memory, checkpoints, retries, cancellation, and human approval.
- Sandboxing, least privilege, secret isolation, tool permissions, network/file access, and prompt-injection boundaries.
- Evaluation datasets, regression tests, traceability, observability, latency, quality/cost trade-offs, and reproducibility.
- Data privacy, retention, user consent, and provider data handling where applicable.

Innovation lenses:

- Capability/tool discovery, interoperable agent protocols, durable workflows, constrained autonomy, eval-driven development, agent collaboration, and human-agent handoff.

Reject claims of agent reliability or autonomy without evaluated tasks, failure cases, and clear permission boundaries.

## 3. SaaS and multi-tenant platforms

Audit:

- Tenant isolation in data, cache, storage, logs, jobs, and authorization.
- Tenant lifecycle, provisioning, suspension, deletion, export, and data residency.
- Roles/permissions, audit trail, quotas, rate limits, billing metering, and plan enforcement if present.
- Operational blast radius, migrations across tenants, feature flags, and support workflows.
- Tenant-aware observability and cost attribution.

Innovation lenses:

- Self-service workflows, composable integrations, policy-as-code, tenant automation, usage insights, and safe extension ecosystems.

Do not assume a SaaS business model if the repository does not support that conclusion.

## 4. Desktop and offline-first applications

Audit:

- OS integration, installers/updaters, signing, sandboxing, filesystem permissions, and auto-update safety.
- Local persistence, schema migrations, backup, recovery, and user data portability.
- Offline behavior, sync engine, conflict resolution, idempotency, retry, and merge semantics.
- Main/renderer or process boundaries, IPC contracts, lifecycle, crash recovery, and resource use.
- Deep links, accessibility, keyboard behavior, packaging, and cross-platform consistency.

Innovation lenses:

- Local-first data ownership, resilient offline workflows, sync-aware collaboration, automation hooks, and native capabilities.

Do not label a product offline-first merely because some screens load without a network.

## 5. Developer tools, CLI, and infrastructure

Audit:

- Installation, discoverability, command ergonomics, shell completion, configuration precedence, and diagnostics.
- Reproducibility, plugin/extension contracts, environment isolation, secrets, permissions, and rollback.
- API stability, versioning, automation compatibility, scripting, and machine-readable output.
- CI/CD integration, telemetry/privacy, logs, error messages, and migration paths.

Innovation lenses:

- Workflow composition, declarative configuration, self-diagnostics, policy checks, portable environments, and agent-friendly command contracts.

## 6. Realtime and distributed systems

Audit:

- Event ordering, delivery guarantees, duplication, idempotency, replay, and backpressure.
- Consistency model, partition behavior, leader/failover, clock assumptions, and synchronization.
- Connection lifecycle, reconnect behavior, presence, fanout, scaling, and resource limits.
- Observability of distributed traces and failure recovery.

Innovation lenses:

- Event-sourced projections, edge processing, resilient synchronization, adaptive quality, and topology-aware orchestration.

Do not introduce distributed complexity unless consistency, scale, availability, or deployment needs justify it.

## 7. Data-intensive and analytics systems

Audit:

- Data lineage, schema evolution, validation, quality checks, retention, privacy, and access controls.
- Batch/stream pipelines, orchestration, retries, deduplication, late/out-of-order data, and backfills.
- Partitioning, indexing, query performance, storage cost, and reproducibility.
- Metric definitions, semantic consistency, and source-of-truth ownership.

Innovation lenses:

- Data contracts, lineage-aware automation, self-service analysis, anomaly detection, and reversible transformations.

Do not claim data quality or model accuracy without representative evaluation.

## 8. Mobile and embedded systems

Audit:

- Platform lifecycle, permissions, signing, packaging, upgrades, and compatibility.
- Device resource limits, battery/power, storage, connectivity, and hardware variation.
- Secure local storage, identity, data synchronization, crash handling, and telemetry constraints.
- Accessibility, platform conventions, and release-store requirements where relevant.

Innovation lenses:

- Edge processing, context-aware interaction, low-connectivity operation, and hardware-assisted workflows.

## 9. Security-critical or regulated domains

Activate when repository purpose or data types warrant it:

- Threat model, trust boundaries, secure development lifecycle, identity proofing, audit logs, retention, incident handling, and dependency provenance.
- Applicable standards/regulations and their official sources, version, and scope.
- Data minimization, access review, recovery, and change evidence.

Never claim legal or standards compliance merely from a checklist. Distinguish technical observation from legal interpretation; identify need for qualified review.

## 10. Agent-native engineering readiness

This adapter can apply to almost any repository using coding agents.

Evaluate:

- Clear repository instructions and precedence rules.
- Architecture discoverability and source-of-truth documentation.
- Small, verifiable tasks with stable contracts and explicit non-goals.
- Fast deterministic test/lint/typecheck feedback.
- Build/test commands that agents can safely run.
- Machine-readable errors, logs, schemas, and diagnostics.
- Test fixtures and examples that reduce context gathering.
- Tool permissions, sandboxing, secret protection, branch/commit controls, and human approval.
- Evaluation of agent-produced changes, regression detection, and traceability.
- Parallel task boundaries and integration contracts.

Look for leverage points: better contracts, test feedback, and task context can improve many agent runs without adding another agent framework.

## 11. Adapter output

For every activated adapter:

- Why it applies and evidence.
- High-risk areas checked.
- Relevant coverage results.
- Distinct findings not already captured by universal audit.
- Adapter-specific innovation hypotheses.
- Validation needs and limitations.

Avoid duplicating universal findings. Cross-reference their IDs instead.
