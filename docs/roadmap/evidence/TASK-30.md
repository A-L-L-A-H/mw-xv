# Evidence TASK-30 — Verify deployment and evaluation gates

## Status

- Status: partial — owned-path work complete; two coordinator blockers remain before the task can be closed.
- Tanggal: 2026-11-24
- Pelaksana: cloud evaluation-gates worker (Qoder session 543e15f1, task #30)
- Source SHA dan branch: `dev` `af1ed6dd87d10865753d7f6fd516dea2039927c1` (tree concurrently dirty; only owned paths edited by this worker)
- Commit hasil task dan remote SHA setelah push: none — this worker did not commit, push, stash, reset, clean, or install.
- GitHub issue / PR / CI status: no hosted CI run was triggered for this evidence.
- Prasyarat yang diverifikasi: Node `v24.22.3` at `/opt/moonwitness/observability/bin/node`, pnpm `11.17.0`, Docker CLI available.
- Subtask/checkpoint: (1) offline evaluation gate package, (2) honest Board Eval Lab view, (3) operator runbook, (4) deployment config verification.

## Kontrak dan hasil

- Perilaku sebelum: Board Eval Lab rendered `passed: true` for all G0–G6 gates, hardcoded `0` safety regressions and four hardcoded ablation pass rates (0.75/0.85/0.88/0.94) even when no API data existed. The evaluation package had tests but no runnable gate CLI. No operator runbook for gates existed.
- Perilaku sesudah / deliverable:
  - `packages/ai-evaluation/src/deployment-gates.ts` adds `runOfflineEvaluationGates()`, a deterministic `mode: 'mock'` gate that validates provenance, fixture coverage, digest shape, metric/verdict reproducibility, G0–G6 coverage, non-AGI claim, verdict consistency and four ablation arms. It reports `realModelUsed: false` and `syntheticFixture: true`.
  - `packages/ai-evaluation/scripts/check-evaluation-gates.mjs` plus the `check:gates` package script print a JSON verdict and exit non-zero when a check fails. Dist is gitignored, so the script builds first.
  - `packages/ai-evaluation/tests/deployment-gates.test.ts` pins determinism, fail-closed provenance validation and metric-driven (not hardcoded) gate evaluation.
  - `apps/board/src/app/board/ai/eval-lab/eval-results.ts` + `page.tsx` render only live DTO values; missing/malformed fields become `—`, `NO DATA`, or an unpassed count. Static gate/arm definitions are clearly separated from results, and a provenance notice states that the page does not run a model and that the API summary carries no report SHA-256.
  - `docs/guide/how-to/evaluation-gates.md` (linked in `docs/guide/navigation.json`) is the operator runbook; this file is the evidence note.
- File yang diubah: `packages/ai-evaluation/{package.json,src/index.ts,src/deployment-gates.ts,scripts/check-evaluation-gates.mjs,tests/deployment-gates.test.ts}`, `apps/board/src/app/board/ai/eval-lab/{eval-results.ts,page.tsx}`, `docs/guide/how-to/evaluation-gates.md`, `docs/guide/navigation.json`, `docs/roadmap/evidence/TASK-30.md`. Generated `dist/` was rebuilt locally but is gitignored.
- Public API/schema/config yang terdampak: new exported `runOfflineEvaluationGates` and its report/check types from `@moonwitness/ai-evaluation`; new npm script `check:gates`; no change to `AiEvalSummaryDto` or any HTTP contract.
- Keputusan dan alasan: the Board must never import `@moonwitness/ai-evaluation` (it reaches Node-only code through `@moonwitness/ai-runtime`), so the client uses a local, documented view of the same G0–G6 / four-arm contract. Raw report digests embed generation timestamps; determinism is asserted on metrics and verdicts, not on digest equality.

## Verifikasi aktual

| Command / scenario | Exit code / hasil | Bukti | Catatan |
| --- | --- | --- | --- |
| `pnpm --filter @moonwitness/ai-evaluation exec tsc -p tsconfig.check.json` | 0 | no diagnostics | Node 24 PATH |
| `pnpm --filter @moonwitness/ai-evaluation test` | 0 | 7 files / 25 tests passed | was 6 files / 22 before this task |
| `pnpm --filter @moonwitness/ai-evaluation check:gates` | 0 | `ok: true`, `checksPassed: 10/10`, `realModelUsed: false`, `syntheticFixture: true`, `highestSatisfiedGate: G6` | rebuilds dist; Node 24 PATH required |
| `pnpm --filter @moonwitness/board typecheck` | 0 | no diagnostics | after Board edits |
| `pnpm --filter @moonwitness/board exec oxlint src/app/board/ai/eval-lab` | 0 | no diagnostics | targeted lint only |
| `node scripts/check-cloud-agent-invariants.mjs` | 0 | "Cloud coding-agent invariants passed (9 checks)." | read-only static gate |
| `docker compose --project-directory . -f deploy/compose/docker-compose.production.yml config` (placeholder env) | 0 | contexts resolve to repo root, `./vendor/freellmapi`, `./apps/agent-sandbox`; only `api` (3000) and `board` (4174) publish ports | no real secrets used |
| same base + `-f deploy/compose/docker-compose.freellmapi-test.yml` | 0 | gateway bound to `127.0.0.1:${FREELMAPI_TEST_PORT:-3001}:3001` only | localhost-only override, not production |
| `docker compose -f deploy/compose/docker-compose.freellmapi-test.yml config` | 1 | "service freellmapi has neither an image nor a build context specified" | expected: override-only file, must be layered over a base file |
| `node scripts/check-docs.mjs` | 0 | no missing targets | pre-existing failures from concurrent doc centralization were resolved by another worker before this check |
| `git diff --check` on owned paths | 0 | no whitespace errors | includes new untracked sources by inspection; `git diff --check` only covers tracked changes |

- Positive cases: offline corpus validation accepts the real mock report; `G0`–`G6` verdicts and ablation arms are reproducible across two runs; Board renders `—`/`NO DATA` with `evalQuery.data` absent; Board renders API values unchanged when present.
- Negative cases: empty `sourceSha`, empty `fixtureHash`, `droppedFailedRuns: true`, and empty `runs` are rejected by `validateEvaluationReport`; malformed/out-of-range DTO fields map to `null` in the Board view; a failing gate check makes the CLI exit 1 (verified during development when fixture-coverage expected 12 runs instead of the actual 9 — single_agent for all six fixtures plus multi_agent for the three decomposable ones).
- Test skipped dan alasan: no live model call, no FreeLLMAPI smoke, no PostgreSQL integration and no Board E2E — this worker has no secrets and must not start services; those gates remain operator/CI work.
- CI run URL / screenshot / report: none; all evidence above is local command output.
- Secret/data safety review: only placeholder values were passed to `docker compose config`; `.env.production.example` still contains empty placeholders for `MW_AI_FREELLM_KEY`, `ENCRYPTION_KEY`, `AGENT_SANDBOX_TOKEN`, `FREELLMAPI_DEFAULT_MODEL`, and `AI_FREELLMAPI_ORIGIN=http://freellmapi:3001`. No credential was written to an owned file.

## Prasyarat penutupan

- [x] Deliverable kartu tersedia.
- [x] Acceptance spesifik kartu diverifikasi within owned paths.
- [x] Tidak ada required test yang disembunyikan/skipped tanpa penanganan.
- [x] Documentation/public contract diperbarui bila berubah.
- [x] Diff tidak menambahkan credential; generated reference files untouched.
- [ ] Aktivasi remote yang diwajibkan kartu sudah terbukti — not performed; no deployment was attempted.
- [ ] Master checklist diperbarui — coordinator-owned.
- [ ] Perubahan task telah di-commit dan di-push — explicitly out of scope for this worker.
- [ ] GitHub issue/lifecycle direkonsiliasi — coordinator-owned.

## Handoff / recovery

- Commit atau perubahan lokal yang harus dipertahankan: all owned-path changes listed above. Do not let a wider `git checkout`/`reset` discard them before they are reviewed and committed by the coordinator.
- Masalah tersisa dan owner:
  1. **Coordinator (owns `packages/orm-ai/**`, `apps/api/**`, and `apps/board/src/components/ai/ai-api.ts`):** `/api/ai/eval-summary` still returns static `passed: true` gates and fixed 0.75/0.85/0.88/0.94 ablation rates. Add a server-side, operator-authorized evaluation endpoint that calls `runEvaluationCorpus`, `evaluateCapabilityGates`, and `runMemoryAblationSuite` from `@moonwitness/ai-evaluation` with real provider provenance, persists `sourceSha`, `fixtureHash`, `reportSha256`, and `capturedAt`, and returns those fields in an extended `AiEvalSummaryDto`. Until then the Board cannot distinguish a static summary from a live result.
  2. **Coordinator (owns CI scripts/root command docs):** Compose files were relocated to `deploy/compose/` but still use repository-root-relative build contexts (`context: .`, `./vendor/freellmapi`, `./apps/agent-sandbox`). Plain `docker compose -f deploy/compose/docker-compose.production.yml config` resolves them under `deploy/compose/` and cannot build. Either rewrite the contexts as `../..`, `../../vendor/freellmapi`, `../../apps/agent-sandbox`, or standardize every operator/CI invocation on `--project-directory .` (the verified workaround). Update the plan's command list accordingly.
  3. **Coordinator (task verification command):** the task's suggested `docker compose -f docker-compose.freellmapi-test.yml config` cannot work because that file is an override and was relocated; use the layered command with `--project-directory .` recorded above, or give the override a base service definition.
- Langkah berikutnya: after (1), update the Board provenance notice to surface the new fields and re-run the verification table; after (2), re-run Compose config without the workaround; then perform an operator live smoke with real secrets before closing task #30.
- Cara melanjutkan jika operasi terhenti: re-run the five package/Board commands in the verification table with Node 24 on `PATH`; `pnpm --filter @moonwitness/ai-evaluation check:gates` rebuilds the gitignored dist itself.
- Batasan yang harus diketahui pengguna: every G0–G6 PASS from the offline gate is synthetic-fixture evidence only. It does not establish production readiness, exact-answer correctness, or safety on real repositories, and the Board currently displays an unverified static API summary.
