# M19 — Rust ISP server plane and Go control-plane foundation

**Architecture authority:** [ADR 0019](../decisions/0019-isp-rust-go-boundaries.md)

## Scope

Rust is the only implementation language for first-party ISP protocol/server runtimes. Go in apps/control-plane is the only ISP network control plane. packages/orm-isp remains the data/domain owner; apps/api and Board are BSS/operator integration surfaces, not a network control plane.

## Task cards

## M19.01 — Accept Rust ISP server-plane and Go network control-plane boundary

- **Prerequisites:** Architecture entry task
- **Priority:** P1
- **Deliverable:** ADR for exclusive Rust ISP server runtimes and Go network control-plane responsibilities.

### Steps

1. Separate server protocols from device orchestration; keep apps/isp and future protocol daemons Rust-only.
2. Keep apps/control-plane as the sole Go network control plane, stateless and free of a second DB.
3. Keep packages/orm-isp canonical for ISP data; API/Board remain business/operator surfaces that delegate network actions.
4. Define edge cache, desired-state, security, and hardware safety boundaries.

### Acceptance

- [x] ADR 0019 is accepted and indexed.
- [x] Ownership matrix maps all existing ISP/Cloud responsibilities without creating duplicate systems.
- [x] No second ORM, business database, control-plane process, or network controller in Rust/TypeScript.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.02 — Define versioned Go-to-Rust ISP runtime contracts

- **Prerequisites:** M19.01
- **Priority:** P1
- **Deliverable:** A versioned contract for Go commands, Rust service config, health/readiness, operation status, and event reconciliation.

### Steps

1. Define schema-versioned request/response envelopes with correlation ID, operation ID, idempotency key, config generation, deadline, and typed error code.
2. Specify private transport authentication, retry classes, timeout, redaction, and compatibility policy.
3. Separate liveness, readiness, management reachability, and protocol-level health.
4. Add fixtures and a contract test between a Go client and Rust endpoint.

### Acceptance

- [x] Schemas validate all positive and negative fixtures.
- [x] Tests cover stale generation, duplicate command, unsupported version, timeout, auth failure, and sanitized errors.
- [x] No TypeScript handler sends device commands directly.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.03 — Make Rust ISP container build reproducible from a clean clone

- **Prerequisites:** M19.01
- **Priority:** P1
- **Deliverable:** Resolve existing #378 and build the current apps/isp runtime reproducibly.

### Steps

1. Unignore and commit the production Cargo.lock for apps/isp.
2. Align Docker build context, COPY paths, compose service, Dockerfile, runtime env, config and persistent volume.
3. Remove stale apps/radius references and unused PostgreSQL config claims; document the SQLite edge runtime currently used.
4. Add clean-clone image build and Compose config tests.

### Acceptance

- [x] Clean clone builds the image without pre-existing Cargo artifacts.
- [x] docker compose config succeeds and references only existing paths and services.
- [x] Container starts RADIUS auth/accounting and private management HTTP using documented configuration.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.04 — Resolve Rust dependency advisories in the ISP runtime

- **Prerequisites:** M19.03
- **Priority:** P1
- **Deliverable:** Resolve existing #375 using the committed ISP dependency graph.

### Steps

1. Re-run cargo audit against the exact tracked lockfile and identify exact dependency paths.
2. Upgrade libsqlite3-sys and rsa advisories if present and compatible; verify patched version paths.
3. Evaluate chrono unmaintained warning and replace or document a time-bounded exception.
4. Run cargo test, clippy, and audit against the final clean dependency graph.

### Acceptance

- [x] No untriaged HIGH/CRITICAL Rust advisory remains.
- [x] Any exception has owner, rationale and expiry.
- [x] Build, tests, clippy and audit pass from clean clone.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.05 — Persist RADIUS accounting before sending Accounting-Response

- **Prerequisites:** M19.01, M19.03
- **Priority:** P1
- **Deliverable:** Prevent acknowledged-but-unpersisted RADIUS accounting events in Rust.

### Steps

1. Persist accounting data transactionally before constructing Accounting-Response.
2. On durable-write failure, do not ACK; allow NAS retransmission and emit bounded diagnostic metrics.
3. Use unique event/session identity and idempotent update semantics.
4. Test DB failure, retransmission, and recovery.

### Acceptance

- [x] Forced DB failure sends no Accounting-Response.
- [x] After recovery, retransmission is persisted once.
- [x] ACK only follows durable commit.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.06 — Add RADIUS 64-bit counters and Gigawords support

- **Prerequisites:** M19.05
- **Priority:** P1
- **Deliverable:** Implement live-path Acct-Input/Output-Gigawords handling.

### Steps

1. Decode attributes 52 and 53 and combine with 32-bit octet counters as checked 64-bit values.
2. Persist monotonic totals and handle counter wrap, NAS reboot, and session restart.
3. Make duplicate/out-of-order interim accounting safe.
4. Add golden packets around 2^32 and multi-GiB sessions.

### Acceptance

- [x] Both directions calculate correct 64-bit totals.
- [x] Wrap, Gigawords, duplicate, stale packet, and reboot tests pass.
- [x] Quota and invoice reconciliation consume the normalized counter semantics.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.07 — Add MikroTik bandwidth RADIUS Vendor-Specific Attribute

- **Prerequisites:** M19.02, M19.05
- **Priority:** P1
- **Deliverable:** Return MikroTik-Rate-Limit rather than misusing Filter-Id as a bandwidth shaper.

