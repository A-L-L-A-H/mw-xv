# Addon Developer & Schema Evolution Guide

## Architecture Principles

- **Canonical Frontend:** `apps/board` is the canonical Next.js frontend for all MoonWitness ORM addons. Generic views (`list`, `form`, `search`, `kanban`, `calendar`, `graph`, `pivot`) are driven by backend metadata (`/api/app/bootstrap`, `/api/:model/views`, `/api/:model/fields`).
- **Schema Evolution Without Manual SQL Migrations:** `@moonwitness/orm` synchronizes tables, columns, enum `CHECK` constraints, indexes, unique keys, and foreign keys directly from `defineModel` and `extendModel` declarations via `pnpm db:migrate` (`--dry-run` supported, guarded by PostgreSQL advisory locks).

## Developer Tooling

- **Node 22.x LTS Parity:** `.nvmrc` and `.node-version` pin Node `22`. Run `pnpm node:parity` to verify local runtime alignment with `package.json` `engines.node` (`22.x`).
- **Create a New Addon:** Run `pnpm addon:create <slug>` (or `--dry-run`) to scaffold `packages/orm-<slug>` with `package.json`, `tsconfig.json`, `src/index.ts`, and `tests/<slug>.test.ts`.
- **Inspect ORM Metadata:** Run `pnpm orm:inspect [--addon <name>] [--model <name>] [--json]` to inspect workspace addons and models offline without starting an HTTP server.

## Authoring an Addon

1. Declare models with `defineModel` and extend upstream models with `extendModel`.
2. Declare multi-mode views (`list`, `form`, `search`, `kanban`, `calendar`, `graph`, `pivot`) and hierarchical menus in `defineAddon`.
3. Declare access policies (`accessPolicy`), field ACLs (`readGroups` / `writeGroups`), and tenant-scoped `recordRules` in the addon manifest.
4. Verify with:
   - `pnpm test:addon-conformance`
   - `pnpm docs:examples:check`
   - `pnpm docs:check`
