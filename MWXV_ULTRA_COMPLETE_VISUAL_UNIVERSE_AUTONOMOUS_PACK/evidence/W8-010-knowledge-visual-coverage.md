# W8-010 — Knowledge visual coverage

## Source-backed UI coverage

The existing `/knowledge` and `/board/knowledge` routes render `apps/board/src/board-pages/knowledge-page.tsx`. The surface is read-only and uses the active company scoped query keys. It checks `canReadResearch(user?.role, activeCompanyId)` before enabling the research requests and presents a permission-denied state when the role/company context is insufficient. API routes retain authority for membership, visibility, child-protection and release checks.

The page consumes pinned source citations/passages, active-release graph search and relation explanations. Loading skeletons, source/passage/graph/relation errors, unavailable pinned passages, empty graph matches and permission-denied states are separate. No testimony records, witness identities, graph releases, routes, or artwork were invented. The manifest's synthetic knowledge seeds remain restricted fixtures. Existing canonical `BookOpenIcon`, `RelationIcon`, and `SearchIcon` provide the meaningful visual language; text and actions remain accessible HTML.

## Verification

- `pnpm board:ui:check` — exit 0; 6 boundary checks passed.
- `pnpm --filter @moonwitness/board typecheck` — exit 0.
- `pnpm test:assets` — exit 0; 56 tests passed, canonical inventory/provenance and docs exports verified.
- `pnpm test:ui-catalog` — exit 0; 41 browser tests passed and catalog bundle budget passed.
- `pnpm --filter @moonwitness/board exec playwright test e2e/knowledge-explorer.spec.ts --workers=1` — could not start; configured API webServer did not become ready because the local PostgreSQL E2E service is unavailable. `docker compose ps` also reports that the uncommitted local compose configuration has `control-plane` depending on undefined service `moonwitness-postgres`. No compose changes were made. Existing `apps/board/e2e/knowledge-explorer.spec.ts` contains source-backed browser coverage, but it was not executed in this environment.

## Residual

Authenticated API-backed screenshots and the Knowledge E2E browser assertions remain to be run after the local E2E database/compose configuration is available. No production UI or API behavior is changed by this task because the real consumer and distinct states already exist.
