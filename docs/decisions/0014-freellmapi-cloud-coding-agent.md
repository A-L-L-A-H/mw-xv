# ADR 0014: Bounded Cloud Coding Agent with Vendored FreeLLMAPI

- **Status:** Accepted (2026-11-24; approved MoonWitness cloud coding-agent plan)
- **Date:** 2026-11-24
- **Decision owners:** MoonWitness maintainers
- **Amends:** [ADR 0007](0007-ai-corporation-addon-first-architecture.md), principally D5 and the read-only v1 boundary
- **Scope:** `vendor/freellmapi`, `packages/orm-ai`, `packages/ai-runtime`, `packages/jobs`, `packages/orm-workflow`, `packages/orm-storage`, `apps/api`, `apps/board`, `apps/agent-sandbox`, production Compose

## Context

ADR 0007 established one bounded, read-only agent before any swarm. The approved cloud coding-agent plan now requires a single vertical slice that can edit a curated repository snapshot, run checks, and produce reviewable evidence. That write capability exceeds ADR 0007's initial boundary, while model inference must use the vendored FreeLLMAPI gateway without creating a second business authority or exposing the gateway publicly.

## Alternatives Considered

1. **Call a separately managed, mutable FreeLLMAPI installation.** This preserves a quick migration path but leaves provenance, image contents, credentials, and upgrades outside reproducible repository control.
2. **Execute edits directly in the API/worker or reuse the Desktop process-local sidecar.** This avoids a new service but grants model-driven effects host process, filesystem, and credential access.
3. **Vendor a pinned gateway and execute typed operations in an isolated sandbox.** This adds deployment and evidence overhead, but makes provenance reviewable and keeps inference, durable authority, and execution isolation separate.

## Decision

1. **One bounded write-capable agent replaces only the read-only v1 limit.** ADR 0007's addon-first architecture remains in force. `@moonwitness/orm`/`@moonwitness/orm-ai`, `@moonwitness/jobs`, `@moonwitness/orm-workflow`, and `@moonwitness/orm-storage` remain the sole MoonWitness ORM, queue, approval, and artifact authorities. No second ORM, queue, workflow engine, agent UI, or package-manager workspace is introduced.
2. **Authority remains ordinary and single-company.** Agents never use `system` or `superadmin` identities, cannot modify policy/grants, and require current company scope, contract, grant, policy version, quota, and job lease/fencing checks before every effect.
3. **FreeLLMAPI is vendored, not followed as a moving dependency.** `vendor/freellmapi` is pinned to upstream `https://github.com/tashfeenahmed/freellmapi` revision `cd65d6485788dfc7828f06c1147cdea207b28322`, with its MIT license, copyright notices, and `UPSTREAM.json` preserved. It is excluded from the pnpm workspace and root application Docker context. Updates require a newly reviewed snapshot and replayed local patches. Nested Git metadata, runtime environment files, SQLite/WAL/SHM state, sessions, credentials, dependencies, and build output are forbidden; `client/src/data` remains legitimate source.
4. **The gateway owns only provider-local state.** Its encrypted SQLite database, provider credentials, dashboard state, and unified inference key live in the named `moonwitness-freellmapi-data` volume at `/app/server/data`; they are not MoonWitness business state. MoonWitness stores only secret references, never raw keys.
5. **Private hosting is still cloud egress.** `freellmapi` is always classified as cloud egress, regardless of its private Compose address. `local_only` and `restricted` data never reaches it or the coding sandbox. Board receives no inference URL credential, encryption key, or `MW_AI_*` value and performs no ORM, AI-runtime, Docker, filesystem, or child-process work.
6. **R3 requires durable human approval before dispatch.** Cloud-egress execution creates an R3 approval bound to the exact immutable execution fingerprint. A different active human reviewer must approve the current, unexpired, unrevoked revision; approval is single-use and atomically gates enqueueing. R4 tools are always denied.
7. **Tools are typed, allowlisted, and isolated.** Model output is untrusted data, never a shell command, Docker parameter, path, or database mutation. Initial writes use structured patches, fixed check templates, bounded reads/diffs, local commits, and rollback through an authenticated `agent-sandbox`. Production requires rootless Docker or microVM isolation, no network, read-only root, a dedicated per-run workspace, dropped capabilities, no host secrets, no Docker socket, and no host repository bind mount. Write tools stay disabled until adversarial isolation tests pass.
8. **Acceptance is deterministic and evidence-based.** Applicable tests, typecheck, lint, and schema checks record exit codes and bounded logs in a PCW evidence bundle stored through `@moonwitness/orm-storage`. Model self-reported completion is not acceptance; failed or cancelled runs discard their worktree.
9. **No autonomous publication or deployment.** Local commits and accepted diffs remain artifacts. There is no automatic merge, push, deployment, self-update, or live policy/grant self-modification; any publishing flow requires a separate approval and decision.
10. **Production exposure is internal-only.** Neither `freellmapi` nor `agent-sandbox` publishes a production port. Temporary gateway testing may use a separate localhost-only override, never the production entrypoint. Caddy remains untouched.
11. **The boundary is executable.** `scripts/check-cloud-agent-invariants.mjs` fails on provenance/license drift, forbidden vendored runtime data, workspace/Docker-context leakage, unsafe Compose exposure or mounts, Board boundary violations, missing FreeLLMAPI cloud-egress classification, or the retired hard-coded cloud-adapter fallback. Its `node:test` suite uses temporary positive and negative fixtures.

## Consequences

- The vertical slice can perform reviewed coding work without weakening ADR 0007's tenant, authority, durability, or evidence boundaries.
- A pinned in-repository gateway and a real sandbox increase build, migration, verification, and operational cost.
- Gateway data migration must preserve the existing encryption key and retain the old installation as rollback until acceptance succeeds.
- Any broader agent swarm, A2A delegation, host execution, or autonomous publishing requires another explicit decision rather than an implicit expansion of this amendment.
