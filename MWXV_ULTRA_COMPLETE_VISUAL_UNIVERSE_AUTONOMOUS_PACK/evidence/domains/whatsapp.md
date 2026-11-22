# W8-D05 — WhatsApp domain audit

## Verified contract

- Manifest: `packages/orm-whatsapp/src/manifest.ts` registers 13 models: account, conversation, message, status, upload ticket, conversation read, internal note, label, conversation-label, conversation-alias, group creation, group join and group operation. Metadata views exist for account, conversation, message and status.
- API: `apps/api/src/addons/registry.ts` registers `whatsappRoutes`; route implementation is split across `apps/api/src/routes/whatsapp/*` for accounts, conversations, messages, media, groups, statuses, triage and webhooks.
- Board: dedicated `/board/whatsapp` and `/board/whatsapp/status` routes. Supporting UI includes pairing, conversation, media preview, profile drawers and status composition components under `apps/board/src/components/whatsapp/`.
- Access: user group is read-only for the four user-facing models (account, conversation, message, status); superadmin receives CRUD there. Remaining supporting models have no broad user CRUD grant in this manifest. Route-level auth/company checks remain authoritative.
- Existing assets: generic `message`, `phone`, `smartphone`, `attachment`, `image`, `play`, `upload`, `check`, `warning`, `error`, `refresh`, `users` icons. No profile portraits should be invented.

## Real states and boundaries

Account status values come from `WHATSAPP_ACCOUNT_STATUSES`; messages include declared direction/type/status and media scan statuses `not_applicable/pending/clean/infected`; status posts declare their own queued/sending/sent/failed/unknown lifecycle. Use only API-returned values. User uploads continue through existing attachment/storage and scanner paths; no generated media may masquerade as a real conversation or contact.

Source review covered manifest, model enums, route modules and all dedicated Board route/component paths. Board typecheck is recorded in the W8-D batch evidence.
