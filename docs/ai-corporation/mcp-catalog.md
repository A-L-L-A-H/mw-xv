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

## 4. A2A (Agent-to-Agent) Protocol Decision & ADR Reconciliation (`AI5.30`–`AI5.33`, `DSK-0.11`)

### 4.1 Architectural Determination (`AI5.30`–`AI5.32`)

Per [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) (D9 & §6.6):

1. **Internal Orchestration Uses `@moonwitness/orm-ai` + `@moonwitness/jobs`:** Within a MoonWitness company, multi-agent planning, parent/child `ai.work_contract` delegation, `ai.taskforce` / `ai.workforce_assignment`, and independent review are coordinated authoritatively through PostgreSQL / SQLite ORM transactions and `@moonwitness/jobs`—not peer-to-peer HTTP agent mesh calls.
2. **External Peer-Agent A2A Is Deferred & Disabled by Default in v1:** Cross-organization or external third-party agent delegation via the horizontal A2A protocol is **not** enabled in v1. Enabling external A2A delegation requires:
   - Mutually authenticated agent identity cards and cryptographic key pinning;
   - Cross-domain data-classification negotiation (`local_only` and `restricted` payloads must never cross external A2A peers);
   - Signed PCW evidence exchange (`sha256` artifact manifests + independent local verification before acceptance);
   - Spoofed-agent, replay, and cancellation-propagation conformance tests (`AI5.33`).

### 4.2 ADR Numbering Reconciliation (`DSK-0.11`)

- **`docs/decisions/0001`–`0007`:** Canonical platform and AI Corporation ADRs (`0007` = [ADR 0007: AI Corporation Addon-First Architecture](../decisions/0007-ai-corporation-addon-first-architecture.md)).
- **`docs/architecture/adr/0008-local-first-desktop-agent-harness.md`:** Authoritative ADR `0008` for the Local-First Desktop Agent Harness (`apps/desktop`).
- **A2A Protocol ADR Slot:** Recorded as a deferred decision in [ADR 0007](../decisions/0007-ai-corporation-addon-first-architecture.md) §6.6 and Section 4.1 above; if external A2A federation is proposed in a future release, it will be assigned the next sequential ADR number (`0009`) in [`docs/decisions/README.md`](../decisions/README.md).
