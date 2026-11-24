# W8-D11 — Storage domain audit

## Verified contract

- Manifest: `packages/orm-storage/src/index.ts` declares `orm-storage` with `models: []`. It owns provider-neutral attachment I/O and guarded reconciliation primitives, not a business model, view, menu or storage dashboard.
- API/Board: no dedicated storage addon route or Board screen was found. Existing base attachment records and the attachment/storage routes in generic and WhatsApp media paths retain their existing authorization, scanning and provider lifecycle.
- Existing assets: `attachment`, `document`, `image`, `file-spreadsheet`, `upload`, `download`, `warning`, `error`, `check`, `archive`; existing upload/preview controls and status components.

## Real states and boundaries

Provider readiness, upload/download, reconciliation, missing/corrupt/orphaned and scan outcomes are surfaced only where an existing API exposes them. The provider addon itself has no models, so no fictitious `storage.health` model/menu is proposed. User media remains on current attachment/storage paths.

Source review covered provider interface/manifest, API route imports, and Board attachment/WhatsApp media consumers. Board typecheck is recorded in the W8-D batch evidence.
