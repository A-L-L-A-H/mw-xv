# W8-D05 — WhatsApp domain audit

## Verified contract

- Manifest: `packages/orm-whatsapp/src/manifest.ts` registers 13 models: account, conversation, message, status, upload ticket, conversation read, internal note, label, conversation-label, conversation-alias, group creation, group join and group operation. Metadata views exist for account, conversation, message and status.
- API: `apps/api/src/addons/registry.ts` registers `whatsappRoutes`; route implementation is split across `apps/api/src/routes/whatsapp/*` for accounts, conversations, messages, media, groups, statuses, triage and webhooks.
- Board: dedicated `/board/whatsapp` and `/board/whatsapp/status` routes. Supporting UI includes pairing, conversation, media preview, profile drawers and status composition components under `apps/board/src/components/whatsapp/`. The inbox uses live `/whatsapp/*` APIs, displays loading/error/empty and stale-data states, and gates sending, conversation management, status creation, and account controls using API-returned permissions. The status history has explicit loading, error and empty states; no contact portraits or fabricated message data are introduced.
- Access: user group is read-only for the four user-facing models (account, conversation, message, status); superadmin receives CRUD there. Remaining supporting models have no broad user CRUD grant in this manifest. Route-level auth/company checks remain authoritative.
- Existing assets: generic `message`, `phone`, `smartphone`, `attachment`, `image`, `play`, `upload`, `check`, `warning`, `error`, `refresh`, `users` icons. No profile portraits should be invented.

## Real states and boundaries

Account status values come from `WHATSAPP_ACCOUNT_STATUSES`; messages include declared direction/type/status and media scan statuses `not_applicable/pending/clean/infected`; status posts declare their own queued/sending/sent/failed/unknown lifecycle. Use only API-returned values. User uploads continue through existing attachment/storage and scanner paths; no generated media may masquerade as a real conversation or contact.

Source review covered manifest, model enums, route modules and all dedicated Board route/component paths. Canonical shared icons are reused by stable asset IDs and no addon-specific artwork was needed. Verified with Board shared-UI check, Board typecheck, asset validation and UI Catalog tests; W8-005 records the exact commands.
