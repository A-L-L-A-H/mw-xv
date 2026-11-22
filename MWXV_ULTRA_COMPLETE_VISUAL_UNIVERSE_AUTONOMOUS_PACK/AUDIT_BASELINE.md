# Source Audit Baseline

## Repository snapshot

- Repository: `https://github.com/A-L-L-A-H/mw-xv`
- Branch: `dev`
- Refreshed HEAD at pack creation: `0b89060602c659efdd5e9e1a12c166fee237418e`
- Commit message: `feat(ui): apply raw-art grunge geometry and anime kinetics across all UI components`
- Commit date: `2026-11-22T03:26:24Z`
- The commit diff includes current raw-art/grunge geometry and anime kinetics improvements in UI styles/components, chart treatments, and a UI Catalog stylesheet budget adjustment. Preserve these changes.

Earlier detailed source inspection was against `7eab2e1dfeba4629dd66a9fc5472def46f0b8cd2`; current HEAD advanced to `0b89060602c659efdd5e9e1a12c166fee237418e`. The inspected current commit changes UI presentation/budgets; it does not invalidate the workspace/addon ownership map below. **The local agent must revalidate the current tree before editing.**

## Workspace inventory observed

26 workspace packages:

- `@moonwitness/ai-evaluation`
- `@moonwitness/ai-mcp`
- `@moonwitness/ai-runtime`
- `@moonwitness/assets`
- `@moonwitness/auth`
- `@moonwitness/client`
- `@moonwitness/corpus`
- `@moonwitness/eslint-config`
- `@moonwitness/jobs`
- `@moonwitness/knowledge`
- `@moonwitness/local-ai`
- `@moonwitness/logger`
- `@moonwitness/orm-ai`
- `@moonwitness/orm-base`
- `@moonwitness/orm-integration`
- `@moonwitness/orm-knowledge`
- `@moonwitness/orm-notification`
- `@moonwitness/orm-organization`
- `@moonwitness/orm-request`
- `@moonwitness/orm-storage`
- `@moonwitness/orm-whatsapp`
- `@moonwitness/orm-workflow`
- `@moonwitness/orm`
- `@moonwitness/research`
- `@moonwitness/types`
- `@moonwitness/ui`

Apps observed: `apps/api`, `apps/board`, `apps/desktop`, `apps/docs`, `apps/ui-catalog`, `apps/todo` (revalidate each directory and package manifest; `apps/todo` manifest was not independently confirmed in the prior inspection).

## Active addon registry observed

- `base` — `packages/orm-base`: People, partners, companies, users, activities, attachments, tags, records
- `auth` — `packages/auth`: Identity, login, registration, security and session states
- `jobs` — `packages/jobs`: Queues, jobs, scheduled work, execution and failure states
- `integration` — `packages/orm-integration`: Webhook endpoints, delivery and connector states
- `whatsapp` — `packages/orm-whatsapp`: Accounts, conversations, messages, media and contact states
- `request` — `packages/orm-request`: Purchase requests and approval lifecycle
- `notification` — `packages/orm-notification`: Inbox, unread/read/archived and channel states
- `organization` — `packages/orm-organization`: Departments, teams, positions, memberships and hierarchy
- `workflow` — `packages/orm-workflow`: Definitions, instances, transitions, approvals and event history
- `knowledge` — `packages/orm-knowledge`: Witness testimony, source, evidence, corrections, interpretations and research graph
- `orm-storage` — `packages/orm-storage`: Attachment storage providers and lifecycle states; currently provider addon has no domain models
- `ai` — `packages/orm-ai`: Agents, profiles, models, providers, contracts, runs, taskforces, skills and memory

`system-health` is also an API runtime module but is not an ORM domain manifest. `orm-storage` provides storage functionality and its manifest has no business models in the inspected implementation. Confirm all details against current source.

## Existing visual foundation observed

### `packages/assets`

