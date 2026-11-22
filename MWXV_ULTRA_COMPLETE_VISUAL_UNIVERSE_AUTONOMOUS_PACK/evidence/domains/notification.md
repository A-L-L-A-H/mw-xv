# W8-D07 — Notification domain audit

## Verified contract

- Manifest/models/views: `packages/orm-notification/src/manifest.ts`, `models.ts`, `views.ts` define notification, preference and template. User menus expose inbox and preferences; templates are `developmentOnly`.
- Access: `base.group_user` has read-only access to notification records and preferences. Inbox APIs further scope reads/writes to authenticated recipient, active company, in-app channel and delivered records.
- API: registry owns `notificationRoutes`; `apps/api/src/routes/notification.routes.ts` provides inbox, read and preferences endpoints with auth/company checks and a bounded limit. Model states are `unread/read/archived`; delivery values are `delivered/suppressed`.
- Board: notification bell links to `/board/m/notification.notification`; notification preferences use existing settings surface. No broad all-user notification browser was found.
- Existing assets: `notification`, `inbox`, `mail`, `message`, `check`, `archive`, and standard status components.

## Real states and boundaries

Unread count is API-derived and recipient/company scoped. Do not show fabricated counts or create states beyond the model/API. Template seeds explicitly include examples and do not prove external message delivery.

Source review covered manifest, model/view definitions, API route and Board notification bell. Board typecheck is recorded in the W8-D batch evidence.
