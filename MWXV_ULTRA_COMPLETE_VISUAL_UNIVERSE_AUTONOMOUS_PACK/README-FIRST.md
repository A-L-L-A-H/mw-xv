# MoonWitness XV — Ultra Complete Visual Universe & Asset Ecosystem

**Autonomous implementation pack for local AI / Codex / multi-agent coding systems**

- Repository: `https://github.com/A-L-L-A-H/mw-xv`
- Target branch: `dev`
- Pack baseline: `0b89060602c659efdd5e9e1a12c166fee237418e`
- Task count: **109 atomic tasks**
- Machine-readable plan: `task.json`
- Human-readable checklist: `TASKS.md`

## Start here

1. Open the repository and read `AUTONOMOUS_EXECUTION.md` completely.
2. Read `PROJECT_CHARTER.md`, `AUDIT_BASELINE.md`, `ARCHITECTURE.md`, `VISUAL_BIBLE.md`, and `ASSET_PACK_SPEC.md`.
3. Read `ADDON_ASSET_MATRIX.md`, `ANIMATION_RUNTIME.md`, `CREATIVE_LAB.md`, and `QA_ACCEPTANCE.md`.
4. Revalidate current `dev` HEAD and workspace. The repository may have moved since pack creation.
5. Load `task.json`; execute tasks in dependency order. `TASKS.md` is the human-facing mirror.
6. Work autonomously on non-blocked tasks; do not ask broad questions. Only request human approval at the explicit approval gates.

## What this is

This pack is a specification, execution backlog, validation contract and production handoff. It does **not** pretend to contain the final binary anime art, rig files, sprite sheets or completed runtime. Those are explicit production tasks for the local agent to create, register, validate and review inside the repository.

## Main architectural rule

Evolve `packages/assets` and `packages/ui`; preserve the ORM/addon architecture. Do not create one asset package per addon. Keep static visual assets out of ORM migrations/seeds. Backend and ORM packages must remain presentation-agnostic.

## Expected first visible milestone

One approved Moon City homepage scene: independent visual layers, one consistent character, controlled environment motion, bounded camera/parallax, anime FX, reduced-motion fallback, and responsive composition. After it works and passes budgets, expand coverage to existing product domains.
