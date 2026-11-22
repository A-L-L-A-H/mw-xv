# W8-D09 — Workflow domain audit

## Verified contract

- Manifest/models/views: `packages/orm-workflow/src/manifest.ts`, `models.ts`, `views.ts` define workflow definition, instance, event and approval.
- Access: `base.group_user` receives read-only access to all four models. Menus expose workflow instances, event history and approvals; definitions are Technical. State-changing actions use configured roles and the workflow API.
- API/Board: registry registers `workflowRoutes`; no separate workflow Board app route exists. Records use the generic model route, and real business record forms show the workflow panel. The panel reads definitions, instances and append-only event history from the existing workflow APIs, derives available actions from the returned role/state contract, and submits expected revisions/idempotency keys. The generic model menu now uses the canonical `workflow`, `history`, and `check-circle` icons for definition, event, and approval models.
- Existing assets: `workflow`, `relation`, `check`, `check-circle`, `close`, `clock`, `history`, `play`, `warning`; existing timelines/tables are reusable.

## Real states and boundaries

Instance states are `active/completed/rejected/timed_out/cancelled`; approval decisions are `approved/rejected`. Workflow events are append-only in setup guards. Do not draw transitions or claim completion from a model that is not returned by authorized API data.

Source review covered model/view/manifest, API workflow route, setup triggers, generic model route and `WorkflowPanel`. The panel now distinguishes an empty event history, API-unavailable/error state, configured action denial and an active state with no configured transition. Focused action-state tests, Board typecheck, shared-UI check, asset suite and Catalog suite are recorded by W8-009. No transition, approval, event or count is fabricated.
