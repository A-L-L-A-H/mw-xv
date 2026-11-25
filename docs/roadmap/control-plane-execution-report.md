# Control-plane CF workstream — execution report

**Date:** 2026-11-24 (UTC)
**Base inspected SHA:** `4a8a249e1b37d93917942fd18a98695952e455e7` (`dev`)
**Scope:** GitHub issues #55–#80 (CF workstream), #203, plus the API health/metrics wiring needed by CF-013/CF-014/CF-012.

> This report records implementation and local verification evidence only. No `git add`, `commit`, push, issue closure, workflow edit or deployment was performed. The working tree already contained unrelated user changes and those files were not touched.

## Execution waves

| Wave           | Issues                                                                                                     | Outcome                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 0 — foundation | #55 CF-001, #78 CF-023, #79 CF-024, #203                                                                   | Source-linked gap map + checkpoint/CI investigation docs; canonical private-mesh CIDR list (TS + Go mirror) |
| 1 — P0         | #56 CF-002, #57 CF-003, #70 CF-016, #61 CF-007, #63 CF-009, #67 CF-013, #73 CF-019, #66 CF-012, #77 CF-022 | Implemented with tests                                                                                      |
| 2 — derived    | #58 CF-004, #59 CF-005, #60 CF-006, #64 CF-010, #65 CF-011, #68 CF-014, #69 CF-015, #71 CF-017, #76 CF-021 | Implemented with tests                                                                                      |
| 3 — final      | #62 CF-008, #72 CF-018, #74 CF-020 (design only)                                                           | Implemented / designed                                                                                      |
| 4 — parent     | #80 CF-EPIC                                                                                                | Left open pending acceptance review and CI evidence                                                         |

## Implementation summary by issue

| Issue      | Delivered                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #55 CF-001 | [`cloud-control-plane-gap-map.md`](../architecture/cloud-control-plane-gap-map.md): owner map, implemented/partial/missing/blocked status, gap→issue index, exact SHA/date                                              |
| #56 CF-002 | `CLOUD_ROUTE_ACCESS_MATRIX`, company-scoped lookups including live-log records, cross-tenant denial tests                                                                                                               |
| #57 CF-003 | Go `controlPlaneRouteMatrix`, hardened bearer parsing, privileged Paas auth, TLS-capable listener; TS token contract with rotation candidates and timing-safe verifier                                                  |
| #58 CF-004 | Secret classification/redaction, rotation candidates, secret-reference provider form, exported Terraform redaction                                                                                                      |
| #59 CF-005 | `Idempotency-Key` contract, company-scoped replay records, 409 payload conflict and ambiguous-timeout retry hint                                                                                                        |
| #60 CF-006 | Coolify deployment state machine, `applyDeploymentEvent`, bounded `reconcileDeploymentOutcome`, plan retry with stable key                                                                                              |
| #61 CF-007 | `PaasQuotaReservationLedger` serialized check-and-set + usage settlement ledger                                                                                                                                         |
| #62 CF-008 | Provision step→compensation map, reverse-order scoped rollback, `needs_operator_retry` state                                                                                                                            |
| #63 CF-009 | Monotonic HA generation, `tryClaimHaOwnership`, `applyFencedHeartbeat`, failover race resolution                                                                                                                        |
| #64 CF-010 | `runDeterministicHaDrill` with five recorded steps, five scenarios, redacted diagnostics and deterministic evidence SHA                                                                                                 |
| #65 CF-011 | Probe target allowlist/SSRF assertions, redirect revalidation, bounded timeout/body, stable reason codes                                                                                                                |
| #66 CF-012 | Bounded-cardinality cloud counters; `renderMetrics()` now exposes `moonwitness_cloud_operations_total` behind the existing bearer-protected `/metrics` endpoint                                                         |
| #67 CF-013 | Shared `WorkerHealthContract`, safe live/ready payloads, loopback-only bind validation; API worker-health endpoint consumes the contract                                                                                |
| #68 CF-014 | Standardized health response shapes wired into jobs-worker, scheduler and outbox worker; drain-first readiness                                                                                                          |
| #69 CF-015 | Abort-aware `runWorkerLoop`, bounded drain controller, stale-worker/fencing/dead-letter adversarial tests                                                                                                               |
| #70 CF-016 | Go A2A in-memory nonce/fencing authority removed; thin forwarder to private-mesh API inbox with origin allowlist, redirect rejection, bounded retry, safe errors; docs updated                                          |
| #71 CF-017 | TS peer identity registry with key pinning, grace/rotation/revocation and fingerprint-only audit; Go consumer enforces key/agent/company/SPKI binding                                                                   |
| #72 CF-018 | TS transport identity verification (socket certificate only, forwarded headers ignored) and Go mTLS listener config; fail-closed when enabled                                                                           |
| #73 CF-019 | Inbox cursor pagination, rate limiting with `Retry-After`, size limit, retention projection                                                                                                                             |
| #74 CF-020 | [`dispatch-bridge-design.ts`](../../packages/orm-a2a/src/dispatch-bridge-design.ts): default-off, PCW + classification/capability/depth gates, jobs lease/fencing and human-approval checklist — design only, as scoped |
| #76 CF-021 | `validateCloudConfig`/`readCloudReadiness` with stable reason codes and no secret values; Go bounded `/health`                                                                                                          |
| #77 CF-022 | [`cloud-backup-restore-verification.md`](../knowledge/cloud-backup-restore-verification.md) with checksum and non-prod restore steps; RPO/RTO marked unknown                                                            |
| #78 CF-023 | [`control-plane-checkpoint-reconciliation.md`](control-plane-checkpoint-reconciliation.md): stale checkpoint findings and proposed (unapplied) edit                                                                     |
| #79 CF-024 | [`control-plane-ci-conclusion-investigation.md`](control-plane-ci-conclusion-investigation.md): run 404, non-reproducible conflict, SHA-keyed aggregation recommendation                                                |
| #203       | `PRIVATE_MESH_CIDRS` canonical export in `@moonwitness/ai-runtime`, re-export in `orm-cloud`, Go `privateMeshCIDRs` mirror, desktop mesh-fleet uses the shared list, parity tests                                       |

