# ADR 0019: Rust ISP Server Plane and Go Network Control Plane

- **Status:** Accepted
- **Date:** 2026-11-26
- **Scope:** apps/isp, future ISP protocol servers, apps/control-plane, packages/orm-isp, and platform integration contracts.

## Context

The ISP target is an all-in-one ISP operations and managed-network-services platform: AAA, access provisioning, IPAM, FTTH/OLT/ONT, DNS, DHCP, ACS/CPE management, NOC telemetry, customer lifecycle, and managed server products.

Existing responsibilities are split among a Rust RADIUS service, TypeScript ORM plugins/jobs, and a Go control-plane. This leaves protocol serving, orchestration, device commands, and business authority ambiguous.

## Decision

### Rust owns every first-party ISP server/runtime

Rust is the only implementation language for first-party ISP server processes and protocol runtimes:

- RADIUS AAA and accounting (apps/isp).
- DHCPv4, DHCPv6 and Prefix Delegation.
- Authoritative DNS and recursive/caching DNS.
- ACS/CPE protocol runtime: TR-069 CWMP first; TR-369 USP requires a separate capability/acceptance gate.
- Syslog/SNMP-trap and IPFIX/sFlow ingestion.
- Future NTP and other ISP-operated protocol servers only after an explicit demand/capability review.

Rust owns protocol parsing, state machines, local edge persistence/cache where required, service health/readiness/metrics, and its process lifecycle. Rust does not own CRM, commercial catalog, network-wide policy, global device orchestration, vendor device controllers, or the control plane.

RADIUS fast-path authentication must not synchronously call Go for each Access-Request. Rust consumes versioned desired-state/config snapshots and uses a bounded local edge cache to survive temporary control-plane disconnection. Edge state is derived runtime state, never a second business source of truth.

### Go owns the entire ISP network control plane

apps/control-plane is the sole ISP network control-plane implementation and remains Go. It owns:

- Internal control API, authorization boundary, operation lifecycle, idempotency and typed errors.
- Desired-state compilation, planning, drift detection, reconciliation and rollback.
- NAS/BNG/router/switch/OLT/ONT/ACS/CPE vendor adapters and capability discovery.
- Network resource orchestration: subscriber provisioning, IP allocation actions, VLAN/VRF/circuit actions, FTTH activation and device HA/failover decisions.
- Lifecycle/config rollout/version compatibility/readiness/upgrade/rollback for Rust server fleet.
- NOC event correlation, incident policy and remediation decisions, gated by approval and blast-radius policy.

No new Go protocol server may be added for an ISP service owned by the Rust server plane. No Rust package may implement network-wide orchestration or vendor device control.

### Preserve existing business and data ownership

- packages/orm-isp remains the canonical owner of subscriber, NAS inventory, service profile, session mirror, IPAM and future network inventory records.
- packages/orm-subscription, orm-sales, orm-income-ledger, orm-helpdesk, orm-workflow, orm-observability and orm-cloud retain their existing domain ownership.
- apps/api and ORM manifest.httpPlugins may provide authenticated BSS/operator reads, forms and integration adapters. They must not contain device commands, vendor config compilers, HA decisions, or a second provisioning engine.
- Those adapters delegate network mutation and desired-state reconciliation to Go. Browser clients never connect directly to routers, OLTs, private Rust management ports, or device credentials.
- PostgreSQL/ORM remains authoritative business state. Go must retain the stateless-agent posture and must not add another SQLite authority. Rust edge stores may hold bounded derived cache/runtime/accounting state with generation markers, durable event handling and reconciliation.

### Go-to-Rust contract

Every control operation uses a versioned private contract with authenticated transport, bounded deadline, correlation ID, operation ID, idempotency key, config generation, typed outcome, redacted errors and replay-safe event identity.

Outcomes distinguish planned, applied, acknowledged, rejected, timed_out, drifted and rolled_back. Liveness, readiness, management reachability and protocol health are separate signals.

### Device and service safety

- Vendor-neutral resource models stay separate from vendor-specific Go adapters.
- Begin with read-only capability discovery and simulators before real device writes.
- Router/OLT/ONT/firmware/routing mutations require explicit policy, blast-radius limits, audit, read-back verification and tested compensation/rollback.
- MikroTik RouterOS, Huawei MA5800 and ZTE C300 are initial validation targets, not universal compatibility assumptions.
- Production readiness requires hardware/lab acceptance beyond unit and simulator tests.

## Rejected

- ISP protocol servers implemented in Go.
- Network orchestration/vendor device commands implemented in Rust or TypeScript ORM plugins.
- A second ORM, shadow business database, or separate PaaS/container orchestrator.
- Per-packet synchronous RADIUS dependence on the Go control plane.
- Arbitrary CLI/shell strings accepted from UI/API.
- Production-ready claims based only on a planner, simulator, or HTTP 200.

## Rollout

1. Harden existing Rust RADIUS and make its clean build reproducible.
2. Establish versioned Go↔Rust contracts and add the ISP module to the existing Go control plane.
3. Move NAS/router/OLT/ONT commands, provisioning, reconciliation, health/HA and vendor adapters to Go.
4. Extend ORM-owned network inventory/IPAM and build FTTH workflows.
5. Add Rust DHCP/DNS/ACS/telemetry service runtimes under Go lifecycle/config control.
6. Complete BSS, billing, customer self-service, managed server products and full exact-SHA E2E proof.

The work is split into M19–M22 and atomic task issues. Existing PaaS, cloud, subscription, billing, helpdesk, jobs and observability capabilities are reused, not rebuilt.
