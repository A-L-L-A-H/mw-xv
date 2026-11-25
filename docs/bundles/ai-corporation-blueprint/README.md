# MoonWitness XV — AI Corporation Blueprint Pack

Status: **Architecture proposal / research-backed design draft**  
Prepared: 2026-11-21  
Target repository: `A-L-L-A-H/mw-xv`  
Architecture invariant: **ORM Addon-First**

This package contains documentation proposals only. It does not modify the GitHub repository, create a branch, push a commit, or open a pull request.

## Contents

- `EXECUTIVE-SUMMARY.md` — one-page decision brief.
- `docs/AI-CORPORATION-GRAND-PLAN.md` — main architecture and product blueprint.
- `docs/AI-CORPORATION-RESEARCH-REGISTER.md` — research synthesis, GitHub reference projects, novelty hypotheses, and source register.
- `docs/AI-CORPORATION-IMPLEMENTATION-PLAN.md` — phased execution plan, work packages, acceptance gates, and evaluation metrics.
- `docs/AI-CORPORATION-ADR-DRAFT.md` — proposed architecture decisions for maintainer review.
- `PR-DESCRIPTION.md` — suggested PR / change description.
- `docs/roadmap/todo-ai-corporation.md` — granular, checkbox-driven implementation ledger (proposal IDs; reconcile with live roadmap before execution).
- `assets/architecture.png` — rendered target architecture diagram.
- `deliverables/MoonWitness-XV-AI-Corporation-Grand-Plan.docx` — formatted Word version of the grand plan.

## Suggested repository placement

Copy the files into the existing repository as follows, after reconciling with the live `dev` branch and the current roadmap:

- `docs/architecture/AI-CORPORATION-GRAND-PLAN.md`
- `docs/architecture/EXECUTIVE-SUMMARY.md`
- `docs/research/AI-CORPORATION-RESEARCH-REGISTER.md`
- `docs/roadmap/AI-CORPORATION-IMPLEMENTATION-PLAN.md`
- `docs/roadmap/todo-ai-corporation.md`
- `docs/adr/AI-CORPORATION-ADR-DRAFT.md` (confirm the repository's ADR directory and next number first)

Do not create a new feature branch if the repository's current two-branch policy remains in force. The repository roadmap currently describes `dev` as the integration branch and `main` as the stable branch.

## Important scope note

This is a proposal, not an implementation report. New models, addon names, APIs, and package boundaries are provisional until an exact-SHA audit of the current `dev` source confirms there is no existing implementation or overlap with the M-series and K0–K9 work.
