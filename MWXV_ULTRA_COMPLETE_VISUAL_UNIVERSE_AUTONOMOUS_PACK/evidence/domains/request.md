# W8-D06 — Purchase request domain audit

## Verified contract

- Manifest/model: `packages/orm-request/src/manifest.ts` and `models.ts` register only `request.purchase` with a list/form/search view. It has a Workspace menu and a `base.group_user` access seed granting read/create/write and denying unlink.
- Lifecycle: approval is defined as workflow `request.purchase_approval`: user/system may start and submit; superadmin/system may approve or reject; approval requires one distinct actor. The model itself does not declare a status field; workflow owns lifecycle state.
- API/Board: request has no custom registry route; generic model/API metadata is the consumer when enabled. No request-specific Board route was found.
- Existing assets: `document`, `credit-card`, `currency`, `partner`, `check`, `check-circle`, `close`, `workflow`, `history`, `warning`; reusable form/table/approval UI only.

## Real states and boundaries

The configured workflow states are `draft`, `submitted`, `approved`, and `rejected`. Do not imply withdrawn/cancelled states absent from this definition. Amount and currency come from request records; do not invent spend totals or savings.

Source review covered request model/view/manifest, the workflow definition and generic model route. Board typecheck is recorded in the W8-D batch evidence.
