# MoonWitness MCP Server Catalog, Client Setup & A2A Decision (`DOC.6`, `AI5.29`–`AI5.33`, `DSK-0.11`)

- **Status:** Accepted Specification ([ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) D9, [ADR 0008](../architecture/adr/0008-local-first-desktop-agent-harness.md) §5)
- **Implementation:** [`packages/ai-runtime/src/mcp-server.ts`](../../packages/ai-runtime/src/mcp-server.ts), [`packages/ai-runtime/src/capability-gateway.ts`](../../packages/ai-runtime/src/capability-gateway.ts), [`apps/desktop/src/mcp-host.ts`](../../apps/desktop/src/mcp-host.ts)
- **Related documents:** [AI Corporation Docs Index](README.md) · [Threat Model](threat-model.md) · [Desktop Local-First Harness](../architecture/desktop-local-first-harness.md)

---

## 1. MCP Architecture & Security Invariants (`AI5.1`–`AI5.28`)

MoonWitness implements the Model Context Control protocol (`MCP_PROTOCOL_VERSION = '2025-03-26'`, compatible with stateless JSON-RPC 2.0 request/response framing) via `McpServerHandler`:

1. **No Direct Database Access (`AI5.2`):** MCP handlers never query Knex/Objection tables directly. Every tool delegates to `MoonWitnessDomainServices` through `CapabilityGateway`.
2. **Execution-Time Grant & Company Re-Check (`AI5.3`–`AI5.5`, `AI5.18`):** Every `initialize`, `tools/list`, and `tools/call` request authenticates an `McpPrincipal` (`actorType`, `actorId`, `companyId`, `policyVersion`, `tokenExpiresAt`, `revoked`). Cross-company requests (`args.companyId !== principal.companyId`), unauthenticated calls, expired tokens, and revoked grants are deterministically rejected and logged in `McpCallAuditEntry[]`.
3. **Untrusted Output Envelopes & Redaction (`AI5.6`, `AI5.20`):** All `tools/call` responses are scrubbed by `createRedactor()` and wrapped in `{ untrustedData: true, auditRef, idempotentReplay, data }` so downstream prompts treat tool outputs strictly as untrusted data.

---

## 2. Registered MCP Tool Catalog & Permission Matrix (`DOC.6`, `AI5.29`)

Registered via `registerMoonWitnessMcpTools(gateway, services)` in [`packages/ai-runtime/src/mcp-server.ts`](../../packages/ai-runtime/src/mcp-server.ts):

