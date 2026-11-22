---
name: hybrid-swarm-dag
description: Orchestrate zero-waste multi-agent /swarm DAG execution using hybrid model routing (gemini-4-neon-low, gemini-4-argon-low, gemini-3.8-flash-low), strict disjoint file ownership, diff-scoped preflight, and atomic git commit --only landing.
---

# Hybrid Swarm DAG Orchestration

Use this skill to decompose multi-package features, audits, and verification passes into a conflict-free Directed Acyclic Graph (DAG) on the shared `/swarm` message board.

## 1. Hybrid Model Routing & Quota Auto-Balancer (`INV-008`)

Distribute swarm workers across distinct quota pools based on cognitive complexity and live pool availability:

| Tier                                   | Model                  | Target Allocation       | Responsibilities                                                                                                                                                         |
| -------------------------------------- | ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Parallel Feature Workers**           | `gemini-4-neon-low`    | ~85% of workers         | Parallel implementation slices, UI components, route handlers, unit tests, and script tooling with bounded file ownership.                                               |
| **Deep Architecture & Quota Failover** | `gemini-4-argon-low`   | Separate quota pool     | Complex `@moonwitness/orm-*` schema/migration design, cross-package architecture, and automatic failover when any primary model pool drops below `<25%` remaining quota. |
| **Monitor & Lightweight Checks**       | `gemini-3.8-flash-low` | 1 monitor / fast checks | Deadlock detection (`swarm_monitor`), board health checks, and fast read-only status probes.                                                                             |

- **Quota Rebalancing**: When a worker receives a `[quota]` warning or a pool drops below `<25%`, switch waiting workers in place via `swarm{action:"model", name, model:"gemini-4-argon-low"}` rather than killing and respawning.

## 2. Strict Disjoint File Sharding

Two agents editing the same file is the primary swarm failure mode. Enforce pairwise-disjoint ownership in every worker brief:

1. **Explicit File Manifest**: Every `swarm{action:"add"}` brief must list the exact files or directories the worker owns and the directories it must not touch.
2. **Shared Root Files**: Root `package.json`, `README.md`, `docs/guide/reference/*`, and `docs/architecture/diagrams/*` are owned by a designated foundations/verifier agent or updated in the final single-pass sync (`INV-010`).
3. **Workspace Mode**:
   - Use `workspace: "inherit"` when workers operate on strictly disjoint file paths in the main working tree.
   - Use `workspace: "share"` only when parallel workers must run conflicting full-tree builds concurrently, and merge their work before calling `kill`.

## 3. DAG Execution & Fast Preflight (`INV-010`)

Structure work into staged DAG waves:

- **Wave 1 (Foundations & Contracts)**: Land shared types, ORM addon manifests (`packages/orm-*`), and invariant gate scripts (`scripts/*`).
- **Wave 2 (Parallel Feature Slices)**: Fan out independent workers across API routes, board UI, desktop sidecar, and evaluation suites.
  - Workers verify their own slice using targeted `node --test` suites and `node scripts/preflight-fast.mjs --json`.
  - Workers do **not** run full `pnpm docs:generate` or `pnpm architecture:generate` mid-wave.
- **Wave 3 (Single-Pass Sync & Verification)**:
  - Once parallel workers post `@verifier [done]`, the verifier runs `node scripts/preflight-fast.mjs --sync`, `node scripts/orm-codegen.mjs --check --json`, and `node scripts/ai-drift-watchdog.mjs --json`.
  - Retire completed helpers via `swarm{action:"kill", name}` after their files are verified on disk.

## 4. Shell & Commit Hygiene (`INV-001`)

- **Windows PowerShell Chaining**: Always chain commands with `; if ($?) { ... }`. Never use Bash `&&`.
- **Atomic Path-Scoped Commits**: Stage and commit each logical slice using explicit file paths:
  ```powershell
  git add <owned-files> ; if ($?) { git commit -m "feat(scope): summary" --only <owned-files> }
  ```
- **Signal Protocol**: Start final completion messages with `[done]` immediately after the target `@mention` (e.g., `@verifier [done] slice summary and JSON gate output`) and call `swarm_wait` in the same turn.
