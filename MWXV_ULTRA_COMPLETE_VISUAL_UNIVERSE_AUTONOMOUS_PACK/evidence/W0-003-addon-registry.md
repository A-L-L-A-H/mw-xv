# W0-003 — Active API addon registry

Source: `apps/api/src/addons/registry.ts` and the referenced addon manifests on current `dev`. API typecheck was run via the package's actual `build` script because `@moonwitness/api` has no `typecheck` script.

| Registry name | Manifest/package | Manifest dependencies | API route and post-install ownership |
| --- | --- | --- | --- |
| `base` | `packages/orm-base/src/manifest.ts` | none | Generic CRUD and bootstrap routes; no post-install hook |
| `auth` | `packages/auth/src/manifest.ts` | `base` | Auth routes; no post-install hook |
| `jobs` | `packages/jobs/src/models.ts` | `base` | Jobs routes; no post-install hook |
| `integration` | `packages/orm-integration/src/manifest.ts` (`orm-integration`) | `base`, `jobs` | No custom registry route or post-install hook; webhook models/views are manifest-driven |
| `whatsapp` | `packages/orm-whatsapp/src/manifest.ts` (`orm-whatsapp`) | `base` | WhatsApp routes; no post-install hook |
| `request` | `packages/orm-request/src/manifest.ts` | `base`, `jobs`, `notification`, `workflow` | No custom registry route or post-install hook; request approval is workflow-backed |
| `notification` | `packages/orm-notification/src/manifest.ts` | `base`, `jobs` | Notification routes; no post-install hook |
| `organization` | `packages/orm-organization/src/manifest.ts` | `base` | No custom registry route or post-install hook; manifest-driven generic model views |
| `workflow` | `packages/orm-workflow/src/manifest.ts` | `base`, `jobs`, `notification` | Workflow routes; no post-install hook |
| `knowledge` | `packages/orm-knowledge/src/manifest.ts` | `base` | Corpus, evidence, research, workbench, privacy, publication and related API routes; post-install review workflow setup |
| `orm-storage` | `packages/orm-storage/src/index.ts` | none | Provider primitives with an explicitly empty `models` list; no custom route or post-install hook |
| `ai` | `packages/orm-ai/src/manifest.ts` | `base`, `organization`, `jobs`, `workflow`, `orm-storage` | AI corporation and desktop-sync routes; post-install job registration |

Manifest-backed models/views verified in source: base exports its current model list, `jobs` declares Job/JobRun/Cron/OutboxEvent, integration declares WebhookEndpoint/WebhookDelivery with list/form/search views, WhatsApp declares 13 models and user-facing account/conversation/message/status views, request declares PurchaseRequest, notification declares Notification/NotificationPreference/NotificationTemplate, organization declares department/team/position/membership models, workflow declares definition/instance/event/approval, storage declares no models, and AI declares 15 models with view metadata. Knowledge's model list includes testimony, evidence, research and review-related records.

`system-health` is a runtime module in the registry, not an ORM addon manifest. It registers health routes and storage/WhatsApp health probes. The registry resolves manifests from imported packages rather than guessing from folders. API manifest activation and route registration are in `apps/api/src/addons/registry.ts`; domain models, data, views, menus and permission seeds stay in their owning addon packages. No migration or seed files were changed during this audit.

Verification:

- `pnpm --filter @moonwitness/api typecheck` — unavailable: package has no script (exit 1, `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`).
- `pnpm --filter @moonwitness/api build` (`tsc`) — exit 0; this is the package's real TypeScript check.
