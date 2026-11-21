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
