---
name: plan-taskos
description: Plan and execute multi-step features as atomic micro-tasks with a local SQLite Cognitive Brain, DAG-Merkle proof-carrying completion, disjoint write-ownership guarantees, and multi-plane projections (`.plan/` Markdown, TaskOS v2, Docs, GitHub Issues, ORM, `/swarm`) — in MoonWitness or any external Git repository via `plan-taskos` CLI + stdio MCP.
---

# Plan-TaskOS: Cognitive WorkGraph OS

Use this skill when you need to: plan a multi-step feature as sharded waves of 1–5 file micro-tasks, execute those micro-tasks autonomously with per-task verification and cryptographic completion proofs, query a fast local Brain (2-hop knowledge graph, hybrid BM25 recall, episodic pitfalls), or fan out disjoint `/swarm` workers across a ready DAG frontier.

The `plan-taskos` CLI runs **offline in ANY Git repository** with zero external services — plans live as human-readable Markdown + JSON shards under `.plan/`, and the Cognitive Brain is a gitignored local SQLite database rebuilt deterministically from Git in `<150ms`.

## 1. When to Use

- **Planning:** decompose a feature, migration, audit, or refactor into atomic micro-tasks (1–3 owned files, 1–5 binary acceptance criteria, 1 verify command, 1 atomic commit each).
- **Executing:** run the Flash Autonomous Loop (§3) — claim next ready task, implement, verify, seal proof, commit — without ever holding more than one task's context.
- **Querying:** ask the Brain what to do next (`next`), why a file matters (`impact`), or what past failures touched these files (`recall`).
- **Orchestrating:** export disjoint worker briefs for parallel `/swarm` execution (`export-swarm`) with guaranteed non-overlapping `owner_files`.

## 2. Authoring Protocol (Plan Bundles)

A plan is a sharded bundle under `.plan/<plan-id>/`:

```
.plan/<plan-id>/
  manifest.json          # header, execution_policy, projections, wave registry
  ADR-NNN-<slug>.md      # immutable architectural decisions
  waves/W{n}-<slug>.json # structured 6-plane task IR (5–15 tasks per shard)
  specs/W{n}-<slug>.md   # rich fenced code specs keyed 1:1 by task code
  evidence/Txx.proof.json # runner-sealed proof envelopes (append-only)
.plan/<plan-id>.md       # projected Master Checklist + Progress Ledger
```

Scaffold a starter bundle that passes lint out of the box:

```bash
plan-taskos init my-feature --title "My Feature"
# or copy the minimal templates in this skill's templates/ directory:
#   templates/manifest.template.json  -> .plan/<plan-id>/manifest.json
#   templates/wave.template.json      -> .plan/<plan-id>/waves/W0.json
#   templates/adr.template.md         -> .plan/<plan-id>/ADR-001-<plan-id>.md
#   templates/spec.template.md        -> .plan/<plan-id>/specs/W0.md
```

Sizing rules: shard waves so each holds 5–15 micro-tasks (~4–8 KB per wave JSON); keep specs rich in the `.md` shards, keep structure strict in the `.json` shards; validate everything with `plan-taskos lint` (AJV schemas + 1:1 spec parity + Disjoint Write-Ownership Prover + cycle check + proof-chain check; exits 1 on any error).

## 3. Flash Autonomous Loop (5 Commands)

Run one micro-task per cycle, fully autonomously:

```
1. plan-taskos reindex                      # rebuild Brain from Git (<150ms)
2. plan-taskos next --claim                 # O(1) Micro-Brief for next ready task + TTL lease
3. (edit ONLY the task's owner_files)       # scope membrane blocks anything else
4. plan-taskos complete <task-id> --commit  # verify + scope check + seal proof + atomic commit
5. plan-taskos sync                         # project to .plan/*.md / TaskOS / docs / GitHub / ORM
```

Notes:
- `next --claim` acquires a SQLite `BEGIN IMMEDIATE` lease; stale leases are reaped automatically, so parallel agents never double-claim.
- `complete` verifies all acceptance criteria, scrubs secrets, fails closed if `git diff` touches files outside `owner_files`, and seals a DAG-Merkle proof referencing its predecessors' proof hashes (parallel-safe, no linear chain conflicts).
- Failed verification escalates model tier `flash -> neon -> argon` and trips to `blocked` after `max_attempts_per_task`; use `plan-taskos fail <id> --reason <m>` to record the episode, `block` to park it.
- After a burst of execution, run `plan-taskos sleep` for Non-REM episodic consolidation: decays stale episodes, clusters repeated pitfalls, and drafts constitutional invariant proposals (never auto-promoted — `automatedPromotionAllowed: false`).

## 4. Brain Queries

```bash
plan-taskos recall "why does the lease manager retry BEGIN IMMEDIATE"   # hybrid BM25 + optional Ollama recall
plan-taskos impact src/runner/lease-manager.ts                          # 2-hop blast radius
plan-taskos dag                                                          # wave stats, frontier, Boss Critical Path
```

## 5. Multi-Plane Projections & Orchestration

`plan-taskos sync [--target md|taskos|docs|github|orm] [--check]` runs the Split-Authority projection bus. Each plane owns disjoint fields and no-ops on unchanged content (normalized SHA-256 fencing):

- **Git plan bundle** owns specs, DAG, `owner_files`, verify commands, proofs.
- **`.plan/<id>.md`** is projected deterministically (Desktop-Observatory compatible).
- **TaskOS v2** (`docs/tasks/tasks.json`) rolls statuses/priorities up bijectively.
- **Docs** gets ADR/spec registry entries and `INV-006` doc-impact triggers when owner files touch routes/models/packages.
- **GitHub Issues** fold adaptively (`plan` = 1 master issue, `wave` default = one checklist issue per wave, `task` = 1:1 parity) inside managed fences; human notes are preserved verbatim.
- **ORM** maps Plan -> project, Wave -> milestone, Task -> task (URN in `external_ref`), AC -> 1:1 `ai.acceptance_criterion`.

For parallel swarms:

```bash
plan-taskos export-swarm [plan-id] --wave W1 --max-parallel 4
```

emits disjoint worker briefs (model tier per task risk) ready for a `/swarm` dispatcher.

## 6. MCP Server

Run the standalone stdio JSON-RPC MCP server (read-only by default):

```bash
plan-taskos mcp                # read tools only
plan-taskos mcp --allow-write  # enable controlled write tools
```

Read tools: `plan_list`, `plan_dag`, `plan_next`, `plan_recall`, `plan_impact`, `plan_graph`.
Write tools (require `--allow-write`): `plan_claim`, `plan_verify`, `plan_complete`, `plan_fail`, `plan_sync`.

Ready-to-paste client entry: see `mcp-manifest.json` next to this file.

## 7. Git Hygiene Invariants

- The Brain DB and lease mirrors are always gitignored: `.plan/.brain/` and `.plan/*/.leases.local.json` must never be committed.
- Every task lands as one atomic `git commit --only <owner-files>`; never `git add -A`, never push proof secrets (episodes and proofs pass through `redactSensitiveText`).
- On Windows PowerShell, chain commands with `; if ($?) { ... }` — never `&&`.
