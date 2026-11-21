# Mizan policy boundary specification

- Related ADR: [ADR 0005: Mizan evaluation and policy boundary](../decisions/0005-mizan-evaluation-policy-boundary.md)
- Related task: `K6-001`
- Calibration and failure-mode profile: [`research/profiles/mizan-policy-boundary-v1.json`](../../research/profiles/mizan-policy-boundary-v1.json)
- Privacy and safeguarding policy: [Knowledge privacy and safeguarding](../governance/knowledge-privacy-and-safeguarding.md)

## 1. Legacy `TH` / `ARI` disposition

- Legacy `bjo163/dev-mw-blueprint` (`cc53d63da1f34f69e20516a0b1c13514fa898725`) is deferred under `K0-006` with `license: "unknown"` and no imported source files.
- Legacy `TH` and `ARI` semantics are **rejected as unverified** until re-derived cleanly inside this repository with versioned equations, synthetic calibration fixtures, and independent review.

## 2. Analytic vs. normative boundary matrix

| Domain                                         | Permitted output                                                                                      | Prohibited output / claim                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Evidence-bound factor analysis (`K6-002`)      | Policy-versioned numeric or categorical diagnostic with explicit scope, uncertainty, and evidence IDs | Moral worth, spiritual rank, salvation status, divine judgment, legal guilt/liability   |
| Missing or conflicting evidence                | Explicit `unknown` / `insufficient_evidence` state                                                    | Coercion to `0`, `low_risk`, `cleared`, or `verified`                                   |
| World-simulation concepts (e.g., AETHERION)    | Labeled `framework` / `hypothesis` / `world_simulation` concept metadata                              | Real-world afterlife gain/loss assertions about any person                              |
| Publication & case triage (`K6-003`, `K6-004`) | Advisory candidate summary staged for authenticated human review                                      | Autonomous harm/enforcement, autonomous `PUBLIC_APPROVED` transition, or minor exposure |

## 3. Prohibited autonomous action gates

1. **No autonomous harm actions**: Analytic factors may never trigger sanctions, suspensions, alerts naming unverified suspects publicly, or automated external dispatches.
2. **No autonomous publication**: No score threshold may promote `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`, or `CHILD_SENSITIVE` records to `PUBLIC_APPROVED`.
3. **No minor exposure**: Any `CHILD_SENSITIVE` case (including BUG slot `#013` boundary classes) is excluded from general search, public URLs, analytics telemetry, logs, and AI prompts/responses.

## 4. Calibration and failure-mode review checklist

Before any `K6-002` implementation is accepted, reviewers must verify synthetic calibration cases covering:

- **F1 — Missing evidence preservation**: Absent or unreviewed evidence yields `unknown`, never a synthetic score.
- **F2 — Contradictory evidence preservation**: Opposing accepted evidence keeps conflict explicit (`unknown` / `contested`), never averaged into certainty.
- **F3 — Normative boundary refusal**: Any attempt to emit `salvation_status`, `legal_verdict`, `divine_judgment`, or `human_worth` fails closed.
- **F4 — Autonomous action refusal**: High or low analytic factors carry zero execution authority for publication, deletion, or minor disclosure.
