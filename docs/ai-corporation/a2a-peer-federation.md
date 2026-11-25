# A2A Peer Federation — API Durable Inbox

**Status:** Experimental backend receiver; disabled by default.  
**Milestone:** M14.03  
**Protocol:** `a2a.v1`  
**Primary decision:** [ADR 0009](../decisions/0009-a2a-mesh-federation.md)

## Purpose

The addon-first `@moonwitness/orm-a2a` package exposes the API receiver. It accepts a signed A2A envelope from a private EasyTier mesh peer and persists an inbox receipt under the configured MoonWitness company. It is intentionally an inbox boundary, not an execution engine.

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

The sender's `targetEndpoint` must identify this API origin; a bare private IP is normalized to `http://` for the default HTTP port. The API derives the source IP from the raw socket and requires it to be private. If the optional signed `sourceEndpoint` is supplied, its host must match that observed IP. Forwarded headers are deliberately ignored; terminate any reverse proxy outside this trust boundary or provide a direct private-mesh listener.

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
- The Control Plane `/a2a/delegate` handler is now a thin forwarding adapter to this API receiver; it keeps no replay/fencing authority of its own (see [Control Plane forwarding](#control-plane-forwarding-boundary)).
- The shared HMAC secret still defines the envelope trust domain. Per-agent identity and transport authentication are now enforced by the Control Plane forwarder through registered key identities and verified mesh peer certificates (CF-017/CF-018). The API receiver must apply the same registered-peer mapping before multi-organization or live autonomous dispatch.

## Control Plane forwarding boundary

`apps/control-plane/a2a.go` no longer accepts, persists or advances authoritative replay/fencing state. It verifies the signed envelope locally, verifies the transport peer identity, then forwards the **original raw body** and protocol headers to `POST /a2a/delegate` on a configured private-mesh API origin. The API/ORM receiver remains the single durable authority for nonce replay, fencing monotonicity, de-duplication and receipts.

```dotenv
MW_A2A_FORWARD_ORIGIN=http://100.64.0.20:3000          # required; private mesh IP literal only
MW_A2A_FORWARD_TIMEOUT_MS=5000                          # bounded 100..30000, default 5000
MW_A2A_FORWARD_MAX_ATTEMPTS=2                           # bounded 1..2, default 2
MW_A2A_PEER_REGISTRY_JSON='[{"peerId":"peer-alpha","agentId":"agent-alpha","companyId":42,"keyId":"key-2026-01","spkiSha256":"<hex>"}]'
MW_A2A_PEER_CA_PEM='-----BEGIN CERTIFICATE-----\n...'    # inline PEM, or use MW_A2A_PEER_CA_FILE
MW_A2A_MTLS_CERT_FILE=/etc/mw/tls/control-plane.crt      # optional; enables mTLS termination
MW_A2A_MTLS_KEY_FILE=/etc/mw/tls/control-plane.key
```

Fail-closed defaults: with no peer CA or empty registry every A2A request is rejected during peer verification; if a registered peer is verified but no `MW_A2A_FORWARD_ORIGIN` is configured, the forwarder returns `503 FORWARD_NOT_CONFIGURED`. The target origin must be an `http(s)` origin with a canonical private mesh IP literal, no credentials, path, query or fragment. Redirects are never followed (`502 UPSTREAM_REDIRECT_REJECTED`), ambient HTTP proxies are ignored, and the dialer re-checks that the resolved address is a private mesh IP. Retries are bounded to at most two attempts and only for transient upstream responses (`408`, `429`, `502`, `503`, `504`) or connection errors; `4xx` responses such as `REPLAY_NONCE_DETECTED` are never retried. Duplicate receipts are prevented by the API receiver's durable nonce/message-ID de-duplication; the Control Plane never fabricates a `queued` receipt unless the upstream returned `202` with a matching receipt.

Forwarded headers `Authorization`, `X-Forwarded-*`, `X-Real-IP`, `X-Client-Cert` and similar identity headers are stripped. `Content-Type`, `X-A2A-Protocol: a2a.v1` and an optional `X-A2A-Key-ID` are preserved byte-for-byte. Error responses are `{ "error": <safe message>, "reasonCode": <allowlisted code> }`; envelope bodies, signatures, secrets and upstream error text are never logged or returned.

## Transport peer identity contract (CF-017 / CF-018, Go side)

A signed envelope alone is not sufficient at the Control Plane. Every request must present a verified client certificate on a TLS connection (`tls.RequireAndVerifyClientCert` when mTLS termination is configured), chaining to `MW_A2A_PEER_CA_PEM`/`MW_A2A_PEER_CA_FILE`, currently valid, and with a SubjectPublicKeyInfo SHA-256 pin present in `MW_A2A_PEER_REGISTRY_JSON`. The registration's `agentId` and `companyId` must match the envelope's `sourceAgentId`/`companyId`; if `X-A2A-Key-ID` is present it must equal the registration's `keyId`. Missing, expired, untrusted and mismatched certificates produce `401 PEER_CERT_MISSING`, `401 PEER_CERT_EXPIRED`, `401 PEER_CERT_UNTRUSTED` or `403 PEER_IDENTITY_MISMATCH` / `403 PEER_KEY_MISMATCH`. Proxy/forwarded headers can never substitute for the verified certificate. Rotation uses a bounded overlap: configure both the old and new registrations (with a CA pool containing both issuers) until the old key is retired, then remove the old registration or CA to revoke it deterministically; Go tests cover the overlap and the post-revocation rejection. The canonical TS peer registry owns activation/grace/revocation state for the API receiver.

**TS side contract (owned by OMN-A2A in `packages/orm-a2a`):** publish one canonical peer registry (key ID, peer/agent binding, company, activation/grace/revocation, SPKI pin or equivalent attestation) and expose the same resolver to the API receiver. When the caller is a registered Control Plane forwarder, the API receiver must map the authenticated transport identity of the forwarder to the registered peer instead of using the raw socket IP for the `sourceEndpoint` binding check; it must continue to ignore `X-Forwarded-*` headers. The API receiver remains authoritative for replay, fencing and receipts.

## Canonical private mesh CIDR mirror

Go declares one canonical mirror of the TypeScript `PRIVATE_MESH_CIDRS` export from `packages/ai-runtime/src/a2a-protocol.ts`:

```
10.0.0.0/8, 100.64.0.0/10, 172.16.0.0/12, 192.168.0.0/16, fd00::/8
```

`IsPrivateMeshIP` in `a2a.go` parses that single declaration and is used by both A2A admission (`IsPrivateMeshHost`) and the git deploy SSRF filter (`isBlockedGitHost` in `gitbuilder.go`). Go parity tests assert the exact list and that both validators agree on representative addresses. The TypeScript export must remain the authoritative source; any change requires updating the Go mirror and its parity test together.

## Control Plane route matrix

The explicit route matrix lives in `apps/control-plane/main.go` (`controlPlaneRouteMatrix`) and is the single registration source for `buildMux`:

| Access        | Routes                                                                                                                                                                                                                       | Credential                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| public        | `GET /health`                                                                                                                                                                                                                | none; bounded `{status, database.status, docker}` only, no error text                           |
| authenticated | `/mesh/status`, `/services`, `/services/`, `/api/services`, `/api/services/`, `/api/deployments`, `/api/deployments/`, `/paas/node/metrics`, `/paas/apps`, `/paas/backups`, `/paas/cluster/nodes`, `/paas/cluster/ha/status` | canonical admin Bearer token (or `X-Control-Plane-Token` for `/paas/*`)                         |
| privileged    | `/deploy`, `/api/deploy`, `/api/containers/`, `/paas/apps/deploy`, `/paas/apps/`, `/paas/backups/postgres`, `/paas/backups/restore`, `/paas/cluster/nodes/join`, `/paas/apps/deploy-git`, `/paas/apps/preview`               | canonical admin token only, plus explicit method gate; raw `MW_INTERNAL_SECRET` is not accepted |
| A2A peer      | `POST /a2a/delegate`                                                                                                                                                                                                         | signed envelope + registered mTLS peer identity                                                 |
| provider HMAC | `POST /paas/webhooks/github/`                                                                                                                                                                                                | GitHub `X-Hub-Signature-256`                                                                    |

The token consumer matches `resolveControlPlaneToken` in `packages/orm-cloud/src/auth.ts`: explicit `MW_CONTROL_PLANE_TOKEN`, otherwise `HMAC-SHA256(MW_INTERNAL_SECRET || JWT_SECRET, "moonwitness-control-plane-admin-v1")`. The domain label is the service audience; tokens derived for another audience are rejected. Missing, malformed, whitespace-padded, wrong-audience and rotated-out tokens are rejected with a generic `401` that never echoes the credential. The derived token has no embedded expiry; expiry is rotation of the backing secret, which invalidates all previously derived tokens immediately. When neither secret is configured, the Go service falls back to a locally generated `.admin-token`; TS callers in that mode must set `MW_CONTROL_PLANE_TOKEN` to the same value. Health exposes only fixed status values and no provider, container, configuration or credential data.

## Verification

The API route tests cover disabled-by-default behavior, signed receipt persistence, nonce replay, duplicate message IDs, stale fencing, direct peer-IP binding, public peer rejection, cross-company rejection, server-only acceptance, and authenticated inbox reads.

Run:

```sh
pnpm --filter @moonwitness/api exec vitest run tests/a2a.routes.test.ts
pnpm --filter @moonwitness/api build
pnpm api:addon:check
cd apps/control-plane && go test ./... && go vet ./...
```

Go tests cover forwarding success (byte-identical envelope and headers), timeout, rejected origin and redirect, upstream rejection, bounded retry with no duplicate receipts, no local replay authority, peer certificate missing/expired/untrusted/mismatched, forwarded-header spoofing rejection, route-family auth failures, and CIDR parity.
