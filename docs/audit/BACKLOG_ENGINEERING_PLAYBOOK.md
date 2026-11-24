# Backlog Engineering Playbook

Panduan untuk mengubah temuan audit dan inovasi menjadi task yang ringkas, distinct, evidence-linked, agent-ready, dan dependency-aware.

## 1. Two separate backlogs

Jangan mencampur dua portfolio:

### Execution backlog
Bug, security, reliability, debt, validated product changes, required foundations, and approved strategic decisions.

### Experiment backlog
Hypotheses, prototypes, research spikes, benchmarks, technical feasibility checks, and user/problem validation.

Experiment yang sukses dapat menghasilkan execution task. Experiment yang gagal harus menghasilkan keputusan stop/revise, bukan implementasi paksa.

## 2. Reconcile existing work before creating

Inventarisasi:
- GitHub Issues, PRs, Discussions, milestones, and project boards.
- Markdown/JSON/YAML task lists and roadmap.
- TODO/FIXME/HACK comments.
- Changelog, release notes, ADRs, test failures, and incomplete implementations.
- Existing automation or externally maintained work queues, if accessible.

Untuk setiap candidate, tentukan KEEP, UPDATE, MERGE, SPLIT, SUPERSEDE, CLOSE AS DONE, CLOSE AS DUPLICATE, atau CREATE NEW. Dalam read-only audit, ini hanya rekomendasi; jangan mengubah tracker.

Completion hanya boleh dinyatakan jika acceptance criteria dan implementasi telah diverifikasi. Jangan menutup task hanya karena code atau file tampak ada.

## 3. Anti-overlap protocol

Deduplicate pada empat dimensi:

### A. Outcome
Apakah dua task bertujuan menghasilkan outcome yang sama? Jika ya, merge atau tetapkan parent-child yang batasnya tidak tumpang tindih.

### B. Root cause
Apakah beberapa gejala berasal dari penyebab yang sama dan bisa diperbaiki oleh satu perubahan kohesif? Konsolidasikan. Jika penyebab atau solusi berbeda, pertahankan terpisah.

### C. Scope and ownership
Catat package, files, APIs, schemas, components, and owner/agent area. Shared files bukan bukti duplikasi. Tetapkan interface dan batas perubahan agar pekerjaan paralel tidak konflik.

### D. Validation
Apakah dua task memakai acceptance criteria/test yang sama dan dapat dianggap selesai oleh perubahan yang sama? Jika ya, cek apakah keduanya sebenarnya satu outcome.

Overlap matrix:
| Candidate A | Candidate B | Relation | Decision | Boundary/rationale |
|---|---|---|---|---|

Relations: DUPLICATE / OVERLAP / DEPENDENCY / SHARED AREA / CONFLICT RISK / NONE.

Jangan mengklaim tidak ada overlap hanya karena judul berbeda. Bandingkan problem, outcome, root cause, scope, and validation.

## 4. Task sizing

- XS: satu perubahan sangat kecil dan terisolasi.
- S: satu outcome sederhana pada satu area.
- M: beberapa file/komponen dalam satu outcome kohesif.
- L: lintas area atau beberapa outcome; pecah bila anak task dapat diverifikasi independen.
- XL: epic/inisiatif; bukan task implementasi agent tunggal.

Target XS–M untuk task coding agent jika pemecahan tidak menambah koordinasi sia-sia. Jangan membuat task mikro yang memerlukan banyak context switching atau task lintas modul yang kabur.

## 5. Required task contract

Setiap task harus memuat:

