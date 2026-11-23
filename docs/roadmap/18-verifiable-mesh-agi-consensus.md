# M17 — Verifiable Mesh AGI Consensus & Self-Healing (`M17.01`–`M17.04`)

Status: **in progress (ADR 0012 + deterministic invariant gate + runtime primitives)** — this milestone extends MoonWitness's [M16 Sovereign Dreaming AGI-OS](17-sovereign-dreaming-agi.md) with cross-node verifiable A2A swarm consensus, deterministic policy invariant fuzzing, ephemeral zero-network sandbox runner contracts, and autonomous incident self-healing governed by [ADR 0012](../decisions/0012-verifiable-a2a-consensus-self-healing.md).

## Constitutional Gate (Prerequisite for All M17 Modules)

Before any M17 feature code is promoted, `scripts/check-m17-invariants.mjs` enforces [ADR 0012](../decisions/0012-verifiable-a2a-consensus-self-healing.md) across all four modules:

- Zero direct `node:fs`, `node:child_process`, `eval(`, or `new Function` usage in `packages/ai-runtime/src/`
- Zero explicit `: any` annotations
- Mandatory `automatedSelfMerge: false` and `automatedPromotionAllowed: false` constitutional lock
- Mandatory `createRedactor()` usage in `packages/ai-runtime/src/incident-healer.ts`
- Mandatory `networkDisabled: true` and `secretsInjected: false` enforcement in `packages/ai-runtime/src/sandbox-runner.ts`
- Mandatory Merkle inclusion proof verification (`verifyInclusionProof`) and calibration-weighted quorum check in `packages/ai-runtime/src/a2a-consensus.ts`

---

## M17.01 — Cross-Node Verifiable A2A Swarm Consensus

- **Module path:** `packages/ai-runtime/src/a2a-consensus.ts`
- **Unit tests:** `packages/ai-runtime/tests/a2a-consensus.test.ts`
- **Governing ADR:** [ADR 0012](../decisions/0012-verifiable-a2a-consensus-self-healing.md) (Pillar 1)
- **Acceptance criteria:**
  - Accepts peer execution attestations carrying HMAC/signature metadata, RFC 6962 Merkle inclusion proofs (`verifyInclusionProof` from `./merkle-ledger.js`), and peer Brier/ECE calibration scores (from `./epistemic-calibration.js`).
  - Computes Byzantine-tolerant calibration-weighted quorum, rejecting unverified, tampered, or poorly calibrated peers.
  - Always returns `automatedPromotionAllowed: false`, `automatedSelfMerge: false`, and deterministic `consensusSha256`.

---

## M17.02 — Deterministic Seeded Policy Invariant Fuzzer

- **Module path:** `packages/ai-runtime/src/policy-fuzzer.ts`
- **Unit tests:** `packages/ai-runtime/tests/policy-fuzzer.test.ts`
- **Governing ADR:** [ADR 0012](../decisions/0012-verifiable-a2a-consensus-self-healing.md) (Pillar 2)
- **Acceptance criteria:**
  - Implements deterministic `mulberry32` seeded PRNG to generate randomized adversarial action traces.
  - Tests candidate synthesized policies/invariants against baseline policies, detecting contradictions, shadow-allow regressions, and boundary escapes.
  - Returns `passed`, detailed `findings`, `automatedPromotionAllowed: false`, `automatedSelfMerge: false`, and deterministic `fuzzReportSha256`.

---

## M17.03 — Ephemeral Zero-Network Sandbox Runner Contract

- **Module path:** `packages/ai-runtime/src/sandbox-runner.ts`
- **Unit tests:** `packages/ai-runtime/tests/sandbox-runner.test.ts`
- **Governing ADR:** [ADR 0012](../decisions/0012-verifiable-a2a-consensus-self-healing.md) (Pillar 3)
- **Acceptance criteria:**
  - Builds Docker/MicroVM ephemeral sandbox runner manifests strictly enforcing `networkDisabled: true`, `readOnlyRootFs: true`, `secretsInjected: false`, CPU/memory/timeout ceilings, and `--cap-drop=ALL`.
  - Verifies sandbox stdout/stderr/diff outputs and produces ablation-gate-compatible verification summaries.
  - Returns `automatedPromotionAllowed: false`, `automatedSelfMerge: false`, and deterministic SHA-256 digests.

---

## M17.04 — Autonomous Incident Self-Healer

- **Module path:** `packages/ai-runtime/src/incident-healer.ts`
- **Unit tests:** `packages/ai-runtime/tests/incident-healer.test.ts`
- **Governing ADR:** [ADR 0012](../decisions/0012-verifiable-a2a-consensus-self-healing.md) (Pillar 4)
- **Acceptance criteria:**
  - Ingests structured log entries redacted via `createRedactor()`, clusters recurring fault signatures, and scores diagnostic hypotheses using `active-inference.ts` EFE and `causal-replay.ts` counterfactual divergence evidence.
  - Emits a human-reviewable RCA and patch/runbook proposal with `automatedSelfMerge: false`, `automatedPromotionAllowed: false`, and deterministic `proposalSha256`.

---

## Verification

- `node --test scripts/check-m17-invariants.test.mjs`
- `node scripts/check-m17-invariants.mjs --json`
- `pnpm --filter @moonwitness/ai-runtime build ; if ($?) { pnpm --filter @moonwitness/ai-runtime test }`
