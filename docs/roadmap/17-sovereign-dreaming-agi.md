# M16 — Sovereign Dreaming AGI-OS (`M16.01`–`M16.04`)

Status: **in progress (ADR 0011 + deterministic invariant gate landed)** — this milestone extends MoonWitness's [M15 Constitutional AGI-OS](16-constitutional-agi-os.md) with sleep-time memory consolidation, Active Inference Expected Free Energy (EFE) control, RFC 6962 Merkle audit transparency, and an offline adversarial red-team self-play arena governed by [ADR 0011](../decisions/0011-sovereign-dreaming-merkle-agi.md).

## Constitutional Gate (Prerequisite for All M16 Modules)

Before any M16 feature code is promoted, `scripts/check-m16-invariants.mjs` enforces [ADR 0011](../decisions/0011-sovereign-dreaming-merkle-agi.md) across all four modules:

- Zero direct `node:fs` or `node:child_process` imports in `packages/ai-runtime/src/`
- Zero explicit `: any` annotations
- Mandatory `createRedactor()` secret redaction and SHA-256 (`createHash('sha256')`) digests
- Mandatory `automatedSelfAccept: false` / `automatedPromotionAllowed: false` guardrails
- Strict RFC 6962 `0x00` (leaf) and `0x01` (internal node) domain separation in `packages/ai-runtime/src/merkle-ledger.ts`
- Reversible-only memory soft-decay (never destructive hard deletion of source provenance)

---

## M16.01 — Sleep-Time Compute & Reversible Dreaming Memory Consolidation

- **Module path:** `packages/ai-runtime/src/sleep-dream.ts`
- **Unit tests:** `packages/ai-runtime/tests/sleep-dream.test.ts`
- **Desktop API wiring:** `POST /api/desktop/ai/sleep-dream` (available in both DX and workspace modes)
- **Governing ADR:** [ADR 0011](../decisions/0011-sovereign-dreaming-merkle-agi.md) (Pillar 1 — Sleep-Time Compute / SleepGate / SCM / MemDream / REALM; arXiv:2504.13171, arXiv:2604.20943, arXiv:2609.16053)
- **Acceptance criteria:**
  - Exports `runNonRemConsolidation`, `runRemDreamSelfProbe`, and `reconsolidateMemoryFeedback`.
  - Detects stale/conflicting proactive interference within company scope and applies reversible soft-decay (`status: 'decayed'`) while preserving original provenance and hash.
  - Compresses surviving episodic items into semantic summary candidates with `automatedPromotionAllowed: false`, `createRedactor()`, and deterministic `reportSha256` / `probeSha256`.

---

## M16.02 — Active Inference Expected Free Energy (EFE) & Epistemic Action

- **Module path:** `packages/ai-runtime/src/active-inference.ts`
- **Unit tests:** `packages/ai-runtime/tests/active-inference.test.ts`
- **Desktop API wiring:** `POST /api/desktop/ai/active-inference` (available in both DX and workspace modes)
- **Governing ADR:** [ADR 0011](../decisions/0011-sovereign-dreaming-merkle-agi.md) (Pillar 2 — Active Inference Expected Free Energy & Epistemic Action, Jun/Sep 2026)
- **Acceptance criteria:**
  - Exports `evaluateExpectedFreeEnergy(candidates, policy)`.
  - Computes `pragmaticValueBps`, `epistemicInfoGainBps`, `computeCostBps`, and `expectedFreeEnergyBps` deterministically.
  - Selects `epistemic_action`, `optimal_question`, or `pragmatic_action` with `automatedSelfAccept: false`, `createRedactor()`, and deterministic `decisionSha256`.

---

## M16.03 — RFC 6962 Merkle Audit Transparency Ledger

- **Module path:** `packages/ai-runtime/src/merkle-ledger.ts`
- **Unit tests:** `packages/ai-runtime/tests/merkle-ledger.test.ts`
- **Desktop API wiring:** `GET /api/desktop/audit/merkle-root` (available in both DX and workspace modes)
- **Governing ADR:** [ADR 0011](../decisions/0011-sovereign-dreaming-merkle-agi.md) (Pillar 3 — RFC 6962 Merkle Transparency / PunkGo, arXiv:2602.20214)
- **Acceptance criteria:**
  - Enforces RFC 6962 domain separation: `hashMerkleLeaf` prefixes `0x00` and `hashMerkleNode` prefixes `0x01`.
  - Exports `buildMerkleAuditTree`, `generateMerkleInclusionProof`, `verifyMerkleInclusionProof`, and `verifyMerkleConsistency` proving append-only integrity in $O(\log N)$ hashes.
  - Redacts sensitive fields via `createRedactor()` and detects payload tampering fail-closed.

---

## M16.04 — Offline Adversarial Red-Team Self-Play Arena

- **Module path:** `packages/ai-runtime/src/redteam-arena.ts`
- **Unit tests:** `packages/ai-runtime/tests/redteam-arena.test.ts`
- **Desktop API wiring:** `POST /api/desktop/ai/redteam-arena` (DX mode only; `403 WORKSPACE_MODE_RESTRICTED` in workspace mode)
- **Governing ADR:** [ADR 0011](../decisions/0011-sovereign-dreaming-merkle-agi.md) (Pillar 4 — MoonWitness Original)
- **Acceptance criteria:**
  - Exports `DEFAULT_REDTEAM_SCENARIOS` (`prompt_injection`, `path_traversal`, `overconfident_plan`, `a2a_spoofing`, `paas_quota_bypass`, `self_accept_forgery`) and `runAdversarialRedTeamArena`.
  - Computes `defensePassRateBps`, records every bypassed attack, and invokes `synthesizeInvariantRuleProposal` (`./invariant-synthesizer.js`) for every breach.
  - Enforces `automatedPromotionAllowed: false`, `automatedSelfAccept: false`, `createRedactor()`, and deterministic `arenaSha256`.

---

## Verification

- `node --test scripts/check-m16-invariants.test.mjs`
- `node scripts/check-m16-invariants.mjs --json`
- `pnpm --filter @moonwitness/ai-runtime build && pnpm --filter @moonwitness/ai-runtime test`
- `node scripts/check-docs.mjs` and `pnpm automation:check:roadmap`