| Tool Name                      | Version | Required Capability (`ai.capability_grant`) | Owner Addon     | Side Effect        | Risk Tier | Data Classification | Idempotent                      | Description & Scope                                                                                                                                             |
| ------------------------------ | ------: | ------------------------------------------- | --------------- | ------------------ | --------- | ------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mw_agent_registry_read`       |     `1` | `agent.registry_read@v1`                    | `orm-ai`        | `read_only`        | `R0`      | `local_only`        | Yes                             | Reads a single company-scoped `ai.agent` + `ai.agent_profile` by `agentCode`                                                                                    |
| `mw_work_contract_read`        |     `1` | `work.contract_read@v1`                     | `orm-ai`        | `read_only`        | `R0`      | `local_only`        | Yes                             | Reads an assigned `ai.work_contract` and its locked `ai.acceptance_criterion[]` within `companyId`                                                              |
| `mw_knowledge_approved_read`   |     `1` | `knowledge.approved_read@v1`                | `orm-knowledge` | `read_only`        | `R0`      | `local_only`        | Yes                             | Queries approved K0–K9 publications and active research graph releases via read-only projections                                                                |
| `mw_evidence_ref_read`         |     `1` | `evidence.ref_read@v1`                      | `orm-storage`   | `read_only`        | `R0`      | `local_only`        | Yes                             | Resolves company-scoped `ai.artifact_manifest` metadata (`storage_key`, `sha256`, `verification_status`)                                                        |
| `mw_work_contract_append_note` |     `1` | `work.note_append@v1`                       | `orm-ai`        | `reversible_write` | `R1`      | `local_only`        | Yes (`idempotencyKey` required) | Appends an idempotent progress note to an assigned work contract via domain service (replayed `idempotencyKey` returns cached outcome without duplicate writes) |

---

## 3. Local Development MCP Client Configuration (Zero Secrets, `AI5.21`)

Configure a local MCP client or `apps/desktop` `LocalMcpServerConfig` using environment variable references only—**never commit bearer tokens or API keys**:

```json
{
  "mcpServers": {
    "moonwitness-local": {
      "transport": "stdio",
      "command": "node",
      "args": ["./packages/ai-mcp/dist/cli.js", "--stdio"],
      "env": {
        "MW_API_BASE_URL": "http://127.0.0.1:3000",
        "MW_MCP_AUTH_TOKEN_REF": "MW_AI_C1_MCP_SERVICE_TOKEN"
      }
    }
  }
}
```

For `apps/desktop` (`LocalMcpServerConfig` in [`apps/desktop/src/types.ts`](../../apps/desktop/src/types.ts)):

```json
{
  "serverId": "mw-domain-stdio",
  "name": "MoonWitness Domain MCP Gateway",
  "transport": "stdio",
  "command": "node",
  "args": ["./packages/ai-mcp/dist/cli.js"],
  "requiredCapability": "work.contract_read@v1",
  "maxRiskTier": "R1",
  "allowedDataClassifications": ["local_only", "restricted"],
  "maxCallsPerRun": 25,
  "timeoutMs": 10000,
  "enabled": true
}
```

---

## 4. A2A (Agent-to-Agent) Peer Federation

### 4.1 Current architecture and enablement boundary

[ADR 0009](../decisions/0009-a2a-mesh-federation.md) is accepted. The protocol foundation lives in `@moonwitness/ai-runtime`; `apps/desktop` contains the outbound `A2AMeshClient`; and `apps/control-plane` exposes a private-mesh `POST /a2a/delegate` handler. The API has a separate durable inbox receiver at `POST /a2a/delegate`, provided by the addon-first workspace package `@moonwitness/orm-a2a` and disabled by default.

For a durable API receipt, the sender's `targetEndpoint` must be the private-mesh origin of the **API receiver**, not the Control Plane listener. The desktop client appends `/a2a/delegate` when the target URL has no path. Configure the API receiver using `MW_A2A_API_ENABLED`, `MW_A2A_SIGNING_SECRET`, `MW_A2A_COMPANY_ID`, and `MW_A2A_API_ENDPOINT`; see [A2A Peer Federation Operations](a2a-peer-federation.md).

The API receiver enforces:

- HMAC-SHA256 envelope verification using the company-scoped secret, the `a2a.v1` protocol version, bounded TTL, and the ADR 0009 private mesh address ranges.
- A direct socket peer check: `sourceEndpoint` must match the remote IP observed by the API. Forwarded headers are not used as peer identity.
- Exact configured-company scope and active source/target `ai.agent` records; no cross-company delegation.
- Persistent replay protection for live nonce windows, message-ID de-duplication, and monotonic fencing per source agent. The receipt and fence advance are written transactionally to the append-only `base.audit_log`.
- Redaction of the stored payload and no storage of the envelope signature or signing secret.

### 4.2 What a successful receipt means

HTTP `202` with status `queued` means **the signed message was durably recorded in the API inbox**. It does not mean a worker executed it, an `ai.work_contract` was created, artifacts were verified, or work was accepted. The company-scoped inbox read endpoint is `GET /api/ai/a2a/inbox` and requires a company superadmin/system role.

The current Control Plane endpoint still has its own in-memory replay/fencing cache and returns a local queued receipt. It is not yet a durable forwarding adapter to the API inbox. A sender targeting the Control Plane port therefore must not interpret that acknowledgement as an API-persisted inbox item.

### 4.3 Security limitations and release gate

- `MW_A2A_API_ENABLED=false` is the default and must remain so until operators configure a direct private-mesh API listener, a company-specific secret, and the expected company/endpoint values.
- The current A2A signature uses a shared HMAC secret. It is a trust boundary for peers holding that secret, not per-agent cryptographic attestation or a substitute for mTLS/key pinning.
- The API receiver persists proposals only. It does not dispatch peer work, accept artifacts, or change a work contract to `accepted`. Server-side PCW verification and independent workflow approval remain authoritative.
- Multi-organization federation, public endpoints, and live autonomous dispatch remain disabled until per-peer identity/attestation, mTLS or key pinning, cancellation propagation, and a durable dispatch/consumer path have separate acceptance evidence.

### 4.4 ADR and desktop-harness references

- **ADR 0007:** [AI Corporation Addon-First Architecture](../decisions/0007-ai-corporation-addon-first-architecture.md) remains authoritative for domain ownership, tenant isolation, and server-only acceptance.
- **ADR 0008:** [Local-First Desktop Agent Harness](../architecture/adr/0008-local-first-desktop-agent-harness.md) governs local execution and synchronization.
- **ADR 0009:** [Stateless A2A Agent Federation over Private EasyTier P2P Mesh](../decisions/0009-a2a-mesh-federation.md) governs the peer protocol and transport boundary.
