# ADR 0013: Autonomous AGI-OS Evaluation Benchmark Suite & Deterministic Multi-Agent World-Model Simulator

- **Status:** Accepted (2026-11-23; autonomous approval under repository unconditional-autonomy governance)
- **Date:** 2026-11-23
- **Decision owners:** MoonWitness maintainers
- **Scope:** `@moonwitness/ai-evaluation`, `scripts/`
- **Related tasks:** `M18.01`–`M18.03`
- **Related decisions and policies:** [ADR 0001](0001-platform-contracts.md), [ADR 0005](0005-mizan-evaluation-policy-boundary.md), [ADR 0010](0010-constitutional-rsi-world-model.md), [ADR 0011](0011-sovereign-dreaming-merkle-agi.md), [ADR 0012](0012-verifiable-a2a-consensus-self-healing.md)

## Context

MoonWitness's M14–M17 runtime layers ([ADR 0010](0010-constitutional-rsi-world-model.md), [ADR 0011](0011-sovereign-dreaming-merkle-agi.md), [ADR 0012](0012-verifiable-a2a-consensus-self-healing.md)) introduced obligation drift monitoring, speculative trajectory trees, world-model consistency gating, causal replay, epistemic calibration, sleep-time memory consolidation, Active Inference EFE control, RFC 6962 Merkle transparency logs, an adversarial red-team arena, cross-node A2A consensus, policy invariant fuzzing, ephemeral sandbox contracts, and incident self-healing.

Without a unified, deterministic, quantitative evaluation harness that exercises all M14–M17 primitives end-to-end under repeatable fault and adversarial perturbations, regressions in safety boundaries or cross-module integration can go undetected or be masked by non-deterministic randomness.

## Decision

MoonWitness adopts an **Autonomous AGI-OS Evaluation Benchmark Suite & Deterministic Multi-Agent World-Model Simulator** (`M18.01`–`M18.03`) implemented as pure, deterministic TypeScript modules in `@moonwitness/ai-evaluation`, governed by falsifiable constitutional invariants enforced by `scripts/check-m18-invariants.mjs` and executed via `scripts/run-agi-benchmark.mjs`.

### The 3 M18 Pillars

1. **M18.01 — Deterministic Multi-Agent World-Model Simulator (`world-sim.ts`)**
   - Generates repeatable synthetic repository, A2A mesh, incident, and obligation scenarios with controllable fault injection, latency spikes, and state-drift perturbations.
   - Uses a deterministic `mulberry32` PRNG keyed by an explicit caller-provided `seed` (zero `Math.random()`).
   - Emits deterministic scenario bundles and SHA-256 digests so identical seeds always produce bit-identical simulation worlds.

2. **M18.02 — Standardized Adversarial Red-Team & Boundary-Escape Suite (`adversarial-suite.ts`)**
   - Executes standardized red-team and boundary-escape vectors against real `@moonwitness/ai-runtime` M14–M17 primitives:
     - Prompt-injection & self-accept forgery (`runAdversarialRedTeamArena`)
     - Forged `accepted` status claims & replay nonce attacks (`validateA2ADelegationPolicy`, `verifyA2AEnvelope`)
     - Secret leakage in sandbox/incident outputs (`verifySandboxExecutionOutput`, `createRedactor`)
     - Uncalibrated/Byzantine peer collusion (`evaluateA2AConsensus`)
     - Policy shadow-allow & boundary-escape regressions (`fuzzPolicyInvariants`)
   - Requires 100% block rate on critical safety vectors; any breach sets `constitutionalPass: false` and forces `passed: false`.

3. **M18.03 — End-to-End 8-Axis Quantitative AGI-OS Scorecard (`agi-benchmark.ts`)**
   - Exercises real M14–M17 modules across 8 quantitative axes (each scored `0..100`):
     1. `obligation_continuity` (M14 `evaluateObligationDrift`)
     2. `speculative_reasoning` (M15 `selectWinningSpeculativeBranch`)
     3. `world_model_consistency` (M15 `evaluateWorldModelConsistency`)
     4. `causal_epistemic_rigor` (M15 `findCausalDivergencePoint` + `computeEpistemicCalibration`)
     5. `memory_active_inference` (M16 `runNonRemConsolidation` + `runRemDreamSelfProbe` + `evaluateExpectedFreeEnergy`)
     6. `merkle_audit_integrity` (M16 `buildMerkleAuditTree` + `generateMerkleInclusionProof` + `verifyMerkleInclusionProof` + `verifyMerkleConsistency`)
     7. `adversarial_safety` (M16 `runAdversarialRedTeamArena` + M18 `runAdversarialBenchmarkSuite`)
     8. `consensus_sandbox_healing` (M17 `evaluateA2AConsensus` + `fuzzPolicyInvariants` + `buildEphemeralSandboxManifest` + `verifySandboxExecutionOutput` + `synthesizeIncidentHealingProposal`)
   - Anchors the axis results in an RFC 6962 Merkle audit tree (`merkleRootHash`) and enforces a strict constitutional hard-fail gate: `constitutionalPass: false` unconditionally forces `passed: false` regardless of composite score.

## Falsifiable Constitutional Invariants

Every M18 module MUST satisfy all of the following machine-verified invariants (enforced by `scripts/check-m18-invariants.mjs`):

1. **Zero direct I/O, shell execution, or dynamic code evaluation in `@moonwitness/ai-evaluation`:** No M18 module in `packages/ai-evaluation/src/` may import `node:fs`, `node:fs/promises`, `fs`, `node:child_process`, or `child_process`, nor call `eval(` or `new Function`.
2. **Strict TypeScript type hygiene:** Zero explicit `: any` annotations in M18 modules.
3. **Deterministic seeded execution:** Zero bare `Math.random()` calls in M18 modules; simulation and benchmark entry points MUST accept an explicit `seed` parameter.
4. **Constitutional hard-fail gate:** Safety-axis and benchmark evaluators MUST enforce `constitutionalPass` such that `constitutionalPass: false` unconditionally forces overall `passed: false`.

## Consequences

- **Positive:** Provides a reproducible, cryptographically anchored 8-axis quantitative scorecard covering every M14–M17 runtime pillar, catching regressions and safety boundary escapes in CI.
- **Costs / trade-offs:** Requires maintaining synthetic scenario fixtures aligned with `@moonwitness/ai-runtime` contracts; any breaking runtime contract change surfaces immediately in the benchmark.
- **Enforcement:** Verified continuously via `node scripts/check-m18-invariants.mjs --json`, `pnpm --filter @moonwitness/ai-evaluation test`, and `node scripts/run-agi-benchmark.mjs --json`.
