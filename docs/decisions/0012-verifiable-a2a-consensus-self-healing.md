# ADR 0012: Verifiable Cross-Node A2A Consensus, Policy Invariant Fuzzing, Ephemeral Sandbox Contracts & Autonomous Incident Self-Healing

- **Status:** Accepted (2026-11-23; autonomous approval under repository unconditional-autonomy governance)
- **Date:** 2026-11-23
- **Decision owners:** MoonWitness maintainers
- **Scope:** `@moonwitness/ai-runtime`, `scripts/`
- **Related tasks:** `M17.01`–`M17.04`
- **Related decisions and policies:** [ADR 0001](0001-platform-contracts.md), [ADR 0005](0005-mizan-evaluation-policy-boundary.md), [ADR 0006](0006-mandatory-addon-thin-api.md), [ADR 0007](0007-ai-corporation-addon-first-architecture.md), [ADR 0009](0009-a2a-mesh-federation.md), [ADR 0010](0010-constitutional-rsi-world-model.md), [ADR 0011](0011-sovereign-dreaming-merkle-agi.md)

## Context

MoonWitness's M16 Sovereign Dreaming AGI-OS ([M16 Roadmap](../roadmap/17-sovereign-dreaming-agi.md), [ADR 0011](0011-sovereign-dreaming-merkle-agi.md)) delivered reversible sleep-time memory consolidation, Active Inference Expected Free Energy (EFE) control, RFC 6962 Merkle audit transparency, and an offline adversarial red-team arena. Operating a federated, multi-node AGI engineering mesh safely requires solving four additional verification and containment challenges:

1. **Unverified cross-node swarm consensus:** Federated A2A peers can emit conflicting or forged execution attestations; naive majority voting treats uncalibrated or unverified peers equally and lacks cryptographic inclusion proofs tied to an append-only audit root.
2. **Policy regression & boundary escapes in synthesized invariants:** Candidate policies and invariants synthesized from red-team runs or operator rules may introduce subtle contradictions, shadow-allow regressions, or boundary escapes under adversarial action sequences.
3. **Unsafe execution contracts for candidate patches and ablations:** Running untrusted candidate code or ablation gates without a strict, machine-verified zero-network, secret-free, read-only-root sandbox manifest risks lateral movement, credential exfiltration, or resource exhaustion.
4. **Manual, slow incident triage without causal grounding:** Recurring production fault signatures require redacting sensitive log payloads, clustering root causes, and synthesizing human-reviewable RCA and patch/runbook proposals grounded in Active Inference EFE and counterfactual causal replay—without ever permitting autonomous self-merge.

## Decision

MoonWitness adopts a **Verifiable Mesh AGI Consensus & Self-Healing Architecture** (`M17.01`–`M17.04`) implemented as pure, deterministic TypeScript primitives inside `@moonwitness/ai-runtime`, governed by falsifiable constitutional invariants enforced by `scripts/check-m17-invariants.mjs`.

### The 4 M17 Pillars

1. **M17.01 — Cross-Node Verifiable A2A Swarm Consensus (`a2a-consensus.ts`)**
   - Evaluates peer execution attestations carrying HMAC/signature metadata, RFC 6962 Merkle inclusion proofs (verified via `verifyMerkleInclusionProof` / `verifyInclusionProof` from `./merkle-ledger.js`), and peer Brier/ECE calibration scores (from `./epistemic-calibration.js`).
   - Computes Byzantine-tolerant calibration-weighted quorum (`quorumReached`, `acceptedWeightBps`, `rejectedPeers`), rejecting peers with invalid signatures, failed Merkle proofs, or calibration error above policy thresholds.
   - Always enforces `automatedPromotionAllowed: false` and `automatedSelfMerge: false`, with deterministic `consensusSha256`.

