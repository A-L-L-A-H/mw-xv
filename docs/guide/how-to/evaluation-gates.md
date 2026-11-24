# How to run deployment and evaluation gates

This runbook covers the offline evaluation gates and the deployment gates for the cloud coding-agent stack. It is deliberately explicit about what each gate does **not** prove: none of these commands runs a real model, publishes a release, or changes production state.

Run every command from the repository root with Node 24.x. The verified interpreter in this environment is `/opt/moonwitness/observability/bin/node`; set `PATH` accordingly if the default shell still points at Node 22.

## 1. Offline evaluation gates

The deterministic corpus lives in `@moonwitness/ai-evaluation`. It uses checked-in fixtures (`mode: 'mock'`), touches no provider, network, or database, and is the only evaluation path that may be used as a fast, repeatable CI gate.

```bash
pnpm --filter @moonwitness/ai-evaluation test
pnpm --filter @moonwitness/ai-evaluation exec tsc -p tsconfig.check.json
pnpm --filter @moonwitness/ai-evaluation check:gates
```

- `test` also runs the TypeScript check and the Vitest suites. A green baseline at the time of writing is 7 files / 25 tests.
- `check:gates` rebuilds the package and runs `scripts/check-evaluation-gates.mjs`, printing one JSON report and exiting non-zero if any check fails.

The JSON report carries these honesty markers:

| Field                                                                | Meaning                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode: "offline-mock"`                                               | Fixture-driven execution only.                                                                                                                                                                        |
| `realModelUsed: false`                                               | No model was called; latency, cost and success are synthetic.                                                                                                                                         |
| `syntheticFixture: true`                                             | Numbers describe the fixture harness, not a real deployment.                                                                                                                                          |
| `ok`                                                                 | All checks passed. A failure means the gate evaluator is broken, not that the product regressed.                                                                                                      |
| `checks[].id`                                                        | `corpus-provenance`, `fixture-coverage`, `report-digest-shape`, `deterministic-metrics`, `gate-coverage`, `non-agi-claim`, `gate-verdict-consistency`, `deterministic-verdicts`, `ablation-coverage`. |
| `corpus.reportSha256`, `gates.reportSha256`, `ablation.reportSha256` | SHA-256 of the report body, which embeds a generation timestamp. Compare their **shape**, not their value, across runs. Compare metrics and verdicts for determinism.                                 |

`validateEvaluationReport` is the fail-closed provenance check. It rejects a report with no `sourceSha`, no `fixtureHash`, an empty run set, or `droppedFailedRuns: true`. Keep failed fixtures in the corpus; a baseline that silently drops them is not a baseline.

A `G0`–`G6` PASS from this gate means "the deterministic evaluator produced the expected verdicts from synthetic data". It is **not** evidence of production readiness, exact-answer correctness, or safety on real repositories.

## 2. Board Evaluation Lab

The Research & Evaluation Lab at `/board/ai/eval-lab` is a read-only view. It never imports `@moonwitness/ai-evaluation` (that package reaches Node-only code through `@moonwitness/ai-runtime`) and never runs a model in the browser.

- Gate verdicts and safety-regression counts come only from `/api/ai/eval-summary`.
- Ablation pass/harm rates come only from the summary's validated `ablationConditions` values.
- Missing, malformed, or out-of-range values render as `—`. There are no client-side defaults of `passed: true`, zero regressions, or invented pass rates.
- The summary DTO has no report SHA-256, model provenance, or capture timestamp. The page therefore labels the numbers as an API summary and links to this runbook; treat them as display data, not release evidence.

**Known limitation:** the current `/api/ai/eval-summary` implementation returns a static summary. Until a server-side endpoint runs the real corpus and persists its provenance (see [the task #30 evidence note](../../roadmap/evidence/TASK-30.md)), the Board cannot distinguish that static summary from a live run. Do not cite the Board page as proof that a gate was executed.

## 3. Deployment gates

### Environment placeholders

`.env.production.example` documents non-secret placeholders only. Never commit filled values. The cloud coding-agent stack requires:

| Variable                   | Consumer                       | Purpose                                                                        |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| `MW_AI_FREELLM_KEY`        | `api`, `jobs-worker`           | Unified inference key injected from the FreeLLMAPI encrypted volume.           |
| `ENCRYPTION_KEY`           | `freellmapi`                   | Existing gateway encryption key; never regenerate during migration.            |
| `AGENT_SANDBOX_TOKEN`      | `jobs-worker`, `agent-sandbox` | Private RPC authentication.                                                    |
| `FREELLMAPI_DEFAULT_MODEL` | `api`, `jobs-worker`           | Operator-selected model discovered from the gateway.                           |
| `AI_FREELLMAPI_ORIGIN`     | `api`, `jobs-worker`           | Origin only, default `http://freellmapi:3001`; no `/v1`, credentials or query. |

