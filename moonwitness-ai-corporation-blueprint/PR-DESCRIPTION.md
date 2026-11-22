# PR Description — Documentation Proposal

## Title

`docs: propose evidence-grounded AI Corporation architecture`

## Summary

Adds a research-backed architecture proposal for evolving MoonWitness XV into an ORM Addon-First, evidence-grounded adaptive AI organization.

## Documents

- Executive Summary
- Grand Plan & Design Blueprint
- Research Register and prior-art notes
- Implementation Workplan with acceptance gates
- Draft ADR for maintainer decision

## Key decisions proposed

- MoonWitness remains the authoritative source of truth.
- ORM Addon-First is mandatory for durable domain state.
- Existing request, organization, workflow, knowledge, integration and Jobs Engine capabilities are reused before new models are introduced.
- The existing K0–K9 knowledge/research AI scope remains distinct from workforce execution.
- One bounded agent with evidence-based verification is delivered before a multi-agent organization.
- A persistent obligation ledger provides continuity across project changes.
- MCP is the tool boundary; A2A is an optional peer-agent boundary.
- Memory/skill/policy improvements require evaluation and rollback.

## Non-goals

- No runtime code or database schema changes.
- No deployment or branch-rule changes.
- No AGI claim.
- No new GitHub Issues or roadmap statuses until maintainer review.

## Validation

Documentation link checks and repository docs validation should run after the files are placed in the repository. The exact current `dev` SHA and ADR numbering must be confirmed before merge.

## Reviewer focus

1. Does the proposal preserve the existing addon-first and two-branch contracts?
2. Does it reuse current domain models instead of duplicating them?
3. Is the boundary between knowledge suggestions and autonomous execution clear?
4. Is the obligation/evidence proposal worth a focused proof of concept?
5. Are the security and evaluation gates sufficient for the first bounded agent?
