# MoonWitness — Master Engineering Transformation TODO

> Canonical root engineering checklist for transforming the MoonWitness monorepo (`@moonwitness/*`) into a unified, metadata-driven, Odoo-inspired application platform. Grounded in direct source-code audit of `apps/*`, `packages/*`, `scripts/*`, `.github/workflows/*`, and existing planning/ADR artifacts.

---

## 00 — Project Overview

### Transformation Objective

Unify MoonWitness's existing Fastify 5 backend (`apps/api`), Objection/Knex programmatic ORM (`packages/orm`), 11 addon packages (`packages/orm-*`, `packages/auth`, `packages/jobs`), typed client (`packages/client`), design system (`packages/ui`, `packages/assets`), and Next.js App Router frontend (`apps/board`) into a coherent, declarative, metadata-driven application platform modeled on Odoo's core strengths—without introducing separate SQL migration-script frameworks or duplicate engines.

### Target Architecture Summary

- **Core Runtime (`@moonwitness/orm` + `apps/api`):** Single deterministic bootstrap separating in-memory metadata registration (`registerAddons`) from transactional DDL/seed synchronization (`installAddons`), shared across HTTP servers and background workers (`jobs-worker`, `jobs-scheduler`, `outbox-worker`).
- **ORM & Schema Engine (`@moonwitness/orm`):** Canonical `Registry` + `Environment` + `Recordset` + `defineModel` + `extendModel`, computed/stored fields, `onchange`/`default_get` hooks, constraint validation, dotted relational domains, and automatic PostgreSQL/SQLite schema diffing & synchronization.
- **Native Addon Engine (`@moonwitness/orm` + `packages/orm-*`):** Self-contained workspace addons owning models, extensions, views, menus, actions, permissions, seeds, and Fastify `httpPlugins`, with install/enable/disable/upgrade/uninstall lifecycles and `ir.feature_flag` integration.
- **Model–View, Widget, Action, Menu & Domain Engines:** Inheritance-capable multi-view definitions (`list`, `form`, `search`, `kanban`, `calendar`, `graph`, `pivot`), declarative field widgets (`Many2one`, `One2many`, `Many2many`, `StatusBar`, `Date`/`Monetary`), unified action/menu registries, and shared domain/context evaluation.
- **Security, API/RPC & Frontend Runtime:** Declarative model/record/field/action security policies, streaming attachment handling, full REST + JSON-RPC parity, dynamic `apps/board` view engines with zero hardcoded model special cases, and a token-based runtime `ThemeRegistry` / Skin Engine in `@moonwitness/ui`.

### Scope & Working Principles

1. **ORM Owns Schema Evolution:** Ordinary DDL changes (tables, columns, nullability, defaults, enum `CHECK` constraints, indexes, unique keys, foreign keys) are handled programmatically by `@moonwitness/orm` + `pnpm db:migrate`. `addon.upgrade` hooks are reserved strictly for non-trivial data backfills. **No separate SQL migration-script framework will be created.**
2. **Addon-First & Thin API (`ADR-0006`):** All domain models, views, menus, and addon manifests live in `packages/*` (`pnpm api:addon:check`), never inside `apps/api/src`.
3. **Shared UI Discipline:** All frontend controls, icons, and tokens in `apps/board` consume `@moonwitness/ui` and `@moonwitness/assets` (`pnpm board:ui:check`), keeping `apps/board` (`@moonwitness/board`) as the canonical web application directory (`apps/web` architectural role).
4. **One Canonical Implementation per Engine:** Eliminate duplicate type definitions (`@moonwitness/client` vs `@moonwitness/types`) and duplicate domain evaluators (`@moonwitness/client` vs `@moonwitness/orm`).
5. **Two-Branch Promotion Governance (`ADR-0001`):** Preserve `dev` -> `main` promotion, exact-SHA verification gates, and reconciliation with existing `ROADMAP.md` (`M0`–`M11`, `K0`–`K9`).

### Completion Rules

- `[x]` denotes **implemented AND verified** by existing repository code, tests, or recorded CI/test evidence observed during audit.
- `[ ]` denotes **incomplete, unverified, broken, or planned** work. Never check `[ ]` without running and recording the corresponding verification command after final edits.
- Priority legend: **P0** Critical blocker/security/data integrity · **P1** Core foundation & contracts · **P2** Platform runtime & engines · **P3** Experience, skins, DX & polish.

### Overall Progress & Phase Summary

| Section   | Phase / Subsystem                      | Task ID Range                   | Priority Focus | Done (`[x]`) | Open (`[ ]`) |   Total |
| :-------- | :------------------------------------- | :------------------------------ | :------------- | -----------: | -----------: | ------: |
| 01        | Baseline Verified Capabilities         | `MW-BASE-001`–`MW-BASE-012`     | Baseline       |           12 |            0 |      12 |
| 03        | Core Runtime                           | `MW-CORE-001`–`MW-CORE-006`     | P0–P1          |            0 |            6 |       6 |
| 04        | ORM & Model Engine                     | `MW-ORM-001`–`MW-ORM-012`       | P1–P2          |            0 |           12 |      12 |
| 05        | ORM Schema Management                  | `MW-SCHEMA-001`–`MW-SCHEMA-008` | P0–P1          |            0 |            8 |       8 |
| 06        | Native Addon Engine                    | `MW-ADDON-001`–`MW-ADDON-009`   | P1–P2          |            0 |            9 |       9 |
| 07        | Model–View Engine                      | `MW-VIEW-001`–`MW-VIEW-010`     | P1–P2          |            0 |           10 |      10 |
| 08        | Field Widget Engine                    | `MW-WIDGET-001`–`MW-WIDGET-007` | P2–P3          |            0 |            7 |       7 |
| 09        | Action & Menu Engine                   | `MW-ACT-001`–`MW-ACT-007`       | P2             |            0 |            7 |       7 |
| 10        | Domain & Context Engine                | `MW-DOM-001`–`MW-DOM-006`       | P1–P2          |            0 |            6 |       6 |
| 11        | Security & Identity                    | `MW-SEC-001`–`MW-SEC-008`       | P0–P1          |            0 |            8 |       8 |
| 12        | API & RPC Architecture                 | `MW-API-001`–`MW-API-007`       | P1–P2          |            0 |            7 |       7 |
| 13        | Backend Transformation (`apps/api`)    | `MW-BACK-001`–`MW-BACK-007`     | P1–P2          |            0 |            7 |       7 |
| 14        | Frontend Transformation (`apps/board`) | `MW-WEB-001`–`MW-WEB-009`       | P2–P3          |            0 |            9 |       9 |
| 15        | Shared UI & Design System              | `MW-UI-001`–`MW-UI-006`         | P2–P3          |            0 |            6 |       6 |
| 16        | Skin & Theme Engine                    | `MW-SKIN-001`–`MW-SKIN-005`     | P3             |            0 |            5 |       5 |
| 17        | Shared Packages Consolidation          | `MW-PKG-001`–`MW-PKG-006`       | P1–P2          |            0 |            6 |       6 |
| 18        | Events, Jobs & Automation              | `MW-JOB-001`–`MW-JOB-005`       | P1–P2          |            0 |            5 |       5 |
| 19        | Configuration, Storage & i18n          | `MW-CFG-001`–`MW-CFG-005`       | P1–P3          |            0 |            5 |       5 |
| 20        | Performance & Optimization             | `MW-PERF-001`–`MW-PERF-005`     | P2–P3          |            0 |            5 |       5 |
| 21        | Security & Reliability Hardening       | `MW-HARD-001`–`MW-HARD-005`     | P0–P1          |            0 |            5 |       5 |
| 22        | Testing & Quality Assurance            | `MW-QA-001`–`MW-QA-006`         | P1–P2          |            0 |            6 |       6 |
| 23        | Developer Experience & Tooling         | `MW-DX-001`–`MW-DX-004`         | P2–P3          |            0 |            4 |       4 |
| 24        | Documentation                          | `MW-DOC-001`–`MW-DOC-004`       | P2–P3          |            0 |            4 |       4 |
| 25        | CI/CD & Production Readiness           | `MW-CICD-001`–`MW-CICD-005`     | P0–P2          |            0 |            5 |       5 |
| 26        | End-to-End Platform Integration        | `MW-E2E-001`–`MW-E2E-016`       | P0–P1          |            0 |           16 |      16 |
| 27        | Final Audit & Cleanup                  | `MW-AUDIT-001`–`MW-AUDIT-004`   | P1–P3          |            0 |            4 |       4 |
| **Total** | **All Tracked Sections**               | **`MW-BASE-*` + `MW-*`**        | **P0–P3**      |       **12** |      **172** | **184** |

---

## 01 — Repository Discovery & Baseline

### Workspace Inventory (Measured via `node scripts/audit-workspace.mjs`)

- **Monorepo Scope:** 27 workspace manifests (root `moonwitness-monorepo` + 4 apps + 22 packages), 1,234 scanned source files, **0** runtime import cycles, **0** workspace dependency cycles, and **5** type-only file-level cycles (`packages/local-ai/src/index.ts -> suggestion-generation.ts`, `packages/orm-knowledge/src/research-release-validation.ts -> research-release.ts`, `packages/orm-storage/src/index.ts -> s3.ts`, `packages/orm/src/base.model.ts -> environment.ts`, `packages/orm/src/base.model.ts -> model-definition.ts`).
- **Registered Addon Models:** **73 models** across 11 addon manifests (`base`: 23, `auth`: 1, `jobs`: 4, `notification`: 3, `organization`: 4, `orm-storage`: 0, `workflow`: 4, `request`: 1, `orm-integration`: 2, `orm-whatsapp`: 13, `knowledge`: 18).
- **Boundary Checks Passing at Baseline:**
  - `node scripts/check-api-addon-boundary.mjs` -> 0 violations (empty legacy allowlists).
  - `node scripts/check-board-shared-ui.mjs` -> 0 violations (no raw JSX controls or banned icon libraries).
  - `node scripts/roadmap/validate-roadmap.mjs` -> 213 roadmap tasks validated (`148` M-series + `65` K-series; 81 open cards).
- **CI Workflows Present (`.github/workflows/`):** 6 active workflow files (`ci.yml`, `pages.yml`, `release-orchestrate.yml`, `release-plan.yml`, `release-prepare.yml`, `release.yml`). Note: `scripts/platform-audit.mjs` and `scripts/check-gitleaks-config.mjs` still reference retired filenames (`gitleaks.yml`, `codeql.yml`, `browser-matrix.yml`, `deep-regression.yml`, `platform-audit.yml`).

### Application Audit (`apps/*`)

| App               | Package Name              | Purpose & Architecture                                                                                                                                                                         | Audit Findings & Current Gaps                                                                                                                                                                                                                                                                                                                                                                            |
| :---------------- | :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | `@moonwitness/api`        | Fastify 5 REST/JSON-RPC host, auth plugin, generic CRUD, domain routes, and 13 CLI/worker commands (`server.ts`, `db-migrate.ts`, `jobs-worker.ts`, `jobs-scheduler.ts`, `outbox-worker.ts`).  | `app.ts` (306 lines) is clean, but `registry.ts` skips `model.knex`/`views`/`menus`/`postInstall` when `SKIP_BOOT_MIGRATIONS=true`. `generic.routes.ts` is 1,586 lines; WhatsApp sub-routers `conversations.routes.ts` (1,073), `groups.routes.ts` (1,015), `messages.routes.ts` (864) and `route-helpers.ts` (831) remain large. Worker CLIs duplicate addon lists and call `installAddons()` directly. |
| `apps/board`      | `@moonwitness/board`      | Next.js App Router app serving public `/` and authenticated `/board/*` workspace (`app-shell.tsx`, `list-view.tsx`, `form-view.tsx`, `fields.tsx`, `whatsapp-page.tsx`, `dashboard-page.tsx`). | Acts as canonical `apps/web`. Contains 0 raw JSX control violations (`board:ui:check`), but `list-view.tsx` (1,486 lines), `whatsapp-page.tsx` (2,897 lines), and `dashboard-page.tsx` (991 lines) are oversized. Hardcodes sidebar modules, 4-model omnisearch, country/state `onchange`, `Many2one` search fields, and ad-hoc Kanban grouping heuristics. `useViews` sets `staleTime: Infinity`.       |
| `apps/docs`       | `@moonwitness/docs`       | Searchable Vite/React documentation portal and versioned GitHub Pages builder.                                                                                                                 | Local build and publication safety checks pass; hosted `main` Pages publication remains gated on promotion (`M6.07`–`M6.10`).                                                                                                                                                                                                                                                                            |
| `apps/ui-catalog` | `@moonwitness/ui-catalog` | Interactive component specimen and Playwright visual/accessibility verification harness (`catalog.tsx`, 1,642 lines).                                                                          | Covers existing primitives and light/dark tokens; lacks multi-skin switcher matrix and data-view widgets (`KanbanBoard`, `StatusBar`, `DatePicker`).                                                                                                                                                                                                                                                     |

### Package Audit (`packages/*` — All 22 Packages)

