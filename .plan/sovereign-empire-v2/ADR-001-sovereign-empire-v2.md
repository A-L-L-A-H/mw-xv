# ADR-001 — Sovereign Empire v2

- **Status:** Accepted
- **Date:** 2026-11-27
- **Plan Tracker:** `.plan/sovereign-empire-v2.md`

---

## 1. Context & Problem Statement

The MoonWitness platform requires a cohesive multi-repo sovereign architecture spanning authentication, ISP radius & billing dunning, cloud PaaS deployment, business operations cockpit, epistemic knowledge engines, and field mobile operations without cross-monolith entanglement.

## 2. Decision Drivers

- **Micro-Task Atomicity:** every micro-task owns 1–3 files, 1–5 binary acceptance criteria, 1 verify command, and lands as exactly one atomic commit.
- **Disjoint Write-Ownership:** agents operate across independent working sets with zero lock conflicts.
- **Determinism:** all contracts must be statically checkable via TypeScript or validated via unit tests.

## 3. Architectural Decisions

### Decision 1 — Multi-Repo Sovereign Fleet Boundary

- **Chosen:** Split repositories strictly along deployment and change boundaries: `mw-xv` (ORM/backend), `mw-isp` (ISP RADIUS daemon), `mw-cp` (Control plane), `mw-pocket` (mobile ops), and `mw-rocksoul-*` (epistemic agent runtime).
- **Rejected:** Monolithic colocation of mobile apps and agent sandboxes inside `mw-xv`.
- **Consequence:** Clean contracts, zero unwanted coupling, and modular release cadences.

## 4. Repository Gate Invariants

| Gate | Command / Check | Requirement |
|---|---|---|
| Schema & Ownership | `bun run plan:lint` | Zero validation errors, ownership conflicts, or cycles. |
| Test Suite | `vitest run` | All tests pass before any task may complete. |
