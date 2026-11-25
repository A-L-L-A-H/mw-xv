# W9-007 — Desktop scene adoption decision

## Audit and decision

The desktop app is a local-first Node/Tauri host and agent harness, not a browser presentation consumer. Its package manifest has no dependency on `@moonwitness/ui` or `@moonwitness/assets`, and its public entry points do not render Board routes or scene DOM. The scene formats can remain portable package content for web consumers; desktop does not currently have a user-facing scene use case that justifies bringing in the visual package or browser-only lifecycle APIs. **No scene runtime or visual dependency was added to desktop.** Revisit if a concrete desktop view requests authored scene presentation.

## Verification

- `pnpm --filter @moonwitness/ai-runtime build` — exit 0; refreshed the local ignored declarations from current source.
- `pnpm --filter @moonwitness/desktop typecheck` — exit 0 after dependency build.
- First `pnpm --filter @moonwitness/desktop test` run had 2 SQLite initialization tests time out at their 5-second limit while UI Catalog browser tests were consuming CPU in parallel; 26/28 passed.
- Isolated retry `pnpm --filter @moonwitness/desktop test` — exit 0; 28/28 tests passed.

## Boundary

Scene JSON and asset provenance stay in `@moonwitness/assets`; rendering contracts stay in `@moonwitness/ui` and `@moonwitness/types`; desktop remains free of those dependencies until a real rendering consumer exists. The build command only updated ignored package output and did not change tracked source.