The Board service receives none of these. `api`, `jobs-worker`, and `freellmapi` are the only consumers.

### Render the Compose files without secrets

Compose files live under `deploy/compose/`. With no `--project-directory` override, `docker compose` resolves relative paths from the directory of the first `-f` file (`deploy/compose/`). The build contexts in these files are therefore written as `../..`, `../../vendor/freellmapi`, and `../../apps/agent-sandbox`, which resolve to the repository root. Run every command from the repository root and **do not** pass `--project-directory .`: that moves the project directory to the repository root and makes `../..` resolve one level above it.

```bash
# Use throwaway values only; this renders config, it does not start anything.
env \
  DATABASE_URL='postgresql://db:5432/mw' \
  JWT_SECRET='placeholder' \
  WHATSAPP_GATEWAY_URL='http://example.invalid' \
  ATTACHMENT_S3_ACCESS_KEY='placeholder' \
  ATTACHMENT_S3_SECRET_KEY='placeholder' \
  WHATSAPP_GATEWAY_USERNAME='placeholder' \
  WHATSAPP_GATEWAY_PASSWORD='placeholder' \
  MW_AI_FREELLM_KEY='placeholder' \
  ENCRYPTION_KEY='placeholder' \
  AGENT_SANDBOX_TOKEN='placeholder' \
  docker compose \
    -f deploy/compose/docker-compose.production.yml config
```

Assertions for the production file:

- Build contexts resolve to the repository root, `<repo>/vendor/freellmapi`, and `<repo>/apps/agent-sandbox` — never under `deploy/compose/`.
- Only `api` and `board` publish host ports; `freellmapi` and `agent-sandbox` publish none.
- `freellmapi_data` is a named volume at `/app/server/data`, with a healthcheck on `/api/ping`.
- `jobs-worker` depends on healthy `freellmapi` and `agent-sandbox`; Board startup does not depend on the gateway.
- `agent-sandbox` has no Docker socket by default. The optional socket override requires a dedicated rootless daemon socket, never `/var/run/docker.sock`.

`deploy/compose/docker-compose.freellmapi-test.yml` is an **override** that binds only `127.0.0.1:${FREELMAPI_TEST_PORT:-3001}:3001`. It is not a standalone entrypoint: `docker compose -f deploy/compose/docker-compose.freellmapi-test.yml config` fails with "neither an image nor a build context specified". Always layer it over the production file, and never use it as the production command:

```bash
# Prefix this with the same `env VAR='placeholder' ...` assignments shown above.
docker compose \
  -f deploy/compose/docker-compose.production.yml \
  -f deploy/compose/docker-compose.freellmapi-test.yml config
```

### Cloud coding-agent invariants

```bash
/opt/moonwitness/observability/bin/node scripts/check-cloud-agent-invariants.mjs
```

This is a read-only static gate (9 checks at the time of writing) covering vendored provenance, Compose exposure, Board import boundaries, raw-credential leaks, and R3 approval dispatch. A green result is a necessary precondition, not a substitute for the evaluation gates.

## 4. Interpretation checklist

| Question                              | Authoritative evidence                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Did the gate evaluator run correctly? | `pnpm --filter @moonwitness/ai-evaluation check:gates` exits 0 with `ok: true`.                                                   |
| Did a real model succeed on a task?   | A live provider-backed eval run with recorded provenance; **not** the offline gate or Board defaults.                             |
| Is production Compose safe to render? | `docker compose -f deploy/compose/docker-compose.production.yml config` with placeholder env, plus the invariant gate.            |
| Are the Board numbers real results?   | Only if the summary endpoint supplies provenance and the offline/live run is recorded in an evidence note. Currently: unverified. |

Escalate to the coordinator when the summary endpoint is static, when Compose contexts resolve under `deploy/compose/`, or when a gate is skipped. Record the exact command and output in `docs/roadmap/evidence/` rather than asserting a PASS from memory.
