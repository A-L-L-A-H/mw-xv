# Evidence DURABLE-AGENT-OPERATIONS

## Status and provenance

- Status: **local candidate verified; release acceptance incomplete**.
- Date: 2026-11-25 (UTC).
- Branch and baseline HEAD: `dev` at `6d936d14620fd791ffdd759dd87e9a424d5c493f`.
- The baseline HEAD is provenance only. It does **not** identify the modified working tree tested below.
- Implementation working-tree SHA-256: `66d383de31d161749f85dc7752314456f37736220c4a295f856e0181563377d8` across 46 files. This is a deterministic content digest over changed/untracked implementation, test, and configuration files, excluding documentation, generated documentation, test reports, and local swarm state. It is not a Git commit SHA.
- Result commit / remote SHA: pending the authorized commit and push; immutable SHA evidence is recorded after the implementation commit is created.
- Runtime used: Bun `1.4.5`, Node `v22.22.1`, Linux x64. The repository declares Node `24.x`; Node 24 parity remains open.
- PostgreSQL used for integration evidence: disposable local PostgreSQL container, isolated schemas/databases, synthetic role and fixtures only.
- ADR 0016 and ADR 0017 are Accepted as architecture decisions. Acceptance is not production or release acceptance.

## Delivered scope

- One addon-owned interactive-session authority in `packages/orm-ai`, with durable sequenced events, idempotent commands, snapshots, reconnect/gap handling, approvals, cancellation, completion evidence, and owner/company isolation.
- `AgentRun` and `packages/jobs` remain the execution identity and queue authority. No second runner, queue, database, session loop, model registry, or PTY was introduced.
- Waiting/terminal sessions fail closed before inference/tool effects. Pause intents cancel and clear only the matching old job; approval requeue uses compare-and-set fencing so stale workers cannot commit.
- Independent reviewers use a minimal pending-approval projection and cannot read the owner's full session. Neither the owner nor requester may approve; the decision is bound to approval ID, fingerprint, and expiry.
- One addon-owned observability authority in `packages/orm-observability`: OTLP/Qoder ingest, redaction, PostgreSQL persistence, durable cross-replica correlation, credential-derived tenant attribution, scoped reads, keyset pagination, retention, readiness, and prune status.
- Board Mission Control is the operator UI for interactive sessions and telemetry. The portable visual-swarm dashboard remains local, read-only coordination metadata.
- Production ingest credentials remain API-only; client-supplied telemetry attributes cannot establish tenant scope. Legacy/unscoped credentials remain global-admin-only.
- CI and release preflight execute both ADR boundary fixture suites and repository gates; active unit CI includes agent-observability and release-preflight tests.

## Verified commands

