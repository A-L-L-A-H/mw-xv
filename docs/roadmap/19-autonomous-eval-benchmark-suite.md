# M18 — Autonomous AGI-OS Evaluation Benchmark Suite & Deterministic World-Model Simulator (`M18.01`–`M18.03`)

Status: **in progress (ADR 0013 + deterministic invariant gate + evaluation suite + CLI runner)** — this milestone delivers an end-to-end quantitative 8-axis evaluation harness and deterministic multi-agent world-model simulator exercising all M14–M17 `@moonwitness/ai-runtime` modules, governed by [ADR 0013](../decisions/0013-autonomous-eval-harness-world-sim.md).

## Constitutional Gate (Prerequisite for All M18 Modules)

Before any M18 evaluation code is promoted, `scripts/check-m18-invariants.mjs` enforces [ADR 0013](../decisions/0013-autonomous-eval-harness-world-sim.md) across all three modules:

- Zero direct `node:fs`, `node:child_process`, `eval(`, or `new Function` usage in `packages/ai-evaluation/src/`
- Zero explicit `: any` annotations
- Zero bare `Math.random()` calls; deterministic seeded execution (`seed` required)
- Constitutional hard-fail enforcement (`constitutionalPass: false` forces overall `passed: false`)

---

## M18.01 — Deterministic Multi-Agent World-Model Simulator

- **Module path:** `packages/ai-evaluation/src/world-sim.ts`
- **Unit tests:** `packages/ai-evaluation/tests/world-sim.test.ts`
- **Governing ADR:** [ADR 0013](../decisions/0013-autonomous-eval-harness-world-sim.md) (Pillar 1)
- **Acceptance criteria:**
  - Uses deterministic `mulberry32` PRNG keyed by explicit `seed` (zero `Math.random()`).
  - Synthesizes multi-agent repo, A2A mesh, incident log, and obligation drift scenarios with controllable fault injection, latency spikes, and state-drift perturbations.
  - Emits deterministic SHA-256 `scenarioSha256` identical across repeated runs with the same seed.

---

## M18.02 — Standardized Adversarial Red-Team & Boundary-Escape Suite

- **Module path:** `packages/ai-evaluation/src/adversarial-suite.ts`
- **Unit tests:** `packages/ai-evaluation/tests/adversarial-suite.test.ts`
- **Governing ADR:** [ADR 0013](../decisions/0013-autonomous-eval-harness-world-sim.md) (Pillar 2)
- **Acceptance criteria:**
  - Tests prompt-injection, forged `accepted` self-accept claims, replay nonce attacks, secret leakage, uncalibrated peer collusion, and policy boundary escapes against real `@moonwitness/ai-runtime` M14–M17 modules.
  - Returns per-vector outcomes, `blockRateBps`, `constitutionalPass`, `passed` (forced `false` whenever `constitutionalPass` is `false`), and deterministic `suiteSha256`.

---

## M18.03 — End-to-End 8-Axis Quantitative AGI-OS Scorecard & CLI Runner

- **Module path:** `packages/ai-evaluation/src/agi-benchmark.ts`
- **Unit tests:** `packages/ai-evaluation/tests/agi-benchmark.test.ts`
- **CLI runner:** `scripts/run-agi-benchmark.mjs`
- **Governing ADR:** [ADR 0013](../decisions/0013-autonomous-eval-harness-world-sim.md) (Pillar 3)
- **Acceptance criteria:**
  - Exercises real M14–M17 runtime primitives across 8 quantitative axes (`0..100` each) and computes a composite score.
  - Anchors all axis records in an RFC 6962 Merkle audit tree (`merkleRootHash`) with verified inclusion proof.
  - Enforces strict constitutional hard-fail (`constitutionalPass: false` forces `passed: false`).
  - CLI runner supports `--seed <n>` and `--json`, exiting `0` iff `passed && constitutionalPass`.

---

## Verification

- `node --test scripts/check-m18-invariants.test.mjs ; if ($?) { node scripts/check-m18-invariants.mjs --json }`
- `pnpm --filter @moonwitness/ai-evaluation build ; if ($?) { pnpm --filter @moonwitness/ai-evaluation test }`
- `node scripts/run-agi-benchmark.mjs --json`
