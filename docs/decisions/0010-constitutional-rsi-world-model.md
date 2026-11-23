# ADR 0010: Constitutional Recursive Self-Improvement, World-Model Verification & Epistemic Calibration

- **Status:** Accepted (2026-11-23; autonomous approval under repository unconditional-autonomy governance)
- **Date:** 2026-11-23
- **Decision owners:** MoonWitness maintainers
- **Scope:** `@moonwitness/ai-runtime`, `@moonwitness/ai-evaluation`, `@moonwitness/orm-ai`, `apps/board`, `scripts/`
- **Related tasks:** `M15.01`–`M15.07`
- **Related decisions and policies:** [ADR 0001](0001-platform-contracts.md), [ADR 0005](0005-mizan-evaluation-policy-boundary.md), [ADR 0006](0006-mandatory-addon-thin-api.md), [ADR 0007](0007-ai-corporation-addon-first-architecture.md), [ADR 0009](0009-a2a-mesh-federation.md)

## Context

MoonWitness's M14 foundation ([M14 Roadmap](../roadmap/15-autonomous-evolution-agi.md)) established closed-loop skill/memory evolution, continuous obligation sweeps, and stateless EasyTier A2A mesh federation. Advancing from single-trajectory autonomous execution to an AGI-class engineering OS requires solving seven structural failure modes observed across frontier recursive self-improvement (RSI) systems:

1. **Single-path local optima & unverified candidate selection:** Linear agent runs get trapped in brittle patches without exploring parallel solution hypotheses or enforcing deterministic tournament selection.
2. **Skill negative transfer & silent degradation:** Flat skill libraries accumulate conflicting heuristics that regress performance across domains (`orm`, `board`, `paas`, `desktop`, `knowledge`) when promoted without hierarchical transferability scoring.
3. **Silent side-effects & world-model drift:** Passing unit tests alone does not guarantee that an agent's post-execution state (modified files, container/HTTP health, invariants) matches its pre-execution prediction.
4. **Recurring regression classes:** Post-mortem findings remain prose instead of being compiled into executable, deterministic invariant proposals.
5. **Unbounded multi-node broadcast chatter:** Peer-to-peer mesh coordination without semantic resonance filtering, TTLs, and private-mesh IP enforcement risks broadcast storms and data exfiltration.
6. **Opaque failure forensics:** When a multi-step trajectory fails, restarting from scratch wastes tokens and obscures whether the root cause was prompt ambiguity, missing context, skill negative transfer, tool error, or environment drift.
7. **Overconfident self-assessment:** Uncalibrated LLM confidence scores misallocate human review and compute budgets unless continuously audited via proper scoring rules (Brier score and Expected Calibration Error).

## Decision

MoonWitness adopts a **Constitutional Recursive Self-Improvement (RSI) & World-Model Verification Architecture** (`M15.01`–`M15.07`) implemented as pure, deterministic TypeScript primitives inside `@moonwitness/ai-runtime`, governed by falsifiable constitutional invariants enforced by `scripts/check-m15-invariants.mjs`.

### The 7 M15 Pillars

1. **M15.01 — Speculative Tree Search & Recursive Tournament Voting (`speculative-tree.ts`)** _(informed by arXiv:2604.16529)_
   - Evaluates $N$ parallel speculative worktree or mesh branches.
   - Disqualifies fail-closed any branch failing Proof Gate v2 or reporting `scopeClean === false`.
   - Compresses trajectories and ranks passing branches via deterministic Recursive Tournament Voting (RTV) with objective test pass-rate and latency/cost tie-breakers.
   - Emits a redacted `SpeculativeTournamentReport` with `automatedSelfAccept: false` and deterministic `reportSha256`.

2. **M15.02 — Collective Skill Tree Search (`skill-tree.ts`)** _(informed by CSTS / CSN-Assess, arXiv:2606.16774)_
   - Organizes procedural skills into a hierarchical parent-child tree across MoonWitness domains (`orm`, `board`, `paas`, `desktop`, `knowledge`).
   - Scores cross-domain transferability (`transferDeltaBps`); negative transfer (`transferDeltaBps < 0`) flags degraded nodes as `prune_recommended` or `revocation_candidate`.
   - Enforces `automatedPromotionAllowed: false` and emits deterministic `treeSha256`.

