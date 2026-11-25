# Repository Audit Playbook

Panduan untuk membangun pemahaman faktual tentang kondisi repository, system map, kualitas engineering, dan product reality.

## 1. Audit stance

Audit bukan pencarian kesalahan semata. Inventarisasi juga aset, keputusan yang benar, kemampuan reusable, dan bagian yang sebaiknya tidak disentuh. Jangan menganggap missing feature sebagai defect tanpa bukti kebutuhan.

## 2. Baseline protocol

Catat:

- Repository URL, visibility/access, default branch, branch/commit yang diperiksa, dan waktu pemeriksaan.
- Working tree state bila local clone tersedia.
- Bahasa, framework, runtime, package manager, database, build system, dan deployment target.
- Repository shape: monorepo, multi-package, service repository, library, desktop, mobile, atau lainnya.
- Entry points, executable surfaces, services, workers, scheduled jobs, CLI, APIs, UI clients, and extension points.
- Build/test/lint/typecheck/security scan commands yang tersedia.
- CI workflows, release process, deployment definitions, and environment assumptions.
- Dokumentasi utama, ADR, roadmap, open issues, PRs, task files, TODO/FIXME, and known limitations.

Jangan menjalankan semua script secara otomatis. Inspeksi script dan side effect dahulu. Catat command yang benar-benar dijalankan beserta hasilnya.

## 3. System map

Petakan pada tingkat yang cukup untuk menjelaskan sistem:

- Component map: module/package/service dan tanggung jawabnya.
- Dependency map: arah dependensi, shared libraries, external providers, dan coupling.
- Data flow: sumber data, transformasi, persistence, events, ownership, dan consumers.
- User/workflow map: aktor, trigger, langkah, state transitions, outputs, and failure paths.
- Trust boundary: identity, permissions, secrets, input surfaces, network boundaries, and privileged operations.
- Runtime/deployment map: process, containers, hosts, environments, queue, storage, and external services.
- Capability map: kemampuan yang sudah ada, tingkat kelengkapan, pemilik implementasi, dan capability yang dipakai bersama.

Tandai VERIFIED versus INFERRED pada diagram. Jangan menggambar komponen yang hanya diasumsikan.

## 4. Technical and product audit domains

Pilih area yang relevan. Untuk setiap domain tulis relevance, inspection status, evidence, findings, limitation, dan next check.

### A. Product and user workflows

Vision/use-case fit, target actors, onboarding, primary journeys, task success, friction, incomplete flows, accessibility, and product differentiation.

### B. Architecture and modularity

Boundaries, separation of concerns, cohesion/coupling, dependency direction, extensibility, abstraction cost, circular dependencies, shared state, and evolution paths.

### C. Code correctness and maintainability

Type safety, duplicate logic, dead code, partial implementation, error handling, resource lifecycle, concurrency, edge cases, complexity, and consistency.

### D. Data and persistence

Data model, ownership, integrity, constraints, indexing, query patterns, transactions, schema evolution, migration ordering, rollback, backup/restore, retention, privacy, and data-loss risks.

### E. API, protocol, and integration

Contracts, schema validation, auth, authorization, versioning, compatibility, idempotency, retries, timeouts, pagination, webhooks, event delivery, external failure modes, and SDK consistency.

### F. Security and supply chain

Threat surfaces, identity, permissions, secrets, session security, input/output validation, injection, dependency risk, transitive packages, provenance, CI token permissions, artifact integrity, container security, license obligations, and secure defaults.

### G. Performance and cost

Startup, build, runtime, latency, throughput, database/network bottlenecks, caching, backpressure, bundle size, memory/CPU, capacity, resource efficiency, and infrastructure costs. Require a baseline before quantitative performance claims.

### H. Reliability and operations

Timeouts, retries, recovery, graceful degradation, job/queue behavior, duplicate processing, health checks, logs, metrics, tracing, alerting, incident handling, rollback, runbooks, and operational ownership.

### I. Testing and quality

