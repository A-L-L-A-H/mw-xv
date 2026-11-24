# ADR 0005: Mizan evaluation and policy boundary

- Status: proposed (pending explicit owner approval; `approval-required` gate)
- Date: 2026-11-21
- Related plan: [`MOONWITNESS_XI_MASTER_PLAN.md`](../bundles/local-ai-rebuild-plan/MOONWITNESS_XI_MASTER_PLAN.md) (Sections 1 and 7.5)
- Related task: `K6-001`
- Related decisions and policies: [ADR 0001](0001-platform-contracts.md), [ADR 0004](0004-knowledge-rebuild-centralization.md), [Knowledge privacy and safeguarding](../governance/knowledge-privacy-and-safeguarding.md), [Mizan policy boundary specification](../knowledge/mizan-policy-boundary-spec.md)
- Supporting profile: [`research/profiles/mizan-policy-boundary-v1.json`](../../research/profiles/mizan-policy-boundary-v1.json)

## Context

The local AI rebuild plan evaluates whether concepts from the legacy `dev-mw-blueprint` Rust Mizan specification—such as role, level, mandate, `TH` responsibility, and `ARI` analytic factors—may be adapted for future scoped analysis (`K6-002`).

In [`docs/knowledge/legacy-source-inventory.json`](../knowledge/legacy-source-inventory.json) (`legacy-mizan-blueprint`), read-only repository inspection recorded historical references to `bjo163/dev-mw-blueprint` (`cc53d63da1f34f69e20516a0b1c13514fa898725`), including `mizan-engine.fixtures.v1.json`, `mizan-engine.fixtures.v1.1.json`, `mizan-analytical.fixtures.v1.2.json`, and migrations `crates/mizan-api/migrations/0001_mizan_ledger.sql` through `0003_analytical_factors.sql`. Under the owner-approved `K0-006` disposition (2026-10-15), that legacy repository has `license: "unknown"`, its source is unavailable in this checkout, and `decision` is `"defer"` (no legacy code or fixture import).

Without an explicit policy boundary, numeric responsibility or impact factors risk being misinterpreted as moral worth, divine/salvation verdicts, legal liability determinations, or triggers for automated enforcement, publication, or minor-data exposure.

## Decision

1. **Reject unverified legacy `TH` and `ARI` factor semantics for direct import.**
   Legacy `dev-mw-blueprint` `TH`/`ARI` weights, thresholds, and ledger schemas are not authoritative in this repository and may not be ported directly. Any analytic factor introduced later under `K6-002` must be newly specified, policy-versioned, licensed, bounded by a `research/profiles/` configuration, and verified with synthetic calibration fixtures and failure-mode checks.

2. **Strictly separate analytic/advisory scoring from normative rulings.**
   `TH != ARI != moral worth != legal verdict != final divine judgment`. Analytic calculations produce bounded, non-normative advisory diagnostics tied to explicit evidence references (`K3-002`). No analytic score, factor, or concept/world-simulation level (including Paradise/AETHERION designs) may represent, assert, or imply human worth, salvation status, divine approval/condemnation, or legal guilt/liability.

3. **Preserve `unknown` as `unknown`.**
   Missing evidence, unreviewed assertions, conflicting review consensus, or out-of-scope context must emit `unknown` or `insufficient_evidence` rather than coercing missing values to `0`, `safe`, `approved`, or `faultless`.

4. **Prohibit autonomous harm, publication, and minor-exposure actions.**
   Analytic outputs and optional local AI outputs (`AI_MODE=disabled` by default under ADR 0004) are strictly advisory. Neither an analytic score nor a model output may autonomously:
   - initiate enforcement, punitive, financial, reputational, or physical harm actions;
   - transition records to `PUBLIC_APPROVED` or publish editorial/case content;
   - expose, route, log, index, or send to any AI prompt any `CHILD_SENSITIVE` record or minor identifier (see [Knowledge privacy and safeguarding](../governance/knowledge-privacy-and-safeguarding.md)).

5. **Enforce human review gates across lifecycle stages.**
   - **Policy activation (`K6-001`)**: Requires explicit owner/CODEOWNER approval before any `K6-002` scoring code is enabled.
   - **Profile and calibration updates (`K6-002`)**: Require deterministic calibration fixtures, failure-mode verification, and independent human review (`K3-005`).
   - **Case actions, disclosures, and child-protection escalation (`K6-003`, `K6-004`)**: Require authenticated human reviewers distinct from the requester/action owner, bounded by company/tenant scope and explicit refusal paths.

## Consequences

- `K6-002` (scoped analytic responsibility engine) remains optional and gated on explicit owner acceptance of this ADR and its calibration/failure-mode boundary.
- Any downstream API or UI rendering analytic factors must label them explicitly as non-normative, advisory, and policy-versioned, and must block normative verdict wording and automated action triggers.
- Acceptance of this ADR establishes policy boundaries only; it does not authorize legacy code import (`K0-006`), private data ingestion (`K0-005`), runtime AI activation (`K7-001`), or application deployment (`ADR 0001`).
