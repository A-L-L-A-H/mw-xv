# Single `tasks.json` Source of Truth

- **Sole Canonical Registry**: `docs/tasks/tasks.json` (`moonwitness-tasks/v2`) is the **only** authoritative task JSON file in this repository (holding all platform, roadmap, desktop, WhatsApp, visual-universe, social, and audit tasks).
- **Zero Duplicate Task JSONs**: Agents MUST NOT create `task.json` or `tasks.json` anywhere else (not at repo root, not in `docs/roadmap/`, not in `docs/bundles/`, not in `apps/` or `packages/`).
- **Automated Enforcement**: `node scripts/tasks/validate-tasks.mjs` (`bun run tasks:validate`, run in pre-push and CI) scans the repository and FAILS if any duplicate `task.json` or `tasks.json` exists outside `docs/tasks/tasks.json`.
- **In-Memory Projection Only**: Roadmap tools (`scripts/roadmap/*`, `scripts/render-promotion-report.mjs`) project M/K roadmap tasks in memory from `docs/tasks/tasks.json` via `scripts/tasks/roadmap-index.mjs` without writing duplicate JSON files on disk.
