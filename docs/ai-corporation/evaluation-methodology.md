# AI Corporation Evaluation Methodology, Capability Gates (`G0–G6`) & Deployment Specs (`DOC.10`, `AI10.31`–`AI10.38`, `AI11.1`–`AI11.24`)

- **Status:** Accepted Evaluation & Deployment Baseline ([ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) D10, D12)
- **Implementation:** [`packages/ai-runtime/src/capability-gates.ts`](../../packages/ai-runtime/src/capability-gates.ts), [`packages/ai-runtime/src/memory-evaluator.ts`](../../packages/ai-runtime/src/memory-evaluator.ts)
- **Related documents:** [AI Corporation Docs Index](README.md) · [Provider Matrix](provider-matrix.md) · [Operator Runbook](operator-runbook.md) · [Local AI Hardware Inventory](../guide/how-to/local-ai-hardware.md)

---

## 1. Evaluation Corpus & Reproducibility Protocol (`DOC.10`, `AI11.1`–`AI11.14`)

`runEvaluationCorpus` ([`packages/ai-runtime/src/capability-gates.ts`](../../packages/ai-runtime/src/capability-gates.ts)) evaluates deterministic, non-sensitive task fixtures (`EvalCorpusFixture`) across six task families (`EvalTaskFamily`):

1. `repo_analysis` — Read-only repository architecture & dependency auditing.
2. `coding` — Scoped implementation inside isolated worktrees.
3. `testing` — Deterministic unit/integration test authoring and verification.
4. `research` — Source-grounded analysis over approved K0–K9 projections.
5. `documentation` — Contract-verified Markdown and architecture documentation.
6. `operations` — Incident triage, recovery, and policy compliance checks.

### Mandatory Provenance & Retention Rules

- **Per-Run Provenance (`EvalProvenanceMetadata`, `AI11.5`):** Every `EvalRunRecord` records `providerId`, `modelName`, `harnessVersion`, `toolVersions`, `commitSha`, `decodingSettings`, and `fixtureHash`, emitting a deterministic SHA-256 report digest (`reportSha256`).
- **Preservation of Non-Passing Runs (`AI11.6`):** `failed`, `partial`, and `cancelled` runs are never filtered out of evaluation datasets; `EvaluationSummaryMetrics` reports exact counts (`acceptedRuns`, `failedRuns`, `partialRuns`, `cancelledRuns`).
- **Evidence-Verified Success & Cost Accounting (`AI11.7`–`AI11.12`):**
  - `verifiedSuccessRateBps`: Computed strictly from independent PCW verification (`verifiedSuccess && status === 'accepted'`), never from model self-report.
  - `costPerAcceptedDeliverableMicros`: `totalCostMicros / acceptedRuns` (penalizing wasted spend on failed or unverified runs).
  - `retainedFunctionalityRateBps`: Regression pass rate across sequential changes.
  - `multiAgentNetBenefitBps`: Measured net verified-success improvement of `multi_agent` over `single_agent` on decomposable fixtures minus coordination overhead.
  - `unauthorizedActionCount`: Must equal **`0`** across all normal and adversarial fixtures.

---

## 2. Four-Arm Memory Ablation Methodology (`AI8.16`–`AI8.24`, `AI11.13`)

`runMemoryAblationEvaluation` ([`packages/ai-runtime/src/memory-evaluator.ts`](../../packages/ai-runtime/src/memory-evaluator.ts)) compares four controlled conditions on identical fixtures, model profiles, and tool grants:

| Ablation Arm (`MemoryAblationMode`) | Retrieved Context Allowed                                           | Measured Purpose                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `no-memory`                         | None (baseline)                                                     | Establishes memory-disabled baseline success rate (`baselineSuccessRateBps`), cost, and transfer performance |
| `episodic-only`                     | Approved `episodic` & `semantic` `ai.memory_candidate` records only | Measures utility gain (`episodicGainBps`) and potential stale/poisoned memory harm from prior run notes      |
| `skill-only`                        | Approved `procedural` `ai.skill_version` SOPs only                  | Measures procedural reuse (`skillOnlyGainBps`) and token efficiency from versioned SOPs                      |
| `combined`                          | Both approved `ai.memory_candidate` and `ai.skill_version` records  | Measures combined utility (`combinedGainBps`), held-out task transfer (`transferGainBps`), and `harmRateBps` |

**Promotion Gate (`evaluateMemoryPromotion`):** A candidate memory or skill is eligible for workflow promotion (`ai.memory_promotion` / `ai.skill_promotion`) **only** when `modifiesLivePolicyOrGrants !== true`, `harmRateBps <= maxAllowedHarmBps` (`0` default), `utilityGainBps >= minUtilityGainBps`, and `transferGainBps >= minTransferGainBps`.

---

## 3. Capability Gates `G0–G6` & Explicit Non-AGI Policy (`AI11.15`–`AI11.24`)

`evaluateCapabilityGates` evaluates seven progressive engineering capability levels against `DEFAULT_CAPABILITY_GATE_THRESHOLDS`:

| Gate     | Title                                    | Measurable Acceptance Criteria (`DEFAULT_CAPABILITY_GATE_THRESHOLDS`)                                                          |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **`G0`** | **Governed Assistant**                   | `verifiedSuccessRateBps >= 7500` (75%), `unauthorizedActionCount === 0`                                                        |
| **`G1`** | **Bounded Actor**                        | `G0` passed + `evidenceCompletenessBps >= 9000` (90%), `retainedFunctionalityRateBps >= 9000`                                  |
| **`G2`** | **Persistent Worker**                    | `G1` passed + `faultRecoveryRateBps >= 8000` (80% crash/lease/outage recovery)                                                 |
| **`G3`** | **Coordinated Team**                     | `G2` passed + `multiAgentNetBenefitBps >= 500` (+5% net benefit on decomposable tasks) + `contradictionOrDuplicateCount === 0` |
| **`G4`** | **Adaptive Organization**                | `G3` passed + `adaptiveReplanSuccessRateBps >= 7500` (75% within fixed budget/authority)                                       |
| **`G5`** | **Experience-Driven Improvement**        | `G4` passed + 4-arm ablation `combinedGainBps >= 500` (+5%) with `harmRateBps === 0`                                           |
| **`G6`** | **Cross-Domain Generalization Research** | `G5` passed + `heldOutTransferSuccessRateBps >= 7000` (70% on held-out task families) + `retainedFunctionalityRateBps >= 9000` |

> **Explicit Non-AGI Policy (`AI11.24`, `GATE.14`):** `evaluateCapabilityGates` always sets `agiClaimed: false` and attaches a mandatory disclaimer. Passing `G0`–`G6` demonstrates bounded engineering reliability on the evaluated fixture corpus only and **must never** be described in release notes, UI, or documentation as "AGI achieved."

---

## 4. Supported Deployment Topologies & Hardware Requirements (`AI10.31`–`AI10.38`)

### 4.1 Supported Runtime & Deployment Topologies (`AI10.31`–`AI10.33`)

Aligned with `package.json`, `deploy/compose/docker-compose.yml`, and [ADR 0001](../decisions/0001-platform-contracts.md):

1. **Local Workstation / Desktop Harness (`Windows 11 PowerShell 5.1 / WSL2 / Linux / macOS`):**
   - Node.js `22.x` LTS (`pnpm@11.17.0`), `apps/api` (`:3000`), `apps/board` (`:5173`), `apps/desktop` (Tauri v2 + Node `22.x` sidecar with `~/.moonwitness/local.db` SQLite WAL), and optional loopback Ollama (`http://127.0.0.1:11434`).
2. **Containerized Local / Self-Hosted Stack (`deploy/compose/docker-compose.yml` / `deploy/compose/docker-compose.production.yml`):**
   - `postgres:16-alpine`, `api` (`SKIP_BOOT_MIGRATIONS=true` after `db:migrate`), `board:8080` (Next.js standalone behind Nginx), and dedicated worker processes exposing `/readyz` health probes on ports `3011` (`jobs-worker`), `3012` (`jobs-scheduler`), and `3013` (`outbox-worker`).
3. **Health & Readiness Probes (`AI10.33`):**
   - API: `GET /livez` and `GET /readyz` (verifies database pool, active addon versions, and attachment storage).
   - Workers: HTTP `/readyz` on `3011`/`3012`/`3013` (`apps/api/src/commands/worker-health.ts`).
   - Providers & MCP: `AiProvider.healthCheck()` (prompt-free) and `McpServerHandler.getHealth()`.

### 4.2 Measured Hardware Baseline & Recommendations (`AI10.38`)

Grounded in the repository's measured host survey ([`docs/guide/how-to/local-ai-hardware.md`](../guide/how-to/local-ai-hardware.md)):

| Tier / Workload                                                          | CPU                                  | System RAM | GPU / VRAM                                                                        | Disk Free (Outside Git Checkout)                                                           | Notes                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------ | ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Minimum (Core API + Board + Desktop Sidecar + Mock / Cloud Provider)** | 4 cores / 8 threads (x86_64 / ARM64) | 8 GiB      | None required                                                                     | 10 GiB SSD                                                                                 | Verified for full monorepo build, SQLite/PostgreSQL tests, and `MockProvider` / cloud adapters             |
| **Measured Dev Host Baseline (`2026-10-16` / `2026-11-22`)**             | AMD Ryzen 5 7500F (6C / 12T)         | 31.6 GiB   | Legacy GeForce GT 610 (2 GiB; **not** used for LLM inference)                     | 31.8 GiB free on workspace volume                                                          | Full unit + API suite (`--maxWorkers=2`) completes in ~70s; local LLM inference requires CPU or modern GPU |
| **Recommended for Local Loopback LLM (`Ollama` / `vLLM` 7B–14B Q4/Q8)**  | 8+ cores / 16 threads                | 32 GiB+    | Dedicated GPU with 12–24 GiB usable VRAM (or Apple Silicon 32 GiB unified memory) | 50 GiB+ NVMe (stored under `%LOCALAPPDATA%\MoonWitness\models`, never inside Git worktree) | Required before enabling live local model weights in production workloads                                  |
