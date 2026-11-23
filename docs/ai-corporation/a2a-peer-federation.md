# A2A Peer Federation — API Durable Inbox

**Status:** Experimental backend receiver; disabled by default.  
**Milestone:** M14.03  
**Protocol:** `a2a.v1`  
**Primary decision:** [ADR 0009](../decisions/0009-a2a-mesh-federation.md)

## Purpose

The API receiver accepts a signed A2A envelope from a private EasyTier mesh peer and persists an inbox receipt under the configured MoonWitness company. It is intentionally an inbox boundary, not an execution engine.

The endpoint matches the current Desktop client wire contract:

- `POST /a2a/delegate`
- Header: `X-A2A-Protocol: a2a.v1`
- Body: the signed `SignedA2AEnvelope` JSON object directly
- Success: HTTP `202` and a receipt containing `status`, `messageId`, `companyId`, `delegationDepth`, `fencingToken`, and `receivedAt`

A `queued` response means only that the API wrote the envelope metadata/payload to the durable inbox. It does not mean the remote task ran.

## Configuration

The receiver is disabled unless `MW_A2A_API_ENABLED=true`. Enable it only when the API is directly reachable on a private EasyTier mesh interface.

```dotenv
MW_A2A_API_ENABLED=true
MW_A2A_SIGNING_SECRET=<company-specific random secret, 32+ characters>
MW_A2A_COMPANY_ID=<positive MoonWitness company ID>
MW_A2A_API_ENDPOINT=http://100.64.0.20:3000
```

The endpoint must be an HTTP(S) origin on an allowed private mesh IP; do not use a public DNS name, public IP, loopback, link-local address, URL credentials, or a path/query. Configure the same company-scoped signing secret on the sending peer. Never commit the secret.

The sender's `targetEndpoint` must identify this API origin. The API derives the source IP from the raw socket and requires it to match the host in the signed `sourceEndpoint`. Forwarded headers are deliberately ignored; terminate any reverse proxy outside this trust boundary or provide a direct private-mesh listener.

## Persistence and validation

The receiver reuses existing authoritative models; it adds no shadow database or new ORM schema:

1. Verify protocol version, signature, company, private source/target endpoints, delegation depth, classification, TTL, nonce, and the ban on peer-claimed `accepted` status using `@moonwitness/ai-runtime`.
2. Resolve both agent codes against active `ai.agent` records in the configured company. Paused, emergency-stopped, missing, or cross-company agents are rejected.
3. Lock the configured company row and perform replay/fencing validation inside one database transaction, serializing concurrent API replicas for that company.
4. Append a receipt row to `base.audit_log` with model marker `ai.a2a_message` and a fencing snapshot with marker `ai.a2a_fencing`. Nonces are checked within the maximum envelope TTL plus allowed clock skew; fencing tokens remain monotonic per source-agent record.
5. Store a redacted payload and SHA-256 payload digest. The signature and signing secret are not persisted.

The company-scoped operations inbox is `GET /api/ai/a2a/inbox?limit=50`. It requires authenticated company context and a `superadmin` or `system` role.

## Safety boundary

- `local_only` and `restricted` data must remain inside the private mesh; the protocol rejects public target endpoints for all classifications.
- No peer can assert `accepted`. Only MoonWitness server-side Proof-Carrying Work verification and the canonical workflow may accept a work contract.
- This receiver does not create `ai.work_contract` or `ai.agent_run` rows, enqueue `base.job`, run remote commands, validate artifact contents, or forward the envelope to the Control Plane.
- The current Control Plane `/a2a/delegate` handler has its own in-memory replay/fencing cache. It is not yet a durable forwarding adapter to this API receiver. To use the durable inbox, configure Desktop's target endpoint to the API's private-mesh origin rather than the Control Plane's listener.
- HMAC currently defines a shared peer trust domain. Per-agent key pinning/attestation and API-side mTLS integration remain outstanding before multi-organization or live autonomous dispatch.

## Verification

The API route tests cover disabled-by-default behavior, signed receipt persistence, nonce replay, duplicate message IDs, stale fencing, direct peer-IP binding, public peer rejection, cross-company rejection, server-only acceptance, and authenticated inbox reads.

Run:

```sh
pnpm --filter @moonwitness/api exec vitest run tests/a2a.routes.test.ts
pnpm --filter @moonwitness/api build
pnpm api:addon:check
```
