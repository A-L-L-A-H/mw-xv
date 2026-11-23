# ADR 0009: Stateless A2A Agent Federation over Private EasyTier P2P Mesh

- **Status:** Accepted (2026-11-23; autonomous approval under repository unconditional-autonomy governance)
- **Date:** 2026-11-23
- **Decision owners:** MoonWitness maintainers
- **Scope:** `@moonwitness/ai-runtime`, `@moonwitness/orm-ai`, `apps/api`
- **Related tasks:** `M12.06`, `M14.03`
- **Related decisions and policies:** [ADR 0001](0001-platform-contracts.md), [ADR 0006](0006-mandatory-addon-thin-api.md), [ADR 0007](0007-ai-corporation-addon-first-architecture.md)

## Context

[ADR 0007](0007-ai-corporation-addon-first-architecture.md) (Principle D9) established that MCP and any future Agent-to-Agent (A2A) peer protocol must remain stateless adapters and that A2A peer-agent federation requires its own dedicated ADR before enablement.

Federating autonomous MoonWitness agents across multiple compute nodes introduces severe security and consistency risks if exposed over public networks or allowed to bypass MoonWitness domain governance:

1. Exposing agent control or delegation endpoints on public interfaces expands the attack surface and invites SSRF, credential stuffing, and unauthorized lateral movement.
2. Unauthenticated or replayable peer messages allow forged delegations, stale worker fencing violations, and cross-tenant data leakage.
3. Unbounded peer-to-peer delegation chains can cause runaway recursion and budget exhaustion.
4. Allowing peer agents to self-assert `accepted` work-contract status would violate [ADR 0007](0007-ai-corporation-addon-first-architecture.md) Principle D6 (Proof-Carrying Work acceptance).

## Decision

### 1. Private EasyTier P2P Mesh Transport Only

All A2A peer-to-peer federation traffic MUST traverse a private EasyTier P2P mesh overlay. Public internet endpoints, DNS-resolved public hostnames, loopback/link-local escapes, and public admin ports are strictly prohibited.

- **Allowed private mesh CIDR ranges (fail-closed):**
  - `10.0.0.0/8` (RFC 1918)
  - `100.64.0.0/10` (RFC 6598 CGNAT / EasyTier default virtual subnet)
  - `172.16.0.0/12` (RFC 1918)
  - `192.168.0.0/16` (RFC 1918)
  - `fd00::/8` (RFC 4193 IPv6 Unique Local Addresses)
- **Zero public admin ports:** EasyTier mesh listeners and A2A federation endpoints bind exclusively to private mesh interface addresses. No A2A or mesh administration port may be published on `0.0.0.0` public interfaces or external ingress.

### 2. Cryptographic Signed Envelopes & Replay Protection

Every A2A delegation message is carried in a stateless signed envelope (`a2a.v1`) authenticated by HMAC-SHA256 (verified with constant-time `timingSafeEqual`) over a canonical payload, layered over mTLS when EasyTier peer certificates are enabled:

- **Monotonic `fencingToken`:** Every envelope carries a strictly increasing positive integer `fencingToken` derived from the `@moonwitness/jobs` lease/fencing authority. Receivers reject any envelope with `fencingToken <= lastSeenFencingToken`.
- **Bounded TTL expiry:** Envelopes carry `issuedAt` and `expiresAt` timestamps with a bounded TTL (`<= 300_000 ms`). Expired envelopes or envelopes with future clock skew beyond tolerance are rejected fail-closed.
- **Replay nonce:** Every envelope carries a cryptographically random `nonce` (at least 128 bits of entropy). Receivers track seen nonces within the TTL window and reject duplicates.
- **Secret redaction:** Signing secrets and sensitive payload fields are sanitized via `createRedactor()` before serialization, logging, or error emission.

### 3. Multi-Tenant Isolation, Depth Caps & Data Classification

- **Strict `companyId` isolation:** Every A2A envelope binds an explicit positive integer `companyId`. Cross-company delegation or `companyId` mismatch between sender, envelope, and receiver is rejected fail-closed.
- **Bounded delegation depth:** `delegationDepth` MUST be a non-negative integer `<= 3` (`MAX_A2A_DELEGATION_DEPTH = 3`). Callers cannot raise this constitutional ceiling.
- **Data classification enforcement:** Payloads classified as `restricted` or `local_only` MUST NEVER leave the private EasyTier mesh. Any attempt to route `restricted` or `local_only` payloads to a non-mesh or public endpoint is blocked fail-closed.

### 4. Stateless Adapter & Server-Only `accepted` Authority

- **Stateless protocol layer:** `@moonwitness/ai-runtime` implements the pure protocol primitives (`isPrivateMeshHost`, `validateA2ADelegationPolicy`, `createSignedA2AEnvelope`, `verifyA2AEnvelope`) in `packages/ai-runtime/src/a2a-protocol.ts` with zero direct filesystem, shell, or shadow database access.
- **Server-only `accepted` authority:** Peer agents may submit evidence proposals or intermediate execution reports, but **never** self-assert `accepted` status. Any inbound or outbound envelope carrying `claimedStatus: 'accepted'` is rejected fail-closed; only the canonical MoonWitness server workflow (`@moonwitness/orm-workflow` + PCW verifier) may transition a work contract to `accepted`.

## Consequences

- **Positive:** Enables horizontal multi-node agent federation over EasyTier without exposing public ports, preserves single-tenant `companyId` boundaries, prevents replay and split-brain stale-worker mutations via `fencingToken`, and upholds ADR 0007 D6/D9 invariants.
- **Costs / trade-offs:** Requires EasyTier mesh provisioning and shared HMAC/mTLS key rotation across participating nodes, plus nonce cache retention for the bounded TTL window.
- **Review triggers:** Revisit this ADR if cross-organization (multi-company) federation with explicit federated trust agreements or asymmetric Ed25519/mTLS-only envelope signatures are introduced in a future milestone.