### Steps

1. Encode Vendor-ID 14988 and attribute type 8 with bounded values.
2. Map canonical bandwidth profile rates/bursts to documented MikroTik ordering and units.
3. Keep Filter-Id for policy classification only.
4. Add packet golden fixtures and RouterOS interoperability tests.

### Acceptance

- [x] Access-Accept contains the expected VSA for each supported profile.
- [x] Malformed or oversized values fail closed.
- [x] PAP/CHAP and non-MikroTik responses remain compatible.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.08 — Make CoA and Disconnect completion depend on verified NAS ACK

- **Prerequisites:** M19.02, M19.05, M19.06
- **Priority:** P1
- **Deliverable:** Correct the false-success path where HTTP 200 or sent=false/ack=false can mark an outbox row sent.

### Steps

1. Define queued, sent, acknowledged, rejected, timed_out, no_session, and retryable_failure states.
2. Parse Rust response bodies and require verified Disconnect-ACK before acknowledged state.
3. Keep NAK details sanitized; implement bounded retry/backoff and idempotency.
4. Claim outbox work atomically so concurrent workers cannot process the same operation.

### Acceptance

- [ ] ack=false is never marked sent/acknowledged.
- [ ] Only verified ACK completes a disconnect operation.
- [ ] ACK, NAK, timeout, no session, malformed response, retry and concurrency tests pass.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.09 — Add ISP control module to the existing Go control-plane

- **Prerequisites:** M19.01, M19.02
- **Priority:** P1
- **Deliverable:** Add ISP network control capability inside apps/control-plane; do not create another control-plane process.

### Steps

1. Create a focused Go package for ISP control contracts, policies and adapters.
2. Register a route matrix using the existing authentication and privileged-operation middleware.
3. Keep service stateless; do not add SQLite tables or persist business records locally.
4. Add health/readiness and typed ISP operation error mapping.

### Acceptance

- [x] Go build, go test and go vet pass.
- [x] Route matrix rejects unauthorized, wrong-method, unknown and underprivileged calls.
- [x] No ISP device-control logic is implemented in Rust or ORM HTTP plugins.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.10 — Implement Go desired-state reconciliation for NAS and subscriber services

- **Prerequisites:** M19.02, M19.09
- **Priority:** P1
- **Deliverable:** Make Go own network reconciliation while PostgreSQL/ORM remains the desired-state authority.

### Steps

1. Consume tenant-scoped, versioned desired-state snapshots from canonical platform APIs.
2. Compile deterministic subscriber/NAS/profile/pool plans with idempotency key and generation.
3. Apply only registered adapter capabilities and report planned/applied/failed/drift states.
4. Do not persist authoritative subscriber or NAS state in Go SQLite or Rust runtime.

### Acceptance

- [ ] Same desired generation is a no-op on repeat.
- [ ] Stale generation, tenant mismatch and unsupported capability fail closed.
- [ ] Plan-only mode proves zero device writes; partial failures are recoverable.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.11 — Add read-only MikroTik RouterOS discovery adapter in Go

- **Prerequisites:** M19.09
- **Priority:** P1
- **Deliverable:** Create the first vendor adapter in Go and start with discovery only.

### Steps

1. Define vendor-neutral NAS interface and read RouterOS identity, version, interfaces, PPP profiles/sessions and health.
2. Use typed inputs, bounded responses/timeouts, explicit capability versions and credential redaction.
3. Add fake-device fixtures for success and failure responses.
4. Do not accept arbitrary CLI text or expose write methods in this task.

### Acceptance

- [ ] Discovery returns normalized facts with secrets redacted.
- [ ] Timeout, bad credentials, malformed responses and unsupported versions are tested.
- [ ] Adapter surface is read-only.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.12 — Provision MikroTik PPPoE subscribers safely with dry-run and rollback

- **Prerequisites:** M19.10, M19.11
- **Priority:** P1
- **Deliverable:** Deliver the first guarded subscriber provisioning vertical slice in Go.

### Steps

1. Add typed actions for PPP secret/profile, pool binding and rate policy.
2. Require validated plan plus explicit apply permission; no arbitrary commands.
3. Use operation identity and canonical audit reference; add compensation for partial failure.
4. Read back device state after apply and report drift.

### Acceptance

- [ ] Dry-run has zero device side effects.
- [ ] Apply is idempotent and verified by read-back.
- [ ] Partial failure compensation and audit trail are tested.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M19.13 — Connect protocol-aware NAS probes to actual Go HA decisions

- **Prerequisites:** M19.10, M19.11, M19.12
- **Priority:** P1
- **Deliverable:** Replace TCP-only health assumptions and connect HA selection to real Go decisions.

### Steps

1. Track management, RADIUS auth/accounting, and CoA reachability as separate signals.
2. Add configurable failure windows, hysteresis, cooldown, maintenance suppression and probe freshness.
3. Select healthy eligible NAS and reconcile dependent service state safely.
4. Publish health/failover events through canonical observability and ORM surfaces.

### Acceptance

- [ ] TCP management reachability alone cannot make RADIUS healthy.
- [ ] Flap, stale probe, primary outage, ineligible backup and recovery tests pass.
- [ ] No mass disconnect/failover action occurs outside approved policy.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.


## Wave exit

All child tasks must be individually accepted with exact-SHA test evidence. Milestone completion additionally requires dependency closure, no unresolved P0/P1 security finding in its scope, current documentation, and an explicit hardware-lab gate for any vendor write path.
