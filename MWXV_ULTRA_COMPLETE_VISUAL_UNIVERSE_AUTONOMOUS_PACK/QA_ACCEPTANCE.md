# Quality, Safety and Production Acceptance

## 1. Source and task integrity

- Latest `dev` HEAD recorded before changes.
- Existing dirty changes preserved.
- Task dependencies acyclic and synchronized between JSON/Markdown.
- No task marked done without acceptance evidence.

## 2. Asset correctness

- Canonical manifest parses and validates.
- Every ID/path unique.
- Every generated file has an owning generator and source/master relationship.
- Every distributable asset has valid provenance/license.
- Alpha, dimensions, crop/focal point, safe area and color profile reviewed where relevant.
- Sprite/frame/scene references resolve.
- Contact sheets generated and reviewed.
- Source masters are excluded from ordinary runtime package output unless explicitly needed.

## 3. Character/world consistency

- Character IDs and design sheets are canonical.
- Outfit/proportion/palette/linework remain consistent.
- Environment perspective and lighting match the World Bible.
- No visual artifacts, malformed anatomy, broken alpha seams or unintended text.
- Scenes have responsive/focal-safe composition.

## 4. Runtime correctness

- Scene play/pause/reset/complete works.
- Offscreen scenes pause according to policy.
- Unmount/navigation releases observers/listeners/media/animation resources.
- Missing assets use static fallback.
- Reduced-motion does not conceal information or prevent access.
- No scroll hijack, focus obstruction or input interception.
- No autoplay sound; user can mute/stop ambience.

## 5. Application and addon integrity

- All 12 active addon domains have verified mapping to existing models/routes/views/permissions.
- ORM packages do not import visual/media runtime.
- API does not import browser animation or image-generation code.
- Static assets are not database seeds/migrations.
- User-uploaded media uses existing storage/attachment controls.
- Real data/state semantics remain authoritative.

## 6. Browser/accessibility matrix

At minimum test repository's current supported breakpoints and visual audit widths. At the inspected baseline these included desktop (1672/1440), tablet (1024/768), mobile (390/375/320); revalidate current test config.

- Keyboard only and focus-visible.
- Touch and hover-capable pointer separately.
- Light/dark and supported skins/densities.
- Reduced-motion.
- Asset load failure and slow network.
- Screen-reader names, semantic headings, live status and alt/decorative behavior.
- No document horizontal overflow.

## 7. Performance gate

Measure, do not guess:
- Initial route JS and CSS (raw + gzip).
- Critical and deferred asset transfer sizes.
- Decode time and memory.
- Frame pacing on named reference device/browser.
- CPU/GPU load and active animation count.
- Layout shift and interaction responsiveness.

Keep existing package/UI/Board budgets. If an increase is needed, justify with before/after measurement and targeted scope; never inflate budget merely to pass.

## 8. Commands

Run commands appropriate to changes and current scripts. Likely root gates include:

```bash
pnpm assets:generate
pnpm assets:validate
pnpm assets:check:bounds
pnpm test:assets
pnpm test:ui
pnpm test:ui-catalog
pnpm board:ui:check
pnpm --filter @moonwitness/board typecheck
pnpm --filter @moonwitness/board build
pnpm board:budget
pnpm test:e2e:visual:matrix
pnpm lint
pnpm build
pnpm test
```

Do not assume every command remains named or wired exactly this way; inspect current `package.json` and workflows. `pnpm assets:generate` may rewrite generated outputs: run with clean understanding of ownership and inspect `git diff` afterwards.

## 9. Release acceptance

- Required CI for changed paths passes.
- Package exports and consumer smoke tests pass.
- Documentation and changelog updated per repository policy.
- Branch protection preserved; no direct push to main/master.
- Evidence links and residual risks included in final handoff.
