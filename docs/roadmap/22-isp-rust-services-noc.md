# M21 — Rust ISP service servers and Go NOC

**Architecture authority:** [ADR 0019](../decisions/0019-isp-rust-go-boundaries.md)

## Scope

All first-party ISP protocol/telemetry servers are Rust. NOC correlation, event policy and remediation decisions are Go. Server fast paths do not require synchronous Go calls for each packet.

## Task cards

## M21.01 — Build Rust DHCPv4 server with durable leases and relay support

- **Prerequisites:** M19.01, M19.02, M20.03
- **Priority:** P1
- **Deliverable:** Add a Rust protocol server configured by Go with durable local lease state.

### Steps

1. Implement DHCPDISCOVER/OFFER/REQUEST/ACK/NAK/RELEASE/INFORM and agreed relay support.
2. Support reservations, options, lease timers, duplicate requests and restart recovery.
3. Consume signed/versioned Go config; no per-packet Go call or commercial data authority.
4. Add packet fixtures and parser fuzzing.

### Acceptance

- [ ] Rust tests cover state machine, relay, malformed and duplicate packets, and restart.
- [ ] Go configuration activates runtime without per-packet control-plane dependency.
- [ ] No authoritative customer or contract records exist in DHCP local store.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M21.02 — Add Rust DHCPv6 and Prefix Delegation

- **Prerequisites:** M21.01, M20.03
- **Priority:** P2
- **Deliverable:** Extend the Rust DHCP runtime to IPv6 and delegated subscriber prefixes.

### Steps

1. Implement Solicit/Advertise/Request/Reply/Renew/Rebind/Release/Decline/Information-Request.
2. Support IA_NA, IA_PD, lifetimes, DUID and relay options.
3. Resolve leases against Go IPAM reservation contract asynchronously/idempotently where possible.
4. Test duplicate DUID, exhaustion and restart.

### Acceptance

- [ ] Golden DHCPv6 and IA_PD tests pass.
- [ ] Delegated prefixes do not overlap and renew idempotently.
- [ ] Exhaustion/unsupported behavior is protocol-correct and auditable.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M21.03 — Build Rust authoritative DNS server with tenant-scoped zones

- **Prerequisites:** M19.01, M19.02
- **Priority:** P1
- **Deliverable:** Deliver authoritative DNS hosting based on canonical ORM zone state.

### Steps

1. Implement authoritative zone serving for agreed record types and zone versioning.
2. Consume versioned desired zone snapshots from Go, sourced from ORM-owned records.
3. Gate DNSSEC signing/key lifecycle as a separately verified feature.
4. Apply zone changes atomically and maintain rollback snapshots.

### Acceptance

- [ ] Positive, negative, delegation, TTL and zone version fixtures pass.
- [ ] Cross-tenant reads/writes are denied.
- [ ] Atomic update and rollback are tested; no unsupported DNSSEC claim.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M21.04 — Build Rust recursive DNS resolver with cache and policy isolation

- **Prerequisites:** M21.03, M19.02
- **Priority:** P2
- **Deliverable:** Separate recursive resolver role from authoritative hosting.

### Steps

1. Implement recursive lookup, bounded cache, TTL, upstream selection and flushing.
2. Add tenant policy, safe timeout, allow/deny policies and separately gated DNSSEC validation.
3. Expose cache/latency/error metrics to NOC.
4. Test cache poisoning, malformed response and cross-tenant cache isolation.

### Acceptance

- [ ] Recursive and authoritative roles deploy/configure independently.
- [ ] Cache obeys TTL/policy without tenant leakage.
- [ ] Bad upstream, timeout and DNSSEC failure outcomes are deterministic.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M21.05 — Build Rust TR-069 ACS server and simulated CPE suite

- **Prerequisites:** M19.01, M19.02
- **Priority:** P1
- **Deliverable:** Implement TR-069 CWMP first and leave TR-369 USP as a separately scoped follow-up.

### Steps

1. Implement CWMP session/Inform, parameter read-write, download/reboot and connection request profile.
2. Scope CPE identity/credentials/policy through canonical platform contract.
3. Use simulated CPE tests; gate fleet firmware/config operations by approval and rollout policy.
4. Document unsupported USP features clearly.

### Acceptance

- [ ] SOAP/session success, malformed, unauthorized and retry fixtures pass.
- [ ] Credentials never appear in logs/responses.
- [ ] Firmware/config rollout requires approved policy and canary/rollback.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M21.06 — Build Rust syslog and SNMP-trap ingestion service

- **Prerequisites:** M19.01, M19.02
- **Priority:** P2
- **Deliverable:** Ingest network events in Rust, leaving NOC correlation/actions to Go.

### Steps

1. Receive bounded UDP/TCP syslog and SNMP traps with source allowlists and rate limits.
2. Normalize vendor messages to versioned events with source, timestamp, severity, code and payload reference.
3. Redact secrets and subscriber PII before persistence/forwarding.
4. Add backpressure, replay-safe IDs, drop counters, health and metrics.

### Acceptance

- [ ] Golden fixtures cover MikroTik/Huawei/ZTE, malformed, oversized and high-rate traffic.
- [ ] Backpressure and drop behavior are bounded and observable.
- [ ] Ingest process does not make remediation/incident decisions.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M21.07 — Build Rust IPFIX and sFlow flow collector

- **Prerequisites:** M21.06, M19.02
- **Priority:** P2
- **Deliverable:** Collect flow data for utilization, top talkers, capacity and abuse analytics.

### Steps

1. Decode selected IPFIX templates and sFlow datagrams with bounded template cache.
2. Normalize five-tuple, counters, exporter, observation domain and sampling metadata.
3. Guard malformed templates, spoofed exporters, replay and cardinality explosions.
4. Publish normalized events to Go NOC contract.

### Acceptance

- [ ] Golden IPFIX/sFlow fixtures normalize deterministically.
- [ ] Malformed/unknown exporters fail closed without unbounded allocation.
- [ ] Throughput and backpressure load report included.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M21.08 — Implement Go NOC event correlation, alarms and incident workflow

- **Prerequisites:** M19.09, M21.06, M21.07
- **Priority:** P1
- **Deliverable:** Keep NOC policy/correlation/remediation decision-making in Go, using existing platform owners.

### Steps

1. Consume normalized Rust telemetry and correlate by site/device/interface/service/tenant.
2. Add deduplication, maintenance suppression, severity, escalation and service impact mapping.
3. Create/update incident projections through existing orm-helpdesk and observability owners.
4. Expose safe action proposals; require approval for remediation.

### Acceptance

- [ ] Golden event sequences produce deterministic deduplicated alarms.
- [ ] Maintenance suppression does not delete evidence.
- [ ] Incident links and tenant scope are correct; secrets are never exposed.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.


## Wave exit

All child tasks must be individually accepted with exact-SHA test evidence. Milestone completion additionally requires dependency closure, no unresolved P0/P1 security finding in its scope, current documentation, and an explicit hardware-lab gate for any vendor write path.
