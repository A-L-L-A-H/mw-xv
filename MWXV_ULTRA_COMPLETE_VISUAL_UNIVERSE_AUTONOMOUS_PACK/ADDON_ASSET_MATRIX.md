# Addon-to-Asset and UI Coverage Matrix

This matrix maps **existing business domains** to the visual coverage they may need. It does not authorize inventing routes, models, metrics or behavior. Revalidate each addon manifest and Board consumer before implementation.

| Active addon | Existing domain concepts | Required visual/asset families | Production states to support |
|---|---|---|---|
| `base` / `orm-base` | User, partner, company, country, bank, activity, attachment, tags, access, saved filters | People/profile, organization mark, partner type, record/file/activity, generic portrait/neutral avatar | Empty, loading, no result, restricted, unavailable, failed, selected |
| `auth` | Credential login and refresh tokens | Shadow entrance, identity, session/security, login artwork | Idle, submitting, invalid, expired, locked/denied where real, success |
| `jobs` | Job, job run, cron, outbox event | Queue, scheduled event, execution/timeline, retry/failure symbols | Queued, running, succeeded, failed, retrying, dead-letter, paused |
| `integration` | Webhook endpoint/delivery | Connector, endpoint, delivery path, signed event | Disabled, enabled, delivered, retrying, dead |
| `orm-whatsapp` | Account, conversation, message, status, upload tickets and related records | Contact/neutral avatar, conversation, message media, attachment/video/audio/document/sticker type icons | Disconnected, connecting, QR, connected, reconnecting, error; queued/sent/delivered/read/failed; scan status |
| `request` | Purchase request | Document, purchase/request, review and approval marks | Draft/submitted/approved/rejected/withdrawn as confirmed by workflow |
| `notification` | Notification, preference, template | Inbox, notification channel and status marks | Unread/read/archived, delivered/suppressed, preference off |
| `organization` | Department, team, position, membership | Organization constellation, team/department/position, hierarchy | Active/inactive membership based on actual fields and permissions |
| `workflow` | Definition, instance, event, approval | Process path, state transitions, approvals, event history | Active/completed/rejected/timed out/cancelled; approved/rejected |
| `knowledge` | Testimony, correction, interpretation, research graph, evidence, publication/research domain | Witness/source/evidence, provenance, correction, interpretation, graph nodes/edges and archive | Restricted/internal/public, hypothesis/supported/contested/rejected, version/review/release states as actually implemented |
| `orm-storage` | Provider-neutral attachment storage and reconciliation primitives | File type, upload/download, storage health, orphan/reconcile indicators | Ready/unavailable, uploading/downloading, rejected/infected/clean where actual scanner data exists |
| `ai` / `orm-ai` | Provider/model, agent/profile, execution policy, work contract, criteria, capability grant, runs, artifacts, obligations, taskforces, workforce, skills and memory | AI identity/avatar, model/provider marks, taskforce/team, skill, capability, run, artifact, memory/evidence | Draft/active/retired/emergency stop and run/contract/review states as declared by real models |

## Rules

1. `orm-*` packages remain presentation-agnostic. They must never import `@moonwitness/assets`, `@moonwitness/ui`, Next.js, Motion or image binaries.
2. App-level mapping connects a domain concept to a stable asset ID and an existing UI state.
3. Use a shared canonical asset if two addons need the same visual. Do not duplicate it in two packs.
4. Do not create profile portraits for real users as generated fiction. Use uploaded/user-provided media or neutral generated placeholders labelled as placeholders.
5. Do not invent crew, live maps, country counts, signal counts or activity metrics that do not come from authorized product data.
6. Do not bake state text into an illustration; HTML and component state remain source of truth.
7. The UI Catalog may use fixture data only when clearly labelled as a design example.
8. For `orm-storage`, media files remain governed by current attachment storage, authorization and scanning lifecycle. Static shipped artwork has a separate build-time lifecycle.

## Additional shared UI coverage

- Shared page/header/panel/ribbon/artwork frame and existing anime FX.
- Domain icons and badges with consistent semantic state.
- Empty/error/loading/offline illustrations that do not replace text/recovery action.
- Chart/graph visual language with accessible labels and table/text equivalent.
- Timeline/approval/process map compositions.
- Character/world imagery only on the Living World and selected editorial surfaces.
