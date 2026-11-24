# W8-D12 — AI domain audit

## Verified contract

- Manifest/models/views: `packages/orm-ai/src/manifest.ts`, `models/*`, `views.ts` define 15 records: provider/model profiles, execution policy, agent/profile, work contract, acceptance criterion, capability grant, agent run, artifact manifest, obligation, taskforce, workforce assignment, skill version and memory candidate. Manifest menus expose seven principal operations plus technical/development-only supporting records.
- Access: `packages/orm-ai/src/data.ts` denies every AI model to `base.group_user`. Operator group gets write access only to `OPERATOR_WRITABLE_MODELS`, read-only to `OPERATOR_READONLY_MODELS`; reviewer group gets read-only access across the declared AI models. `ai.corporation_enabled` feature flag is seeded disabled, and group memberships are seeded to superadmin.
- API/Board: registry registers AI corporation and desktop-sync routes. Existing Board screens are `/board/ai/hq`, `/mission-control`, `/operations`, `/continuity`, `/governance`, `/providers`, and `/eval-lab` under `/board/ai/`.
- Existing assets: `model`, `sparkle`, `code`, `jobs`, `workflow`, `team`, `users`, `security`, `key`, `history`, `document`, `attachment`; generic badges/tables/status components. No robot/agent portraits or live AI run values are invented.

## Real states and boundaries

Use model/provider/run/contract/obligation/review states from the actual API. Do not show an AI surface as enabled when the feature flag is off, or expose capability/secret material beyond the caller's role. Demo fixtures belong only in the clearly labeled UI Catalog.

Source review covered manifest, model/view exports, permission arrays, feature flag seed, API registry and all listed Board route files. Board typecheck is recorded in the W8-D batch evidence.
