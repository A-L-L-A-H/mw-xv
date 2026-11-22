# W8-D09 — Workflow domain audit

## Verified contract

- Manifest/models/views: `packages/orm-workflow/src/manifest.ts`, `models.ts`, `views.ts` define workflow definition, instance, event and approval.
- Access: `base.group_user` receives read-only access to all four models. Menus expose workflow instances, event history and approvals; definitions are Technical. State-changing actions use configured roles and the workflow API.
- API/Board: registry registers `workflowRoutes`; no separate workflow Board app route exists. Records use the generic model route; request/AI pages may link into workflow-backed business flows.
- Existing assets: `workflow`, `relation`, `check`, `check-circle`, `close`, `clock`, `history`, `play`, `warning`; existing timelines/tables are reusable.

## Real states and boundaries

Instance states are `active/completed/rejected/timed_out/cancelled`; approval decisions are `approved/rejected`. Workflow events are append-only in setup guards. Do not draw transitions or claim completion from a model that is not returned by authorized API data.

Source review covered model/view/manifest, API workflow route and setup triggers. Board typecheck is recorded in the W8-D batch evidence.
