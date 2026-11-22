# Learned Repository Invariants

Structured post-mortem rules persisted by autonomous and operator loops so resolved failure classes never recur.

## INV-001: Windows PowerShell 5 Command Chaining

- **Symptom**: Commands fail at parse time when chained with `&&`.
- **Root Cause**: Windows PowerShell 5.1 does not support Bash `&&` operator syntax.
- **Invariant**: Always chain PowerShell commands with `; if ($?) { ... }`.

## INV-002: Windows API Vitest Worker Memory / Native Sharp Loading

- **Symptom**: Multi-worker `vitest run` inside `apps/api` throws `ERR_DLOPEN_FAILED` / pagefile exhaustion loading `sharp`.
- **Root Cause**: Concurrent Vite worker pools exceed Windows commit limits for native binaries.
- **Invariant**: Run local `apps/api` Vitest suites with `--maxWorkers=1 --no-file-parallelism`.

## INV-003: Org Policy Action Pinning & Verification

- **Symptom**: Hosted GitHub Actions workflows fail immediately with `startup_failure`.
- **Root Cause**: Org `A-L-L-A-H` blocks non-verified/unpinned third-party actions and unpinned tags.
- **Invariant**: Keep only GitHub-owned `actions/*` or verified actions pinned to 40-char commit SHAs with `# vX.Y.Z` comments, validated by `pnpm automation:check:action-pins` and `pnpm automation:check:action-tags`.

## INV-004: Thin API Addon Boundary

- **Symptom**: Domain models, views, or business state accumulate inside `apps/api/src/`.
- **Root Cause**: Routes bypassing `@moonwitness/orm` workspace packages create coupling across microservices and workers.
- **Invariant**: Keep `LEGACY_MODEL_ALLOWLIST` and `LEGACY_ADDON_ALLOWLIST` empty (`new Set()`); define all new models and addons under `packages/orm-*`.

## INV-005: Node Engine Pinning

- **Symptom**: Toolchain or CI drift when updating root metadata.
- **Root Cause**: Automated scripts or edits altering `package.json` `engines.node`.
- **Invariant**: Keep root `package.json` and every workspace `package.json` `engines.node` pinned to `"24.x"` Active LTS (matched by `.nvmrc`, `.node-version`, `Dockerfile`, and `.github/workflows/*.yml`).

## INV-006: Recursive Route Discovery & Generated Reference/Diagram Sync

- **Symptom**: Documentation Pages and CI quality-and-build fail on scripts/docs/generate-reference.test.mjs and architecture:check after nested route files, models, or scripts change.
- **Root Cause**: generate-reference.test.mjs read apps/api/src/routes non-recursively (missing nested routes like whatsapp/media.routes.ts), and commits omitted pnpm docs:generate / pnpm architecture:generate.
- **Invariant**: Scan apps/api/src/routes recursively in doc reference tests and regenerate docs/diagrams via pnpm docs:generate and pnpm architecture:generate whenever routes, models, packages, or root scripts change.

## INV-007: Shared UI Stylesheet Integrity

- **Symptom**: CI and Documentation Pages fail with CssSyntaxError: Missing closing } at @layer components in apps/board and apps/ui-catalog, and packages/ui token tests fail.
- **Root Cause**: Commit bc13117 truncated packages/ui/src/styles/components.css to line 1 while removing broken WIP component files.
- **Invariant**: Always verify packages/ui/src/styles/components.css integrity with pnpm test:ui and downstream Tailwind builds before committing UI cleanup changes.

## INV-008: Hybrid Swarm Model Routing & Disjoint File Sharding

- **Symptom**: Single-model swarm runs exhaust quota pools prematurely or cause git merge conflicts when multiple workers touch shared directories.
- **Root Cause**: Uniformly routing all workers onto one frontier pool and assigning overlapping workspace file globs.
- **Invariant**: Route 85% parallel feature workers to `gemini-4-neon-low`, reserve `gemini-4-argon-low` (separate quota pool) for complex ORM/architecture slices and `<25%` quota auto-rebalancing, assign `gemini-3.8-flash-low` to monitors/lightweight verifiers, enforce strict disjoint file ownership per worker, and commit via `git commit --only <owned-paths>`.

## INV-009: Zero-Overlap Desktop Harness Membrane

- **Symptom**: Domain logic leaks into `apps/desktop/src` via `defineModel`/`defineAddon`, or `apps/board/src` fails browser builds by importing native desktop/SQLite/PTY runtime modules.
- **Root Cause**: Mixing local desktop execution sidecar responsibilities with canonical `@moonwitness/orm-*` domain addons or browser UI bundles.
- **Invariant**: Keep `apps/desktop` strictly a local execution harness consuming `@moonwitness/orm-*` and `@moonwitness/ai-runtime` without calling `defineModel`/`defineAddon`, prevent `apps/board` from importing `@moonwitness/orm`, `tauri`, `better-sqlite3`, `node-pty`, or `node:*` runtime modules, and enforce via `pnpm desktop:ui:check`.

## INV-010: Diff-Scoped Worker Preflight & Single-Pass Generator Sync

- **Symptom**: Multi-agent swarms waste CPU and hit file race conditions when every worker runs full workspace builds and doc/diagram generators concurrently.
- **Root Cause**: Running full `pnpm docs:generate` and `pnpm architecture:generate` inside each parallel worker turn instead of diff-scoped boundary checks.
- **Invariant**: Parallel workers run fast diff-scoped preflight (`pnpm preflight:fast`) and targeted package tests; the verifier/shepherd runs `pnpm preflight:fast --sync` (`pnpm docs:generate` and `pnpm architecture:generate`) once after all parallel slices land.

## INV-011: Static Fastify Route Literal Requirement for Reference Docs

- **Symptom**: `scripts/docs/generate-reference.mjs` fails with `Route '<METHOD>' in '<file>' must use a static absolute path`.
- **Root Cause**: Passing helper expressions, template substitutions, or variables as the first path argument to `fastify.get/post/put/patch/delete` in `apps/api/src/routes/**/*.ts`.
- **Invariant**: Always declare literal string paths starting with `'/'` as the first argument to Fastify route registration methods (`fastify`, `app`, `server`) across `apps/api/src/routes/**/*.ts`.

## INV-012: Inline Command Palette Mount Scroll Hijack and Mobile Webfont CLS

- **Symptom**: apps/ui-catalog webfont fallback CLS test fails on Linux CI with 0.13-0.41 layout shift on section.catalog-section
- **Root Cause**: Inline Command without an unmatched defaultValue auto-selects item 0 and calls scrollIntoView on mount, scrolling window ~16000px down to #overlays so webfont reflow above shifts the visible section
- **Invariant**: Pass defaultValue='**none**' on inline showcase Command widgets outside dialogs so initial page load stays at scrollY=0 without layout-shift amplification