## Local verification evidence

All commands run from the repository root on the working tree described above. Full logs: `/tmp/opencode/verify/*.log`.

| Check                                                                                                                | Result                                           |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `cd apps/control-plane && go test ./... && go vet ./...`                                                             | PASS (`ok moonwitness-control-plane`, vet clean) |
| `pnpm --filter @moonwitness/orm-cloud test`                                                                          | PASS — 11 files / 93 tests                       |
| `pnpm --filter @moonwitness/orm-a2a test`                                                                            | PASS — 8 files / 37 tests                        |
| `pnpm --filter @moonwitness/jobs test`                                                                               | PASS — 5 files / 67 tests                        |
| `pnpm --filter @moonwitness/ai-runtime test`                                                                         | PASS — 30 files / 130 tests                      |
| `pnpm --filter @moonwitness/api exec vitest run tests/worker-health.test.ts`                                         | PASS — 4 tests                                   |
| `pnpm --filter @moonwitness/api exec vitest run tests/observability.test.ts --hookTimeout=60000 --testTimeout=60000` | PASS — 6 tests                                   |
| `pnpm --filter @moonwitness/api exec vitest run tests/a2a.routes.test.ts --hookTimeout=60000 --testTimeout=60000`    | PASS — 8 tests                                   |
| `pnpm --filter @moonwitness/desktop exec vitest run tests/mesh-fleet.test.ts`                                        | PASS — 6 tests                                   |
| `pnpm --filter @moonwitness/orm-cloud exec tsc --noEmit -p tsconfig.json`                                            | PASS                                             |

Extended Vitest hook timeouts are needed in this environment; the failures at the default 10 s are hook timeouts, not assertion failures.

## Close-blocking caveats

1. No CI run URLs were produced here, and issue bodies require close only after acceptance criteria and evidence are reviewed. All issues therefore remain **open**.
2. #74 and #75 are duplicates with the same `CF-020` ID; #75 is closed and #74 is open. Human triage is still required.
3. CF-023/CF-024 are analysis-only: `ACTIVE-PLAN.md` and CI workflows were not edited because those files were already dirty or outside the granted scope. Proposed changes are in the linked docs.
4. CF-003: service tokens are static HMAC capabilities without an `exp` claim; expiry is enforced as rotation invalidation. Adding `exp` needs a coordinated issuer change.
5. CF-017: the peer key registry is in-memory/env-JSON, not a durable DB table; no suitable ORM model existed to reuse.
6. CF-018: verified against injected authenticated socket objects, not a live mTLS peer; no production certificate rollout.
7. CF-019: retention projects payloads at read time; stored payloads are not physically purged because no approved destruction rule exists.
8. CF-020 is design-only by issue scope; no dispatch code or work-contract creation was added.
9. Cross-process idempotency needs a DB unique constraint (schema change, deliberately not attempted).
10. `pnpm --filter @moonwitness/api exec tsc --noEmit` reports pre-existing errors in unrelated dirty files (Fastify plugin/route typings); none of the files changed by this workstream appear in that error list.
