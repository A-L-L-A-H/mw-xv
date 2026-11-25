# ADR-001 — My Plan

- **Status:** Accepted
- **Date:** 1970-01-01
- **Plan Tracker:** `.plan/my-plan.md`

---

## 1. Context & Problem Statement

Describe the exact failure mode, architectural bottleneck, or product need that
motivates this plan. Reference the current behavior and why it no longer holds.

## 2. Decision Drivers

- **Micro-Task Atomicity:** every micro-task owns 1–3 files, 1–5 binary acceptance
  criteria, 1 verify command, and lands as exactly one atomic commit.
- **Zero-Coupling:** list the module boundaries this plan must not cross.
- **Determinism:** every guarantee must be statically checkable or unit-tested.

## 3. Architectural Decisions

### Decision 1 — <Short Name>

- **Chosen:** what was decided, concretely.
- **Rejected:** the main alternative and why it loses (latency, complexity,
  dependency weight, determinism).
- **Consequence:** what becomes true, and what trade-off is accepted.

## 4. Repository Gate Invariants

| Gate | Command / Check | Requirement |
|---|---|---|
| Schema & Ownership | `plan-taskos lint` | Zero validation errors, ownership conflicts, or cycles. |
| Tests | `<your test command>` | All tests pass 100% before any task may complete. |