| Command / scenario | Result | Notes |
| --- | --- | --- |
| `/tmp/opencode/bun-install/bin/bun --filter @moonwitness/orm-observability build` | Exit 0 | Rebuilt after the PostgreSQL key-encoding fix. |
| `/tmp/opencode/bun-install/bin/bun --filter @moonwitness/orm-ai build` | Exit 0 | Rebuilt current domain sources. |
| `/tmp/opencode/bun-install/bin/bun --filter @moonwitness/orm-observability test` | Exit 0; **65/65**, 7 files | SQLite/memory/HTTP/OTLP/Qoder/redaction/caps regression. |
| `/tmp/opencode/bun-install/bin/bun --filter @moonwitness/orm-ai test` | Exit 0; **93/93**, 13 files | Includes 14 interactive-session tests, durable ports, fencing, provider/sandbox/effect, and HTTP regression. |
| `node ../../node_modules/vitest/vitest.mjs run tests/telemetry-store.test.ts --testTimeout=60000 --hookTimeout=60000` with `TELEMETRY_POSTGRES_TEST_URL` | Exit 0; **33/33** | PostgreSQL implementation, isolated random schema per store. Found and fixed UTF-8 NUL incompatibility in persisted metric-series keys. |
| `node ../../node_modules/vitest/vitest.mjs run tests/interactive-sessions.test.ts --testTimeout=120000 --hookTimeout=120000` with `INTERACTIVE_POSTGRES_TEST_URL` | Exit 0; **14/14** | PostgreSQL lifecycle, replay, approval, cancellation, requeue, stale-worker, reviewer, and HTTP isolation; isolated random schema per test. |
| `node ../../node_modules/vitest/vitest.mjs run tests/ai-corporation.routes.test.ts tests/observability.test.ts tests/worker-health.test.ts tests/addon-registry.test.ts tests/startup-bootstrap.test.ts` from `apps/api` | Exit 0; **18/18**, 5 files | API registration, company isolation, health/worker/startup configuration. |
| `node --test scripts/check-interactive-session-boundary.test.mjs scripts/check-swarm-observability-boundary.test.mjs scripts/release-preflight.test.mjs` | Exit 0; **31/31** | Positive/negative fixtures plus CI/release wiring. |
| `node scripts/check-interactive-session-boundary.mjs` | Exit 0; 6 checks, 1125 files | Compose sandbox mount checks skipped because the canonical file has no sandbox service candidate; reported explicitly by the gate. |
| `node scripts/check-swarm-observability-boundary.mjs` | Exit 0; 7 checks, 1125 files | No second receiver/model/route/database authority. |
| `node node_modules/typescript/bin/tsc --noEmit -p apps/board/tsconfig.json` | Exit 0 | Board typecheck after rebuilding shared UI declarations. |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/orm-ai/tsconfig.json` | Exit 0 | Domain typecheck. |
| `node node_modules/typescript/bin/tsc --noEmit -p packages/orm-observability/tsconfig.json` | Exit 0 | Domain typecheck. |
| `node scripts/architecture/generate-diagrams.mjs --check` | Exit 0 | 14 artifacts, 63 packages, 89 core addon models, 146 relations. |
| `node scripts/docs/generate-reference.mjs --check` | Exit 0 | Generated API/model/platform references current. |
| `node scripts/docs/update-readme.mjs --check` | Exit 0 | README current. |
| `node scripts/check-docs.mjs` | Exit 0 | 732 Markdown files; local links/anchors resolve. |
| `node scripts/check-doc-navigation.mjs` | Exit 0 | 4 sections, 26 navigation targets. |
| `node --test scripts/docker-workspace-manifests.test.mjs` | Exit 0; **10/10** | Found and fixed a missing production build-stage copy for the Coolify template-pack manifest. |
| `node scripts/release-preflight.mjs` | Exit 1 only at Node parity; all later executed gates passed | Local Node `v22.22.1` is not the declared Node `24.x`; release acceptance remains blocked. |
| `/tmp/opencode/bun-install/bin/bun --filter @moonwitness/agent-observability test` | Exit 0; **1/1** | Instrumentation exporter configuration. |
| `node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json` and `packages/ai-runtime/tsconfig.json` | Exit 0 | API and agent runtime typechecks. |
| `git diff --check` | Exit 0 | No whitespace errors. |
| Board Playwright Chromium: `e2e/interactive-session.spec.ts` and `e2e/telemetry.spec.ts` | Exit 0; **7/7** | Built API, isolated PostgreSQL, one worker; four interactive-session and three telemetry scenarios. |

## Regression findings fixed during integration

- Approval changed fencing state but did not initially fence the old job before externally visible effects. Added a pre-effect linked-session gate, pause cancellation/job clearing, and compare-and-set requeue.
- Owner-only session reads prevented an independent reviewer from discovering a pending decision. Added a dedicated minimal approval endpoint/UI while keeping full reads owner-only.
- Reviewer domain and HTTP shapes differed. The addon now returns the stable flattened Board DTO.
- PostgreSQL telemetry initially failed with `invalid byte sequence for encoding "UTF8": 0x00`. Persisted metric `series_key` now uses NUL-free JSON tuple encoding; cursor-only NUL identities remain encoded before SQL binding.
- PostgreSQL fixtures initially shared schemas and collided on company names. Both integration suites now create isolated random schemas.
- Browser gap payloads were parsed as ordinary snapshots, fresh gap data was discarded, and reconnect `open` cleared the gap before a replacement frame arrived. Parser/recovery now preserves the gap until a valid snapshot/replay frame is applied.
- Browser log assertions expected raw IDs that the privacy-preserving table intentionally does not render. They now assert safe trace correlation and visible metadata instead.
- Telemetry browser setup navigated before installing mocks and reloaded while workspace authentication was still settling. Mocks now precede the first Mission Control navigation and the test waits for the session panel, eliminating unmocked startup requests.
- Release preflight found the Coolify template-pack manifest missing from the production Docker build stage. The manifest is now copied before frozen install; the Docker fixture suite passes 10/10.
- ADR 0016 previously described a PTY/SSE implementation. It now matches the delivered bounded typed command/output protocol and explicitly keeps PTY/arbitrary terminal streams out of scope.

## Open release gates

- [x] Final seven-scenario Chromium acceptance result recorded.
- [ ] Node `24.x` parity on the declared runtime.
- [ ] Hosted Compose cutover, multi-replica soak/failover, restore, and rollback evidence.
- [ ] Production ingest credential provisioning and old-ingress cutover evidence.
- [ ] Immutable result commit SHA, exact-SHA CI run, and reviewed release-preflight result.
- Commit and push to `origin/dev` are authorized for this wave; no deployment is authorized or performed.
- [ ] `oxlint` result: an earlier invocation crashed with `Illegal instruction`; no lint pass is claimed.

## Handoff

Preserve the candidate changes; do not reset or discard them. Local swarm state remains ignored and must not be committed. Synthetic PostgreSQL resources are disposable and may be removed after evidence capture. Commit and push are authorized; record the immutable implementation SHA, rerun the relevant gates against that SHA, and only then evaluate release acceptance. Deployment remains outside this authorization.
