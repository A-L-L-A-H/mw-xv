# ADR 0011: Sovereign Dreaming Memory Consolidation, Active Inference & RFC 6962 Merkle Transparency

- **Status:** Accepted (2026-11-23; autonomous approval under repository unconditional-autonomy governance)
- **Date:** 2026-11-23
- **Decision owners:** MoonWitness maintainers
- **Scope:** `@moonwitness/ai-runtime`, `apps/desktop`, `apps/board`, `scripts/`
- **Related tasks:** `M16.01`–`M16.04`
- **Related decisions and policies:** [ADR 0001](0001-platform-contracts.md), [ADR 0005](0005-mizan-evaluation-policy-boundary.md), [ADR 0006](0006-mandatory-addon-thin-api.md), [ADR 0007](0007-ai-corporation-addon-first-architecture.md), [ADR 0009](0009-a2a-mesh-federation.md), [ADR 0010](0010-constitutional-rsi-world-model.md)

## Context

MoonWitness's M15 Constitutional AGI-OS ([M15 Roadmap](../roadmap/16-constitutional-agi-os.md), [ADR 0010](0010-constitutional-rsi-world-model.md)) established speculative tournament search, collective skill trees, forward-inverse world-model surprise gates, constitutional invariant synthesis, private-mesh semantic resonance, counterfactual causal replay, and epistemic Brier/ECE calibration. Advancing to a long-horizon, cryptographically verifiable, sovereign AGI engineering plane requires solving four remaining structural challenges:

1. **Proactive memory interference & unverified knowledge decay:** Continuously accumulated episodic memories degrade retrieval precision over time; naive hard-deletion destroys audit provenance, whereas unpruned stores suffer proactive interference and stale cross-domain assumptions.
2. **Suboptimal explore-vs-exploit action selection:** Agents either execute prematurely under high epistemic uncertainty or waste compute over-probing when pragmatic action is already justified, without a principled Expected Free Energy (EFE) trade-off.
3. **Tamper-evident auditability across local and federated runs:** Linear hash chains require $O(N)$ verification and lack compact inclusion and append-only consistency proofs needed for independent third-party or cross-node audit verification.
4. **Reactive-only security hardening:** Waiting for production incidents to discover prompt injection, path traversal, A2A spoofing, quota bypass, or self-accept forgery leaves constitutional defenses untested against systematic adversarial pressure.

## Decision

MoonWitness adopts a **Sovereign Dreaming, Active Inference & RFC 6962 Merkle Transparency Architecture** (`M16.01`–`M16.04`) implemented as pure, deterministic TypeScript primitives inside `@moonwitness/ai-runtime`, governed by falsifiable constitutional invariants enforced by `scripts/check-m16-invariants.mjs`.

### The 4 M16 Pillars

1. **M16.01 — Sleep-Time Compute & Reversible Dreaming Memory Consolidation (`sleep-dream.ts`)** *(informed by Sleep-Time Compute / SleepGate / SCM / MemDream / REALM — arXiv:2504.13171, arXiv:2604.20943, arXiv:2609.16053)*
   - **Non-REM consolidation (`runNonRemConsolidation`):** Detects stale or conflicting proactive interference within company scope, applies **reversible-only soft-decay** (`status: 'decayed'`, preserving original provenance and content hash — never destructive hard deletion), and compresses surviving episodic items into compact semantic summary candidates (`automatedPromotionAllowed: false`, `reportSha256`).
   - **REM dream self-probe (`runRemDreamSelfProbe`):** Synthesizes deterministic self-probe queries over knowledge and skill nodes to expose unverified assumptions and weak cross-domain links (`probeSha256`).
   - **Reconsolidation feedback (`reconsolidateMemoryFeedback`):** Updates memory importance and retrieval confidence weights deterministically from observed hit/miss feedback.

