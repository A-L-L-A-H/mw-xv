# W8-D04 — Integration domain audit

## Verified contract

- Manifest: `packages/orm-integration/src/manifest.ts` registers `integration.webhook_endpoint` and `integration.webhook_delivery`, each with list/form/search metadata. Seeded access grants CRUD only to `base.group_superadmin` for both models.
- Menus for “Webhook Endpoints” and “Webhook Deliveries” are `developmentOnly`; no production-facing Board integration route was found.
- API: registry entry is named `integration`, while the manifest identity is `orm-integration`. The entry adds no custom route handler; manifest HTTP plugins are registered only when declared. Generic API metadata is the model path.
- Existing assets: `signal`, `send`, `external-link`, `refresh`, `check`, `warning`, `error`, `history`, and `settings` icons; no integration-specific illustration pack is registered.

## Real states and boundaries

Endpoint enabled state and delivery `delivered/retrying/dead` are actual model values. Secrets remain references and must never be displayed as art or fixture copy. Treat missing dedicated production screen as absent; do not make a webhook control surface visible by adding a new route in this audit task.

Source review covered manifest/model imports, menu and ACL seeds, API registry and `packages/assets/icons`. Board typecheck is recorded in the W8-D batch evidence.