Unit, integration, contract, end-to-end, regression, security, performance, flaky tests, determinism, fixtures, critical path coverage, failure scenarios, and environment parity. Do not equate line coverage with test effectiveness.

### J. CI/CD and release

Reproducible builds, CI gates, caching, parallelism, secrets, permissions, artifact signing, deployment strategy, rollback, release versioning, changelog, compatibility, and contribution workflow.

### K. UI/client experience

Responsive behavior, semantic structure, keyboard navigation, accessibility, screen-reader behavior, loading/empty/error/offline states, localization, formatting, timezone, visual consistency, interaction feedback, and UX friction.

### L. Compatibility and portability

Supported OS/browser/runtime/architectures, environment drift, configuration reproducibility, upgrade/deprecation paths, vendor lock-in, portability, and migration options.

### M. Privacy, governance, and lifecycle

Sensitive data mapping, collection minimization, data retention/deletion, consent where relevant, auditability, access review, data export, account lifecycle, and regulatory constraints applicable to the domain. Do not make legal compliance claims without qualified evidence.

### N. Agent/developer readiness

Repo instructions, local setup reproducibility, task boundaries, stable contracts, test feedback loops, debugging, architecture discoverability, machine-readable metadata, agent permissions, and safe automation boundaries. Activate deeper analysis through DOMAIN_SPECIFIC_ADAPTERS.md.

## 5. Evidence protocol

For each finding:

- Finding ID and concise title.
- Evidence status: VERIFIED / SUPPORTED / INFERRED / HYPOTHESIS / UNKNOWN.
- Exact file path, line range, symbol, config key, command output, issue/PR reference, or source URL.
- Observed behavior versus expected behavior.
- User/system impact and severity.
- Root cause only if demonstrated; otherwise mark UNKNOWN.
- Reproduction or validation path.
- Scope and dependencies.
- Limitation and counter-evidence.

Use the smallest specific evidence range that supports a claim. A directory name or README statement alone does not prove runtime behavior. Distinguish absence in searched scope from absence throughout the entire system.

## 6. Coverage matrix

| Domain | Relevance | Status | Evidence | Findings | Limitation / Next Check |
| ------ | --------- | ------ | -------- | -------- | ----------------------- |

Statuses:

- CHECKED: meaningful inspection completed with evidence.
- PARTIAL: only a subset checked.
- NOT CHECKED: not inspected.
- BLOCKED: access/environment/tool prevented inspection.
- NOT APPLICABLE: demonstrably irrelevant, with reason.

Coverage should be weighted by importance, not simply by number of rows. Explain critical domains left PARTIAL/BLOCKED. Do not claim 100% coverage by counting NOT APPLICABLE rows as completed checks.

## 7. Strengths and assets register

Record capabilities worth preserving:

- Stable modules and contracts.
- Existing reusable infrastructure.
- Well-tested workflows.
- Strong automation and tooling.
- Differentiating product behavior.
- Good architectural boundaries.
- Community or ecosystem assets, if evidenced.

Avoid recommending replacement of a healthy component solely because another technology is fashionable.

## 8. Finding classification

Separate:

- Defect: current behavior violates a stated or necessary requirement.
- Risk: a plausible failure/security/operational exposure.
- Gap: a needed capability or requirement is not met.
- Opportunity: a possible new way to create value.
- Debt: a present engineering cost that slows change or increases risk.
- Strength: an asset or capability to preserve.
- Unknown: a material question lacking adequate evidence.

Severity and priority are separate. A high-severity finding may require urgent action; an opportunity may be strategically valuable without being urgent.

## 9. Audit report template

1. Repository baseline and limitations.
2. Product reality versus documented vision.
3. System and capability maps.
4. Coverage matrix.
5. Findings by domain.
6. Strengths and assets to preserve.
7. Risks and unresolved questions.
8. Evidence appendix.
9. Recommended next inspections.

Keep finding IDs stable so research, decisions, and backlog can reference them without duplicating their descriptions.
