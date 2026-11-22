# W9-008 — Add-on visual handoff

## Deliverable

`docs/design/addon-visual-handoff.md` defines the ORM → API → Board ownership boundary, canonical manifest-path reference convention, explicit UI/assets public import rules, and current visual mapping for all 12 active add-ons. It links the verified per-domain audit and documents how to add mappings without leaking presentation into backend packages or showing catalog fixtures as production data.

The same batch regenerated the stale generated API, model, platform and workspace references from current `dev` source. The workspace reference now includes the already-committed `sounds:ambience` generator script.

## Verification

- `pnpm docs:generate` — exit 0; generated references and README workspace summary from committed source.
- `pnpm docs:check` — exit 0; 15 generated-reference/readme/guide tests, 8 docs/navigation tests, built examples typecheck, and ORM examples (10 tests) passed.
- `pnpm docs:links` — exit 0; 602 Markdown files and navigation targets validated with this handoff staged.
- `node scripts/docs/generate-reference.mjs --check` — exit 0; generated references are current.
- `git diff --check` — exit 0.

The docs check was run with unrelated local ORM/desktop/todo work temporarily stashed because it changed the source fingerprint. The local work was restored; concurrently created untracked commercial files were preserved and not included.
