# K4-006 Semantics benchmark and drift evaluation

- Task: `K4-006`
- Policy and schema reference: [`docs/knowledge/semantics-benchmark-and-drift.md`](../../docs/knowledge/semantics-benchmark-and-drift.md)
- Versioned synthetic suite: [`docs/knowledge/semantics-benchmark-fixtures.json`](../../docs/knowledge/semantics-benchmark-fixtures.json)
- Suite ID / version: `mw:benchmark-suite:synthetic-semantics-v1` (`1.0.0`, `fixture_classification: "synthetic"`)

## Measured scope and boundaries

This report records deterministic golden-suite evaluation over **synthetic** fixtures only:

- **Evaluated domains**: `polarity_speaker` (`projectResearchSemanticAnnotation`), `textual_alignment` (`projectTextualAlignmentCandidate`), and `concept_profile` (`validateConceptProfile` / `validateConceptProfileWithEvidence`).
- **Measured synthetic cases**: 4 (`SEM-01-negative-narration`, `SEM-02-direct-quote-speaker`, `ALN-01-parallel-candidate`, `CPT-01-scoped-profile-valid`).
- **Non-measured distinct slices**: 1 `empty` (`SLICE-01-empty-asma-lexicon`), 1 `unsupported` (`SLICE-02-unsupported-script`), 1 `unknown` (`SLICE-03-unknown-gold-label`).
- **Suite verdict rule**: Because the canonical mixed suite includes 3 non-measured slices alongside 4 matching measured synthetic cases, its verdict is `incomplete` (never `passed`), with `precision: 1` (`4/4` measured) and `error_rate: 0` (`0/4` measured) reported explicitly over `evaluated_cases = 4`.
- **Historical count reconciliation audit**: `mw:count-reconciliation:asma-1751-vs-1754-audit` records the historical `1751` vs `1754` discrepancy (`discrepancy_delta: 3`) with `reconciliation_status: "discrepancy_recorded"` and `observation_state: "historical_unverified"`.

## What is not claimed

- No precision, recall, or coverage metric over real Qur'anic, biblical, or witness corpora is claimed.
- No local AI model or external network call is executed.
- Historical Asma counts (`1751` vs `1754`) remain unreconciled pending an authorized corpus edition and human-authored morphological method.