- Framework-independent asset package with no runtime dependencies.
- One canonical `manifest.json` (`schemaVersion: 1` at the inspected baseline) and `licenses.json`.
- At the inspected baseline, 179 manifest entries by `kind`: app icons 2, favicon 1, lockups 4, symbols 4, wordmarks 4, readme banner 1, social cards 2, source 7, fonts 7, icons 88, illustrations 14, artwork exports 9, patterns 5, materials 17, ornaments 11, sounds 3.
- Five original artwork masters were listed: auth/login, Board masthead, home editorial triptych, home hero, Story Workbench masthead.
- Generator and validation scripts include `generate.mjs`, `generate-illustrations.mjs`, `generate-materials.mjs`, `generate-sounds.mjs`, `prepare-artwork.mjs`, `prepare-fonts.mjs`, `asset-inventory.mjs`, `manifest-ownership.mjs`, `validate.mjs`, `check-svg-bounds.mjs`, render scripts.
- Current package scripts include brand/font/artwork preparation; root scripts orchestrate the complete asset generation/render/validation pipeline.
- Current exports at inspected baseline include brand, fonts, icons, illustrations, materials, sounds, manifest and licenses.
- Provenance is tracked separately in `licenses.json`; keep both canonical files synchronized.

### `packages/ui`

- Framework-independent UI package with no runtime dependencies at inspected baseline.
- Shared tokens, controls, compositions, icons, themes, audio, effect primitives and tests.
- 16 named effect exports observed in `effects.tsx`: EditorialTexture, AccentMarker, SignalOrbit, LoadingProgress, LoadingSpinner, SpeedLines, InkUnderline, Doodle, DecorativeMotif, InkFrame, AnimeImpactBurst, GrungeCanvas, AnimeActionLines, GrungeStamp, SpeechBubble, LiveIndicator; confirm the actual exported symbol count from current source before updating documentation.
- `ArtworkFrame` supports `animeEffect` values `none`, `slash`, `impact`, `cel-shake` at the inspected baseline.
- Existing CSS anime FX include slash, impact burst, grunge cel shake, speed sweep, stamp/pop and doodle motion.
- Tokens include short UI motion, anime motion, hard impact shadow, theme/contrast and reduced-motion handling.
- Existing `useAnimationVisibility` uses IntersectionObserver to pause animations when offscreen.

### Board/Motion

- `apps/board` declares `motion` (Motion for React) as an existing runtime dependency.
- `apps/board/src/providers.tsx` wraps content in `MotionConfig reducedMotion="user"` at the inspected baseline.
- Homepage hero uses a responsive static `<picture>` artwork component (`home-hero-art.tsx`) with desktop/mobile WebP and fallback.
- Existing homepage includes reveal, editorial hover and filmstrip interaction; these are not a full scene/character runtime.
- UI Bible explicitly prefers CSS/SVG and allows Canvas/WebGL only for measured need; it discourages perpetual parallax/hidden offscreen work. The new Living World tier may add controlled scene motion without weakening operational UI rules.

## Important current implementation boundaries

- API addon registry owns activation and route registration.
- ORM packages own models, views, menu/access/security data and addon manifests.
- `packages/assets` owns static media and provenance.
- `packages/ui` owns shared presentation and reusable interaction/effects.
- `apps/board` consumes assets/UI; `apps/docs` and `apps/ui-catalog` also declare assets/UI dependencies.
- `apps/desktop` declares AI/ORM/storage packages but the visual package dependencies were not present in the inspected package manifest; re-audit before any adoption.
- Do not assume all apps are visual consumers.

## Existing commands observed at repository root

- `pnpm assets:generate`
- `pnpm assets:render`
- `pnpm assets:validate`
- `pnpm assets:check:bounds`
- `pnpm test:assets`
- `pnpm test:ui`
- `pnpm test:ui-catalog`
- `pnpm board:ui:check`
- `pnpm board:budget`
- `pnpm test:e2e:visual:matrix`
- `pnpm docs:check` / `pnpm docs:links` (revalidate script names)

## Audit limitations

This is a source/manifest inspection, not an execution of the repository build, all tests, browser runtime, exact image binary inspection or device performance benchmark. The local agent must run relevant commands and inspect rendered assets before claiming readiness.