2. **M16.02 — Active Inference Expected Free Energy & Epistemic Action (`active-inference.ts`)** *(informed by Active Inference Context Acquisition & Epistemic Action — Jun/Sep 2026)*
   - Evaluates candidate next actions via `evaluateExpectedFreeEnergy(candidates, policy)`, computing `pragmaticValueBps`, `epistemicInfoGainBps`, `computeCostBps`, and `expectedFreeEnergyBps`.
   - Deterministically selects `epistemic_action` (gather more context/probe), `optimal_question` (ask one surgical clarifying question), or `pragmatic_action` (execute now).
   - Enforces `automatedSelfAccept: false`, redaction via `createRedactor()`, and deterministic `decisionSha256`.

3. **M16.03 — RFC 6962 Merkle Audit Transparency Ledger (`merkle-ledger.ts`)** *(informed by RFC 6962 Certificate Transparency / PunkGo — arXiv:2602.20214)*
   - Implements strict RFC 6962 cryptographic domain separation to prevent second-preimage attacks:
     - Leaf hash (`hashMerkleLeaf`): `SHA-256(0x00 || canonicalJson)`
     - Internal node hash (`hashMerkleNode`): `SHA-256(0x01 || leftHash || rightHash)`
   - Exports `buildMerkleAuditTree(events)` (redacting sensitive fields via `createRedactor()`), `generateMerkleInclusionProof(tree, leafIndex)`, `verifyMerkleInclusionProof(leafPayload, proof, expectedRootHash)`, and `verifyMerkleConsistency(olderEvents, newerEvents)` proving append-only integrity in $O(\log N)$ hashes.

4. **M16.04 — Offline Adversarial Red-Team Self-Play Arena (`redteam-arena.ts`)** *(MoonWitness Original)*
   - Executes pure in-memory Red-Team vs Blue-Team self-play across `DEFAULT_REDTEAM_SCENARIOS` (`prompt_injection`, `path_traversal`, `overconfident_plan`, `a2a_spoofing`, `paas_quota_bypass`, `self_accept_forgery`).
   - Computes `defensePassRateBps`, records every bypassed attack, and invokes `synthesizeInvariantRuleProposal` (`./invariant-synthesizer.js`) for every breach so candidate regression rules are generated automatically (`automatedPromotionAllowed: false`, `automatedSelfAccept: false`, `arenaSha256`).

## Falsifiable Constitutional Invariants

Every M16 module MUST satisfy all of the following machine-verified invariants (enforced by `scripts/check-m16-invariants.mjs`):

1. **Zero direct I/O or shell execution in `@moonwitness/ai-runtime`:** No M16 module in `packages/ai-runtime/src/` may import `node:fs`, `node:fs/promises`, `fs`, `node:child_process`, or `child_process`.
2. **Strict TypeScript type hygiene:** Zero explicit `: any` annotations in M16 modules.
3. **RFC 6962 cryptographic domain separation:** `packages/ai-runtime/src/merkle-ledger.ts` MUST enforce distinct `0x00` leaf and `0x01` internal-node domain-separation prefixes.
4. **Reversible-only memory soft-decay:** Memory consolidation MUST preserve original source provenance and cryptographic hashes via reversible soft-decay (`status: 'decayed'`); destructive hard deletion of source provenance is forbidden.
5. **No autonomous self-acceptance or self-promotion:**
   - Execution/planning outputs MUST enforce `automatedSelfAccept: false` (never `automatedSelfAccept: true`).
   - Consolidation/synthesis outputs MUST enforce `automatedPromotionAllowed: false` (never `automatedPromotionAllowed: true`).
6. **Mandatory secret redaction & cryptographic digests:** Every M16 module MUST sanitize emitted payloads via `createRedactor()` and compute deterministic SHA-256 digests (`createHash('sha256')`).

## Consequences

- **Positive:** Enables continuous offline memory hygiene, mathematically grounded explore-vs-exploit control, $O(\log N)$ tamper-evident Merkle audit proofs, and proactive adversarial regression hardening without weakening MoonWitness's constitutional guarantees.
- **Costs / trade-offs:** Adds deterministic hashing, soft-decay metadata retention, and offline red-team evaluation overhead; promoted memories and synthesized regression rules continue to require explicit workflow/human approval.
- **Enforcement:** Verified continuously via `node scripts/check-m16-invariants.mjs --json` and its paired fixture test suite `scripts/check-m16-invariants.test.mjs`.
