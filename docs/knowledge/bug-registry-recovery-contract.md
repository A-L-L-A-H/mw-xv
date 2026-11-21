# 33-BUG registry recovery and alias conflict contract

- Related task: `K5-006`
- Governing legacy boundary: [`docs/roadmap/evidence/K0-006.md`](../roadmap/evidence/K0-006.md)
- Contract schema: [`packages/research/src/bug-registry.schema.json`](../../packages/research/src/bug-registry.schema.json)
- Runtime implementation: [`packages/research/src/bug-registry.ts`](../../packages/research/src/bug-registry.ts)

## Scope and K0-006 no-legacy-import boundary

Under the owner-approved `K0-006` disposition (`legacy-moonwitness-and-bug-registry` in [`docs/knowledge/legacy-source-inventory.json`](legacy-source-inventory.json)), historical real-world 33-BUG source files are **not** imported into this rebuild. Accordingly, the K5-006 contract operates strictly on `fixture_classification: "synthetic"` and `legacy_import_authorized: false`. Any future real-world 33-BUG source import requires reopening `K0-006` with source-specific rights, privacy, and ID-mapping clearance.

## Core invariants

1. **33 planned slots only (no fabricated cases or fixes)**:
   - Program slots are bounded to `1..33` (`mw:bug-program:slot-001` through `mw:bug-program:slot-033`).
   - Missing slots are reported explicitly in `missing_slots`; `planned_slot` entries cannot carry fabricated `case_id`, `submission_id`, or `story_id` values or claim `human_approved` / `verified_fix` status.
   - Claiming `verified_fix` requires `human_approved` status, an `action_owner_id`, a distinct `verification_reviewer_id`, and a `verification_evidence_ref`. `religious_approval_claimed` is fixed to `false`.
2. **Namespace separation**:
   - `program_id` (`mw:bug-program:slot-*`), `case_id` (`mw:bug-case:*`), `submission_id` (`mw:bug-submission:*`), and `story_id` (`mw:story:*`) are strictly separated and cannot be shared across distinct program slots.
3. **Deterministic alias conflict states (`unresolved`, `confirmed_alias`, `distinct`)**:
   - Colliding titles or legacy codes without a human decision remain `unresolved`.
   - Contradictory decisions remain `unresolved`.
   - `confirmed_alias` is permitted only for a single `canonical_target_program_id` and preserves explicit `redirect_history`; attempting to merge two distinct program slots via `confirmed_alias` or shared case/submission/story IDs fails closed (`SILENT_MERGE_FORBIDDEN`).
   - `distinct` records an explicit human decision keeping colliding labels separate across distinct program slots.
4. **Child-safety gate (`#013`)**:
   - Slot `13` requires `child_safety_gate: "child_sensitive_protected"`.