3. **M15.03 — Forward-Inverse World-Model Surprise Gate (`world-model-gate.ts`)** _(informed by ICLR 2026 RSI Forward-Inverse consistency)_
   - Compares pre-execution predicted post-state (expected changed files, HTTP/container health, invariants) against observed post-state.
   - Computes `surpriseScoreBps` (`0..10000`), classifies `UNEXPECTED_SIDE_EFFECT` and `PREDICTION_MISMATCH`, and emits an advisory `ai.obligation` proposal when surprise meets or exceeds the configured threshold (`automatedSelfAccept: false`, `reportSha256`).

4. **M15.04 — Constitutional Auto-Invariant Synthesizer (`invariant-synthesizer.ts`)** _(informed by AIDE² / Aria)_
   - Compiles verified failure traces and drift reports into candidate deterministic invariant specifications (`candidate` status only).
   - Strictly forbids modifying or weakening immutable constitutional gates (`R0`–`R4`, `ai-drift-watchdog`, `board:ui:check`, `desktop:ui:check`, `api:addon:check`).
   - Enforces `automatedPromotionAllowed: false`, secret redaction via `createRedactor()`, and SHA-256 proposal digests.

5. **M15.05 — Mesh Semantic Resonance Bus (`semantic-bus.ts`)** _(informed by openswarm-os + EasyTier A2A)_
   - Routes bounded semantic signals (hypotheses, surprise alerts, skill revocation advisories) exclusively across private EasyTier mesh IPs (`isPrivateMeshHost` fail-closed).
   - Enforces company isolation (`companyId`), TTL expiry, resonance threshold filtering, secret redaction via `createRedactor()`, and SHA-256 envelope digests.

6. **M15.06 — Counterfactual Causal Time-Machine Replay (`causal-replay.ts`)** _(MoonWitness Original)_
   - Scans checkpointed execution traces to pinpoint the earliest step where Proof Gate failed or World-Model Surprise spiked.
   - Attributes root cause (`prompt_ambiguity | missing_context | skill_negative_transfer | tool_error | environment_drift`) and compiles a deterministic counterfactual branch fork plan anchored at that checkpoint commit SHA (`automatedSelfAccept: false`, `planSha256`).

7. **M15.07 — Epistemic Brier/ECE Calibration Ledger (`epistemic-calibration.ts`)** _(MoonWitness Original)_
   - Tracks predicted confidence probabilities against binary Proof Gate verification outcomes across agents and domains.
   - Computes deterministic Brier score, Expected Calibration Error (ECE), reliability bins, and calibration drift alerts (`automatedSelfAccept: false`, `ledgerSha256`).

## Falsifiable Constitutional Invariants

Every M15 module MUST satisfy all of the following machine-verified invariants (enforced by `scripts/check-m15-invariants.mjs`):

1. **Zero direct I/O or shell execution in `@moonwitness/ai-runtime`:** No M15 module in `packages/ai-runtime/src/` may import `node:fs`, `node:fs/promises`, `fs`, `node:child_process`, or `child_process`.
2. **Strict TypeScript type hygiene:** Zero explicit `: any` annotations in M15 modules.
3. **No autonomous self-acceptance or self-promotion:**
   - Execution/planning outputs MUST enforce `automatedSelfAccept: false` (never `automatedSelfAccept: true`).
   - Evolution/synthesis outputs MUST enforce `automatedPromotionAllowed: false` (never `automatedPromotionAllowed: true`).
4. **Immutable constitutional gates:** No M15 module may disable, bypass, or weaken `R0`–`R4` risk tiers, `ai-drift-watchdog`, `board:ui:check`, `desktop:ui:check`, or `api:addon:check`.
5. **Private-mesh-IP-only routing:** All M15 mesh signal routing MUST enforce private EasyTier mesh IP validation ([ADR 0009](0009-a2a-mesh-federation.md)); public internet endpoints are rejected fail-closed.
6. **Mandatory secret redaction & cryptographic digests:** Every M15 module MUST sanitize emitted reports/envelopes via `createRedactor()` and compute deterministic SHA-256 digests (`createHash('sha256')`) over canonical payloads.

## Consequences

- **Positive:** Elevates MoonWitness from single-trajectory automation to verifiable, calibrated, counterfactual-capable AGI-class engineering while preserving 100% server-authoritative Proof Gate v2 and constitutional safety boundaries.
- **Costs / trade-offs:** Adds deterministic verification and calibration overhead per run and requires human/workflow promotion for synthesized skills and invariants.
- **Enforcement:** Verified continuously via `node scripts/check-m15-invariants.mjs --json` and its paired fixture test suite `scripts/check-m15-invariants.test.mjs`.
