# W8-D08 — Organization domain audit

## Verified contract

- Manifest/models/views: `packages/orm-organization/src/manifest.ts`, `models.ts`, `views.ts` define department, team, position and membership with list/form/search metadata.
- Access: `base.group_user` receives read-only access for all four models. Manifest menus group these records under Organization; API model access remains authoritative for each caller.
- API/Board: there is no organization-specific route registration or dedicated Board organization page. The current consumer is generic `/board/m/[model]` when API metadata exposes the model.
- Existing assets: `company`, `users`, `user`, `team`, `partner`, `relation`, `grid`, plus existing table/form primitives. The real generic Board model navigation now reuses `company` for departments, `team` for teams, `user` for positions and `users` for memberships. No organizational chart or personnel portraits are registered as production art.

## Real states and boundaries

Use actual department/team/position/membership fields and active values. No org chart, headcount or hierarchy shape should be invented when relation data is missing or access filtered.

Source review covered manifest ACLs/menus, model/view files, API registry, generic Board list states and model navigation. Generic screens provide loading, error, empty and permission-denied treatment from live API metadata/access. Department/team parent and member relations remain ordinary record relations; no hierarchy visualization or headcount is inferred. Verified with Board typecheck, shared-UI check, asset validation and Catalog suite; W8-008 records exact commands.
