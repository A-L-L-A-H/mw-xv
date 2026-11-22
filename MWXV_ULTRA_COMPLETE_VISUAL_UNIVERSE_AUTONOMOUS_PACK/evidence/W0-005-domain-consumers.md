# W0-005 — Domain-to-screen audit

Routes below are source-confirmed in `apps/board/src/app` and its components. Generic records use `/board/m/[model]` and the API metadata/permission contract; a model or a seed is not evidence of a dedicated screen. Menu visibility and access are manifest/API controlled. “No dedicated route found” is intentionally explicit.

| Domain | Existing Board consumer | Evidence and boundary |
| --- | --- | --- |
| base | `/board`, `/board/m/[model]`; dashboard links to `base.partner`, `base.user`, `base.company`, `base.activity` | `orm-base` manifest menus and `apps/board/src/components/dashboard/kpi-grid.tsx`; record views are metadata-driven and permission-filtered |
| auth | `/login`, `/register`; protected routes redirect to login | `apps/board/src/app/login`, `register`, `components/layout/protected-route.tsx`; refresh tokens are backend/session state, not a user-facing model screen |
| jobs | Generic model route may consume metadata when enabled/authorized; no dedicated Board jobs route/menu was found | `packages/jobs/src/models.ts`, `apps/api/src/addons/registry.ts`; runtime worker/scheduler commands are operational infrastructure |
| integration | Generic model route only when enabled/authorized; manifest menus are development-only; no dedicated integration screen found | `packages/orm-integration/src/manifest.ts`; API registry has manifest but no dedicated route registration |
| WhatsApp | `/board/whatsapp`, `/board/whatsapp/status` | `apps/board/src/app/board/whatsapp`, `packages/orm-whatsapp/src/manifest.ts`; account, message and status state comes from API/model semantics |
| request | Generic model route from `PurchaseRequest` view/menu; approval lifecycle is workflow-backed | `packages/orm-request/src/manifest.ts`; roles/transitions are explicit in approval definition |
| notification | Notification bell/deep link to `/board/m/notification.notification`; notification API routes | `apps/board/src/components/layout/notification-bell.tsx`, `apps/api/src/addons/registry.ts` |
| organization | Generic metadata-driven model route for manifest menus; no separate organization route found | `packages/orm-organization/src/manifest.ts`; models and menu groups remain permission controlled |
| workflow | Generic model route and API workflow endpoints; no dedicated Board workflow page found | `packages/orm-workflow/src/manifest.ts`, API registry |
| knowledge | `/knowledge`, `/board/knowledge`, `/board/stories/workbench` | `apps/board/src/app/knowledge`, `apps/board/src/app/board/knowledge`, `apps/board/src/app/board/stories/workbench`; dedicated API surfaces include evidence, research and privacy/publication routes |
| orm-storage | No model UI or dedicated Board route; provider/reconciliation lifecycle is behind attachment/storage APIs | `packages/orm-storage/src/index.ts` declares `models: []`; existing attachment UI/API owns user files and permissions |
| ai | `/board/ai/hq`, `/mission-control`, `/operations`, `/continuity`, `/governance`, `/providers`, `/eval-lab` | `apps/board/src/app/board/ai/*`; API routes and manifest-backed domain data; detailed access continues to follow real model/API permission checks |

Static artwork is owned by `packages/assets`; no ORM domain manifest imports visual assets. The audit found no basis for adding fictional routes, crews, maps or production metrics.

Verification:

- `pnpm board:ui:check` — exit 0.
- `pnpm --filter @moonwitness/board typecheck` — exit 0.
- `pnpm --filter @moonwitness/api build` — exit 0 (registry/model boundary compile).
