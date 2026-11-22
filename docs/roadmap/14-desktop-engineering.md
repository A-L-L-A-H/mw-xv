# M13 — Desktop Engineering & ROCKSOUL FLOW

Status: **activated 2026-11-22** as a separate, maintainer-authorized engineering workstream. This workstream does not change the first-stable-release blockers or authorize application deployment.

M13 extends the existing MoonWitness Desktop local-first harness. It does not create a second desktop shell, agent runner, ORM, task authority, AI runtime, memory store, or design system.

## M13.01 — ROCKSOUL FLOW capability audit and first vertical-slice selection

- **Status:** complete (2026-11-22; audit deliverables and evidence verified on `dev` base `f3abe0937894b1fd309f675bd7bd86a15ee46e70`; no feature code implemented in M13.01)
- **Prerequisites:** M12.05, M12.06, M12.07, M12.11, M12.13; Desktop architecture baseline ADR 0008 is accepted.
- **Granular activation item:** DSK-0.12 in [the Desktop engineering ledger](../../todo-desktop.md).
- **Source reference:** [bjo163/rocksouldx](https://github.com/bjo163/rocksouldx), catalogued as `ADAPT` in the [source migration matrix](../migration/SOURCE-MIGRATION-MATRIX.md). The matrix's `3157a62...` value is a README blob SHA, **not** a repository commit SHA; resolve and record the actual source commit before relying on any source file.
- **Deliverables:** `docs/architecture/rock-soul-flow-reuse-map.md` and `docs/roadmap/evidence/M13.01.md`.
- **Codex handoff:** [ROCKSOUL FLOW — local Codex instructions](rock-soul-flow-codex-handoff.md).

### Goal

Establish an exact-source, evidence-backed map of ROCKSOUL FLOW ideas against the current target implementation and select one smallest, genuinely missing vertical slice for a later implementation card.

### Capability areas to inspect

| ROCKSOUL FLOW area | Existing target owners to inspect first                                                                                 | Audit question                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Repo Radar         | `apps/desktop`, `packages/ai-runtime` (including repository inspection), isolated worktree and file-inspector contracts | Which repository facts are already indexed/read safely, and what is still missing?              |
| Overlap Detector   | `packages/ai-runtime`, `packages/ai-evaluation`, repository inspection and existing tests                               | Is there a deterministic duplicate/overlap signal, or only an unverified proposal?              |
| Plan Forge         | `packages/ai-runtime` workforce planner, `packages/orm-ai`, `packages/orm-project`, `packages/orm-workflow`             | Can a plan be represented by existing work contracts and project/workflow records?              |
| Prompt Forge       | AI runtime prompt/skill contracts, evaluation fixtures and documentation                                                | Is there a real versioning or review gap without creating another prompt registry?              |
| Task Deck          | `packages/orm-project`, `packages/orm-workflow`, `packages/jobs`, existing Board/AI views and Desktop bridge            | Can existing task/work-contract projections serve the experience?                               |
| Proof Gate         | PCW verifier, evidence artifact manifests, independent-review workflow and Desktop risk gate                            | Which proof checks are already authoritative, and what evidence remains absent?                 |
| Memory Ledger      | `packages/orm-ai` memory candidates/skill versions, memory evaluation and revocation rules                              | What is already canonical, and which memory states must remain candidate-only?                  |
| Visual DNA Lab     | `packages/assets`, `packages/ui`, UI Catalog and existing visual-review workflows                                       | Can artwork-first assets and current UI contracts cover the idea without a new rendering stack? |

This table is an inspection guide, not a claim that any listed capability is complete. Verify exact implementation files, public exports, callers and tests on the candidate SHA.

### Execution steps

1. Inspect the target checkout's exact `dev` SHA, clean/dirty state, applicable `AGENTS.md` files, package scripts and current roadmap status.
2. Read ADR 0008, the Desktop architecture, ADR 0007, the AI runtime/PCW contracts, `todo-desktop.md`, and the ROCKSOUL migration disposition.
3. Inspect the legacy ROCKSOUL FLOW source read-only. Record the exact source repository, branch, commit SHA, relevant paths and applicable licenses/notices. Do not mistake a README blob SHA for a commit SHA.
4. For each capability, record: requirement, target owner, exact source paths, caller/API, tests, status (`implemented`, `partial`, `missing`, or `blocked`), duplicate-authority risk, security/risk boundary, and evidence gap.
5. Recommend exactly one smallest next vertical slice with bounded files, acceptance criteria, dependencies, tests and rollback considerations. Do not implement that slice in M13.01; it becomes a separately reviewed M13.02 (or later) card after the audit.
6. Write the reuse map and evidence report. Keep unresolved rights, license or source-provenance findings explicit.

### Acceptance criteria

- All eight capability areas above have source-backed findings; no status is inferred from a directory name or README alone.
- Findings cite exact target file paths and tests, plus the exact legacy source commit/path where relevant.
- Existing owners and zero-overlap boundaries are explicit. A new package, addon, ORM model, agent runner or persistent registry is not proposed without a demonstrated responsibility gap.
- The selected vertical slice is genuinely missing or materially incomplete, testable in isolation, and does not depend on an unapproved legacy code import.
- The recommended slice preserves capability grants, tenant isolation, risk tiers, human approval, PCW evidence and independent acceptance wherever applicable.
- The handoff and evidence identify all unverified assumptions and skipped checks. No application test is claimed as passed unless it was run on the exact source.
- No legacy repositories are archived/deleted, no private or personal data is imported, and no application deployment or promotion to `main` occurs.

### Verification

For this documentation/audit-only task, run the narrow repository checks that are available in the checkout: roadmap task validation, roadmap/automation consistency, documentation links, formatting for changed files and `git diff --check`. Run package or application tests only if the audit uncovers an actual code change (which is outside M13.01).

M13.01 remains open until the reuse map and evidence file exist and all acceptance criteria are verified.
