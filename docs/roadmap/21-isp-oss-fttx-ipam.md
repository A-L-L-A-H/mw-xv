# M20 — Network OSS, IPAM and FTTH access network

**Architecture authority:** [ADR 0019](../decisions/0019-isp-rust-go-boundaries.md)

## Scope

Extend canonical ORM-owned network inventory, dual-stack IPAM and FTTH resources. Every device discovery/provisioning action is executed through the Go control plane.

## Task cards

## M20.01 — Add canonical ISP network inventory for POPs, devices, interfaces and links

- **Prerequisites:** M19.01
- **Priority:** P1
- **Deliverable:** Extend packages/orm-isp instead of introducing another inventory or network database.

### Steps

1. Add company-scoped POP/site, rack, network device, interface/port and physical/logical link models.
2. Add stable identity, vendor/model/firmware, management endpoint reference, hierarchy and lifecycle fields.
3. Register views/access rules through existing addon manifest.
4. Keep command execution/config compilation out of ORM models and plugins.

### Acceptance

- [ ] Models register through orm-isp manifest and are tenant scoped.
- [ ] Relations reject cross-company links and duplicate interface/device identity.
- [ ] Fresh install and upgrade/reinstall preserve existing ISP data.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M20.02 — Model VLAN, VRF, L2/L3 circuits and upstream connectivity

- **Prerequisites:** M20.01
- **Priority:** P1
- **Deliverable:** Represent access, aggregation, peering, transit and customer circuits as canonical resources.

### Steps

1. Add VLAN/QinQ, VRF, L2/L3 circuit, interface attachment and upstream/peering references.
2. Record encapsulation, MTU, routing context, service role, status and source-of-truth links.
3. Enforce duplicate VLAN/interface assignment constraints within the same resource scope.
4. Reuse existing partner/project relationships.

### Acceptance

- [ ] Resource model validation enforces scope and uniqueness.
- [ ] Service path is traversable from subscriber to access/aggregation/upstream.
- [ ] No vendor CLI/config blob is the canonical model.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M20.03 — Extend IPAM for IPv4/IPv6 prefixes, VRFs and delegated prefixes

- **Prerequisites:** M20.01, M20.02
- **Priority:** P1
- **Deliverable:** Turn existing basic IP pools into routing-context-aware IPAM.

### Steps

1. Model prefix hierarchy, family, VRF, gateway, DHCP ranges, delegation size and utilization.
2. Support IPv4/IPv6 edge cases and overlapping prefixes only in separate VRFs.
3. Link allocations to subscribers and network resources.
4. Persist canonical IPAM state through PostgreSQL/orm-isp.

### Acceptance

- [ ] CIDR validation covers IPv4/IPv6 and VRF-scoped overlap rules.
- [ ] Prefix hierarchy and subscriber PD relationships are tested.
- [ ] No second IPAM data store is introduced.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M20.04 — Implement transactional and idempotent address/prefix allocation

- **Prerequisites:** M20.03, M19.10
- **Priority:** P1
- **Deliverable:** Provide reserve/allocate/release/renew through ORM-owned persistence, driven by Go.

### Steps

1. Define allocate, reserve, release, renew and transfer operations with idempotency keys.
2. Use DB constraints/transactions to prevent duplicate concurrent allocation within a VRF.
3. Have Go compile corresponding network action and verify configured state.
4. Add expiry, reclaim, hold-down and audit events.

### Acceptance

- [ ] Concurrent tests never allocate duplicate address/prefix in one VRF.
- [ ] Retry returns same allocation for same idempotency key.
- [ ] Release/reclaim preserves history and never reuses active allocations.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M20.05 — Define vendor-neutral OLT/ONT adapter contract and simulator

- **Prerequisites:** M19.09, M20.01
- **Priority:** P1
- **Deliverable:** Create the safe vendor-neutral boundary before Huawei/ZTE-specific support.

### Steps

1. Define typed operations for inventory, optical diagnostics, ONU registration, service-port, VLAN, DBA/T-CONT, GEM and profile.
2. Create simulator with capability and realistic error-state support.
3. Require plan/apply separation, operation IDs, bounded requests and read-back verification.
4. Label read-only versus mutating capabilities and approval rules.

### Acceptance

- [ ] Adapter conformance passes against simulator.
- [ ] Unsupported operations return typed unsupported errors.
- [ ] Generic API does not expose arbitrary CLI/SSH commands.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M20.06 — Add read-only Huawei MA5800 and ZTE C300 discovery

- **Prerequisites:** M20.05
- **Priority:** P1
- **Deliverable:** Start with read-only OLT inventory and optical diagnostics; no production config writes.

### Steps

1. Implement model/firmware capability discovery and read-only shelf/slot/board/PON/ONT/alarm/optical reads.
2. Normalize responses to vendor-neutral OLT inventory types.
3. Add sanitized fixtures for MA5800 and C300 profiles.
4. Fail closed on unknown firmware or changed command output.

### Acceptance

- [ ] Both adapters pass sanitized fixture tests.
- [ ] Secrets and subscriber PII are redacted.
- [ ] No ONU deletion, service-port mutation or config-write operation is present.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M20.07 — Provision FTTH ONT-to-subscriber service through approved Go workflow

- **Prerequisites:** M20.03, M20.04, M20.05, M20.06, M19.10
- **Priority:** P1
- **Deliverable:** Build the FTTH provisioning lifecycle from inventory and reserved resources.

### Steps

1. Model POP → OLT → PON → splitter/ODP → ONT/ONU → VLAN/service profile → subscriber relationships.
2. Compile approved plan for ONT binding, service-port, VLAN, DBA/T-CONT, GEM and bandwidth policy.
3. Require operator approval for first vendor writes and verify optical/service state after apply.
4. Define compensation for partial provisioning.

### Acceptance

- [ ] Simulator covers successful path and every failure boundary.
- [ ] Duplicate event cannot provision/register an ONT twice.
- [ ] Production vendor writes remain disabled until lab acceptance is approved.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M20.08 — Add technician work orders for FTTH installation and CPE handoff

- **Prerequisites:** M20.07
- **Priority:** P2
- **Deliverable:** Connect install/repair to field technician work without creating a second ticket system.

### Steps

1. Reuse orm-helpdesk and orm-workflow for work orders and transitions.
2. Track appointment, technician, POP/ODP/ONT, serial, optical reading, media evidence and customer acceptance.
3. Link completed work to provisioning and subscription activation.
4. Add tenant/role access and field-friendly UI.

### Acceptance

- [ ] Work order covers planned, assigned, onsite, blocked, completed and cancelled.
- [ ] Completion requires evidence and verified service.
- [ ] Technician/customer access is scoped.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.


## Wave exit

All child tasks must be individually accepted with exact-SHA test evidence. Milestone completion additionally requires dependency closure, no unresolved P0/P1 security finding in its scope, current documentation, and an explicit hardware-lab gate for any vendor write path.