2. **M17.02 — Deterministic Seeded Policy Invariant Fuzzer (`policy-fuzzer.ts`)**
   - Uses a deterministic `mulberry32` PRNG seeded by caller input to generate randomized adversarial action traces against candidate synthesized policies/invariants.
   - Detects policy contradictions, shadow-allow regressions (candidate allows an action denied by baseline), and boundary escapes before any candidate can reach human review.
   - Emits a deterministic fuzzing report with `automatedPromotionAllowed: false`, `automatedSelfMerge: false`, and `fuzzReportSha256`.

3. **M17.03 — Ephemeral Zero-Network Sandbox Runner Contract (`sandbox-runner.ts`)**
   - Pure manifest builder and execution output/diff verifier for ephemeral Docker/MicroVM sandboxes compatible with ablation gates.
   - Strictly enforces `networkDisabled: true`, `readOnlyRootFs: true`, `secretsInjected: false`, CPU/memory/timeout ceilings, and forbidden capability drop (`--cap-drop=ALL`).
   - Enforces `automatedPromotionAllowed: false`, `automatedSelfMerge: false`, and deterministic `manifestSha256` / `verificationSha256`.

4. **M17.04 — Autonomous Incident Self-Healer (`incident-healer.ts`)**
   - Ingests structured log entries, redacts all sensitive payloads via `createRedactor()`, clusters recurring fault signatures deterministically, and scores diagnostic hypotheses using Active Inference EFE (`evaluateExpectedFreeEnergy` from `./active-inference.js`) and counterfactual causal replay (`findCausalDivergencePoint` from `./causal-replay.js`).
   - Emits a human-reviewable RCA and patch/runbook proposal with `automatedSelfMerge: false`, `automatedPromotionAllowed: false`, and deterministic `proposalSha256`.

## Falsifiable Constitutional Invariants

Every M17 module MUST satisfy all of the following machine-verified invariants (enforced by `scripts/check-m17-invariants.mjs`):

1. **Zero direct I/O, shell execution, or dynamic code evaluation in `@moonwitness/ai-runtime`:** No M17 module in `packages/ai-runtime/src/` may import `node:fs`, `node:fs/promises`, `fs`, `node:child_process`, or `child_process`, nor call `eval(` or `new Function`.
2. **Strict TypeScript type hygiene:** Zero explicit `: any` annotations in M17 modules.
3. **Constitutional non-self-merge & non-self-promotion lock:** No M17 module may set `automatedSelfMerge: true` or `automatedPromotionAllowed: true`; every M17 module MUST explicitly enforce `automatedSelfMerge: false` / `automatedPromotionAllowed: false`.
4. **Mandatory secret redaction in `incident-healer.ts`:** `packages/ai-runtime/src/incident-healer.ts` MUST use `createRedactor()` to sanitize all ingested log entries and emitted proposals.
5. **Mandatory zero-network, secret-free sandbox lock in `sandbox-runner.ts`:** `packages/ai-runtime/src/sandbox-runner.ts` MUST enforce `networkDisabled: true` and `secretsInjected: false` (and forbid `networkDisabled: false` or `secretsInjected: true`).
6. **Mandatory Merkle proof & calibration-weighted quorum in `a2a-consensus.ts`:** `packages/ai-runtime/src/a2a-consensus.ts` MUST verify Merkle inclusion proofs (`verifyInclusionProof`) and enforce calibration-weighted quorum checks.

## Consequences

- **Positive:** Establishes Byzantine-tolerant, cryptographically verified A2A consensus, catches policy regressions before human review via deterministic fuzzing, guarantees zero-network/secret-free sandbox manifests, and accelerates incident triage with causally grounded, redacted RCA proposals.
- **Costs / trade-offs:** Requires peers to supply Merkle proofs and calibration telemetry, adds deterministic fuzzing compute before policy review, and maintains strict human-in-the-loop approval for all merges and promotions.
- **Enforcement:** Verified continuously via `node scripts/check-m17-invariants.mjs --json` and its paired test suite `scripts/check-m17-invariants.test.mjs`.
