# W0-001 — Repository baseline

Status: verified on 2026-11-22.

- Repository remote: `https://github.com/A-L-L-A-H/mw-xv.git` (`origin`).
- Branch: `dev`.
- Local HEAD: `e768079e4551c2f88b528f2a59acfc09ade4ba3e`.
- `git ls-remote origin refs/heads/dev` returned the same SHA, so the checkout matched the current remote `dev` tip at audit time. No fetch/reset/checkout was needed.
- Worktree was already dirty before implementation: 42 tracked paths plus untracked `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/`, `docs/superpowers/`, and `raw_arts/`. These were preserved. No user changes were staged, reset, stashed, or overwritten.
- Branch protection could not be established from local Git metadata; no authenticated protection-rule query was run. Push policy remains: push only to `dev`; stop if rejected.

Commands and exit codes:

| Command                               | Exit |
| ------------------------------------- | ---: |
| `git status --short --branch`         |    0 |
| `git rev-parse HEAD`                  |    0 |
| `git branch --show-current`           |    0 |
| `git remote -v`                       |    0 |
| `git ls-remote origin refs/heads/dev` |    0 |

The baseline differs from pack SHA `0b89060602c659efdd5e9e1a12c166fee237418e`; current `dev` is `e768079e4551c2f88b528f2a59acfc09ade4ba3e` and is the source of truth.
