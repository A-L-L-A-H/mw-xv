# ADR 0006 — Mandatory Addon-First Architecture & Thin `apps/api`

- **Status:** Accepted (2026-11-21)
- **Scope:** `@moonwitness/orm`, workspace addon packages (`packages/orm-*`, `packages/auth`, `packages/jobs`), and `apps/api`

## Context

MoonWitness uses a declarative ORM addon system (`defineModel`, `defineAddon`, `installAddons`) with topological dependency ordering, transactional advisory-locked DDL synchronization, chained semver upgrades, and addon conformance testing (`scripts/roadmap/addon-conformance.test.mjs`).

Without a hard architectural boundary, domain models, manifests, and feature routes accumulate directly inside `apps/api/src/`, causing:

- Bloated `apps/api/src/app.ts` bootstrap wiring and tangled route/model dependencies.
- Bypassed addon conformance tests, inconsistent indexing/constraints, and harder reuse across workers/CLIs/tests.
- Generic CRUD leaks when newly added domain models are forgotten in manual denylists.

## Decision

1. **Mandatory workspace addons for all new domain models and manifests:**
   - Every new ORM model (`defineModel` / `BaseModel`) and every new addon manifest (`defineAddon`) MUST be authored inside a workspace addon package under `packages/*` (`packages/orm-*`, `packages/auth`, `packages/jobs`) and covered by `scripts/roadmap/addon-conformance.test.mjs`.
   - `apps/api/src/whatsapp/models.ts` and `apps/api/src/whatsapp/manifest.ts` are frozen as the sole legacy allowlist pending extraction to `packages/orm-whatsapp`.
2. **Ultra-thin `apps/api/src/app.ts` via declarative addon registry:**
   - `apps/api/src/app.ts` owns only Fastify bootstrap, security middleware, observability, error handling, and delegation to `apps/api/src/addons/registry.ts` (`installApiAddons`, `registerApiAddonRoutes`).
   - Direct `./routes/*` imports inside `apps/api/src/app.ts` are forbidden.
3. **Prefix-level default-deny for sensitive addon namespaces:**
   - All `knowledge.*` models are blocked at prefix level in `apps/api/src/auth/policy.ts` (`INTERNAL_PREFIXES`) so newly added knowledge models can never leak through generic `/api/:model` or JSON-RPC routes.
4. **Automated enforcement:**
   - Enforced locally (`pnpm api:addon:check` and `.githooks/pre-push`) and in CI (`.github/workflows/ci.yml`) via `scripts/check-api-addon-boundary.mjs`.

## Consequences

- `apps/api` remains a thin, auditable HTTP/lifecycle host.
- All workers, CLIs, integration tests, and API routes share one canonical set of versioned workspace addons with chained upgrades and automatic multi-tenant composite indexes.
