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
- **Invariant**: Keep root `package.json` `engines.node` pinned to `"22.x"`.

## INV-006: Recursive Route Discovery & Generated Reference/Diagram Sync

- **Symptom**: Documentation Pages and CI quality-and-build fail on scripts/docs/generate-reference.test.mjs and architecture:check after nested route files, models, or scripts change.
- **Root Cause**: generate-reference.test.mjs read apps/api/src/routes non-recursively (missing nested routes like whatsapp/media.routes.ts), and commits omitted pnpm docs:generate / pnpm architecture:generate.
- **Invariant**: Scan apps/api/src/routes recursively in doc reference tests and regenerate docs/diagrams via pnpm docs:generate and pnpm architecture:generate whenever routes, models, packages, or root scripts change.

## INV-007: Shared UI Stylesheet Integrity

- **Symptom**: CI and Documentation Pages fail with CssSyntaxError: Missing closing } at @layer components in apps/board and apps/ui-catalog, and packages/ui token tests fail.
- **Root Cause**: Commit bc13117 truncated packages/ui/src/styles/components.css to line 1 while removing broken WIP component files.
- **Invariant**: Always verify packages/ui/src/styles/components.css integrity with pnpm test:ui and downstream Tailwind builds before committing UI cleanup changes.
