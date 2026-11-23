# M15 — Constitutional AGI-OS (`M15.01`–`M15.07`)

Status: **in progress (ADR 0010 + deterministic invariant gate landed)** — this milestone builds MoonWitness's Constitutional Recursive Self-Improvement (RSI), World-Model Verification, and Epistemic Calibration plane on top of [M14](15-autonomous-evolution-agi.md) and [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md).

## Constitutional Gate (Prerequisite for All M15 Modules)

Before any M15 feature code is promoted, `scripts/check-m15-invariants.mjs` enforces [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md) across all seven modules:

- Zero direct `node:fs` or `node:child_process` imports in `packages/ai-runtime/src/`
- Zero explicit `: any` annotations
- Mandatory `createRedactor()` secret redaction and SHA-256 (`createHash('sha256')`) digests
- Mandatory `automatedSelfAccept: false` / `automatedPromotionAllowed: false` guardrails
- Immutable constitutional gates (`R0`–`R4`, `ai-drift-watchdog`, `board:ui:check`, `desktop:ui:check`, `api:addon:check`)
- Private-mesh-IP-only routing per [ADR 0009](../decisions/0009-a2a-mesh-federation.md)

---

## M15.01 — Speculative Tree Search & Recursive Tournament Voting (RTV)

- **Module path:** `packages/ai-runtime/src/speculative-tree.ts`
- **Unit tests:** `packages/ai-runtime/tests/speculative-tree.test.ts`
- **Governing ADR:** [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md) (Pillar 1, arXiv:2604.16529)
- **Acceptance criteria:**
  - Exports `compressTrajectorySummary`, `runRecursiveTournamentVoting`, and `selectWinningSpeculativeBranch`.
  - Disqualifies any branch failing Proof Gate v2 or reporting `scopeClean === false` fail-closed.
  - Ranks passing branches deterministically via RTV + objective test pass rate + latency/cost tie-breaker.
  - Emits redacted `SpeculativeTournamentReport` with `automatedSelfAccept: false` and deterministic `reportSha256`.

---

## M15.02 — Collective Skill Tree Search (CSTS / CSN-Assess)

- **Module path:** `packages/ai-runtime/src/skill-tree.ts`
- **Unit tests:** `packages/ai-runtime/tests/skill-tree.test.ts`
- **Governing ADR:** [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md) (Pillar 2, arXiv:2606.16774)
- **Acceptance criteria:**
  - Exports `buildCollectiveSkillTree`, `scoreSkillTransferability`, and `pruneDegradedSkillNodes`.
  - Tracks hierarchical parent-child skills across `orm`, `board`, `paas`, `desktop`, and `knowledge` domains.
  - Detects negative transfer (`transferDeltaBps < 0`), flagging degraded nodes as `prune_recommended` / `revocation_candidate`.
  - Enforces `automatedPromotionAllowed: false`, redaction via `createRedactor()`, and deterministic `treeSha256`.

---

## M15.03 — Forward-Inverse World-Model Surprise Gate

- **Module path:** `packages/ai-runtime/src/world-model-gate.ts`
- **Unit tests:** `packages/ai-runtime/tests/world-model-gate.test.ts`
- **Governing ADR:** [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md) (Pillar 3, ICLR 2026 RSI)
- **Acceptance criteria:**
  - Exports `evaluateWorldModelConsistency(prediction, observation)`.
  - Compares predicted vs observed post-state (changed files, HTTP/container health, invariants) and computes `surpriseScoreBps` (`0..10000`).
  - Detects `UNEXPECTED_SIDE_EFFECT` and `PREDICTION_MISMATCH` and emits an advisory `ai.obligation` proposal when surprise meets or exceeds threshold.
  - Enforces `automatedSelfAccept: false`, redaction via `createRedactor()`, and deterministic `reportSha256`.

---

## M15.04 — Constitutional Auto-Invariant Synthesizer

- **Module path:** `packages/ai-runtime/src/invariant-synthesizer.ts`
- **Unit tests:** `packages/ai-runtime/tests/invariant-synthesizer.test.ts`
- **Governing ADR:** [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md) (Pillar 4, AIDE² / Aria)
- **Acceptance criteria:**
  - Synthesizes deterministic candidate invariant rules from verified failure traces and drift evidence.
  - Rejects fail-closed any proposal attempting to weaken or bypass immutable gates (`R0`–`R4`, `ai-drift-watchdog`, `board:ui:check`, `desktop:ui:check`, `api:addon:check`).
  - Enforces `automatedPromotionAllowed: false`, redaction via `createRedactor()`, and deterministic SHA-256 proposal digests.

---

## M15.05 — Mesh Semantic Resonance Bus

- **Module path:** `packages/ai-runtime/src/semantic-bus.ts`
- **Unit tests:** `packages/ai-runtime/tests/semantic-bus.test.ts`
- **Governing ADR:** [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md) (Pillar 5, openswarm-os + EasyTier A2A), [ADR 0009](../decisions/0009-a2a-mesh-federation.md)
- **Acceptance criteria:**
  - Routes bounded semantic resonance signals across private EasyTier mesh hosts only (`isPrivateMeshHost` fail-closed).
  - Enforces `companyId` isolation, TTL expiry, and resonance score thresholds to prevent broadcast storms.
  - Enforces `automatedSelfAccept: false`, redaction via `createRedactor()`, and deterministic SHA-256 envelope digests.

---

## M15.06 — Counterfactual Causal Time-Machine Replay

- **Module path:** `packages/ai-runtime/src/causal-replay.ts`
- **Unit tests:** `packages/ai-runtime/tests/causal-replay.test.ts`
- **Governing ADR:** [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md) (Pillar 6, MoonWitness Original)
- **Acceptance criteria:**
  - Exports `findCausalDivergencePoint(checkpoints)` and `planCounterfactualFork(trace, intervention)`.
  - Identifies the earliest checkpoint where Proof Gate failed or World-Model Surprise spiked and classifies root cause (`prompt_ambiguity | missing_context | skill_negative_transfer | tool_error | environment_drift`).
  - Compiles a deterministic counterfactual fork plan anchored at the divergence commit SHA with `automatedSelfAccept: false`, `createRedactor()`, and `planSha256`.

---

## M15.07 — Epistemic Brier/ECE Calibration Ledger

- **Module path:** `packages/ai-runtime/src/epistemic-calibration.ts`
- **Unit tests:** `packages/ai-runtime/tests/epistemic-calibration.test.ts`
- **Governing ADR:** [ADR 0010](../decisions/0010-constitutional-rsi-world-model.md) (Pillar 7, MoonWitness Original)
- **Acceptance criteria:**
  - Computes deterministic Brier score, Expected Calibration Error (ECE), and reliability bins from predicted confidence vs verified Proof Gate outcomes.
  - Flags overconfident/miscalibrated domains and emits advisory calibration reports.
  - Enforces `automatedSelfAccept: false`, redaction via `createRedactor()`, and deterministic SHA-256 ledger digests.

---

## Verification

- `node --test scripts/check-m15-invariants.test.mjs`
- `node scripts/check-m15-invariants.mjs --json`
- `pnpm --filter @moonwitness/ai-runtime build && pnpm --filter @moonwitness/ai-runtime test`
- `node scripts/check-docs.mjs` and `pnpm automation:check:roadmap`