| Package                         | Category                         | Models | Consumers                                                                   | Evaluation & Action                                                                                                                                                                                                                                |
| :------------------------------ | :------------------------------- | -----: | :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@moonwitness/orm`              | Core ORM                         |      0 | `api`, all `orm-*`, `auth`, `jobs`                                          | **Keep & Expand:** Add `extendModel`, `Recordset`, computed/stored fields, `onchange`, multi-view registry, and column/enum/FK schema evolution.                                                                                                   |
| `@moonwitness/orm-base`         | Core Addon (`base`)              |     23 | `api`, `auth`, `jobs`, all `orm-*`                                          | **Keep & Expand:** Houses `base.partner`, `base.user`, `base.company`, `ir.feature_flag`, `base.audit_log`, etc. Add `base.config_parameter`, `base.saved_filter`, `base.action`, `base.menu` or declarative contracts.                            |
| `@moonwitness/auth`             | Addon (`auth`)                   |      1 | `api`                                                                       | **Keep:** Owns `auth.refresh_token`, scrypt hashing, refresh rotation grace/family revocation. Integrate with `httpPlugins` and request auth caching.                                                                                              |
| `@moonwitness/jobs`             | Addon (`jobs`)                   |      4 | `api`, `orm-notification`, `orm-workflow`, `orm-integration`, `orm-request` | **Keep & Fix:** Owns `base.job`, `base.job_run`, `base.cron`, `base.outbox_event`. Fix head-of-line scheduler failure (`K7-005`) and share runtime bootstrap.                                                                                      |
| `@moonwitness/orm-notification` | Addon (`notification`)           |      3 | `api`, `orm-workflow`, `orm-request`                                        | **Keep:** In-app/template notifications via outbox. Wire into addon `httpPlugins`.                                                                                                                                                                 |
| `@moonwitness/orm-organization` | Addon (`organization`)           |      4 | `api`                                                                       | **Keep:** Departments, teams, positions, memberships + cross-company validation. Move generic route hook (`isValidOrganizationMutation`) into declarative model validation hook.                                                                   |
| `@moonwitness/orm-storage`      | Storage Provider (`orm-storage`) |      0 | `api`                                                                       | **Keep & Fix Cycle:** Local + S3 attachment storage (`putStream`, `getStream`, reconciliation). Resolve type cycle `index.ts -> s3.ts`; migrate `/api/base.attachment/upload` to `putStream`.                                                      |
| `@moonwitness/orm-workflow`     | Addon (`workflow`)               |      4 | `api`, `orm-request`, `orm-knowledge`                                       | **Keep:** State machines, approvals, append-only SQL triggers, timeout expiry job. Wire into addon `httpPlugins` and FormView statusbar.                                                                                                           |
| `@moonwitness/orm-request`      | Addon (`request`)                |      1 | `api`                                                                       | **Keep:** `PurchaseRequest` reference domain addon atop `workflow` + `notification`.                                                                                                                                                               |
| `@moonwitness/orm-integration`  | Addon (`orm-integration`)        |      2 | `api`                                                                       | **Keep:** Outbound webhook subscriptions, scoped `MW_WEBHOOK_SECRET_C*` refs, HMAC + SSRF DNS guards.                                                                                                                                              |
| `@moonwitness/orm-whatsapp`     | Addon (`orm-whatsapp`)           |     13 | `api`                                                                       | **Keep & Clean:** Version `1.14.0` (mismatch with `1.0.0-rc.1` workspace policy!). Remove raw SQL enum workaround once ORM owns enum `CHECK` diffing; delete `apps/api/src/whatsapp/manifest.ts` shim.                                             |
| `@moonwitness/orm-knowledge`    | Addon (`knowledge`)              |     18 | `api`                                                                       | **Keep & Fix Cycle:** Research graph, witness testimonies, story versions, BUG cases, publication snapshots, append-only triggers. Resolve `research-release-validation.ts -> research-release.ts`; migrate 15 API route plugins to `httpPlugins`. |
| `@moonwitness/types`            | Shared Contracts                 |      0 | `api`, `board`, `orm`, `orm-*`, `jobs`                                      | **Keep & Consolidate:** Canonical home for DTOs, `FieldMeta`, `ViewSpec`, `ResolvedViews`, `ActionSpec`, `Domain` AST/evaluator, and route schemas.                                                                                                |
| `@moonwitness/client`           | Frontend SDK                     |      0 | `board`                                                                     | **Consolidate Contracts:** Currently has zero dependencies on `@moonwitness/types` and duplicates `FieldMeta`, `ResolvedViews`, `Domain`, and `evalDomain`. Depend on `@moonwitness/types` and delete duplicates.                                  |
| `@moonwitness/ui`               | Design System                    |      0 | `board`, `docs`, `ui-catalog`                                               | **Keep & Expand:** Add data-view primitives (`DataGrid`, `KanbanBoard`, `StatusBar`, `SmartButtonBox`, `DatePicker`) and `ThemeRegistry`/Skin Engine.                                                                                              |
| `@moonwitness/assets`           | Static Assets                    |      0 | `ui`, `board`, `docs`, `ui-catalog`                                         | **Keep:** Brand SVG/raster, 82+ canonical icons, fonts, SFX audio, manifest/license provenance.                                                                                                                                                    |
| `@moonwitness/logger`           | Observability                    |      0 | `api`                                                                       | **Keep:** Pino structured logger with secret/credential redaction.                                                                                                                                                                                 |
| `@moonwitness/knowledge`        | Domain Core                      |      0 | `corpus`, `research`, `orm-knowledge`, `api`                                | **Keep:** Offline typed knowledge record contracts, canonical JSON hashing, PROV schemas.                                                                                                                                                          |
| `@moonwitness/corpus`           | Domain Ingestion                 |      0 | `orm-knowledge`, `api`                                                      | **Keep:** Rights-cleared offline passage & artifact ingestion.                                                                                                                                                                                     |
| `@moonwitness/research`         | Research Engine                  |      0 | `orm-knowledge`, `api`                                                      | **Keep:** Offline assertion, evidence, relation, privacy lifecycle, and Mizan policy contracts.                                                                                                                                                    |
| `@moonwitness/local-ai`         | Local AI Adapter                 |      0 | `api`                                                                       | **Keep & Fix Cycle:** Loopback-only, disabled-by-default adapter with prompt-injection suite. Resolve `index.ts -> suggestion-generation.ts` cycle.                                                                                                |
| `@moonwitness/eslint-config`    | Tooling                          |      0 | root                                                                        | **Keep:** Shared strict TypeScript/ESLint rules (zero explicit `any`).                                                                                                                                                                             |

### Existing Working Features (Verified Baseline — Preserve & Do Not Rewrite)

- [x] **MW-BASE-001** Programmatic addon topological sort, transactional `pg_advisory_xact_lock`, `_orm_addons` & `_orm_data` idempotent upsert preserving user-edited seed rows (`packages/orm/src/addon.ts`, `scripts/roadmap/addon-conformance.test.mjs`).
- [x] **MW-BASE-002** Declarative `defineModel` schema generation, automatic password scrypt hashing, `$formatJson` hidden-field stripping, composite `(company_id, active, id)` & FK indexes, and unique constraints (`packages/orm/src/model-definition.ts`, `packages/orm/src/addon.ts`).
- [x] **MW-BASE-003** Fastify 5 thin bootstrap with security headers, `CORS_ORIGINS` allowlist, PostgreSQL rate-limit store (`PostgresRateLimitStore`), graceful shutdown, and worker `/readyz` health servers (`apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/plugins/rate-limit-store.ts`).
- [x] **MW-BASE-004** Refresh token family rotation with 5s concurrent rotation grace window, theft revocation, timing-safe login verification, and session revocation CLIs (`packages/auth/src/service.ts`, `apps/api/src/commands/revoke-auth-sessions.ts`).
- [x] **MW-BASE-005** Prefix-level `knowledge.*` generic API default-deny, company isolation checks (`hasCompanyAccess`), `If-Match`/`x-expected-write-date` 409 optimistic concurrency, and append-only `base.audit_log` (`apps/api/src/auth/policy.ts`, `apps/api/src/routes/generic.routes.ts`).
- [x] **MW-BASE-006** Durable lease/fencing job worker, cron scheduler, and transactional outbox loop (`packages/jobs/src/runtime.ts`), plus `orm-notification`, `orm-workflow` append-only triggers, `orm-integration` SSRF-guarded webhooks, and `orm-storage` local/S3 providers.
- [x] **MW-BASE-007** Mandatory addon-first API boundary (`pnpm api:addon:check`) and zero raw JSX/icon violations in Board (`pnpm board:ui:check`) enforced in CI and `.githooks/pre-push`.
- [x] **MW-BASE-008** Canonical design system `@moonwitness/ui`, `@moonwitness/assets` (SVG bounds/sanitization verified across 114 SVGs, deterministic generation), and `@moonwitness/ui-catalog` visual/a11y suite.
- [x] **MW-BASE-009** Next.js App Router frontend (`apps/board`) serving `/` and `/board/*` with scoped TanStack Query keys (`scopedQueryKey`), company switcher, command palette, keyboard shortcuts, and route-aware bundle budgets (`pnpm board:budget`).
- [x] **MW-BASE-010** Decomposed WhatsApp backend sub-routers (`apps/api/src/routes/whatsapp/*.routes.ts`) and modular Board WhatsApp UI (`apps/board/src/components/whatsapp/*`) with zero ESLint errors and zero oxlint warnings (commits `1990580`, `2ae2e92`).
- [x] **MW-BASE-011** Tenant-scoped, offline-only knowledge/corpus/research/local-ai stack with append-only DB triggers (`packages/orm-knowledge/src/manifest.ts`) and K9-001 deterministic gate (`scripts/knowledge/run-k-gate.mjs`).
- [x] **MW-BASE-012** Deterministic documentation & architecture diagram generators (`pnpm docs:generate`, `pnpm architecture:generate`) and 213-task roadmap validator (`pnpm automation:check:roadmap`).

### Existing Backlog Reconciliation (`ROADMAP.md`, `todo-foundation.md`, `todo-ui.md`, `todo-wa.md`)

- **`ROADMAP.md` (`docs/roadmap/tasks.json`):** 132/213 tasks complete, 81 open (48 M-series: mostly `M1.08`, `M3.11`, `M6.07`–`M6.11`, `M7.05`–`M7.16`, `M8.03`–`M8.11`, `M9.03`–`M9.08`, `M10.01`–`M10.10`, `M11.03`–`M11.15`; 33 K-series: `K3`–`K9`). Open code/CI items are integrated into Sections 18, 21, 22, 24, and 25; hosted/hardware-gated items are tracked in Section 29.
- **`todo-foundation.md`:** WhatsApp `models/manifest` extraction, API route split, worker healthchecks, `db:migrate`, `PostgresRateLimitStore`, and `oxlint` cleanup are complete. Remaining open item: Node `22.x` host alignment (local Node `v24.x` vs `engines.node: "22.x"` -> `MW-DX-001`).
- **`todo-ui.md`:** Sections A–I, visual proofs, and icon migrations are complete; remaining WhatsApp WUI visual items map to Section 14/29.
- **`todo-wa.md`:** API/Board v1 inbox logic is implemented; remaining open items require live GoWA device QR pairing (`P0-01`–`P0-05`, `P0-08`, `P0-24`–`P0-25`, `P1-06`, `P1-28`, `P2-01`) and are tracked in Section 29.

---

## 02 — Architecture & Design Decisions

### Architectural Decision Log

| Decision ID   | Area                                 | Current Implementation                                                                                                                                                                                | Actual Problem                                                                                                                                              | Practical Alternatives Considered                                                                                                                                                                     | Chosen Simplest Robust Solution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Implementation Outcome & Risks                                                                                                                                                    |
| :------------ | :----------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-MW-01** | Web App Identity                     | `apps/board` (`@moonwitness/board`) hosts Next.js public `/` and `/board/*`.                                                                                                                          | Prompt references `apps/web`, creating potential confusion or risky directory renames.                                                                      | (A) Rename `apps/board` to `apps/web` across 23+ scripts/Docker/CI/docs; (B) Add a second app; (C) Standardize `apps/board` as the canonical `apps/web` role.                                         | **Option C:** Keep `apps/board` on disk as the canonical Next.js frontend app; treat all `apps/web` tasks as targeting `apps/board`.                                                                                                                                                                                                                                                                                                                                                                                             | Zero breakage to CI, Dockerfiles, `board:ui:check`, or `board:budget`. Risk: new contributors looking for `apps/web`; mitigated via Section 00/24 docs.                           |
| **ADR-MW-02** | ORM Schema Evolution                 | `syncModel` creates tables, adds missing columns, and builds indexes; `orm-whatsapp` uses custom raw SQL in `setup` to update enum `CHECK` constraints.                                               | Cannot evolve existing column nullability/defaults/types, enum checks, or FK constraints automatically; no `--dry-run` preflight or destructive guardrails. | (A) Build/adopt traditional SQL migration scripts (`knex migrate`); (B) Extend `syncModel` into an Odoo-style schema diff & sync engine.                                                              | **Option B:** Extend `syncModel` in `@moonwitness/orm` to inspect `information_schema` / SQLite `PRAGMA` and apply safe DDL diffs + dry-run plan; keep `addon.upgrade` strictly for data transforms.                                                                                                                                                                                                                                                                                                                             | Preserves ADR-0001/Odoo paradigm and eliminates raw SQL hacks in addons. Risk: destructive column drops/shrinks; mitigated by fail-closed preflight checks (`MW-SCHEMA-005`).     |
| **ADR-MW-03** | Model Inheritance                    | `defineModel` creates isolated `BaseModel` subclasses; no addon can add fields/hooks to an existing upstream model.                                                                                   | Addons cannot extend `base.partner`, `base.user`, or `base.company` cleanly without modifying `@moonwitness/orm-base`.                                      | (A) Monkey-patching prototype; (B) Declarative `extendModel(target, extension)` registry applied before `syncModel`.                                                                                  | **Option B:** Add `extendModel` to `@moonwitness/orm` merging fields, `unique`, `exposedActions`, and lifecycle hooks deterministically in addon dependency order.                                                                                                                                                                                                                                                                                                                                                               | Enables true Odoo-style modular extension. Risk: field name collisions across addons; mitigated by collision checks at addon resolution (`MW-ORM-003`).                           |
| **ADR-MW-04** | View Registry & Inheritance          | `packages/orm/src/view.ts` stores one `ViewSpec` in `Map<string, ViewSpec>` for `list`/`form`/`search` only.                                                                                          | Later addons overwrite earlier views; no `kanban`/`calendar`/`graph`/`pivot`; no form tabs, statusbars, or smart buttons.                                   | (A) XML XPath templates (heavyweight); (B) Typed JSON/TS `defineView` + `extendView` patch operations & priority order.                                                                               | **Option B:** Priority-ordered base + `extendView` patch specs in `@moonwitness/orm` compiled into `ResolvedViews` and validated against model fields.                                                                                                                                                                                                                                                                                                                                                                           | Type-safe, IDE-checked, zero XML parser overhead. Risk: extension patch targeting removed field; mitigated by startup view validation (`MW-VIEW-002`).                            |
| **ADR-MW-05** | Security Policy Ownership            | `INTERNAL_PREFIXES`, `ADMIN_ONLY_MODELS`, and `PUBLIC_MODELS` hardcoded in `apps/api/src/auth/{policy,rules}.ts`.                                                                                     | Adding new models/addons requires editing `apps/api` security files; no field-level ACL or declarative action grants.                                       | (A) Keep centralized lists in `apps/api`; (B) Declare access metadata, field `groups`, and `recordRules` on models/addons and compile at boot.                                                        | **Option B:** Move security metadata into `@moonwitness/orm` model/addon contracts; `apps/api` enforces the compiled policy registry while preserving `knowledge.*` prefix fail-closed deny.                                                                                                                                                                                                                                                                                                                                     | Satisfies ADR-0006 addon autonomy and prevents accidental generic API leaks. Risk: misconfigured addon defaults; mitigated by default-deny for unannotated models (`MW-SEC-001`). |
| **ADR-MW-06** | Core Runtime Boot Separation         | `SKIP_BOOT_MIGRATIONS=true` skips `installAddons()` and only calls `Registry.register()`, bypassing `model.knex`, `registerView`, `modelMenus`, and `postInstall`. Worker CLIs duplicate addon lists. | Production boot with `SKIP_BOOT_MIGRATIONS=true` loses explicit addon views, menu groups/order, and Knex bindings; workers drift from API addons.           | (A) Always run DDL at boot; (B) Separate `registerAddons(db, addons)` (always run) from `synchronizeAddons(db, addons)` (run in `db:migrate` or non-skipped boot).                                    | **Option B:** Split `registerAddons` (in-memory models, views, menus, security, actions, jobs, Knex bindings) from `installAddons` DDL/seed sync, and share a unified workspace manifest list.                                                                                                                                                                                                                                                                                                                                   | Fixes `SKIP_BOOT_MIGRATIONS=true` data/view loss and unifies API + worker boot (`MW-CORE-001`, `MW-CORE-002`).                                                                    |
| **ADR-MW-07** | Domain & Context Engine              | `packages/orm/src/domain.ts` and `packages/client/src/domain.ts` implement two incompatible evaluators; `client/src/types.ts` duplicates `@moonwitness/types`.                                        | Client omits `<>`, `like`, `not like`, `=like`, `is null`, `is not null`; SQL domain fails on dotted relational paths (`partner.country.code`).             | (A) Maintain two copies; (B) Put pure domain AST, validation, dynamic context resolution (`$uid`, `$company_id`), and in-memory eval in `@moonwitness/types`, and SQL compiler in `@moonwitness/orm`. | **Option B:** Single pure domain engine in `@moonwitness/types` consumed by both `@moonwitness/orm` and `@moonwitness/client`, plus SQL relational join compiler in `@moonwitness/orm`.                                                                                                                                                                                                                                                                                                                                          | Eliminates type/operator drift and enables rich relational filtering (`MW-DOM-001`, `MW-DOM-002`, `MW-PKG-002`).                                                                  |
| **ADR-MW-08** | Action & Menu Engine                 | `AddonMenu` is flat (`group` string + `model`); `app-shell.tsx` hardcodes custom routes; actions are just `action_*` method strings.                                                                  | Cannot represent nested menus, window/server/client actions, form smart buttons, or custom workspace screens declaratively.                                 | (A) Keep hardcoded UI nav; (B) Declarative `defineAction` + hierarchical `AddonMenu` + Smart Button specs served via `/api/app/bootstrap`.                                                            | **Option B:** Unified `ActionRegistry` + hierarchical `MenuRegistry` compiled from installed addons and rendered dynamically by `AppShell` and `FormEngine`.                                                                                                                                                                                                                                                                                                                                                                     | Unlocks real modular app navigation without editing `app-shell.tsx` (`MW-ACT-001`..`MW-ACT-007`).                                                                                 |
| **ADR-MW-09** | Skin & Theme Engine                  | `packages/ui/src/styles/tokens.css` defines `:root` and `.dark`; `useTheme` toggles `.dark` via `localStorage`.                                                                                       | Only 1 visual skin with light/dark toggle; no compact/high-contrast/custom skins or user-persisted preference synced with server.                           | (A) Build runtime CSS-in-JS theming; (B) Token-driven CSS attribute skins (`data-skin`, `data-density`, `.dark`) + typed `ThemeRegistry` in `@moonwitness/ui`.                                        | **Option B:** Zero-runtime-overhead CSS variable skin layers registered in `@moonwitness/ui` with pre-paint hydration + optional `base.user` preference sync.                                                                                                                                                                                                                                                                                                                                                                    | Preserves existing bundle budget and SSR compatibility (`MW-SKIN-001`..`MW-SKIN-005`).                                                                                            |
| **ADR-MW-10** | Platform Capabilities Classification | 14 cross-cutting capabilities evaluated for real product necessity.                                                                                                                                   | Risk of overengineering theoretical enterprise features into core.                                                                                          | Evaluate each capability against actual workspace consumers and classify explicitly.                                                                                                                  | **Core:** Config params (`base.config_parameter`), attachments/storage (`orm-storage`), i18n, audit logs, jobs/scheduler/outbox, observability. **Addon:** Notifications (`orm-notification`), webhooks (`orm-integration`), workflow (`orm-workflow`), CSV import/export (`board`+`api` tool), reporting views (`Graph`/`Pivot`). **External:** GoWA WhatsApp (`wa.moonwitness.biz.id`), S3/RustFS, Local LLM (`ollama`/loopback). **Deferred:** Automated cloud multi-region backup orchestration, visual workflow builder UI. | Prevents scope creep while ensuring every needed platform capability has a clear owner.                                                                                           |

### Target Dependency Direction

```text
@moonwitness/types (pure schemas, domain AST/eval, API/view/action contracts)
  ├── @moonwitness/logger
  ├── @moonwitness/assets
  │     └── @moonwitness/ui (tokens, skins, primitives, data-view components, icons)
  ├── @moonwitness/client (depends on @moonwitness/types)
  │     └── apps/board (Next.js App Router dynamic platform shell & view engines)
  └── @moonwitness/orm (Registry, Environment, Recordset, Model/Schema/View/Action/Security engines)
        └── @moonwitness/orm-base (core models, menus, config, saved filters, feature flags)
              ├── @moonwitness/auth
              ├── @moonwitness/jobs
              ├── @moonwitness/orm-* (domain addons)
              └── apps/api (thin HTTP/JSON-RPC/worker host via API_ADDONS)
```

---

## 03 — Core Runtime

- [ ] **MW-CORE-001** Separate in-memory addon metadata registration (`registerAddons`) from transactional DDL/seed synchronization (`installAddons`) so `SKIP_BOOT_MIGRATIONS=true` no longer leaves `model.knex(db)`, `views`, `modelMenus`, `actions`, and `postInstall` uninitialized.
  - **Priority:** P0 · **Layer:** Core · **Dependencies:** None
  - **Location:** `packages/orm/src/addon.ts`, `apps/api/src/addons/registry.ts`
  - **Acceptance Criteria:** Calling `installApiAddons(..., { skipBootMigrations: true })` binds `model.knex(db)`, populates `Registry`, `views`, `modelMenus`, security rules, and runs read-only runtime registration without issuing DDL statements.
  - **Verification:** Add unit + integration test in `apps/api/tests/orm.test.ts` booting `buildApp` with `SKIP_BOOT_MIGRATIONS=true` against a pre-migrated DB and asserting `/api/base.partner/views` returns explicit view sections/filters; run `pnpm --filter @moonwitness/api test`.

- [ ] **MW-CORE-002** Create a single shared runtime bootstrap module (`bootstrapMoonWitnessRuntime`) used identically by `apps/api/src/app.ts`, `apps/api/src/commands/db-migrate.ts`, `jobs-worker.ts`, `jobs-scheduler.ts`, and `outbox-worker.ts`.
  - **Priority:** P1 · **Layer:** Core · **Dependencies:** `MW-CORE-001`
  - **Location:** `apps/api/src/addons/registry.ts`, `apps/api/src/commands/jobs-worker.ts`, `apps/api/src/commands/jobs-scheduler.ts`, `apps/api/src/commands/outbox-worker.ts`
  - **Acceptance Criteria:** Workers no longer maintain duplicate hardcoded addon arrays or invoke `installAddons` inconsistently; all processes register the same canonical addon list, job handlers, and outbox consumers, respecting `SKIP_BOOT_MIGRATIONS`.
  - **Verification:** `pnpm build && pnpm --filter @moonwitness/api exec vitest run tests/startup.test.ts` (or startup suite) and `pnpm api:addon:check`.

- [ ] **MW-CORE-003** Introduce a typed `ServiceRegistry` on the Core Runtime / `Environment` for cross-addon services (storage, logger, job enqueueing, notification dispatch, attachment scanner, local AI).
  - **Priority:** P1 · **Layer:** Core · **Dependencies:** `MW-CORE-002`
  - **Location:** `packages/orm/src/`, `apps/api/src/plugins/orm.plugin.ts`
  - **Acceptance Criteria:** Services are registered by typed token at boot and accessible via `env.services.get(token)` without importing `apps/api` singletons into `packages/orm-*`.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm audit:workspace`.

- [ ] **MW-CORE-004** Implement typed startup configuration schema validation and normalized runtime diagnostics endpoint/report.
  - **Priority:** P1 · **Layer:** Core · **Dependencies:** `MW-CORE-002`
  - **Location:** `apps/api/src/config/env.ts`, `apps/api/src/startup-diagnostics.ts`, `apps/api/src/routes/health.routes.ts`
  - **Acceptance Criteria:** Startup validates all required/optional env vars once at boot with redacted diagnostic summary; `/readyz` reports DB pool, registered addon versions, and service readiness without leaking secrets.
  - **Verification:** `pnpm --filter @moonwitness/api exec vitest run tests/config.test.ts tests/health.test.ts`.

- [ ] **MW-CORE-005** Unify runtime lifecycle hooks (`onInit`, `onReady`, `onDispose`) across API server and all worker commands via `apps/api/src/lifecycle/`.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-CORE-002`, `MW-CORE-004`
  - **Location:** `apps/api/src/lifecycle/graceful-shutdown.ts`, `apps/api/src/lifecycle/process-shutdown.ts`, `apps/api/src/server.ts`
  - **Acceptance Criteria:** API and worker shutdown sequences drain active HTTP requests, job leases, S3 pools, and Knex connections deterministically within configured timeout.
  - **Verification:** `pnpm --filter @moonwitness/api test`.

- [ ] **MW-CORE-006** Standardize typed platform error classes (`PlatformError`, `ValidationError`, `AccessDeniedError`, `NotFoundError`, `ConcurrencyConflictError`, `SchemaSyncError`) across `@moonwitness/orm` and `apps/api`.
  - **Priority:** P1 · **Layer:** Core · **Dependencies:** None
  - **Location:** `packages/types/src/`, `packages/orm/src/`, `apps/api/src/app.ts`
  - **Acceptance Criteria:** Errors thrown by ORM/addons carry stable `code`, `statusCode`, and sanitized client message; Fastify's `setErrorHandler` maps them uniformly without string heuristics.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test`.

---

## 04 — ORM & Model Engine

- [ ] **MW-ORM-001** Expand canonical field definitions in `@moonwitness/orm` to support `float`, `decimal`, `date`, `datetime`, `json`, and `manyToMany` alongside existing 8 field kinds.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** None
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/view.ts`, `packages/types/src/`
  - **Acceptance Criteria:** `fields.float`, `fields.decimal`, `fields.date`, `fields.datetime`, `fields.json`, and `fields.manyToMany` generate accurate TypeScript `ModelValues`, Objection `jsonSchema` + `relationMappings`, and `FieldMeta`.
  - **Verification:** Add type + runtime serialization tests in `packages/orm/tests/`; run `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-ORM-002** Implement `manyToMany` junction table resolution and link management in `defineModel` and `syncModel` (auto-creating/indexing deterministic relation tables with explicit `relationTable` override).
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-ORM-001`, `MW-SCHEMA-001`
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** `ManyToManyRelation` works in `withGraphFetched`, `create`/`write` link commands (`set`, `link`, `unlink`), and schema sync without manual boilerplate link models for new relations.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:integration`.

- [ ] **MW-ORM-003** Implement Odoo-inspired model inheritance & extension (`extendModel(targetModelName | ModelClass, extension)`) in `@moonwitness/orm`.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-ORM-001`
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/registry.ts`, `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** Addons can declare extensions adding `fields`, `unique` constraints, `exposedActions`, and lifecycle hooks (`beforeCreate`, `afterWrite`) to upstream models; extensions compose cleanly in addon topological order and fail fast on duplicate field collisions.
  - **Verification:** Unit + integration test extending `base.partner` from a test addon verifying merged `jsonSchema`, `describeFields`, and PostgreSQL/SQLite column sync; run `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-ORM-004** Add declarative computed fields (`compute`, `depends`, `store`) to `FieldOptions` and ORM read/write pipelines.
  - **Priority:** P2 · **Layer:** ORM · **Dependencies:** `MW-ORM-001`, `MW-ORM-003`
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/base.model.ts`
  - **Acceptance Criteria:** Non-stored computed fields evaluate on `search_read`/`browse` reads (read-only in `FieldMeta`); stored computed fields recompute transactionally whenever any field in `depends` (including dotted relation paths) changes on `create`/`write`.
  - **Verification:** Unit + PostgreSQL integration tests covering stored recompute and non-stored evaluation; run `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-ORM-005** Implement declarative dynamic `default` providers and `onchange` handlers on `defineModel` / `extendModel`.
  - **Priority:** P2 · **Layer:** ORM · **Dependencies:** `MW-ORM-003`
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/base.model.ts`
  - **Location:** `packages/orm/src/`
  - **Acceptance Criteria:** Models expose `defaultGet(fields, context)` and `onchange(values, changedField, fieldSpec)` returning updated field values, field domain overrides, and non-blocking warnings; replaces hardcoded `country_id` logic in Board.
  - **Verification:** `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-ORM-006** Add declarative cross-field and invariant model constraints (`constraints` validators) executed inside create/write transactions before commit.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-ORM-003`, `MW-CORE-006`
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/base.model.ts`
  - **Acceptance Criteria:** Synchronous and transactional async constraints run on every `create`, `write`, and `update` path (REST, JSON-RPC, and direct ORM), returning typed `ValidationError` (`400`) on failure and migrating ad-hoc checks like `isValidOrganizationMutation` cleanly into `@moonwitness/orm-organization`.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/orm-organization test`.

- [ ] **MW-ORM-007** Implement an immutable, chainable `Recordset<M>` abstraction on `Environment` while maintaining backwards-compatible static helpers on `BaseModel`.
  - **Priority:** P2 · **Layer:** ORM · **Dependencies:** `MW-CORE-003`
  - **Location:** `packages/orm/src/environment.ts`, `packages/orm/src/base.model.ts`
  - **Acceptance Criteria:** `env.get('base.partner').browse([1, 2])` or `.search(domain)` returns a `Recordset` carrying `env`, `trx`, `ids`, batch `.write()`, `.unlink()`, `.mapped()`, `.filtered()`, and single-record `.ensureOne()` invariants.
  - **Verification:** `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-ORM-008** Add `_recName` / `displayField` declaration on `defineModel` and consistent `nameGet` / `display_name` computation across ORM and API responses.
  - **Priority:** P2 · **Layer:** ORM · **Dependencies:** `MW-ORM-001`
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/base.model.ts`, `packages/orm/src/view.ts`
  - **Acceptance Criteria:** Models without a `name` column (e.g., `base.user` -> `login`, `base.sequence` -> `code`) declare `_recName` in metadata so `display_name` and `Many2one` widgets stop hardcoding model names.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance`.

- [ ] **MW-ORM-009** Enforce `write_date` optimistic concurrency (`expectedWriteDate`) at `BaseModel.write()` / `BaseModel.unlink()` level so JSON-RPC and service writes share REST's `409 Conflict` safety.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-CORE-006`
  - **Location:** `packages/orm/src/base.model.ts`, `apps/api/src/routes/generic.routes.ts`
  - **Acceptance Criteria:** `BaseModel.write` accepts `expectedWriteDate` in options, issues a conditional `WHERE id IN (...) AND write_date = ?` update, and throws `ConcurrencyConflictError` when 0 rows match an existing ID.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api exec vitest run tests/api-orm-hardening.test.ts`.

- [ ] **MW-ORM-010** Add `onDelete` policy metadata (`'restrict' | 'cascade' | 'set null'`) to `belongsTo` fields and integrate it with `findReference` and SQL FK creation.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-ORM-001`
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/addon.ts`, `apps/api/src/routes/generic.routes.ts`
  - **Acceptance Criteria:** Foreign keys honor declared `onDelete` instead of hardcoding `'RESTRICT'` everywhere, and archive/unlink reference checks respect `cascade` / `set null` semantics cleanly.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:integration`.

- [ ] **MW-ORM-011** Eliminate duplicate `write()` / `update()` audit field bypasses in `BaseModel` by ensuring `$beforeUpdate` and batch `write()` use a single validated hook pipeline (including `sensitive` field redaction).
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-ORM-006`
  - **Location:** `packages/orm/src/base.model.ts`
  - **Acceptance Criteria:** Batch `write()` runs JSON Schema partial validation, password hashing, `sensitive`/audit hooks, and computed field invalidation consistently with single-record `.update()`.
  - **Verification:** `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-ORM-012** Support safe relational dotted-path sorting and `search_read` field projection (e.g., `order: 'partner.name asc'`) in `BaseModel.buildSearchQuery`.
  - **Priority:** P2 · **Layer:** ORM · **Dependencies:** `MW-DOM-002`
  - **Location:** `packages/orm/src/base.model.ts`
  - **Acceptance Criteria:** `order` and `domain` validate relational paths against registered model `BelongsToOneRelation` mappings, check `hiddenFields` on every hop, and generate deterministic left joins without column ambiguity.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:integration`.

---

## 05 — ORM Schema Management

- [ ] **MW-SCHEMA-001** Build a unified PostgreSQL & SQLite schema introspector in `@moonwitness/orm` reading live columns, nullability, defaults, `CHECK` constraints, indexes, unique indexes, and foreign keys.
  - **Priority:** P0 · **Layer:** ORM · **Dependencies:** `MW-CORE-001`
  - **Location:** `packages/orm/src/`
  - **Acceptance Criteria:** Introspector produces a normalized `TableSchemaSnapshot` for both `pg` (`information_schema` + `pg_constraint` + `pg_indexes`) and `better-sqlite3` (`PRAGMA table_info` / `index_list` / `foreign_key_list`).
  - **Verification:** Unit tests on SQLite and integration tests on PostgreSQL (`pnpm --filter @moonwitness/orm test && pnpm test:integration`).

- [ ] **MW-SCHEMA-002** Upgrade `syncModel` to reconcile existing column changes automatically (nullable <-> not nullable when safe, default value updates, widening `varchar`/type promotion such as `string -> text` or `integer -> decimal`).
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-SCHEMA-001`, `MW-ORM-001`
  - **Location:** `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** Safe additive/widening column mutations execute idempotently in transactions on both PostgreSQL and SQLite; making a populated nullable column `required` without a default fails safely with an actionable error.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:integration`.

- [ ] **MW-SCHEMA-003** Implement automatic enum `CHECK` constraint diffing and synchronization inside `syncModel`, and remove the manual PostgreSQL constraint-patching workaround in `packages/orm-whatsapp/src/manifest.ts`.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-SCHEMA-001`
  - **Location:** `packages/orm/src/addon.ts`, `packages/orm-whatsapp/src/manifest.ts`
  - **Acceptance Criteria:** When a `fields.enum([...])` adds or modifies values, `syncModel` detects `CHECK` constraint drift and updates the constraint on PostgreSQL (and recreates/checks on SQLite) automatically; `orm-whatsapp` `setup` raw SQL is deleted.
  - **Verification:** Test enum expansion on populated SQLite & PostgreSQL tables; run `pnpm test:addon-conformance && pnpm test:integration`.

- [ ] **MW-SCHEMA-004** Reconcile foreign-key constraints and `onDelete` actions on newly added `belongsTo` columns and existing tables during `syncModel`.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-SCHEMA-001`, `MW-ORM-010`
  - **Location:** `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** New `belongsTo` fields added to existing PostgreSQL tables get real `FOREIGN KEY` constraints (`ALTER TABLE ADD CONSTRAINT`), and FK `onDelete` mismatches are detected and reconciled cleanly.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:integration`.

- [ ] **MW-SCHEMA-005** Implement a schema-diff preflight guard and destructive-change safety policy (`allowDestructiveSchema` opt-in + data-preservation checks).
  - **Priority:** P0 · **Layer:** ORM · **Dependencies:** `MW-SCHEMA-001`, `MW-SCHEMA-002`
  - **Location:** `packages/orm/src/addon.ts`, `apps/api/src/commands/db-migrate.ts`
  - **Acceptance Criteria:** Schema synchronization NEVER drops columns, drops tables, narrows types, or removes enum values in use automatically; unsafe changes abort cleanly before mutating data and emit structured `SchemaDiffPlan` diagnostics.
  - **Verification:** Negative tests proving destructive field removals or conflicting type shrinks are blocked cleanly without partial DDL commits; run `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-SCHEMA-006** Add `--dry-run` and `--json` schema inspection modes to `apps/api/src/commands/db-migrate.ts` (`pnpm db:migrate`).
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-SCHEMA-005`
  - **Location:** `apps/api/src/commands/db-migrate.ts`, `package.json`
  - **Acceptance Criteria:** `pnpm db:migrate -- --dry-run` computes pending table creations, column additions/alterations, indexes, constraints, and addon upgrades without writing to the database.
  - **Verification:** `pnpm --filter @moonwitness/api test` with dry-run CLI test asserting zero DB side effects and accurate JSON diff output.

- [ ] **MW-SCHEMA-007** Reconcile stale ORM-managed indexes (`mw_idx_*`) and unique constraints (`mw_uq_*`) when model indexes/unique arrays evolve, preserving user/custom DB indexes.
  - **Priority:** P2 · **Layer:** ORM · **Dependencies:** `MW-SCHEMA-001`
  - **Location:** `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** Only ORM-prefixed (`mw_idx_*`, `mw_uq_*`) indexes no longer declared on the model are candidates for cleanup, while new unique constraints perform pre-creation duplicate checks with clear error messages.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:integration`.

- [ ] **MW-SCHEMA-008** Add transactional pre/post-sync `addon.upgrade` orchestration with schema-version checksum tracking in `_orm_addons`.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-SCHEMA-002`, `MW-SCHEMA-005`
  - **Location:** `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** `_orm_addons` tracks `version`, `schema_digest`, `status`, and `upgraded_at`; unchanged schema/version skips redundant DDL (`no-op` fast boot), while upgrades execute schema sync + chained semver `upgrade` hooks atomically with PostgreSQL rollback verification.
  - **Verification:** Run upgrade rollback & idempotent re-install tests via `pnpm test:integration`.

---

## 06 — Native Addon Engine

- [ ] **MW-ADDON-001** Expand the `Addon` manifest contract (`packages/orm/src/addon.ts`) to declare `displayName`, `category`, `summary`, `license`, `autoInstall`, `uninstallable`, `actions`, `security`, and `versionCompatibility`.
  - **Priority:** P1 · **Layer:** Addon · **Dependencies:** `MW-CORE-001`
  - **Location:** `packages/orm/src/addon.ts`, `packages/types/src/`
  - **Acceptance Criteria:** `defineAddon` validates metadata, semver ranges on `depends`, and rejects conflicting action/menu/model registrations before DB transaction start.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance`.

- [ ] **MW-ADDON-002** Implement automatic workspace addon discovery & dependency graph resolver (`discoverWorkspaceAddons`) replacing manual hardcoded imports in `apps/api/src/addons/registry.ts` and worker CLIs.
  - **Priority:** P1 · **Layer:** Addon · **Dependencies:** `MW-ADDON-001`, `MW-CORE-002`
  - **Location:** `packages/orm/src/addon.ts`, `apps/api/src/addons/registry.ts`
  - **Acceptance Criteria:** Addons export a canonical entrypoint discovered from workspace package metadata (`moonwitness.addon: true`) or explicit registry list, validated by topological order and cycle detection.
  - **Verification:** `pnpm test:addon-conformance && pnpm api:addon:check`.

- [ ] **MW-ADDON-003** Track full addon lifecycle state (`uninstalled | installed | disabled | upgrade_failed`) in `_orm_addons` and integrate runtime enable/disable gating with `ir.feature_flag`.
  - **Priority:** P1 · **Layer:** Addon · **Dependencies:** `MW-ADDON-001`, `MW-SCHEMA-008`
  - **Location:** `packages/orm/src/addon.ts`, `packages/orm-base/src/models/feature-flag.ts`
  - **Acceptance Criteria:** Disabling a non-core addon marks its state in `_orm_addons` and suppresses its menus, actions, and non-core generic routes without deleting its stored records; enabling re-exposes them cleanly.
  - **Verification:** Add lifecycle enable/disable unit & integration tests; run `pnpm test:addon-conformance`.

- [ ] **MW-ADDON-004** Implement safe, dependency-checked `uninstallAddon(db, addonName, options)` handling dependent addons, views, menus, actions, permissions, and `_orm_data` ownership.
  - **Priority:** P2 · **Layer:** Addon · **Dependencies:** `MW-ADDON-003`
  - **Location:** `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** Uninstalling an addon required by active dependents fails cleanly (`409`); uninstalling a leaf addon removes its runtime registrations (views, menus, actions, ACL seeds) and optionally purges/archives owned tables only when explicitly confirmed, leaving core data intact.
  - **Verification:** Test dependency blocking, safe unregister, and clean reinstall in `packages/orm/tests/addon.test.ts`; run `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-ADDON-005** Implement addon install/upgrade failure recovery (transactional rollback on PostgreSQL/SQLite, atomic runtime registry snapshot swap, and diagnostic error reporting).
  - **Priority:** P1 · **Layer:** Addon · **Dependencies:** `MW-SCHEMA-008`, `MW-ADDON-003`
  - **Location:** `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** A mid-upgrade error rolls back DDL, seed changes, and in-memory `Registry` / `views` / `modelMenus` snapshots simultaneously so the runtime never stays half-upgraded.
  - **Verification:** PostgreSQL fault-injection test in `apps/api/tests/postgres.integration.test.ts`; run `pnpm test:integration`.

- [ ] **MW-ADDON-006** Migrate addon-specific HTTP routes (`auth`, `jobs`, `notification`, `workflow`, `whatsapp`, and 15 `knowledge` routes) out of `apps/api/src/addons/registry.ts` into each package's `manifest.httpPlugins` entrypoint.
  - **Priority:** P2 · **Layer:** Addon · **Dependencies:** `MW-ADDON-001`, `MW-CORE-003`
  - **Location:** `apps/api/src/addons/registry.ts`, `packages/auth/`, `packages/jobs/`, `packages/orm-notification/`, `packages/orm-workflow/`, `packages/orm-whatsapp/`, `packages/orm-knowledge/`
  - **Acceptance Criteria:** Each addon owns its HTTP endpoints via `httpPlugins` using `ServiceRegistry` (without violating `audit:workspace` dependencies); `apps/api/src/addons/registry.ts` shrinks to clean addon assembly.
  - **Verification:** `pnpm audit:workspace && pnpm api:addon:check && pnpm --filter @moonwitness/api test`.

- [ ] **MW-ADDON-007** Implement cross-addon model/view/menu/action/seed integrity validation during `registerAddons` and in `scripts/roadmap/addon-conformance.test.mjs`.
  - **Priority:** P1 · **Layer:** Addon · **Dependencies:** `MW-ADDON-001`, `MW-ORM-003`
  - **Location:** `packages/orm/src/addon.ts`, `scripts/roadmap/addon-conformance.test.mjs`
  - **Acceptance Criteria:** Conformance tests verify all 11+ workspace addons declare valid dependencies, exported models, valid views/menus/actions, non-colliding seed IDs, and compatibility metadata.
  - **Verification:** `pnpm test:addon-conformance`.

- [ ] **MW-ADDON-008** Add `addon.uninstall` / cleanup hook for `ir.feature_flag`-gated experimental addons integrated with `pnpm evolution:prune`.
  - **Priority:** P3 · **Layer:** Addon · **Dependencies:** `MW-ADDON-004`
  - **Location:** `scripts/evolution/prune-expired-experiments.mjs`, `packages/orm-base/src/models/feature-flag.ts`
  - **Acceptance Criteria:** Expired `exp-*` addons can be cleanly disabled/uninstalled via the standard addon engine rather than ad-hoc file deletion alone.
  - **Verification:** `pnpm evolution:prune -- --dry-run` and unit tests in `scripts/evolution/`.

- [ ] **MW-ADDON-009** Upgrade `pnpm addon:scaffold` (`scripts/evolution/scaffold-exp-addon.mjs` + standard scaffold command) to generate full production-compliant addons (models, views, menus, actions, security rules, tests, `tsconfig.json`, `package.json`).
  - **Priority:** P3 · **Layer:** Addon · **Dependencies:** `MW-ADDON-001`, `MW-ADDON-007`
  - **Location:** `scripts/evolution/scaffold-exp-addon.mjs`, `package.json`
  - **Acceptance Criteria:** Generated addon compiles, passes `pnpm api:addon:check`, passes `pnpm test:addon-conformance`, and installs cleanly into SQLite/PostgreSQL without manual boilerplate edits.
  - **Verification:** Run scaffold dry-run & temp-dir build/conformance test; `pnpm test:addon-conformance`.

---

## 07 — Model–View Engine

- [ ] **MW-VIEW-001** Replace single-slot `Map<string, ViewSpec>` in `packages/orm/src/view.ts` with a multi-view, priority-ordered View Registry supporting `extendView(model, patch)` view inheritance.
  - **Priority:** P1 · **Layer:** Core · **Dependencies:** `MW-ORM-003`, `MW-CORE-001`
  - **Location:** `packages/orm/src/view.ts`
  - **Acceptance Criteria:** Downstream addons can insert fields, sections, tabs, columns, or search filters before/after/inside an upstream view (`extendView`) deterministically by priority/dependency order without overwriting the base view.
  - **Verification:** Unit tests in `packages/orm/tests/` covering multi-addon view inheritance; run `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-VIEW-002** Enforce comprehensive view-definition validation in `defineView` / `extendView` and during `registerAddons` (checking field existence, relation fields, action names, domain syntax, and hidden/write-only exposure).
  - **Priority:** P1 · **Layer:** Core · **Dependencies:** `MW-VIEW-001`, `MW-DOM-001`
  - **Location:** `packages/orm/src/view.ts`
  - **Acceptance Criteria:** Invalid field keys in `list`, `form`, `search`, `kanban`, `calendar`, `graph`, or `pivot`, invalid filter domains, or write-only fields in list/search/kanban throw clear compile/boot errors.
  - **Verification:** Negative validation tests in `packages/orm/tests/`; run `pnpm test:addon-conformance`.

- [ ] **MW-VIEW-003** Upgrade automatic default view generation (`resolveViews`) for models without explicit views, including sensible column prioritization, relation display fields, `active`/`state` filters, and layout grouping.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-VIEW-001`, `MW-ORM-008`
  - **Location:** `packages/orm/src/view.ts`
  - **Acceptance Criteria:** Any registered model with zero explicit `defineView` produces valid List, Form, Search, and default Kanban/Graph-eligible metadata automatically without exposing `password`/`hidden` fields.
  - **Verification:** `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-VIEW-004** Extend `ListView` specification with `editable` (`'top' | 'bottom' | false`), column `widget`, `optional` (`'show' | 'hide'`), `sum`/`avg` numeric aggregations, row `decoration-*` rules, and `multiEdit`.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-VIEW-001`, `MW-PKG-002`
  - **Location:** `packages/orm/src/view.ts`, `packages/types/src/`
  - **Acceptance Criteria:** Addons can declare typed list badges, aggregate footer columns, and optional column visibility in `defineView`, validated and served in `/api/:model/views`.
  - **Verification:** `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/orm test`.

- [ ] **MW-VIEW-005** Extend `FormView` specification with `header` (statusbar field + header buttons), `smartButtons`, `tabs` (notebooks/pages alongside `sections`), 2-column field groups, field `widget`/`placeholder`/`domain`/`context`, and `chatter` toggle.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-VIEW-001`, `MW-ACT-001`
  - **Location:** `packages/orm/src/view.ts`, `packages/types/src/`
  - **Acceptance Criteria:** Form views support declarative statusbars, tabbed pages, smart buttons, relational field domain overrides (replacing hardcoded `country_id` checks), and chatter configuration.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance`.

- [ ] **MW-VIEW-006** Extend `SearchView` specification with `groupBy` presets, typed filter `facets`, date range filters, and `searchPanel` category/relation sidebar configuration.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-VIEW-001`, `MW-DOM-001`
  - **Location:** `packages/orm/src/view.ts`, `packages/types/src/`
  - **Acceptance Criteria:** Search metadata explicitly drives text search targets, pre-built domain chips, group-by options (connected to `/api/:model/group-count`), and facet panels.
  - **Verification:** `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-VIEW-007** Add declarative `KanbanView` specification (`groupBy`, `cardTitle`, `cardFields`, `badgeField`, `quickCreate`, `stageOrder`) to replace hardcoded `groupingField` heuristics in `apps/board/src/components/views/list-view.tsx`.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-VIEW-001`
  - **Location:** `packages/orm/src/view.ts`, `packages/types/src/`
  - **Acceptance Criteria:** Models with stage/state/selection/many2one pipelines declare explicit `kanban` view specs; models without one degrade gracefully or disable Kanban mode cleanly.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance`.

- [ ] **MW-VIEW-008** Add declarative `CalendarView` specification (`dateStart`, `dateStop`, `colorBy`, `mode`: `'month' | 'week' | 'day'`, `fields`) for time-based models (`base.activity`, workflows, requests).
  - **Priority:** P3 · **Layer:** Core · **Dependencies:** `MW-VIEW-001`, `MW-ORM-001`
  - **Location:** `packages/orm/src/view.ts`, `packages/types/src/`
  - **Acceptance Criteria:** Addons can declare `calendar` views validated against `date`/`datetime` fields and consumed via `/api/:model/views`.
  - **Verification:** `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-VIEW-009** Add declarative `GraphView` (`type`: `'bar' | 'line' | 'pie'`, `dimension`, `measure`, `aggregation`) and `PivotView` (`rows`, `columns`, `measures`) specifications backed by `/api/:model/group-count`.
  - **Priority:** P3 · **Layer:** Core · **Dependencies:** `MW-VIEW-001`, `MW-ORM-001`
  - **Location:** `packages/orm/src/view.ts`, `packages/types/src/`
  - **Acceptance Criteria:** Graph and Pivot definitions validate groupable/aggregatable fields and exclude `hiddenFields` and write-only fields.
  - **Verification:** `pnpm --filter @moonwitness/orm test`.

- [ ] **MW-VIEW-010** Implement registry-generation-keyed view metadata caching with HTTP `ETag` / `304 Not Modified` on `/api/:model/views` and automatic cache invalidation in `apps/board`.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-VIEW-001`
  - **Location:** `packages/orm/src/registry.ts`, `apps/api/src/routes/generic.routes.ts`, `apps/board/src/hooks/use-model.ts`
  - **Acceptance Criteria:** `/api/:model/views` sends deterministic `ETag` bound to `Registry.getGeneration()` + user role/permissions; `useViews` stops relying on un-invalidated `staleTime: Infinity` across addon/permission changes.
  - **Verification:** `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/board typecheck`.

---

## 08 — Field Widget Engine

- [ ] **MW-WIDGET-001** Create an extensible `FieldWidgetRegistry` in `apps/board/src/components/views/widget-registry.tsx` dispatching cell and form widgets by `(field.type, widgetName)` with typed fallback.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-VIEW-004`, `MW-VIEW-005`
  - **Location:** `apps/board/src/components/views/fields.tsx`
  - **Acceptance Criteria:** Both `FieldCell` and `FieldWidget` resolve components through `FieldWidgetRegistry` rather than monolithic `switch` statements, allowing custom widgets without editing core files.
  - **Verification:** `pnpm --filter @moonwitness/board typecheck && pnpm board:ui:check`.

- [ ] **MW-WIDGET-002** Implement scalar field widgets using `@moonwitness/ui` primitives for `text` (multiline `Textarea`), `float`, `decimal`, `monetary` (currency symbol from record/company), `date`, `datetime` (accessible date/time picker), `json`, `badge`, `color`, `email`, `url`, and `phone`.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-WIDGET-001`, `MW-UI-001`
  - **Location:** `apps/board/src/components/views/`
  - **Acceptance Criteria:** All new scalar field types render read-only cells and editable controls using `@moonwitness/ui` components, preserving timezone/locale formatting (`apps/board/src/lib/date-format.ts`).
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck`.

- [ ] **MW-WIDGET-003** Implement declarative `StatusBar` header widget for `selection`/`state` fields supporting clickable allowed transitions and read-only progress display.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-WIDGET-001`, `MW-VIEW-005`, `MW-UI-002`
  - **Location:** `apps/board/src/components/views/`
  - **Acceptance Criteria:** `FormView` renders a declarative statusbar from `views.form.header` metadata, replacing ad-hoc badge displays while respecting field `readonly` and workflow guards.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck`.

- [ ] **MW-WIDGET-004** Refactor `Many2oneWidget` (`apps/board/src/components/views/fields.tsx`) to use declarative `field.domain`, `field.context`, and target model `_recName`/`search.fields`, removing hardcoded checks for `base.country_state`, `base.country`, `base.bank`, and `base.user`.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-WIDGET-001`, `MW-ORM-008`, `MW-DOM-003`
  - **Location:** `apps/board/src/components/views/fields.tsx`, `apps/board/src/components/views/form-view.tsx`
  - **Acceptance Criteria:** `Many2oneWidget` dynamically evaluates `field.domain` against the live form record (e.g., `country_id` filtering `state_id` and `bank_id`), resolves target search fields from metadata, and supports "Open record" link & optional quick-create dialog.
  - **Verification:** `pnpm --filter @moonwitness/board typecheck` and E2E relation filter test (`apps/board/e2e/`).

- [ ] **MW-WIDGET-005** Upgrade `One2ManyWidget` (`apps/board/src/components/views/one2many-widget.tsx`) to derive `foreignKey` strictly from metadata (removing hardcoded `'partner_id'` fallback) and support inline/modal child record creation & editing without full page navigation loss.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-WIDGET-001`, `MW-VIEW-005`
  - **Location:** `apps/board/src/components/views/one2many-widget.tsx`
  - **Acceptance Criteria:** Saving child lines works smoothly with parent context, preserves unsaved parent guards, and removes `'partner_id'` hardcoding.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` and E2E one2many test.

- [ ] **MW-WIDGET-006** Implement `Many2ManyWidget` (tag pills + searchable multi-select / link table) backed by `manyToMany` field metadata (`MW-ORM-002`).
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-WIDGET-001`, `MW-ORM-002`
  - **Location:** `apps/board/src/components/views/`
  - **Acceptance Criteria:** Users can attach/detach multiple related records (`PartnerCategory`, `Tag`, `AccessGroup`) via accessible multi-select chips/dialog.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck`.

- [ ] **MW-WIDGET-007** Remove all remaining model-specific hardcoding from `apps/board/src/components/views/form-view.tsx` (`country_id -> state_id` reset and `contextDomain`) by wiring `onchange` API execution and dynamic `field.domain`.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-WIDGET-004`, `MW-ORM-005`, `MW-API-003`
  - **Location:** `apps/board/src/components/views/form-view.tsx`
  - **Acceptance Criteria:** Zero model/field name literals (`country`, `state`, `bank`) remain inside generic `FormView` or `fields.tsx`; dependent resets run from server `onchange` or declarative metadata.
  - **Verification:** `pnpm --filter @moonwitness/board typecheck && pnpm lint` + E2E partner address test.

---

## 09 — Action & Menu Engine

- [ ] **MW-ACT-001** Define canonical `ActionDefinition` schemas (`window`, `server`, `client`, `record`) and `ActionResult` protocol (`reload`, `navigate`, `open_window`, `notify`, `download`) in `@moonwitness/types` and `@moonwitness/orm`.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-ADDON-001`
  - **Location:** `packages/types/src/`, `packages/orm/src/`
  - **Acceptance Criteria:** Addons can declare typed actions via `defineAction(...)` on `Addon.actions`, validated at registration and dispatched uniformly via REST and JSON-RPC.
  - **Verification:** `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/orm test`.

- [ ] **MW-ACT-002** Implement a backend `ActionRegistry` + execution engine supporting single-record, multi-record batch (`ids[]`), and model-level server actions with context & domain pre-evaluation.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-ACT-001`, `MW-SEC-003`
  - **Location:** `packages/orm/src/`, `apps/api/src/routes/generic.routes.ts`
  - **Acceptance Criteria:** `POST /api/:model/action/:actionName` and `/api/:model/:id/action/:method` dispatch through `ActionRegistry`, enforce action ACLs, run inside `inRequestTransaction`, log `base.audit_log`, and return typed `ActionResult`.
  - **Verification:** `pnpm --filter @moonwitness/api test`.

- [ ] **MW-ACT-003** Implement declarative Window Actions (opening a model with pre-applied `domain`, default `context`, active `viewModes`, and `target`: `'current' | 'dialog'`) and Client Actions (mounting named workspace pages like WhatsApp or Knowledge Explorer).
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-ACT-001`
  - **Location:** `packages/orm/src/`, `packages/types/src/`
  - **Acceptance Criteria:** Window and Client actions are returned in `/api/app/bootstrap` and `/api/:model/views`, enabling parameterized workspace links and dialog forms.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test`.

- [ ] **MW-ACT-004** Upgrade `AddonMenu` (`packages/orm/src/addon.ts`) into a hierarchical `MenuRegistry` (`id`, `parentId`, `label`, `icon`, `sequence`, `actionId` | `model`, `groups`, `developmentOnly`) replacing flat `getModelMenuInfo`.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-ACT-003`, `MW-ADDON-001`
  - **Location:** `packages/orm/src/addon.ts`, `packages/orm-base/src/manifest.ts`
  - **Acceptance Criteria:** Menus form a validated acyclic tree filtered by caller permissions, installed/enabled addons, and `developmentOnly` toggle; all existing addon menus convert cleanly to the tree contract.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:addon-conformance`.

- [ ] **MW-ACT-005** Expose `/api/app/bootstrap` endpoint returning authenticated user profile, company memberships, enabled addons, hierarchical menu tree, registered window/client actions, and skin preferences in one round-trip.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-ACT-004`, `MW-SEC-001`
  - **Location:** `apps/api/src/routes/`
  - **Acceptance Criteria:** Single authenticated endpoint supplies all shell bootstrap metadata while preserving `/api/models` backwards compatibility for existing tests/clients.
  - **Verification:** `pnpm --filter @moonwitness/api test`.

- [ ] **MW-ACT-006** Implement declarative Smart Buttons (`smartButtons`) on `FormView` headers showing live related record counts and executing Window Actions scoped to the current record.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-ACT-003`, `MW-VIEW-005`
  - **Location:** `apps/board/src/components/views/form-view.tsx`, `packages/orm/src/view.ts`
  - **Acceptance Criteria:** E.g., `base.partner` displays Contacts/Addresses/Activities/Bank Accounts smart buttons fetched via `/api/:model/group-count` or `search_count` and navigates with parent domain/context on click.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + Playwright E2E smart-button click test.

- [ ] **MW-ACT-007** Refactor `apps/board/src/components/layout/app-shell.tsx` to render dynamic sidebar menus and command-palette omnisearch targets from `/api/app/bootstrap` instead of hardcoded links and 4-model search queries.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-ACT-005`
  - **Location:** `apps/board/src/components/layout/app-shell.tsx`
  - **Acceptance Criteria:** Sidebar renders hierarchical addon menus including client-action workspace modules (WhatsApp, Knowledge Explorer, Story Workbench) dynamically based on user grants; command palette searches models declared searchable in metadata.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` and navigation E2E suite.

---

## 10 — Domain & Context Engine

- [ ] **MW-DOM-001** Consolidate domain AST parsing, depth/size bounding, validation, and in-memory evaluation into `@moonwitness/types` (supporting all 16 `DomainOperator` values consistently on server and client).
  - **Priority:** P1 · **Layer:** Shared · **Dependencies:** `MW-PKG-002`
  - **Location:** `packages/types/src/domain.ts`, `packages/orm/src/domain.ts`, `packages/client/src/domain.ts`
  - **Acceptance Criteria:** `packages/client/src/domain.ts` and `packages/orm/src/domain.ts` share the exact AST parser/evaluator from `@moonwitness/types`, fixing client missing operators (`<>`, `like`, `not like`, `=like`, `is null`, `is not null`) and removing loose `==` fallback.
  - **Verification:** Table-driven unit tests across all 16 operators in `packages/types/tests/` and `packages/client/tests/`; run `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/client test`.

- [ ] **MW-DOM-002** Add bounded relational dotted-path resolution (`relation.field`, up to configurable hop depth 2) to SQL domain compilation in `packages/orm/src/domain.ts`.
  - **Priority:** P1 · **Layer:** ORM · **Dependencies:** `MW-DOM-001`
  - **Location:** `packages/orm/src/domain.ts`, `packages/orm/src/base.model.ts`
  - **Acceptance Criteria:** Queries like `[['partner.country.code', '=', 'ID']]` compile safely to parameterized Knex `LEFT JOIN` / `EXISTS` subqueries across PostgreSQL and SQLite, checking field allowlists and `hiddenFields` on every traversed model.
  - **Verification:** Cross-table domain query unit tests on SQLite and PostgreSQL integration test (`pnpm --filter @moonwitness/orm test && pnpm test:integration`).

- [ ] **MW-DOM-003** Implement dynamic context token interpolation (`$uid`, `$partner_id`, `$company_id`, `$today`, `$now`) in domain evaluation for saved filters, record rules, field domains, and window actions.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-DOM-001`
  - **Location:** `packages/types/src/`, `packages/orm/src/domain.ts`
  - **Acceptance Criteria:** Context tokens resolve purely from verified server `ExecutionContext` (`req.auth` / `env.context`) on backend and active user session on frontend, never trusting client-spoofed identity headers.
  - **Verification:** Unit tests in `@moonwitness/types` and `@moonwitness/orm` + negative security tests in `apps/api/tests/`.

- [ ] **MW-DOM-004** Standardize `ExecutionContext` propagation (`userId`, `role`, `companyId`, `lang`, `tz`, `activeTest`, `default_*`) across HTTP headers/cookies, `orm.plugin.ts`, `BaseModel`, `jobs`, and `ModelRepository`.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-DOM-003`
  - **Location:** `apps/api/src/plugins/orm.plugin.ts`, `packages/orm/src/environment.ts`, `packages/client/src/repository.ts`
  - **Acceptance Criteria:** `default_*` values and `activeTest` propagate cleanly into `defaultGet`, `create`, and `searchRead` without breaking company isolation.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test`.

- [ ] **MW-DOM-005** Add `base.saved_filter` model in `@moonwitness/orm-base` allowing users and admins to persist named Search View filters, sort order, group-by, and default filter flag per `(model, company, user | shared)`.
  - **Priority:** P2 · **Layer:** Addon · **Dependencies:** `MW-DOM-003`, `MW-SEC-002`
  - **Location:** `packages/orm-base/src/`
  - **Acceptance Criteria:** Users can create/update/delete their own saved filters; superadmins can publish company-shared default filters; record rules prevent cross-company or cross-user private filter tampering.
  - **Verification:** `pnpm --filter @moonwitness/orm-base test && pnpm --filter @moonwitness/api test`.

- [ ] **MW-DOM-006** Connect Search/List views and Query Builder in `apps/board` to `base.saved_filter` and full 16-operator domain serialization.
  - **Priority:** P3 · **Layer:** Frontend · **Dependencies:** `MW-DOM-005`, `MW-WEB-003`
  - **Location:** `apps/board/src/components/views/query-builder-dialog.tsx`, `apps/board/src/components/views/list-view.tsx`
  - **Acceptance Criteria:** Users can save custom Search/Query Builder conditions as reusable filters, toggle them from the Search bar, and share company-wide filters when authorized.
  - **Verification:** `pnpm --filter @moonwitness/board typecheck` + E2E saved filter test in `apps/board/e2e/`.

---

## 11 — Security & Identity

- [ ] **MW-SEC-001** Move model access policy classification (`internal`, `adminOnly`, `publicRead`) out of hardcoded lists in `apps/api/src/auth/{policy,rules}.ts` into declarative `defineModel` / `defineAddon` security metadata (retaining `knowledge.*` prefix fail-closed deny).
  - **Priority:** P0 · **Layer:** Security · **Dependencies:** `MW-CORE-001`, `MW-ADDON-001`
  - **Location:** `packages/orm/src/model-definition.ts`, `apps/api/src/auth/policy.ts`, `apps/api/src/auth/rules.ts`
  - **Acceptance Criteria:** Newly installed addon models default to fail-closed (`internal` or group-restricted) unless explicitly annotated; `policy.ts` queries compiled registry metadata + `knowledge.*` prefix guard.
  - **Verification:** `pnpm --filter @moonwitness/api exec vitest run tests/security-hardening.test.ts tests/api-orm-hardening.test.ts`.

- [ ] **MW-SEC-002** Allow addons to declare declarative `recordRules` inside manifests (replacing hardcoded `notification.*`, `base.partner`, `base.company` switches in `apps/api/src/auth/rules.ts`) while keeping immutable `company_id` tenant scoping mandatory.
  - **Priority:** P1 · **Layer:** Security · **Dependencies:** `MW-SEC-001`, `MW-DOM-003`
  - **Location:** `packages/orm/src/addon.ts`, `apps/api/src/auth/rules.ts`, `packages/orm-notification/`, `packages/orm-base/`
  - **Acceptance Criteria:** Addons register operation-scoped (`read`, `create`, `write`, `unlink`) record rules using dynamic context domains (`$uid`, `$partner_id`, `$company_id`), ANDed with immutable `company_id` isolation.
  - **Verification:** Negative cross-tenant and cross-user isolation tests in `apps/api/tests/` (`pnpm --filter @moonwitness/api test && pnpm test:integration`).

- [ ] **MW-SEC-003** Implement field-level ACLs (`groups` / `readGroups` / `writeGroups` on `FieldOptions`) enforced consistently across `describeFields`, `search_read`, `browse`, `create`, `write`, `group-count`, and CSV export.
  - **Priority:** P1 · **Layer:** Security · **Dependencies:** `MW-SEC-001`, `MW-ORM-011`
  - **Location:** `packages/orm/src/model-definition.ts`, `packages/orm/src/view.ts`, `apps/api/src/auth/policy.ts`, `apps/api/src/routes/generic.routes.ts`
  - **Acceptance Criteria:** Fields restricted to specific `base.access_group` codes are omitted from `fields`/`views`, stripped from `search_read`/`read`, blocked in domain/group-by queries, and rejected (`403`) on unauthorized `create`/`write`.
  - **Verification:** Positive and negative field-ACL tests in `apps/api/tests/`; `pnpm --filter @moonwitness/api test`.

- [ ] **MW-SEC-004** Implement granular action-level permissions (`allowedGroups` / `operation` on `ActionDefinition`) instead of collapsing every `action_*` call to `'write'`.
  - **Priority:** P1 · **Layer:** Security · **Dependencies:** `MW-ACT-001`, `MW-SEC-001`
  - **Location:** `apps/api/src/auth/policy.ts`, `packages/orm/src/`
  - **Acceptance Criteria:** Addon actions can specify required access groups or roles (`canExecuteAction(auth, model, action)`); UI hides disallowed action buttons and API returns `403` on unauthorized invocation.
  - **Verification:** `pnpm --filter @moonwitness/api test`.

- [ ] **MW-SEC-005** Verify cross-layer authorization parity across REST `/api/:model`, JSON-RPC `/jsonrpc`, `base.attachment`, `group-count`, and addon-specific endpoints (`notification`, `workflow`, `whatsapp`, `knowledge`).
  - **Priority:** P0 · **Layer:** Security · **Dependencies:** `MW-SEC-002`, `MW-SEC-003`, `MW-SEC-004`
  - **Location:** `apps/api/tests/`, `apps/api/src/routes/`
  - **Acceptance Criteria:** Every registered model/endpoint passes negative role, missing group grant, cross-company `X-Company-Id`, and cross-company relation traversal tests (`403`/`404`) via both REST and JSON-RPC.
  - **Verification:** Expand and run authorization matrix test in `apps/api/tests/` (`pnpm --filter @moonwitness/api test && pnpm test:integration`).

- [ ] **MW-SEC-006** Harden `base.attachment` upload/download access control for polymorphic `resource_model`/`resource_id` links and unify shared MIME/size/filename validation across `generic.routes.ts` and `whatsapp/media.ts`.
  - **Priority:** P1 · **Layer:** Security · **Dependencies:** `MW-SEC-002`
  - **Location:** `apps/api/src/routes/generic.routes.ts`, `apps/api/src/whatsapp/media.ts`
  - **Acceptance Criteria:** Attachment uploads verify magic-byte/MIME signatures consistently, validate parent record write permission (not just read), and enforce `company_id` isolation on both REST and WhatsApp media paths.
  - **Verification:** `pnpm --filter @moonwitness/api test`.

- [ ] **MW-SEC-007** Add group-scoped authentication revocation & permission-change cache invalidation so role/group/company-membership edits take effect immediately without stale JWT grant caches.
  - **Priority:** P1 · **Layer:** Security · **Dependencies:** `MW-SEC-001`
  - **Location:** `apps/api/src/plugins/auth.plugin.ts`, `packages/auth/src/service.ts`
  - **Acceptance Criteria:** Modifying `base.user`, `base.group_membership`, `base.model_access`, or `base.company_membership` invalidates cached auth/grant snapshots across API requests immediately.
  - **Verification:** `pnpm --filter @moonwitness/api exec vitest run tests/auth.test.ts` + PostgreSQL multi-request grant revocation test.

- [ ] **MW-SEC-008** Add security checks for dynamic `context` and `domain` inputs sent from clients to `default_get`, `onchange`, and `group-count` so client-supplied context cannot override `userId`, `role`, `companyId`, or `activeTest` bypasses.
  - **Priority:** P0 · **Layer:** Security · **Dependencies:** `MW-DOM-004`
  - **Location:** `apps/api/src/routes/generic.routes.ts`
  - **Acceptance Criteria:** Reserved identity/tenant context keys sent by untrusted clients are stripped or rejected (`400`/`403`) before entering `Environment`.
  - **Verification:** Adversarial context-injection test in `apps/api/tests/security-hardening.test.ts`.

---

## 12 — API & RPC Architecture

- [ ] **MW-API-001** Decompose `apps/api/src/routes/generic.routes.ts` (1,586 lines) into cohesive, single-responsibility route & policy modules (`metadata.routes.ts`, `query.routes.ts`, `mutation.routes.ts`, `attachment.routes.ts`, `jsonrpc.routes.ts`, `generic-policy.ts`).
  - **Priority:** P1 · **Layer:** Backend · **Dependencies:** `MW-SEC-001`, `MW-SEC-005`
  - **Location:** `apps/api/src/routes/generic.routes.ts`
  - **Acceptance Criteria:** Each module is under ~350 lines with one clear boundary; existing generic REST, JSON-RPC, audit, outbox, and attachment behavior remains 100% preserved.
  - **Verification:** `pnpm --filter @moonwitness/api test && pnpm test:integration` (note: capture baseline behavior tests before refactoring per `docs/engineering/refactor-map.md`).

- [ ] **MW-API-002** Achieve full REST <-> JSON-RPC (`execute_kw`) parity by exposing `read`, `search_count`, `search_group_count`, `fields_get`, `views_get`, `default_get`, `onchange`, and `call_action` via `/jsonrpc`.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-API-001`, `MW-ACT-002`, `MW-ORM-005`
  - **Location:** `apps/api/src/routes/generic.routes.ts`, `apps/api/src/auth/policy.ts`, `packages/types/src/jsonrpc.ts`
  - **Acceptance Criteria:** Every `execute_kw` method enforces the same `canAccess`, record rules, field ACLs, bounds checking, audit logging, and transactional outbox semantics as REST.
  - **Verification:** `pnpm --filter @moonwitness/api test` + `packages/client/tests/` RPC contract tests.

- [ ] **MW-API-003** Add REST endpoints `POST /api/:model/default-get` and `POST /api/:model/onchange` backed by ORM hooks (`MW-ORM-005`).
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-ORM-005`, `MW-API-001`
  - **Location:** `apps/api/src/routes/`, `packages/client/src/repository.ts`
  - **Acceptance Criteria:** Creating or editing records fetches dynamic defaults and reactive `onchange` deltas (values + domain overrides + warnings) with field-level ACL filtering applied.
  - **Verification:** `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/client test`.

- [ ] **MW-API-004** Upgrade `/api/base.attachment/upload` from full-buffer `application/octet-stream` memory buffering to streaming ingestion (`putStream` in `@moonwitness/orm-storage`) + multipart support.
  - **Priority:** P1 · **Layer:** Backend · **Dependencies:** `MW-API-001`
  - **Location:** `apps/api/src/routes/generic.routes.ts`, `packages/orm-storage/src/index.ts`, `packages/client/src/repository.ts`
  - **Acceptance Criteria:** Large attachments (up to `MAX_ATTACHMENT_BYTES` 10 MiB) stream directly to local/S3 storage while computing SHA-256 checksum and enforcing size/MIME bounds without buffering full payloads in Node heap.
  - **Verification:** Streaming upload + oversized abort + storage failure compensation tests in `apps/api/tests/`.

- [ ] **MW-API-005** Generate dynamic OpenAPI 3.x schema descriptors for installed addon models and routes in `@fastify/swagger`.
  - **Priority:** P3 · **Layer:** Backend · **Dependencies:** `MW-API-001`, `MW-ORM-001`
  - **Location:** `apps/api/src/app.ts`, `apps/api/src/routes/`
  - **Acceptance Criteria:** Swagger UI `/docs` (when enabled) reflects installed models, query/body schemas, and addon routes derived from canonical ORM metadata rather than generic untyped placeholders.
  - **Verification:** `pnpm --filter @moonwitness/api test` + schema validation check on `app.swagger()`.

- [ ] **MW-API-006** Standardize JSON API response envelopes (`success`, `data`, `meta`, `error`, `code`, `requestId`) and pagination metadata (`count`, `total`, `nextCursor`, `hasMore`) across all REST endpoints.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-CORE-006`, `MW-API-001`
  - **Location:** `packages/types/src/api.ts`, `packages/types/src/routes.ts`, `apps/api/src/routes/`
  - **Acceptance Criteria:** Error responses consistently include `code` and `requestId`; list endpoints support consistent offset and cursor pagination envelopes without breaking existing `@moonwitness/client` callers.
  - **Verification:** `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/client test`.

- [ ] **MW-API-007** Add bulk mutation support (`PATCH /api/:model/bulk`, `DELETE /api/:model/bulk`, batch `action`) bounded to safe limits (`<= 100` IDs) inside a single transaction.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-API-001`, `MW-PERF-002`
  - **Location:** `apps/api/src/routes/`, `packages/client/src/repository.ts`
  - **Acceptance Criteria:** Board bulk archive/tag/action operations send one transactional request instead of `Promise.all` N separate HTTP requests, enforcing per-record scopes and batched `findReference` checks.
  - **Verification:** `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/client test`.

---

## 13 — Backend Transformation: `apps/api`

- [ ] **MW-BACK-001** Decompose oversized WhatsApp sub-routers (`conversations.routes.ts` 1,073 lines, `groups.routes.ts` 1,015 lines, `messages.routes.ts` 864 lines) and `apps/api/src/whatsapp/route-helpers.ts` (831 lines) into cohesive service modules.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** None
  - **Location:** `apps/api/src/routes/whatsapp/`, `apps/api/src/whatsapp/`
  - **Acceptance Criteria:** Business logic (GoWA sync, cursor management, LID merging, outbox enqueueing) moves from Fastify handlers into testable pure service modules; route files stay thin HTTP adapters (< 400 lines each).
  - **Verification:** `pnpm --filter @moonwitness/api exec vitest run tests/whatsapp*.test.ts` and `pnpm lint`.

- [ ] **MW-BACK-002** Remove the 1-line legacy shim `apps/api/src/whatsapp/manifest.ts` once all workers and tests import `whatsappManifest` directly from `@moonwitness/orm-whatsapp`.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-CORE-002`
  - **Location:** `apps/api/src/whatsapp/manifest.ts`, `apps/api/src/addons/registry.ts`, `apps/api/src/commands/`
  - **Acceptance Criteria:** `apps/api/src/whatsapp/manifest.ts` is deleted and zero references remain anywhere in `apps/api`.
  - **Verification:** `pnpm api:addon:check && pnpm build && pnpm --filter @moonwitness/api test`.

- [ ] **MW-BACK-003** Move `apps/api/src/research-review-workflow.ts` and `packages/orm-knowledge` workflow seeding into `knowledge` addon `setup`/`postInstall` inside `@moonwitness/orm-knowledge` (resolving workflow seeding dependency cleanly).
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-ADDON-006`
  - **Location:** `apps/api/src/research-review-workflow.ts`, `packages/orm-knowledge/src/manifest.ts`
  - **Acceptance Criteria:** `apps/api` contains no addon-specific post-install seed logic; `knowledge` addon owns its own workflow definition setup cleanly.
  - **Verification:** `node scripts/knowledge/run-k-gate.mjs --json && pnpm test:addon-conformance`.

- [ ] **MW-BACK-004** Eliminate direct `apps/api` raw DB access (`app.db('...')`) outside ORM `Environment` / `ServiceRegistry` (including `ir_feature_flags`, `auth_state`, and WhatsApp helpers) where ORM models apply.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-CORE-003`, `MW-ORM-007`
  - **Location:** `apps/api/src/`
  - **Acceptance Criteria:** Domain queries route through ORM models/services so audit context, tenant scoping, and schema abstraction apply consistently.
  - **Verification:** `pnpm --filter @moonwitness/api test && pnpm test:integration`.

- [ ] **MW-BACK-005** Move `whatsapp` and `knowledge` route plugins to addon-owned modules (`packages/orm-whatsapp` / `packages/orm-knowledge` or dedicated addon plugin adapters) mounted via `API_ADDONS` `httpPlugins`.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-ADDON-006`, `MW-BACK-001`
  - **Location:** `apps/api/src/addons/registry.ts`, `apps/api/src/routes/`
  - **Acceptance Criteria:** `apps/api/src/addons/registry.ts` registers addon plugins declaratively; `pnpm docs:generate` route extraction continues detecting 100% of registered routes accurately.
  - **Verification:** `pnpm docs:check && pnpm api:addon:check && pnpm --filter @moonwitness/api test`.

- [ ] **MW-BACK-006** Centralize rate-limit policies per route family (auth, generic bulk/upload, RPC, WhatsApp actions, local-ai) with clear `429` `Retry-After` headers and PostgreSQL distributed store parity.
  - **Priority:** P1 · **Layer:** Backend · **Dependencies:** `MW-CORE-004`
  - **Location:** `apps/api/src/app.ts`, `apps/api/src/plugins/rate-limit-store.ts`
  - **Acceptance Criteria:** Distributed rate limits share consistent key generators (`companyId:userId` vs IP) and pass PostgreSQL concurrent multi-instance tests.
  - **Verification:** `pnpm --filter @moonwitness/api exec vitest run tests/rate-limit*.test.ts` + `pnpm test:integration`.

- [ ] **MW-BACK-007** Add end-to-end request correlation (`requestId`), structured database error mapping, and production log-redaction assertions for all new RPC/view/action routes.
  - **Priority:** P1 · **Layer:** Backend · **Dependencies:** `MW-CORE-006`
  - **Location:** `apps/api/src/plugins/observability.plugin.ts`, `apps/api/src/app.ts`
  - **Acceptance Criteria:** Sensitive headers, tokens, passwords, and `sensitive: true` model fields never appear in error payloads, Pino logs, audit logs, or metrics.
  - **Verification:** `pnpm --filter @moonwitness/api exec vitest run tests/security-hardening.test.ts tests/observability*.test.ts`.

---

## 14 — Frontend Transformation: `apps/web` (`apps/board`)

- [ ] **MW-WEB-001** Decompose `apps/board/src/components/views/list-view.tsx` (1,486 lines) into modular engines (`ViewToolbar`, `SearchEngineBar`, `ListTableEngine`, `BulkActionBar`, and `ViewStateAdapter`).
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-VIEW-004`, `MW-VIEW-006`, `MW-API-007`
  - **Location:** `apps/board/src/components/views/list-view.tsx`
  - **Acceptance Criteria:** Each component has clear props and < 400 lines; CSV export, bulk archive (using `MW-API-007`), bulk tagging, sorting, pagination, and column toggle preserve 100% of existing E2E behavior.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck && pnpm --filter @moonwitness/board lint` + list E2E specs.

- [ ] **MW-WEB-002** Build a metadata-driven `KanbanEngine` connected to `views.kanban` (`MW-VIEW-007`), replacing the inline pipeline mockup inside `list-view.tsx`, supporting keyboard + drag/move stage transitions and card field rendering.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-VIEW-007`, `MW-WEB-001`, `MW-UI-003`
  - **Location:** `apps/board/src/components/views/`
  - **Acceptance Criteria:** Models with a `kanban` view render grouped columns, item counts, cards, and accessible keyboard stage actions; respects `permissions.write` and optimistic concurrency.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + Kanban E2E spec.

- [ ] **MW-WEB-003** Build `SearchEngineBar` consuming `views.search` (`fields`, `filters`, `groupBy`, `searchPanel`) + `base.saved_filter` (`MW-DOM-005`) with removable facet chips and grouped counts.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-VIEW-006`, `MW-DOM-005`, `MW-WEB-001`
  - **Location:** `apps/board/src/components/views/`
  - **Acceptance Criteria:** Selecting search fields, preset filters, group-by buckets, or saved filters composes clean Polish-notation domains and displays grouped record rows lazily.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + search/filter E2E test.

- [ ] **MW-WEB-004** Upgrade `FormView` (`apps/board/src/components/views/form-view.tsx`) to `FormEngine` supporting `header` StatusBar + buttons, `smartButtons`, tabbed notebooks, `onchange` API roundtrips, `If-Match` `write_date` headers, and conflict recovery banner.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-VIEW-005`, `MW-WIDGET-007`, `MW-ACT-006`, `MW-API-003`
  - **Location:** `apps/board/src/components/views/form-view.tsx`, `apps/board/src/hooks/use-model.ts`
  - **Acceptance Criteria:** Concurrent edits detect `409 Conflict` via `write_date` and offer clean Reload/Overwrite recovery; `onchange` updates dependent fields smoothly without losing unsaved edits.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck` + form E2E tests.

- [ ] **MW-WEB-005** Implement `CalendarView`, `GraphView`, and `PivotView` dynamic renderers in `apps/board/src/components/views/` powered by `views.calendar`/`graph`/`pivot`, `/api/:model/group-count`, and `@moonwitness/ui/components/chart`.
  - **Priority:** P3 · **Layer:** Frontend · **Dependencies:** `MW-VIEW-008`, `MW-VIEW-009`, `MW-WEB-001`
  - **Location:** `apps/board/src/components/views/`
  - **Acceptance Criteria:** Models declaring `calendar`, `graph`, or `pivot` views expose switcher tabs in `ModelPage`, render accessible charts/tables/calendars, and respect route-aware bundle budgets (lazy-loaded chunks).
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck && pnpm board:budget`.

- [ ] **MW-WEB-006** Add dynamic View Switcher (`list` | `kanban` | `calendar` | `graph` | `pivot`) and Action Dialog runner in `apps/board/src/board-pages/model-page.tsx` driven by active Window Action metadata.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-ACT-003`, `MW-WEB-002`, `MW-WEB-004`
  - **Location:** `apps/board/src/board-pages/model-page.tsx`
  - **Acceptance Criteria:** `/board/m/:model` and action routes honor URL query/action params (`view`, `domain`, `action`) and handle `ActionResult` payloads (`reload`, `navigate`, `notify`, `open_window`).
  - **Verification:** `pnpm --filter @moonwitness/board typecheck` + model navigation E2E tests.

- [ ] **MW-WEB-007** Decompose the remaining `apps/board/src/board-pages/whatsapp-page.tsx` (2,897 lines) into modular hooks and domain components (`useWhatsAppInbox`, `InboxList`, `ConversationTimeline`, `PairingPanel`, completing `todo-foundation.md`).
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** None
  - **Location:** `apps/board/src/board-pages/whatsapp-page.tsx`, `apps/board/src/components/whatsapp/`
  - **Acceptance Criteria:** `whatsapp-page.tsx` delegates inbox, timeline, pairing, and polling state into focused modules (< 500 lines per file) with zero regressions on all WhatsApp E2E specs and zero `oxlint` warnings.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck && pnpm --filter @moonwitness/board lint` + WhatsApp E2E suite.

- [ ] **MW-WEB-008** Modularize `apps/board/src/board-pages/dashboard-page.tsx` (991 lines) into composable KPI, admin operations, and activity widgets consuming addon dashboard cards/actions rather than hardcoded static model fetches.
  - **Priority:** P3 · **Layer:** Frontend · **Dependencies:** `MW-ACT-007`
  - **Location:** `apps/board/src/board-pages/dashboard-page.tsx`
  - **Acceptance Criteria:** Dashboard tiles gracefully adapt to user permissions (omitting forbidden queries cleanly instead of relying on silent catch fallbacks) and preserve all visual audit snapshots.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck`.

- [ ] **MW-WEB-009** Enforce tenant-isolated TanStack Query cache clearing on logout, company switch, and session expiration across all Board routes and dynamic views.
  - **Priority:** P1 · **Layer:** Frontend · **Dependencies:** `MW-ACT-007`
  - **Location:** `apps/board/src/hooks/use-auth.tsx`, `apps/board/src/lib/query-scope.ts`, `apps/board/src/components/layout/app-shell.tsx`
  - **Acceptance Criteria:** Switching company or user clears stale query cache immediately (`queryClient.removeQueries`) and invalidates active view/model queries without cross-tenant flash.
  - **Verification:** E2E multi-company/multi-user isolation suite (`apps/board/e2e/`).

---

## 15 — Shared UI & Design System

- [ ] **MW-UI-001** Add accessible `DatePicker` (date + datetime), `NumberInput` (decimal/monetary formatting), and `BadgeGroup` / `TagInput` primitives to `@moonwitness/ui` with explicit subpath exports.
  - **Priority:** P2 · **Layer:** Shared · **Dependencies:** None
  - **Location:** `packages/ui/src/components/`, `packages/ui/package.json`
  - **Acceptance Criteria:** New primitives use `@moonwitness/ui/styles/tokens.css` CSS variables, include keyboard navigation + `aria-*` semantics, have unit tests, and never bundle domain/API code.
  - **Verification:** `pnpm test:ui && pnpm test:ui-budget`.

- [ ] **MW-UI-002** Add `StatusBar` and `SmartButtonBox` composition primitives to `@moonwitness/ui` adhering to the MoonWitness ink/paper visual language.
  - **Priority:** P2 · **Layer:** Shared · **Dependencies:** None
  - **Location:** `packages/ui/src/components/`, `packages/ui/package.json`
  - **Acceptance Criteria:** Both components support light/dark + skin tokens, focus-visible outlines, compact/comfortable density, and 320px responsive wrapping.
  - **Verification:** `pnpm test:ui && pnpm test:ui-catalog`.

- [ ] **MW-UI-003** Add `KanbanBoard` / `KanbanColumn` and `FilterFacetBar` composition primitives to `@moonwitness/ui` (zero data-fetching logic, purely presentational + accessible keyboard/slot contracts).
  - **Priority:** P2 · **Layer:** Shared · **Dependencies:** None
  - **Location:** `packages/ui/src/components/`, `packages/ui/package.json`
  - **Acceptance Criteria:** Components preserve native semantic roles, reduced-motion support, and bundle isolation (only imported on routes rendering Kanban/Search).
  - **Verification:** `pnpm test:ui && pnpm test:ui-budget`.

- [ ] **MW-UI-004** Extend `@moonwitness/ui/components/table` (`DataTable`) to support inline cell editing slots, sticky column/header accessibility, column visibility toggles, and aggregate footer rows.
  - **Priority:** P2 · **Layer:** Shared · **Dependencies:** None
  - **Location:** `packages/ui/src/components/table.tsx`
  - **Acceptance Criteria:** Existing Table consumers remain 100% backwards-compatible; keyboard focus and `aria-sort` semantics remain intact.
  - **Verification:** `pnpm test:ui`.

- [ ] **MW-UI-005** Add specimens and Playwright visual/Axe accessibility tests for all new UI primitives (`DatePicker`, `StatusBar`, `SmartButtonBox`, `KanbanBoard`, `FilterFacetBar`) inside `apps/ui-catalog`.
  - **Priority:** P3 · **Layer:** Shared · **Dependencies:** `MW-UI-001`, `MW-UI-002`, `MW-UI-003`, `MW-UI-004`
  - **Location:** `apps/ui-catalog/src/catalog.tsx`, `apps/ui-catalog/tests/catalog.spec.ts`
  - **Acceptance Criteria:** All new specimens pass desktop (1440px) and mobile (320px/390px) WCAG 2.1 AA contrast & keyboard checks in light/dark themes.
  - **Verification:** `pnpm test:ui-catalog && pnpm test:ui-budget`.

- [ ] **MW-UI-006** Extend `scripts/check-board-shared-ui.mjs` to ensure zero internal `@moonwitness/ui/src` or `dist` deep imports and zero raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<svg>` across any new Board view/widget files.
  - **Priority:** P2 · **Layer:** Shared · **Dependencies:** `MW-UI-001`
  - **Location:** `scripts/check-board-shared-ui.mjs`
  - **Acceptance Criteria:** Checker scans all `apps/board/src/**/*.{ts,tsx}` including newly added view engines and fails fast on any violation.
  - **Verification:** `pnpm board:ui:check`.

---

## 16 — Skin & Theme Engine

- [ ] **MW-SKIN-001** Define `SkinMetadata`, `SkinDensity` (`'comfortable' | 'compact'`), `ColorMode` (`'light' | 'dark' | 'system'`), and `ThemeRegistry` in `@moonwitness/ui` and `@moonwitness/types`.
  - **Priority:** P3 · **Layer:** Shared · **Dependencies:** `MW-PKG-002`
  - **Location:** `packages/types/src/`, `packages/ui/src/styles/tokens.css`, `packages/ui/src/lib/`
  - **Acceptance Criteria:** `ThemeRegistry` validates skin IDs, CSS token packs, contrast pairings, and density scales without runtime CSS-in-JS bloat.
  - **Verification:** `pnpm test:ui && pnpm --filter @moonwitness/types test`.

- [ ] **MW-SKIN-002** Author built-in MoonWitness CSS skin layers on top of `packages/ui/src/styles/tokens.css`: `moonwitness-ink` (canonical zine/manga ink-paper skin), `moonwitness-compact` (dense ERP operational skin), and `moonwitness-high-contrast` (AAA accessibility skin).
  - **Priority:** P3 · **Layer:** Shared · **Dependencies:** `MW-SKIN-001`
  - **Location:** `packages/ui/src/styles/`
  - **Acceptance Criteria:** Each skin maps cleanly via `[data-skin="..."]` + `.dark` + `[data-density="compact"]`, keeps MoonWitness crown/brand assets coherent, and passes automated contrast validation.
  - **Verification:** Token contrast tests in `packages/ui/tests/tokens.test.mjs` (`pnpm test:ui`).

- [ ] **MW-SKIN-003** Implement runtime `SkinProvider` + pre-paint SSR/localStorage hydration script in `apps/board` (extending `apps/board/src/hooks/use-theme.ts`) preventing FOUC across skin, color mode, and density switches.
  - **Priority:** P3 · **Layer:** Frontend · **Dependencies:** `MW-SKIN-002`
  - **Location:** `apps/board/src/hooks/use-theme.ts`, `apps/board/src/app/layout.tsx`
  - **Acceptance Criteria:** Switching skin, color mode, or density applies immediately with zero reload, zero layout breakage, and preserves pre-paint initialization.
  - **Verification:** `pnpm --filter @moonwitness/board typecheck && pnpm board:budget`.

- [ ] **MW-SKIN-004** Persist user skin/mode/density preferences on `base.user` (`skin`, `theme_mode`, `density` fields via `MW-SCHEMA-002`) and sync them via `/auth/me` & `/board/settings`.
  - **Priority:** P3 · **Layer:** Shared · **Dependencies:** `MW-SKIN-003`, `MW-SCHEMA-002`
  - **Location:** `packages/orm-base/src/models/user.ts`, `apps/api/src/routes/auth.routes.ts`, `apps/board/src/board-pages/settings-page.tsx`
  - **Acceptance Criteria:** Logged-in users retain their chosen skin/theme/density across browsers/sessions while preserving anonymous `localStorage` fallback.
  - **Verification:** `pnpm --filter @moonwitness/api test` + Board settings E2E test.

- [ ] **MW-SKIN-005** Add interactive skin/density switcher and automated WCAG/visual matrix checks in `apps/ui-catalog` verifying component compatibility across every registered skin.
  - **Priority:** P3 · **Layer:** Shared · **Dependencies:** `MW-SKIN-002`, `MW-UI-005`
  - **Location:** `apps/ui-catalog/src/catalog.tsx`, `apps/ui-catalog/tests/catalog.spec.ts`
  - **Acceptance Criteria:** Every primitive and composition component passes Axe WCAG 2.1 AA and zero-overflow checks in every `(skin × light/dark × density)` combination.
  - **Verification:** `pnpm test:ui-catalog`.

---

## 17 — Shared Packages Consolidation

- [ ] **MW-PKG-001** Eliminate all 5 type-only file-level import cycles reported by `node scripts/audit-workspace.mjs` (`orm/base.model.ts <-> environment.ts / model-definition.ts`, `orm-storage/index.ts <-> s3.ts`, `local-ai/index.ts <-> suggestion-generation.ts`, `orm-knowledge/research-release-validation.ts <-> research-release.ts`).
  - **Priority:** P1 · **Layer:** Shared · **Dependencies:** None
  - **Location:** `packages/orm/src/`, `packages/orm-storage/src/`, `packages/local-ai/src/`, `packages/orm-knowledge/src/`
  - **Acceptance Criteria:** `node scripts/audit-workspace.mjs` reports `"localImportCycles": []`, `"runtimeImportCycles": []`, and `"workspaceDependencyCycles": []`.
  - **Verification:** `node scripts/audit-workspace.mjs && pnpm build && pnpm test:unit:built`.

- [ ] **MW-PKG-002** Wire `@moonwitness/client` to depend on `@moonwitness/types` and delete all duplicated types (`FieldMeta`, `ListView`, `FormView`, `SearchView`, `ResolvedViews`, `Domain`, `GroupCount*`, `SearchRead*`) from `packages/client/src/types.ts`.
  - **Priority:** P1 · **Layer:** Shared · **Dependencies:** `MW-PKG-001`
  - **Location:** `packages/client/package.json`, `packages/client/src/types.ts`, `packages/types/src/`
  - **Acceptance Criteria:** Single source of truth for API, ORM metadata, view, action, and domain types lives in `@moonwitness/types` and is re-exported cleanly by `@moonwitness/client` and `@moonwitness/orm`.
  - **Verification:** `pnpm build && pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/client test && pnpm --filter @moonwitness/board typecheck`.

- [ ] **MW-PKG-003** Audit and prune genuinely unused `dependencies` / `devDependencies` flagged by `audit-workspace.mjs` (verifying scripts/peer conventions like `pg`, `tailwindcss`, `oxlint`, `better-sqlite3` before touching anything).
  - **Priority:** P2 · **Layer:** Shared · **Dependencies:** `MW-PKG-001`
  - **Location:** Root & `packages/*/package.json`, `apps/*/package.json`
  - **Acceptance Criteria:** Zero spurious unused runtime dependencies remain (e.g. redundant `objection` in `orm-integration` `devDependencies` if unused), while intentional runtime adapters (`pg`, `better-sqlite3`, CSS/CLI tools) are documented cleanly.
  - **Verification:** `node scripts/audit-workspace.mjs && pnpm verify`.

- [ ] **MW-PKG-004** Align package version `packages/orm-whatsapp/package.json` (`1.14.0` vs monorepo `1.0.0-rc.1`) with the workspace version policy (`scripts/workspace-version-policy.test.mjs`) while preserving its ORM addon manifest semver (`whatsappManifest.version: '1.14.0'`) independently in `_orm_addons`.
  - **Priority:** P1 · **Layer:** Shared · **Dependencies:** None
  - **Location:** `packages/orm-whatsapp/package.json`, `packages/orm-whatsapp/src/manifest.ts`
  - **Acceptance Criteria:** npm workspace `package.json` version matches monorepo release version policy, while runtime addon schema version in `defineAddon({ version })` stays independent so database upgrade chains never break.
  - **Verification:** `pnpm test:workspace-version-policy && pnpm release:check`.

- [ ] **MW-PKG-005** Consolidate duplicated `parseInteger` / `countValue` / error-code helpers only where semantic contracts match across `apps/api` and `@moonwitness/types`.
  - **Priority:** P3 · **Layer:** Shared · **Dependencies:** `MW-API-001`, `MW-PKG-002`
  - **Location:** `packages/types/src/guards.ts`, `apps/api/src/routes/jobs.routes.ts`, `apps/api/src/routes/notification.routes.ts`
  - **Acceptance Criteria:** Verified identical pure parsers live in `@moonwitness/types` with direct unit tests; no bloated generic `utils` dumping ground is created.
  - **Verification:** `pnpm --filter @moonwitness/types test && pnpm --filter @moonwitness/api test`.

- [ ] **MW-PKG-006** Enforce explicit `exports` maps and forbid subpath bypasses across all 22 workspace packages via `audit:workspace` and TypeScript project references.
  - **Priority:** P2 · **Layer:** Shared · **Dependencies:** `MW-PKG-001`, `MW-PKG-002`
  - **Location:** `packages/*/package.json`, `scripts/audit-workspace.mjs`
  - **Acceptance Criteria:** Every library package declares deliberate `exports` (`.` for domain packages; explicit component/asset subpaths for `@moonwitness/ui` and `@moonwitness/assets`) and fails checks on deep internal relative/dist imports across package boundaries.
  - **Verification:** `pnpm audit:workspace && pnpm build`.

---

## 18 — Events, Jobs & Automation

- [ ] **MW-JOB-001** Fix the head-of-line scheduler failure documented in `ROADMAP.md` `K7-005` (`packages/jobs/src/runtime.ts`) so one failing or misfired cron entry does not starve subsequent due cron schedules.
  - **Priority:** P1 · **Layer:** Backend · **Dependencies:** None
  - **Location:** `packages/jobs/src/runtime.ts`, `packages/jobs/tests/runtime.test.ts`
  - **Acceptance Criteria:** Isolate per-cron evaluation/error handling, advance/backoff failed cron safely without blocking sibling crons, and add regression test proving a failing cron no longer blocks healthy crons.
  - **Verification:** `pnpm --filter @moonwitness/jobs test && pnpm test:integration`.

- [ ] **MW-JOB-002** Standardize ORM model lifecycle event publishing (`record.created`, `record.updated`, `record.archived`, `record.deleted`, `record.action_*`) inside `Environment` / `BaseModel` / action execution with unified outbox payload redaction (`sensitive`/`hidden` exclusion).
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-ORM-011`, `MW-JOB-001`
  - **Location:** `packages/orm/src/base.model.ts`, `packages/jobs/src/runtime.ts`, `apps/api/src/routes/generic-audit.ts`
  - **Acceptance Criteria:** Lifecycle outbox events trigger `@moonwitness/orm-integration` webhook subscriptions and `@moonwitness/orm-notification` templates atomically with consistent redacted snapshots.
  - **Verification:** `pnpm --filter @moonwitness/orm-integration test && pnpm --filter @moonwitness/orm-notification test && pnpm test:integration`.

- [ ] **MW-JOB-003** Expose dead-letter (`status = 'dead'`) inspection, safe payload preview, and manual retry/cancel controls for `base.job` and `base.outbox_event` via `jobs.routes.ts` and Board admin panel.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-JOB-001`, `MW-ACT-007`
  - **Location:** `apps/api/src/routes/jobs.routes.ts`, `apps/board/src/components/layout/cron-scheduler-panel.tsx`
  - **Acceptance Criteria:** `system`/`superadmin` can inspect dead jobs/outbox failures, retry bounded batches, and audit-log every manual intervention; regular users receive `403`.
  - **Verification:** `pnpm --filter @moonwitness/api test` + Board admin E2E test.

- [ ] **MW-JOB-004** Complete remaining `orm-workflow` (`M9.03`) and `orm-integration` (`M9.04`) verification gaps: host-level workflow concurrency/expiry verification and live receiver integration parity tests.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-JOB-001`
  - **Location:** `packages/orm-workflow/tests/`, `packages/orm-integration/tests/`
  - **Acceptance Criteria:** All workflow approval, timeout expiry, webhook SSRF/DNS cancellation, and outbox delivery retry paths pass both SQLite unit and PostgreSQL integration suites.
  - **Verification:** `pnpm --filter @moonwitness/orm-workflow test && pnpm --filter @moonwitness/orm-integration test && pnpm test:integration`.

- [ ] **MW-JOB-005** Register addon-contributed job handlers and outbox consumers declaratively on `Addon` manifests (`jobHandlers`, `outboxConsumers`) instead of manual wiring in worker scripts.
  - **Priority:** P2 · **Layer:** Core · **Dependencies:** `MW-CORE-002`, `MW-ADDON-002`
  - **Location:** `packages/orm/src/addon.ts`, `packages/jobs/src/runtime.ts`
  - **Acceptance Criteria:** `jobs-worker` and `outbox-worker` automatically discover and register all handlers/consumers declared by active installed addons.
  - **Verification:** `pnpm --filter @moonwitness/jobs test && pnpm --filter @moonwitness/api test`.

---

## 19 — Configuration, Storage & Internationalization

- [ ] **MW-CFG-001** Add `base.config_parameter` (`ir.config_parameter` pattern) model in `@moonwitness/orm-base` for runtime system & per-company configuration values (typed `string | integer | boolean | json`, `is_secret` masking, admin-only access).
  - **Priority:** P2 · **Layer:** Addon · **Dependencies:** `MW-SEC-001`, `MW-CORE-003`
  - **Location:** `packages/orm-base/src/`
  - **Acceptance Criteria:** Addons and runtime services read typed config defaults with env override precedence; secret parameters are stripped from generic API reads and audit logs.
  - **Verification:** `pnpm --filter @moonwitness/orm-base test && pnpm --filter @moonwitness/api test`.

- [ ] **MW-CFG-002** Add an in-app **General Settings** workspace page in `apps/board` reading/updating non-secret company & addon parameters (`base.config_parameter` + `ir.feature_flag`) cleanly.
  - **Priority:** P3 · **Layer:** Frontend · **Dependencies:** `MW-CFG-001`, `MW-ACT-003`
  - **Location:** `apps/board/src/board-pages/settings-page.tsx`
  - **Acceptance Criteria:** Admins can view/toggle company settings and feature flags with immediate validation and audit logging; non-admins cannot mutate system settings.
  - **Verification:** `pnpm board:ui:check && pnpm --filter @moonwitness/board typecheck`.

- [ ] **MW-CFG-003** Complete S3 / RustFS presigned upload & CORS verification (`todo-wa.md` `P2-05`) and integrate unified `@moonwitness/orm-storage` streaming + orphan reconciliation (`pnpm attachments:reconcile`) across both `base.attachment` and `whatsapp.message` media.
  - **Priority:** P1 · **Layer:** Backend · **Dependencies:** `MW-API-004`
  - **Location:** `packages/orm-storage/src/s3.ts`, `apps/api/src/commands/attachments-reconcile.ts`, `apps/api/tests/whatsapp-attachments-job.postgres.integration.test.ts`
  - **Acceptance Criteria:** Direct S3 presigned POST + CORS, checksum verification, streaming fallback, and dry-run/apply orphan cleanup pass against local RustFS/MinIO S3 fixture without skipping acceptance tests.
  - **Verification:** `pnpm --filter @moonwitness/orm-storage test && pnpm test:whatsapp`.

- [ ] **MW-CFG-004** Establish an internationalization (`i18n`) catalog layer translating model labels, view titles, menu groups, selection labels, and Board UI strings based on user `base.user.language` / `Accept-Language`.
  - **Priority:** P3 · **Layer:** Shared · **Dependencies:** `MW-DOM-004`
  - **Location:** `packages/orm/src/view.ts`, `packages/types/src/`, `apps/board/src/`
  - **Acceptance Criteria:** `/api/:model/views` and `/api/app/bootstrap` accept `lang` / `Accept-Language` and localize registered labels (with `en-US` fallback); Board displays translated headings, buttons, and date/number formats cleanly at 320px/1440px.
  - **Verification:** `pnpm --filter @moonwitness/api test && pnpm --filter @moonwitness/board typecheck` + locale E2E test (`en-US` and `id-ID`).

- [ ] **MW-CFG-005** Document and enforce the explicit Platform Capability Classification Matrix (`Core` vs `Addon` vs `External` vs `Deferred`) for backup/recovery (`pnpm test:restore-drill`), reporting, and import/export.
  - **Priority:** P2 · **Layer:** Infrastructure · **Dependencies:** `MW-DOC-001`
  - **Location:** `docs/architecture/`, `scripts/verify-application-restore.mjs`
  - **Acceptance Criteria:** Every capability in Mission Section K has a verified home, test command, or explicit deferred rationale—zero ungrounded enterprise stubs.
  - **Verification:** `pnpm test:restore-drill` (with PostgreSQL fixture) and `pnpm docs:check`.

---

## 20 — Performance & Optimization

- [ ] **MW-PERF-001** Add generation- and revocation-aware in-memory caching for user auth profile, active company memberships, and `ModelAccess` group grants in `apps/api/src/plugins/auth.plugin.ts` (replacing 3 DB queries per HTTP request).
  - **Priority:** P1 · **Layer:** Backend · **Dependencies:** `MW-SEC-007`
  - **Location:** `apps/api/src/plugins/auth.plugin.ts`
  - **Acceptance Criteria:** Auth hook caches `(userId -> profile + memberships + grants)` with short bounded TTL and immediate invalidation on `base.user` / membership / grant mutations; cuts per-request auth DB overhead while passing every session-revocation & role-change security test.
  - **Verification:** `pnpm --filter @moonwitness/api exec vitest run tests/auth.test.ts tests/postgres.performance.integration.test.ts`.

- [ ] **MW-PERF-002** Batch `findReference()` reverse-FK lookups in `apps/api/src/routes/generic.routes.ts` and `BaseModel.unlink` so bulk archive/delete checks 100 IDs in `O(referencingModels)` `WHERE col IN (...)` queries instead of `O(N × referencingModels)` queries.
  - **Priority:** P2 · **Layer:** Backend · **Dependencies:** `MW-ORM-010`
  - **Location:** `apps/api/src/routes/generic.routes.ts`, `packages/orm/src/base.model.ts`
  - **Acceptance Criteria:** Bulk archiving 50 records executes a constant number of reverse-FK queries bounded by referencing tables, never N+1.
  - **Verification:** Query-count assertion test in `apps/api/tests/postgres.performance.integration.test.ts`.

- [ ] **MW-PERF-003** Optimize `ListView` / `One2ManyWidget` / `Many2oneWidget` data fetching in `apps/board`: fetch `fields` subset declared in `list.columns` (instead of `SELECT *`), debounce search/typeahead consistently (`250ms`), and avoid duplicate `count=true` queries when page state didn't change filter.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-WEB-001`, `MW-WIDGET-004`
  - **Location:** `apps/board/src/components/views/list-view.tsx`, `apps/board/src/components/views/fields.tsx`, `apps/board/src/hooks/use-model.ts`
  - **Acceptance Criteria:** List requests specify `fields` projection matching visible + required columns, reducing payload size and DB I/O while keeping optimistic `write_date` available for quick edits.
  - **Verification:** `pnpm --filter @moonwitness/board typecheck` + network-payload assertion in Playwright E2E.

- [ ] **MW-PERF-004** Enforce PostgreSQL query-cost benchmarks (`apps/api/tests/postgres.performance.integration.test.ts`) and knowledge capacity benchmarks (`scripts/knowledge/benchmark-knowledge-capacity.mjs`) across extended ORM models and dotted relational queries.
  - **Priority:** P2 · **Layer:** QA · **Dependencies:** `MW-DOM-002`, `MW-ORM-004`
  - **Location:** `apps/api/tests/postgres.performance.integration.test.ts`, `scripts/knowledge/benchmark-knowledge-capacity.mjs`
  - **Acceptance Criteria:** Regression benchmarks measure query counts, p95 response latency, and memory ceiling on PostgreSQL without N+1 regressions.
  - **Verification:** `pnpm test:integration`.

- [ ] **MW-PERF-005** Maintain strict route-aware JavaScript/CSS bundle budgets across all `apps/board` routes (`pnpm board:budget`) and `@moonwitness/ui-catalog` (`pnpm test:ui-budget`) as new view engines (`Kanban`, `Calendar`, `Graph`, `Pivot`) are added.
  - **Priority:** P2 · **Layer:** Frontend · **Dependencies:** `MW-WEB-005`, `MW-SKIN-003`
  - **Location:** `scripts/check-board-bundle.mjs`, `scripts/check-ui-catalog-budget.mjs`
  - **Acceptance Criteria:** `Calendar`, `Graph`, and `Pivot` view engines are dynamically code-split (`next/dynamic`) so initial `/`, `/login`, and `/board` JS budgets never regress.
  - **Verification:** `pnpm build && pnpm board:budget && pnpm test:ui-budget`.

---

## 21 — Security & Reliability Hardening

- [ ] **MW-HARD-001** Reconcile retired `.github/workflows/{gitleaks,codeql,browser-matrix,deep-regression,platform-audit}.yml` references in `scripts/check-gitleaks-config.mjs`, `scripts/platform-audit.mjs`, and docs, and ensure `pnpm automation:check:secrets` + secret scanning run cleanly in `.github/workflows/ci.yml` (`K9-002`).
  - **Priority:** P0 · **Layer:** Security · **Dependencies:** None
  - **Location:** `scripts/check-gitleaks-config.mjs`, `scripts/platform-audit.mjs`, `.github/workflows/ci.yml`
  - **Acceptance Criteria:** No automation audit script references nonexistent workflows as active scheduled failures; secret scanning (`gitleaks` / `check-gitleaks-config.mjs`) passes deterministically locally and in CI.
  - **Verification:** `pnpm automation:check:secrets && pnpm test:secrets && pnpm test:platform-audit`.

- [ ] **MW-HARD-002** Triage and resolve or policy-document the 20 Trivy container toolchain library CVEs (`brace-expansion`, `ip-address`, `picomatch`, `pacote`, `postcss-selector-parser`, `sigstore`, `sigstore-core`) identified in `ROADMAP.md` `M8.03`, and verify `Dockerfile` builds cleanly with zero CRITICAL vulnerabilities.
  - **Priority:** P1 · **Layer:** Security · **Dependencies:** None
  - **Location:** `Dockerfile`, `docs/security/vulnerability-policy.json`, `pnpm-workspace.yaml`
  - **Acceptance Criteria:** Base Node image & npm/pnpm toolchain overrides minimize reachable CVEs; any remaining non-runtime toolchain exceptions have explicit documented expiry in `vulnerability-policy.json`.
  - **Verification:** `pnpm test:security-policy && pnpm audit --prod --audit-level=high` + container Trivy scan.

- [ ] **MW-HARD-003** Audit and harden all `/jsonrpc`, `/api/:model/group-count`, `default-get`, and `onchange` endpoints against payload amplification, deep relation recursion, and CSV formula injection.
  - **Priority:** P0 · **Layer:** Security · **Dependencies:** `MW-API-002`, `MW-API-003`, `MW-DOM-002`
  - **Location:** `apps/api/src/routes/generic-query-graph.ts`, `apps/api/src/routes/generic.routes.ts`, `apps/board/src/lib/csv-export.ts`
  - **Acceptance Criteria:** Query depth, field list length (`<= 100`), group-by cardinality (`<= 3` fields, `<= 500` groups), and payload byte limits are enforced uniformly across REST & JSON-RPC.
  - **Verification:** `pnpm --filter @moonwitness/api exec vitest run tests/security-hardening.test.ts tests/api-orm-hardening.test.ts` and `pnpm test:board-csv`.

- [ ] **MW-HARD-004** Verify `pnpm test:restore-drill` (`scripts/verify-application-restore.mjs`) and `packages/orm-knowledge` interrupted-write/PITR drills (`K9-003`) against PostgreSQL after ORM schema sync and addon lifecycle updates.
  - **Priority:** P1 · **Layer:** Infrastructure · **Dependencies:** `MW-SCHEMA-008`, `MW-ADDON-005`
  - **Location:** `scripts/verify-application-restore.mjs`, `apps/api/src/commands/restore-drill-fixture.ts`, `packages/orm-knowledge/tests/migration-and-interrupted-write.test.ts`
  - **Acceptance Criteria:** Backup/restore restores all addon tables, `_orm_addons`, `_orm_data`, append-only triggers, relations, and user credentials with full integrity checks passing.
  - **Verification:** `pnpm test:restore-drill` (with PostgreSQL running) and `pnpm --filter @moonwitness/orm-knowledge test`.

- [ ] **MW-HARD-005** Verify constitutional invariants (`node scripts/evolution/check-constitution.mjs`) and monotonic fitness ratchet (`node scripts/evolution/check-ratchet.mjs`) remain strictly green throughout transformation work.
  - **Priority:** P1 · **Layer:** Security · **Dependencies:** None
  - **Location:** `scripts/evolution/check-constitution.mjs`, `scripts/evolution/check-ratchet.mjs`
  - **Acceptance Criteria:** `engines.node` stays `22.x` until intentionally amended, immutable security test suites stay intact, and no legacy model/addon allowlist entries return.
  - **Verification:** `pnpm evolution:check && pnpm api:addon:check`.

---

## 22 — Testing & Quality Assurance

- [ ] **MW-QA-001** Build comprehensive unit + SQLite + PostgreSQL integration suites for new ORM capabilities (`extendModel`, computed/stored fields, `onchange`, `Recordset`, `manyToMany`, schema column/enum/FK diffing, uninstall).
  - **Priority:** P1 · **Layer:** QA · **Dependencies:** `MW-ORM-003`, `MW-ORM-004`, `MW-SCHEMA-003`, `MW-ADDON-004`
  - **Location:** `packages/orm/tests/`, `apps/api/tests/postgres.integration.test.ts`
  - **Acceptance Criteria:** Zero skipped assertions on PostgreSQL when `POSTGRES_TEST_URL` is configured (`REQUIRE_POSTGRES_TESTS=true`); covers both happy paths and failure rollback.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm test:integration`.

- [ ] **MW-QA-002** Expand `scripts/roadmap/addon-conformance.test.mjs` to validate views, hierarchical menus, actions, field ACLs, record rules, and repeated upgrade/disable/re-enable idempotency across all workspace addons.
  - **Priority:** P1 · **Layer:** QA · **Dependencies:** `MW-ADDON-007`, `MW-VIEW-002`, `MW-ACT-004`, `MW-SEC-001`
  - **Location:** `scripts/roadmap/addon-conformance.test.mjs`
  - **Acceptance Criteria:** Any workspace addon missing views, broken domain filters, colliding seed IDs, or broken model security defaults fails conformance immediately.
  - **Verification:** `pnpm test:addon-conformance`.

- [ ] **MW-QA-003** Build an automated full-matrix API authorization & tenant-isolation test covering all 73+ registered models × 3 roles (`system`, `superadmin`, `user`) × (`read`, `create`, `write`, `unlink`, `action`, `group-count`, `jsonrpc`).
  - **Priority:** P0 · **Layer:** QA · **Dependencies:** `MW-SEC-005`
  - **Location:** `apps/api/tests/`
  - **Acceptance Criteria:** Matrix runs dynamically over `Registry.getNames()` so every newly added or extended model is automatically verified for negative/positive access and cross-company isolation.
  - **Verification:** `pnpm --filter @moonwitness/api test && pnpm test:integration`.

- [ ] **MW-QA-004** Add dedicated automated tests for all Board dynamic view engines (`List`, `Form`, `Kanban`, `Calendar`, `Graph`, `Pivot`, `Search`, `SmartButtons`, `Widgets`) and skin switching against real Fastify API + PostgreSQL (`pnpm test:e2e`).
  - **Priority:** P2 · **Layer:** QA · **Dependencies:** `MW-WEB-006`, `MW-SKIN-005`
  - **Location:** `apps/board/e2e/`
  - **Acceptance Criteria:** Playwright specs exercise real PostgreSQL-backed CRUD, relational filtering, saved filters, `409` optimistic conflict recovery, skin persistence, and 320px/1440px responsive rendering.
  - **Verification:** `pnpm test:e2e` and `pnpm test:e2e:visual:matrix`.

- [ ] **MW-QA-005** Add unit test coverage for `apps/api/src/commands/db-migrate.ts` (`--dry-run`, advisory lock contention, `SKIP_BOOT_MIGRATIONS=true` boot parity) and worker runtime isolation (`K7-005` cron isolation).
  - **Priority:** P1 · **Layer:** QA · **Dependencies:** `MW-CORE-001`, `MW-SCHEMA-006`, `MW-JOB-001`
  - **Location:** `apps/api/tests/`, `packages/jobs/tests/`
  - **Acceptance Criteria:** Critical boot/migration/scheduler branches pass coverage thresholds in `docs/testing/coverage-thresholds.json`.
  - **Verification:** `pnpm test:coverage-policy && pnpm test:unit`.

- [ ] **MW-QA-006** Execute cross-browser (`Chromium`, `Firefox`, `WebKit`) E2E and visual regression matrix (`M3.11`) after platform transformation and eliminate any browser-specific layout/focus defects.
  - **Priority:** P2 · **Layer:** QA · **Dependencies:** `MW-QA-004`
  - **Location:** `apps/board/e2e/`, `scripts/run-visual-matrix.mjs`
  - **Acceptance Criteria:** Visual & functional matrix passes across Chromium, Firefox, and WebKit on light/dark and skins without horizontal overflow or console errors.
  - **Verification:** `pnpm test:e2e:visual:matrix`.

---

## 23 — Developer Experience & Tooling

- [ ] **MW-DX-001** Standardize Node `22.x` LTS toolchain parity across local dev (`.nvmrc` / `.node-version`), CI (`.github/workflows/ci.yml`), and `Dockerfile` (closing the open `v24.22.1` vs `22.x` drift noted in `todo-foundation.md`).
  - **Priority:** P2 · **Layer:** Infrastructure · **Dependencies:** None
  - **Location:** `.nvmrc`, `package.json`, `Dockerfile`
  - **Acceptance Criteria:** `.nvmrc` pins `22` (matching `engines.node: "22.x"`); local verification confirms builds, native `better-sqlite3` addons, and tests behave identically under Node 22 and CI runners.
  - **Verification:** `pnpm build && pnpm test:unit:built && pnpm test:package-manager`.

- [ ] **MW-DX-002** Add a unified addon developer CLI command (`pnpm addon:create` / upgraded generator) producing compliant `packages/orm-<name>` packages with models, extensions, views, menus, actions, record rules, and conformance tests.
  - **Priority:** P3 · **Layer:** Infrastructure · **Dependencies:** `MW-ADDON-009`
  - **Location:** `scripts/`, `package.json`
  - **Acceptance Criteria:** Running `pnpm addon:create -- --name example` creates a workspace package that builds and passes `pnpm test:addon-conformance` immediately.
  - **Verification:** CLI dry-run + test in `scripts/`.

- [ ] **MW-DX-003** Add a runtime schema & metadata inspector CLI (`pnpm orm:inspect` / `pnpm db:migrate -- --dry-run`) showing registered addons, model fields, inherited extensions, resolved views, and pending DB schema diffs.
  - **Priority:** P3 · **Layer:** Infrastructure · **Dependencies:** `MW-SCHEMA-006`, `MW-VIEW-001`
  - **Location:** `apps/api/src/commands/`, `package.json`
  - **Acceptance Criteria:** Developers can inspect effective merged models, views, actions, and security rules in JSON or table output without starting an HTTP listener.
  - **Verification:** Unit test for CLI output format + `pnpm --filter @moonwitness/api build`.

- [ ] **MW-DX-004** Optimize `turbo.json` task pipeline inputs/outputs so incremental `pnpm build`, `typecheck`, and package-scoped test runs cache cleanly without stale `.d.ts` artifacts.
  - **Priority:** P3 · **Layer:** Infrastructure · **Dependencies:** `MW-PKG-001`
  - **Location:** `turbo.json`, `scripts/ci/build-workspace.mjs`
  - **Acceptance Criteria:** Workspace incremental rebuilds respect topological dependencies (`@moonwitness/types` -> `@moonwitness/orm` -> `@moonwitness/orm-*` -> `apps/*`) with deterministic outputs.
  - **Verification:** `pnpm build && pnpm typecheck`.

---

## 24 — Documentation

- [ ] **MW-DOC-001** Extend deterministic reference generators (`scripts/docs/generate-reference.mjs` and `scripts/architecture/generate-diagrams.mjs`) to document extended model fields, inheritance edges, multi-views (`kanban`/`calendar`/`graph`/`pivot`), actions, menus, and skin tokens.
  - **Priority:** P2 · **Layer:** Infrastructure · **Dependencies:** `MW-ADDON-001`, `MW-VIEW-001`, `MW-ACT-001`
  - **Location:** `scripts/docs/generate-reference.mjs`, `scripts/architecture/generate-diagrams.mjs`, `docs/`
  - **Acceptance Criteria:** Two consecutive runs of `pnpm docs:generate` and `pnpm architecture:generate` produce byte-identical output covering all 73+ models and extended contracts with zero secrets.
  - **Verification:** `pnpm docs:generate && pnpm docs:check && pnpm architecture:check`.

- [ ] **MW-DOC-002** Update Addon Developer Guide, ORM Schema Guide, Model–View Guide, and Security Architecture docs in `docs/` (including explaining `apps/board` as canonical web app and Skin Engine usage in `packages/ui/README.md`).
  - **Priority:** P2 · **Layer:** Infrastructure · **Dependencies:** `MW-DOC-001`, `MW-SKIN-002`
  - **Location:** `docs/addons/`, `docs/architecture/`, `packages/ui/README.md`, `packages/ui/TOKENS.md`
  - **Acceptance Criteria:** Documentation matches actual implemented APIs, field kinds, inheritance hooks, and CLI commands; zero broken links or anchors.
  - **Verification:** `pnpm docs:links && pnpm docs:examples:check && pnpm docs:build`.

- [ ] **MW-DOC-003** Complete executable documentation example tests (`packages/orm/examples/`) covering `extendModel`, `extendView`, `defineAction`, computed fields, and `uninstallAddon`.
  - **Priority:** P3 · **Layer:** Infrastructure · **Dependencies:** `MW-ORM-003`, `MW-VIEW-001`, `MW-ACT-001`
  - **Location:** `packages/orm/examples/`, `packages/orm/tests/addon.test.ts`
  - **Acceptance Criteria:** All documented code snippets typecheck (`tsc --noEmit`) and execute cleanly against SQLite in CI.
  - **Verification:** `pnpm docs:examples:check`.

- [ ] **MW-DOC-004** Complete GitHub Pages deployment & versioned docs retention verification (`ROADMAP.md` `M6.07`–`M6.11`, `M10.09`) once changes promote to `main`.
  - **Priority:** P3 · **Layer:** Infrastructure · **Dependencies:** `MW-DOC-002`, `MW-CICD-002`
  - **Location:** `.github/workflows/pages.yml`, `apps/docs/`
  - **Acceptance Criteria:** Production docs portal deploys safely from exact `main` SHA via Actions artifact without secret leaks or broken base-path links.
  - **Verification:** `pnpm test:docs-portal && pnpm test:docs-publication && pnpm docs:publication:check`.

---

## 25 — CI/CD & Production Readiness

- [ ] **MW-CICD-001** Verify full local `pnpm verify` + `pnpm test:integration` (PostgreSQL) + `pnpm test:e2e` (Playwright + PostgreSQL) + `pnpm test:ui-catalog` pass with zero errors or unapproved skips after platform changes.
  - **Priority:** P0 · **Layer:** Infrastructure · **Dependencies:** `MW-QA-001`, `MW-QA-003`, `MW-QA-004`
  - **Location:** `.github/workflows/ci.yml`, `package.json`
  - **Acceptance Criteria:** Every local and CI technical lane (`quality-and-build`, `unit-tests`, `knowledge-gate`, `postgres-integration`, Board E2E, UI catalog) passes on exact candidate commit SHA.
  - **Verification:** `pnpm verify && pnpm test:integration && pnpm test:e2e && pnpm test:ui-catalog`.

- [ ] **MW-CICD-002** Unblock and verify `dev -> main` PR promotion (`M1.08`), `sync-main-to-dev`, and hosted CI aggregate gate (`ci-gate`) with required CODEOWNER review.
  - **Priority:** P1 · **Layer:** Infrastructure · **Dependencies:** `MW-CICD-001`, `MW-HARD-001`
  - **Location:** `.github/workflows/`, `ROADMAP.md`
  - **Acceptance Criteria:** Promotion PR merges cleanly with exact-SHA green checks; `main -> dev` sync stays consistent with zero force pushes or extra branches.
  - **Verification:** `pnpm test:promotion-policy && pnpm test:expected-ref && pnpm test:ci-gate`.

- [ ] **MW-CICD-003** Validate production Docker image builds (`api`, `board`), Compose interpolation (`docker-compose.production.yml`, `docker-compose.prd.yml`), pre-deploy `db:migrate:built`, and `/readyz` checks across API and worker containers (`jobs-worker`, `jobs-scheduler`, `outbox-worker`).
  - **Priority:** P0 · **Layer:** Infrastructure · **Dependencies:** `MW-CORE-002`, `MW-SCHEMA-006`, `MW-HARD-002`
  - **Location:** `Dockerfile`, `docker-compose.production.yml`, `docker-compose.prd.yml`, `docker-compose.smoke.yml`
  - **Acceptance Criteria:** Built production containers boot cleanly with `SKIP_BOOT_MIGRATIONS=true` after `db:migrate:built`, pass `/readyz`, serve Board -> API proxy traffic, and clean up gracefully.
  - **Verification:** `pnpm test:e2e:diagnostics` + Linux container smoke check (`docker compose -f docker-compose.smoke.yml up` / CI smoke).

- [ ] **MW-CICD-004** Complete hosted release dry-run/prepare/attestation verification (`M7.05`–`M7.16`, `M10.06`–`M10.07`, `K9-006`) for the next monorepo release candidate/stable milestone.
  - **Priority:** P2 · **Layer:** Infrastructure · **Dependencies:** `MW-CICD-002`, `MW-CICD-003`, `MW-PKG-004`
  - **Location:** `.github/workflows/release*.yml`, `scripts/release-*.mjs`
  - **Acceptance Criteria:** `release:check`, `release:dry-run`, `release:verify-attestations`, and hosted tag-triggered release artifacts/SBOM/GHCR provenance pass without clean-tree mismatches.
  - **Verification:** `pnpm release:check && pnpm test:release-dry-run && pnpm test:release-workflow && pnpm test:release-verify-attestations`.

- [ ] **MW-CICD-005** Complete `K9-001`–`K9-007` production go/no-go readiness checklist (exact-SHA hosted PostgreSQL `knowledge-gate` with `K_GATE_REQUIRE_ALL_TESTS=1`, offline egress-denial check, safeguarding/policy sign-offs).
  - **Priority:** P1 · **Layer:** Infrastructure · **Dependencies:** `MW-CICD-001`, `MW-HARD-004`, `MW-JOB-004`
  - **Location:** `scripts/knowledge/run-k-gate.mjs`, `docs/roadmap/evidence/K9-007.md`
  - **Acceptance Criteria:** Automated `K9-001` gate, egress-denial suite, and restore drills pass cleanly; governance owner sign-offs are recorded before enabling any public publication endpoints.
  - **Verification:** `node scripts/knowledge/run-k-gate.mjs --json` (with `K_GATE_REQUIRE_ALL_TESTS=1` against PostgreSQL).

---

## 26 — End-to-End Platform Integration

> **Mandatory Cross-Layer Acceptance Gate:** Proves the entire MoonWitness platform works seamlessly from addon package discovery through PostgreSQL persistence to dynamic Next.js browser UI. Execute using a representative test addon (e.g., `orm-request` or a dedicated conformance fixture addon + upstream extension) against live Fastify API + PostgreSQL + Chromium.

- [ ] **MW-E2E-001** **Addon Discovery:** Workspace addon is automatically discovered from `packages/*` by the Core Runtime without hardcoding route/model imports inside `apps/api/src/app.ts`.
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-ADDON-002`, `MW-CORE-002`
  - **Location:** `apps/api/src/addons/registry.ts`, `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** Addon registers via canonical discovery entry and passes `pnpm api:addon:check`.
  - **Verification:** `pnpm api:addon:check && pnpm test:addon-conformance`.

- [ ] **MW-E2E-002** **Manifest Validation:** Addon manifest (`version`, `depends`, `models`, `extensions`, `views`, `actions`, `menus`, `security`, `data`) is validated fail-closed prior to DB mutation.
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-ADDON-001`, `MW-E2E-001`
  - **Location:** `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** Malformed manifests or invalid references abort cleanly before acquiring transaction locks.
  - **Verification:** `pnpm test:addon-conformance`.

- [ ] **MW-E2E-003** **Dependency Resolution:** Addon topological installer resolves multi-level dependencies (`request -> workflow -> notification -> jobs -> base`) and model FK dependencies deterministically regardless of input order.
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-E2E-002`
  - **Location:** `packages/orm/src/addon.ts`
  - **Acceptance Criteria:** Reversed or shuffled addon lists install in identical topological order without missing-table errors.
  - **Verification:** `pnpm test:addon-conformance`.

- [ ] **MW-E2E-004** **ORM Model & Extension Registration:** Addon models and `extendModel` upstream extensions register into `Registry`, merging `fields`, computed fields, constraints, and `jsonSchema` cleanly even when `SKIP_BOOT_MIGRATIONS=true`.
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-CORE-001`, `MW-ORM-003`, `MW-E2E-003`
  - **Location:** `packages/orm/src/registry.ts`, `packages/orm/src/model-definition.ts`
  - **Acceptance Criteria:** Both API server and worker processes see identical merged `Registry` model schemas regardless of `SKIP_BOOT_MIGRATIONS`.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test`.

- [ ] **MW-E2E-005** **ORM Schema Synchronization:** `db:migrate` / `installAddons` creates tables, columns, enum `CHECK` constraints, indexes, unique keys, and foreign keys in PostgreSQL automatically (without external SQL migration scripts).
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-SCHEMA-003`, `MW-SCHEMA-004`, `MW-E2E-004`
  - **Location:** `packages/orm/src/addon.ts`, `apps/api/src/commands/db-migrate.ts`
  - **Acceptance Criteria:** `pnpm db:migrate` synchronizes PostgreSQL schema idempotently and `pnpm db:migrate -- --dry-run` reports zero pending changes afterwards.
  - **Verification:** `pnpm test:integration`.

- [ ] **MW-E2E-006** **Permission Registration:** Addon model ACLs, field-level group restrictions, action permissions, and record rules register atomically and persist seed grants in `base.model_access`.
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-SEC-001`, `MW-SEC-002`, `MW-SEC-003`, `MW-E2E-005`
  - **Location:** `apps/api/src/auth/`, `packages/orm-base/`
  - **Acceptance Criteria:** Registered security rules enforce immediately on API boot with zero manual policy edits in `apps/api`.
  - **Verification:** `pnpm --filter @moonwitness/api test && pnpm test:integration`.

- [ ] **MW-E2E-007** **View Registration & Inheritance:** Addon base views and `extendView` extensions merge and validate cleanly into `ResolvedViews` (`list`, `form`, `search`, `kanban`, `calendar`, `graph`, `pivot`).
  - **Priority:** P1 · **Layer:** Integration · **Dependencies:** `MW-VIEW-001`, `MW-VIEW-002`, `MW-E2E-004`
  - **Location:** `packages/orm/src/view.ts`
  - **Acceptance Criteria:** Extended fields and sections appear in `/api/:model/views` at the exact declared positions.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test`.

- [ ] **MW-E2E-008** **Action Registration:** Addon Window, Server, Client, and Record actions register into `ActionRegistry` and return authorized action metadata to clients.
  - **Priority:** P1 · **Layer:** Integration · **Dependencies:** `MW-ACT-001`, `MW-ACT-002`, `MW-E2E-006`
  - **Location:** `packages/orm/src/`, `apps/api/src/routes/`
  - **Acceptance Criteria:** Actions execute transactionally, audit-log invocations, and return typed `ActionResult` payloads.
  - **Verification:** `pnpm --filter @moonwitness/api test`.

- [ ] **MW-E2E-009** **Menu Registration:** Addon hierarchical menus appear in `/api/app/bootstrap` filtered by user access grants, addon active state, and `developmentOnly` mode.
  - **Priority:** P1 · **Layer:** Integration · **Dependencies:** `MW-ACT-004`, `MW-ACT-005`, `MW-E2E-008`
  - **Location:** `packages/orm/src/addon.ts`, `apps/api/src/routes/`
  - **Acceptance Criteria:** Authorized users see addon menus in proper hierarchy and order; unauthorized users never see restricted entries.
  - **Verification:** `pnpm --filter @moonwitness/api test`.

- [ ] **MW-E2E-010** **Metadata Delivery to `apps/board`:** `apps/board` fetches `/api/app/bootstrap` and `/api/:model/views` via `@moonwitness/client` without hardcoding model schemas, menus, or field rules locally.
  - **Priority:** P1 · **Layer:** Integration · **Dependencies:** `MW-ACT-007`, `MW-VIEW-010`, `MW-E2E-009`
  - **Location:** `apps/board/src/components/layout/app-shell.tsx`, `apps/board/src/board-pages/model-page.tsx`
  - **Acceptance Criteria:** Browser network trace confirms menus, view sections, widgets, smart buttons, and field rules originate dynamically from API metadata.
  - **Verification:** `pnpm test:e2e`.

- [ ] **MW-E2E-011** **Dynamic Model Rendering:** `apps/board` renders the addon's List, Form (including StatusBar, Tabs, Smart Buttons), Kanban, and Search views dynamically using `@moonwitness/ui` primitives and active skin tokens.
  - **Priority:** P1 · **Layer:** Integration · **Dependencies:** `MW-WEB-006`, `MW-SKIN-003`, `MW-E2E-010`
  - **Location:** `apps/board/src/components/views/`
  - **Acceptance Criteria:** Zero console errors, zero horizontal overflow (320px/1440px), and valid accessibility tree across rendered views.
  - **Verification:** `pnpm test:e2e`.

- [ ] **MW-E2E-012** **Full CRUD Lifecycle:** Users can Create (with `default_get` + `onchange`), Read, Update (with `write_date` optimistic concurrency), Archive, Unarchive, Execute Actions, and Hard-Delete (when allowed) records via UI + REST + JSON-RPC.
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-WEB-004`, `MW-API-002`, `MW-E2E-011`
  - **Location:** `apps/board/e2e/`, `apps/api/tests/`
  - **Acceptance Criteria:** Mutations persist to PostgreSQL, generate real `base.audit_log` + `base.outbox_event` rows, and update List/Form/SmartButton counts immediately.
  - **Verification:** `pnpm test:e2e && pnpm test:integration`.

- [ ] **MW-E2E-013** **Search & Relational Fields:** Free-text search, Polish-notation domain filters, saved filters (`base.saved_filter`), dotted relational searches, `Many2one` dynamic domain filtering, `One2many` line edits, and `Many2many` tags work end-to-end.
  - **Priority:** P1 · **Layer:** Integration · **Dependencies:** `MW-DOM-006`, `MW-WIDGET-004`, `MW-WIDGET-005`, `MW-WIDGET-006`, `MW-E2E-012`
  - **Location:** `apps/board/e2e/`, `apps/api/tests/postgres.integration.test.ts`
  - **Acceptance Criteria:** Parent field changes update child `Many2one` domain dynamically via `onchange` / domain context; saved filters persist per user/company across reloads.
  - **Verification:** `pnpm test:e2e && pnpm test:integration`.

- [ ] **MW-E2E-014** **Cross-Layer Access Rules:** Model ACLs, record rules, company isolation (`X-Company-Id`), field-level ACLs, and action permissions are enforced identically in Board UI, REST API, JSON-RPC, and Attachment endpoints.
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-SEC-005`, `MW-E2E-012`
  - **Location:** `apps/board/e2e/`, `apps/api/tests/`
  - **Acceptance Criteria:** Restricted fields are hidden/unwritable, cross-company records return `404`/`403`, and disallowed actions fail cleanly even on forged direct API calls.
  - **Verification:** `pnpm test:e2e && pnpm test:integration`.

- [ ] **MW-E2E-015** **Addon Upgrade & Data Preservation:** Upgrading an installed addon (adding fields, expanding an enum, updating views/menus, running an `upgrade` data hook) updates PostgreSQL schema safely while preserving 100% of existing user records and maintainer seed edits.
  - **Priority:** P0 · **Layer:** Integration · **Dependencies:** `MW-SCHEMA-008`, `MW-E2E-005`
  - **Location:** `apps/api/tests/postgres.integration.test.ts`, `packages/orm/tests/addon.test.ts`
  - **Acceptance Criteria:** Existing rows retain all user-edited values, enum columns accept newly added values, and rollback on simulated failure leaves prior version & schema untouched.
  - **Verification:** `pnpm test:integration`.

- [ ] **MW-E2E-016** **Safe Addon Disable & Uninstall:** Disabling or uninstalling an addon blocks uninstall when dependents exist (`409`), removes runtime views/menus/actions/routes cleanly for leaf addons, and preserves core platform stability on restart.
  - **Priority:** P1 · **Layer:** Integration · **Dependencies:** `MW-ADDON-003`, `MW-ADDON-004`, `MW-E2E-015`
  - **Location:** `packages/orm/tests/addon.test.ts`, `apps/api/tests/`
  - **Acceptance Criteria:** Leaf addon uninstallation succeeds cleanly; reinstalling the addon later restores cleanly with zero stale orphan state.
  - **Verification:** `pnpm --filter @moonwitness/orm test && pnpm --filter @moonwitness/api test && pnpm test:integration`.

---

## 27 — Final Audit & Cleanup

- [ ] **MW-AUDIT-001** Verify zero leftover legacy shims (`apps/api/src/whatsapp/manifest.ts`), duplicate contracts (`packages/client/src/types.ts`, `domain.ts`), hardcoded view/model switch blocks, or temporary scaffolding remain.
  - **Priority:** P1 · **Layer:** Shared · **Dependencies:** `MW-BACK-002`, `MW-PKG-002`, `MW-WIDGET-007`, `MW-ACT-007`
  - **Location:** Repository-wide
  - **Acceptance Criteria:** `pnpm audit:workspace`, `pnpm api:addon:check`, and `pnpm board:ui:check` pass with zero violations and zero runtime/local import cycles.
  - **Verification:** `pnpm audit:workspace && pnpm api:addon:check && pnpm board:ui:check`.

- [ ] **MW-AUDIT-002** Audit all TypeScript/JavaScript sources for zero explicit `any`, zero `// TODO` placeholders, and zero mock data leaking into production paths.
  - **Priority:** P1 · **Layer:** QA · **Dependencies:** `MW-AUDIT-001`
  - **Location:** `apps/*`, `packages/*`
  - **Acceptance Criteria:** `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` succeed cleanly with zero warnings or errors.
  - **Verification:** `pnpm lint && pnpm format:check && pnpm typecheck`.

- [ ] **MW-AUDIT-003** Regenerate all derived reference documentation, architecture diagrams, and asset manifests (`pnpm docs:generate`, `pnpm architecture:generate`, `pnpm assets:validate`) and verify zero drift.
  - **Priority:** P2 · **Layer:** Infrastructure · **Dependencies:** `MW-DOC-001`, `MW-AUDIT-001`
  - **Location:** `docs/`, `README.md`, `packages/assets/`
  - **Acceptance Criteria:** Generated references match live models, routes, env vars, and packages byte-for-byte.
  - **Verification:** `pnpm docs:check && pnpm architecture:check && pnpm test:assets`.

- [ ] **MW-AUDIT-004** Reconcile completion checkboxes and evidence links across root `todo.md`, `ROADMAP.md`, `todo-foundation.md`, `todo-ui.md`, and `todo-wa.md` without introducing duplicate backlogs.
  - **Priority:** P2 · **Layer:** Infrastructure · **Dependencies:** `MW-E2E-016`, `MW-AUDIT-003`
  - **Location:** `todo.md`, `ROADMAP.md`, `todo-foundation.md`, `todo-ui.md`, `todo-wa.md`
  - **Acceptance Criteria:** All checklists reflect actual verified evidence; `pnpm automation:check:roadmap` passes cleanly.
  - **Verification:** `pnpm automation:check:roadmap && pnpm verify`.

---

## 28 — Definition of Done

A task in this checklist may be marked `[x]` ONLY when **all** of the following conditions hold:

1. **Concrete Implementation:** Code or configuration changes are landed on disk cleanly with zero `// TODO`, zero explicit `any`, and zero duplicated logic across packages.
2. **Boundary & Constitution Integrity:** `pnpm api:addon:check`, `pnpm board:ui:check`, `pnpm audit:workspace`, and `pnpm evolution:check` pass with zero regressions.
3. **Quality Gates:** `pnpm lint`, `pnpm format:check`, and `pnpm typecheck` pass across all workspaces after the final edit.
4. **Automated Verification Observed:** All relevant unit (`pnpm test:unit`), addon conformance (`pnpm test:addon-conformance`), UI/asset (`pnpm test:ui && pnpm test:assets && pnpm board:budget`), PostgreSQL integration (`pnpm test:integration`), and E2E browser (`pnpm test:e2e`) suites for the changed scope have been executed **after the last edit** and observed passing without skipped or relaxed assertions.
5. **Documentation Sync:** `pnpm docs:check` and `pnpm architecture:check` pass if public models, routes, env vars, or packages changed.

---

## 29 — Remaining Technical Debt & Deferred Features

### A. External Hardware, Live-Service & Hosting Gates (Cannot Be Closed by Offline Code Alone)

- **Live GoWA WhatsApp Device Pairing (`todo-wa.md`):** `P0-01`–`P0-05`, `P0-08`, `P0-24`–`P0-25`, `P1-06`, `P1-28`, `P2-01` remain gated on physically scanning the Board QR code against live GoWA (`wa.moonwitness.biz.id` `v9.6.0`), verifying container restart session persistence, GoWA volume backup/restore, and live delivery/read webhooks + media transfers.
- **Live Local AI Model Evaluation (`ROADMAP.md` `K7-006`):** Runtime outage & disabled-mode tests pass; full latency/accuracy/OS-level air-gap egress certification against a live local Ollama/OpenAI-compatible model endpoint awaits dedicated local GPU/hardware benchmark execution.
- **GitHub Hosted Governance & Promotion (`ROADMAP.md` `M1.08`, `M6.07`–`M6.11`, `M7.05`–`M7.16`, `M10.07`, `M11.03`–`M11.15`, `K9-007`):** Require repository maintainer `CODEOWNER` approval on `dev -> main`, first live tagged release run on GitHub Actions/GHCR, trusted `main` GitHub Pages deployment, and safeguarding policy sign-offs.

### B. Intentionally Deferred / Optional Enterprise Capabilities (Out of Current Core Scope)

- **Visual Drag-and-Drop Workflow/Form Builder UI:** Models and workflows remain code-first typed TS declarations inside workspace addons (`defineModel`, `defineView`, `WorkflowDefinition`), prioritizing type safety and deterministic CI conformance over runtime WYSIWYG DB schema editors.
- **Multi-Database Dialects Beyond PostgreSQL & SQLite Test Harness:** Production targets PostgreSQL 16/17 strictly; SQLite (`better-sqlite3`) remains supported solely for fast offline unit/conformance/audit suites.
- **Advanced WhatsApp v2+ Scope (`todo-wa.md` NEXT):** Multi-attachment albums, voice-note recording, automated CRM bots/broadcasts (`P4-01`–`P4-13`), live presence (`P4-15`), and Status/Story publishing (`P3-03`–`P3-16`) remain explicitly deferred until WhatsApp v1 live pairing closes.
- **Hosted Staging/Production Cloud Deployment (`ADR-0001` / `ADR-0004`):** Self-hosted Docker Compose and GHCR container publication remain the delivery target; automated cloud provisioning/CD remains outside current scope unless explicitly amended in ADR 0001.
