# Semantics benchmark and drift ledger

- Related task: `K4-006`
- Contract schema: [`packages/research/src/semantics-benchmark.schema.json`](../../packages/research/src/semantics-benchmark.schema.json)
- Runtime implementation: [`packages/research/src/semantics-benchmark.ts`](../../packages/research/src/semantics-benchmark.ts)
- Versioned synthetic fixtures: [`docs/knowledge/semantics-benchmark-fixtures.json`](semantics-benchmark-fixtures.json)
- Evaluation report: [`research/evaluations/K4-006-semantics-benchmark.md`](../../research/evaluations/K4-006-semantics-benchmark.md)

## Purpose

The semantics benchmark and drift ledger measures deterministic `@moonwitness/research` evaluators (`polarity_speaker`, `textual_alignment`, and `concept_profile`) against versioned suites without inventing pass results or concealing unmeasured corpus gaps.

## Separation of `empty`, `unsupported`, and `unknown`

Every benchmark case declares an explicit `input_state`:

- `measured`: carries explicit expected and payload objects and is evaluated deterministically to `matched` or `mismatched`.
- `empty`: records an intentionally unpopulated dataset or analyzer slice (for example, when no authorized multi-verse lexical analyzer exists yet).
- `unsupported`: records an unsupported script, language, or analyzer capability.
- `unknown`: records an unresolved or unreviewed ground-truth state.

Non-measured cases (`empty`, `unsupported`, `unknown`) are excluded from `evaluated_cases` and reported in separate counters (`empty_cases`, `unsupported_cases`, `unknown_cases`).

## No invented benchmark pass

- If `evaluated_cases === 0`, `precision` and `error_rate` are `null`, and `verdict` is `no_measured_cases`.
- If `mismatched_cases > 0`, `verdict` is `failed`.
- If `mismatched_cases === 0` and any `empty`, `unsupported`, or `unknown` case is present, `verdict` is `incomplete`.
- `verdict` is `passed` **only** when `evaluated_cases > 0`, `mismatched_cases === 0`, and `empty_cases === unsupported_cases === unknown_cases === 0`.

## Drift ledger comparison

`compareSemanticsBenchmarkReports(baseline, candidate)` re-computes and verifies the canonical SHA-256 `report_digest` on both reports before diffing. Tampered or malformed reports fail closed. Detected drifts are classified as:

- `polarity_drift`
- `speaker_drift`
- `alignment_drift`
- `concept_drift`
- `coverage_drift`
- `verdict_drift`
- `reconciliation_drift`

## Historical count reconciliation policy

Discrepancies between historical counts (such as the `1751` vs `1754` Pure Asma occurrence counts noted in the rebuild plan) are recorded as `discrepancy_recorded` or `insufficient_evidence` audit items with explicit `observation_state` values. A reconciliation record cannot be marked `reconciled_with_evidence` while counts diverge or any observation remains `historical_unverified`, `unsupported`, or `unknown`.
