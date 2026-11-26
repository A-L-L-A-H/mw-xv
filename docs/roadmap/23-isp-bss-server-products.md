# M22 — ISP BSS, customer lifecycle and managed server products

**Architecture authority:** [ADR 0019](../decisions/0019-isp-rust-go-boundaries.md)

## Scope

Reuse existing sales, subscription, billing, helpdesk, cloud and PaaS domain owners. Customer UI calls BSS APIs; network provisioning is delegated to Go control plane and runtime services remain Rust.

## Task cards

## M22.01 — Define ISP product catalog using existing subscription ownership

- **Prerequisites:** M19.01, M20.03
- **Priority:** P1
- **Deliverable:** Define retail, SME, enterprise, dedicated, wholesale and managed service offers without duplicating billing.

### Execution steps

1. Link offer to technology, bandwidth, quota, IP allocation, SLA, contract term and eligibility.
2. Reuse orm-sales, orm-subscription and orm-income-ledger for sales/financial authority.
3. Model currency, minor units, recurring/install/overage/discount explicitly.
4. Version product policy so catalog edits do not silently change active contracts.

### Acceptance criteria

- [ ] Active subscription terms change only through explicit renew/migrate action.
- [ ] Existing subscription/invoice models remain sole billing authority.
- [ ] Offer validation covers missing profiles, invalid quota, unsupported technology and tenant isolation.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M22.02 — Implement ISP order lifecycle from coverage to verified activation

- **Prerequisites:** M20.07, M22.01, M19.10
- **Priority:** P1
- **Deliverable:** Connect sales acceptance to Go orchestration and Rust server configuration.

### Execution steps

1. Support new install, upgrade, downgrade, relocation, suspension and termination transitions.
2. Check coverage, capacity, IP/VLAN resources, device capability and approvals before reserve/apply.
3. Generate idempotent Go plan and wait for verified network/runtime state before active.
4. Compensate or release reservations on failed provisioning.

### Acceptance criteria

- [ ] Invalid transitions and duplicate commands are rejected.
- [ ] Activation only after authentication and network health verification.
- [ ] Failure compensation/release rules are tested.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M22.03 — Implement contract-aware recurring and usage billing

- **Prerequisites:** M19.05, M19.06, M22.01
- **Priority:** P1
- **Deliverable:** Replace simplistic per-session default pricing with contract and billing-period rating.

### Execution steps

1. Rate recurring packages, install fee, prorata, add-ons, overage and enterprise-specific rates.
2. Aggregate usage per period before rounding and make rating idempotent by ledger identity.
3. Use explicit currency/minor units; remove magic minor-unit-per-GB defaults.
4. Link every rated usage line to accounting/session evidence.

### Acceptance criteria

- [ ] Golden invoices cover fixed, prorata, overage, quota, zero usage and currency.
- [ ] Repeated rating creates no duplicate invoice line.
- [ ] Amounts reconcile to 64-bit accounting totals and source session evidence.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M22.04 — Implement collections, suspension and restore as verified lifecycle

- **Prerequisites:** M19.08, M22.02, M22.03
- **Priority:** P1
- **Deliverable:** Connect payment status to Go actions and verified Rust/NAS outcomes.

### Execution steps

1. Define grace, warning, reconciliation, soft/hard suspend and restore policy.
2. Emit idempotent desired state to Go; never infer success from HTTP 200 alone.
3. Restore only after payment settlement or audited override plus a fresh provision check.
4. Retain audit history and notification events.

### Acceptance criteria

- [ ] Restore requires settlement or audited override.
- [ ] Completion requires NAS/runtime ACK and follow-up verification.
- [ ] Retry, duplicate webhook, timeout and manual override tests pass.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M22.05 — Build customer self-service for usage, sessions, outages and support

- **Prerequisites:** M22.01, M22.02, M22.03
- **Priority:** P2
- **Deliverable:** Expose customer account/network information through existing Board and BSS APIs.

### Execution steps

1. Show active service, package, current IP, usage period, quota, invoice and permitted device detail.
2. Diagnostic/restart actions become proposals handled by Go policy, never direct browser-to-device.
3. Reuse helpdesk for tickets and show planned/current service outages.
4. Separate retail, enterprise, reseller and technician access.

### Acceptance criteria

- [ ] Queries are subscriber/company/partner scoped; cross-tenant enumeration denied.
- [ ] Browser never sees router/OLT credentials or private device URLs.
- [ ] E2E covers usage, ticket, diagnostic proposal and denied cross-subscriber access.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M22.06 — Add managed server products by reusing existing PaaS and cloud control plane

- **Prerequisites:** M19.01, M19.09, M21.01, M21.03
- **Priority:** P2
- **Deliverable:** Offer DNS/DHCP/VPS/hosting/backup/VPN products without creating another PaaS engine.

### Execution steps

1. Map service SKU to existing cloud capabilities and Rust server runtimes.
2. Reuse apps/control-plane for lifecycle and orm-cloud for cloud resource ownership/templates.
3. Define quota, tenant isolation, network attachment, backup/restore and support per SKU.
4. Separate customer app containers from first-party Rust ISP server daemons.

### Acceptance criteria

- [ ] Each SKU maps to one canonical owner and deployment contract.
- [ ] No second template catalog, PaaS database or orchestrator is created.
- [ ] Create, resize, redeploy, suspend, restore and delete flows are tested.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.

---

## M22.07 — Verify full ISP order-to-activation-to-billing lifecycle

- **Prerequisites:** M19.05, M19.06, M19.08, M19.12, M19.13, M20.04, M20.07, M21.01, M21.03, M22.02, M22.03, M22.04
- **Priority:** P1
- **Deliverable:** Prove one complete customer journey on simulators and disposable PostgreSQL before claiming production readiness.

### Execution steps

1. Run order, reservation, Go provisioning, Rust RADIUS auth/accounting, usage reconciliation, invoice rating, collection suspend and restore.
2. Use simulated NAS/OLT, fake devices and disposable Postgres; do not touch production network/customer data.
3. Capture exact SHA, tests, redacted protocol traces, rollback and restore evidence.
4. List remaining hardware acceptance gates.

### Acceptance criteria

- [ ] Happy path and negative/partial failures pass automation.
- [ ] BSS order, Go operation, Rust event, accounting, invoice and restore are traceable.
- [ ] No production-ready claim is made for untested vendor operations.

### Delivery gates

- Implement only the owned scope and tests; no multi-task mega-PR.
- Run focused tests, app/package build, type/lint checks and relevant security/boundary gates.
- Commit and push to dev only; main promotion stays on the protected dev → main path.
- No production network write until explicit hardware-lab acceptance and approved rollout policy.


## Wave exit

All child tasks must be individually accepted with exact-SHA test evidence. Milestone completion additionally requires dependency closure, no unresolved P0/P1 security finding in its scope, current documentation, and an explicit hardware-lab gate for any vendor write path.
