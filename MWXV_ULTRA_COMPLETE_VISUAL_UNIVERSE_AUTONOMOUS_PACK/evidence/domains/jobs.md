# W8-D03 — Jobs domain audit

## Verified contract

- Manifest: `packages/jobs/src/models.ts` defines `base.job`, `base.job_run`, `base.cron`, and `base.outbox_event`. The manifest has no view or menu metadata and no addon-specific Board screen was found.
- API: `apps/api/src/addons/registry.ts` registers `jobsRoutes`; `apps/api/src/routes/jobs.routes.ts` contains admin job health/list/control endpoints. Admin endpoints require `system` or `superadmin` roles.
- Board: there is no `/board/jobs` route, but `apps/board/src/board-pages/dashboard-page.tsx` contains an admin-only worker/outbox telemetry panel and scheduled cron list. It reads `/admin/jobs/health`, `/admin/crons`, `/admin/jobs?status=dead&limit=20`, and `/admin/outbox?status=dead&limit=20`; dashboard access is gated to system/superadmin roles and the corresponding API endpoints enforce the same role boundary. Retry, cancel and cron toggle controls call existing admin routes. The view now distinguishes loading, API error, unavailable data, verified empty data and populated results without displaying private error payloads as zero metrics.
- Model states are defined in the source: job `queued/running/succeeded/dead/cancelled`; run `running/succeeded/retrying/dead/cancelled`; outbox `pending/processing/published/dead`; cron enabled state and policy enums. Do not translate counts into live metrics unless fetched from the authenticated API.
- Existing assets: `jobs`, `clock`, `calendar-clock`, `play`, `pause`, `refresh`, `warning`, `error`, `check`, and `history` icons; generic state components. No queue illustrations are registered.

## Access and boundaries

The dedicated API admin routes enforce role checks. Generic record access remains governed by model access metadata; the jobs manifest itself declares no UI ACL seeds. Keep worker/scheduler commands and job payloads out of decorative artwork and do not expose private error payloads.

Source review covered the model file, API registry, jobs routes, dashboard consumer, generic Board model page and asset icon inventory. Board typecheck and the W8-003 focused resource-state tests are recorded in the W8-003 task evidence.