- ID: stable unique ID.
- Title: action-oriented, satu primary outcome.
- Portfolio: Execution / Experiment.
- Category: Bug / Security / Architecture / Data / API / Performance / Reliability / CI-CD / DX / UX / Product / Innovation / Documentation.
- Type: Fix / Refactor / Feature / Research / Prototype / Infrastructure / Documentation.
- Status: New / Existing / In Progress / Partially Done / Stale / Duplicate.
- Evidence status: Verified / Supported / Inferred / Hypothesis.
- Severity: Critical / High / Medium / Low, bila merupakan finding.
- Priority: P0 / P1 / P2 / P3.
- Problem: specific current condition or hypothesis.
- Evidence: exact paths, symbols, test/command results, issue/PR, source links.
- Root cause: established cause or UNKNOWN.
- Proposed solution: change or experiment.
- Scope: packages/files/APIs/schemas/workflows.
- Out of scope: explicit boundary.
- Acceptance criteria: observable and testable completion conditions.
- Validation: automated/manual command, test, benchmark, or evidence collection.
- Dependencies: stable task/decision IDs.
- Overlap notes: related tasks and boundary.
- Risk: Low / Medium / High with rationale.
- Effort: XS / S / M / L / XL with rationale.
- Expected impact: observable outcome; no fabricated metrics.
- References: sources used.
- Agent handoff: context needed, constraints, relevant commands, and files to inspect first, without prescribing unverified implementation internals.

Hypothesis tasks additionally need:
- Experiment question and hypothesis.
- Cheapest experiment.
- Success signal.
- Kill criteria.
- Evidence to capture.
- Decision after experiment.

## 6. Agent-ready task test

Task is ready only when another engineer or coding agent can understand:
1. Why this task exists.
2. What outcome is expected.
3. Where to begin inspecting.
4. What is in and out of scope.
5. What must not be changed.
6. How to prove completion.
7. Which dependencies must be respected.
8. Which neighboring tasks must not be duplicated.

Avoid requiring the agent to repeat the entire audit. Include the minimum relevant evidence and references. Do not over-specify an implementation before the responsible agent inspects the current code.

## 7. Dependencies and concurrency

Build a dependency graph:
- BLOCKS / BLOCKED BY for hard prerequisites.
- RELATES TO for non-blocking context.
- SHARED AREA for potential file conflicts.
- CONFLICT RISK for concurrent changes needing sequencing.

Identify:
- Critical path.
- Tasks safe to execute in parallel.
- Tasks requiring shared contracts first.
- Integration checkpoints.
- Tasks that must be sequential due to schema/API/architecture changes.

A common file does not automatically require serial work; define ownership and compatible boundaries. Do not parallelize changes that depend on an unagreed contract.

## 8. Priority models

### Execution scoring
Use 1–5 ratings:
- Impact.
- Urgency.
- Confidence.
- Effort, where higher means more costly.

A rough ranking aid is (Impact × Urgency × Confidence) ÷ Effort. It is not objective truth. Critical security, data-loss, or production reliability items can override the numeric score.

### Experiment scoring
Assess:
- Potential upside.
- Strategic fit.
- Differentiation.
- Leverage.
- Cost to learn.
- Reversibility.
- Current uncertainty.

Prefer high-information, low-cost experiments. Do not punish uncertainty without asking whether it can be resolved cheaply. Do not rank an unvalidated radical idea above a critical fix merely because upside sounds large.

## 9. Parent/child and epic rules

Create an epic only when there are multiple coherent deliverables or milestones. Child tasks must have independent acceptance criteria where possible. Define:
- Epic outcome and non-goals.
- Child task ownership and dependency.
- Shared contracts.
- Integration criteria.
- Completion definition.

Do not create artificial hierarchy for a group of unrelated tasks.

## 10. Stable IDs and tracker migration

Use stable IDs such as AUD-###, INN-###, DEC-###, EXP-###, and TASK-###. Before assigning new IDs, inspect existing conventions. Never recycle IDs. If GitHub Issues will be created later, preserve a mapping between local IDs and issue numbers.

## 11. Required outputs

1. Existing task source inventory.
2. Reconciliation decisions.
3. Execution backlog.
4. Experiment backlog.
5. Overlap matrix.
6. Dependency/concurrency graph.
7. Priority and horizon view.
8. Agent-ready top tasks.
9. Deferred/rejected tasks with reasons.
10. Task-to-finding/idea/decision traceability map.