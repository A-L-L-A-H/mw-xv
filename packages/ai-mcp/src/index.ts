import { createHash } from 'node:crypto';
import {
  isDbEmergencyStopped,
  redactObject,
  type EmergencyStopController,
} from '@moonwitness/ai-runtime';
import { isRecord, type JsonObject, type JsonValue } from '@moonwitness/types';

interface KnexQueryBuilderLike {
  where(filter: Record<string, unknown>): KnexQueryBuilderLike;
  select(...columns: string[]): Promise<Record<string, unknown>[]>;
  first(): Promise<Record<string, unknown> | undefined>;
  insert(values: Record<string, unknown>): Promise<unknown>;
}

type KnexLike = (tableName: string) => KnexQueryBuilderLike;

function isKnexLike(db: unknown): db is KnexLike {
  return typeof db === 'function';
}

export interface AiMcpAuthContext {
  readonly companyId?: number;
  readonly userId?: number | string;
  readonly agentId?: number | string;
  readonly actorRole?: string;
  readonly role?: string;
  readonly grantId?: number | string;
  readonly grants?: readonly string[];
  readonly revoked?: boolean;
  readonly expiresAt?: string;
}

export interface AiMcpRequest {
  readonly jsonrpc?: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly auth?: AiMcpAuthContext | null;
}

export interface AiMcpResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly status?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: JsonValue;
  };
}

export interface AiMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly riskTier: 'R0' | 'R1';
  readonly readOnly: boolean;
  readonly idempotent: boolean;
  readonly requiredCapability: string;
}

export const AI_MCP_TOOLS: readonly AiMcpToolDescriptor[] = [
  {
    name: 'ai.get_agent_registry',
    description: 'Read company-scoped AI agent registry via @moonwitness/orm-ai domain service.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'agent.registry_read@v1',
  },
  {
    name: 'ai.get_agent',
    description: 'Read a single company-scoped AI agent profile.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'agent.registry_read@v1',
  },
  {
    name: 'ai.list_work',
    description: 'List assigned company-scoped work contracts.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'work.contract_read@v1',
  },
  {
    name: 'ai.work_contract.read',
    description: 'Read a company-scoped work contract and acceptance criteria.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'work.contract_read@v1',
  },
  {
    name: 'knowledge.search_approved',
    description: 'Search approved K0-K9 knowledge records with strict provenance gates.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'knowledge.approved_read@v1',
  },
  {
    name: 'knowledge.publications.list',
    description:
      'List approved K0-K9 publications strictly isolated from workforce memory candidates.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'knowledge.approved_read@v1',
  },
  {
    name: 'ai.submit_work_draft',
    description: 'Submit an idempotent scoped work draft note through the domain service.',
    riskTier: 'R1',
    readOnly: false,
    idempotent: true,
    requiredCapability: 'ai.draft.write@v1',
  },
  {
    name: 'ai.work_note.submit',
    description: 'Submit an idempotent work contract note gated by active capability grant.',
    riskTier: 'R1',
    readOnly: false,
    idempotent: true,
    requiredCapability: 'ai.work_note_write@v1',
  },
];

const KNOWN_TOOL_NAMES = new Set(AI_MCP_TOOLS.map((t) => t.name));

const MALICIOUS_ARG_PATTERN =
  /(?:\.\.[/\\]|%2e%2e|(?:^|[/\\])\.env\b|;\s*drop\s+table\b|\bunion\s+select\b|--)/iu;

function hasMaliciousArgument(value: unknown): boolean {
  if (typeof value === 'string') {
    return MALICIOUS_ARG_PATTERN.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(hasMaliciousArgument);
  }
  if (isRecord(value)) {
    return Object.values(value).some(hasMaliciousArgument);
  }
  return false;
}

async function recordDbAuditLog(
  db: unknown,
  entry: {
    readonly model: string;
    readonly recordId: number;
    readonly operation: string;
    readonly actorId?: number | null;
    readonly changes: Record<string, unknown>;
  }
): Promise<void> {
  if (!isKnexLike(db)) return;
  try {
    await db('audit_logs').insert({
      model: entry.model,
      record_id: entry.recordId,
      operation: entry.operation,
      actor_id: entry.actorId ?? null,
      changes: JSON.stringify(entry.changes),
    });
  } catch {
    // audit_logs optional when running without full orm-base schema
  }
}

export interface AiMcpServerOptions {
  readonly db?: unknown;
  readonly emergencyStopController?: EmergencyStopController;
}

export interface AiMcpServer {
  handleRequest(
    request: AiMcpRequest,
    authContext?: AiMcpAuthContext | null
  ): Promise<AiMcpResponse>;
  healthCheck(): Promise<{
    readonly ok: boolean;
    readonly state: 'running' | 'closed';
    readonly toolsCount: number;
  }>;
  close(): Promise<void>;
}

export function createAiMcpServer(options: AiMcpServerOptions = {}): AiMcpServer {
  let state: 'running' | 'closed' = 'running';
  const idempotencyStore = new Map<
    string,
    { readonly payloadHash: string; readonly result: Record<string, unknown> }
  >();

  return {
    async healthCheck() {
      return {
        ok: state === 'running',
        state,
        toolsCount: AI_MCP_TOOLS.length,
      };
    },

    async close() {
      state = 'closed';
    },

    async handleRequest(
      request: AiMcpRequest,
      authContext?: AiMcpAuthContext | null
    ): Promise<AiMcpResponse> {
      const id = request.id ?? null;

      if (state !== 'running') {
        return {
          jsonrpc: '2.0',
          id,
          status: 503,
          error: { code: -32002, message: 'MCP server is closed' },
        };
      }

      if (request.method === 'initialize') {
        const requestedProtocol =
          isRecord(request.params) && typeof request.params.protocolVersion === 'string'
            ? request.params.protocolVersion
            : '2025-03-26';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: requestedProtocol,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: '@moonwitness/ai-mcp', version: '1.0.0-rc.1' },
          },
        };
      }

      if (request.method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }

      const auth = authContext !== undefined ? authContext : request.auth;

      if (request.method === 'tools/list') {
        if (auth === null || (auth && auth.revoked)) {
          return {
            jsonrpc: '2.0',
            id,
            status: 401,
            error: { code: -32001, message: 'Unauthenticated or revoked MCP session' },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: AI_MCP_TOOLS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              riskTier: tool.riskTier,
              readOnly: tool.readOnly,
              idempotent: tool.idempotent,
              requiredCapability: tool.requiredCapability,
            })),
          },
        };
      }

      if (request.method === 'tools/call') {
        const params = isRecord(request.params) ? request.params : {};
        const toolName = typeof params.name === 'string' ? params.name : '';
        const rawArgs = isRecord(params.arguments) ? (params.arguments as JsonObject) : {};

        // 1. Auth validation (fail-closed)
        if (
          !auth ||
          typeof auth.companyId !== 'number' ||
          auth.companyId <= 0 ||
          auth.revoked === true
        ) {
          await recordDbAuditLog(options.db, {
            model: 'ai.mcp',
            recordId: 0,
            operation: 'mcp_unauthenticated',
            changes: { toolName },
          });
          return {
            jsonrpc: '2.0',
            id,
            status: 401,
            error: { code: -32001, message: 'Unauthenticated or revoked MCP credential' },
          };
        }

        if (auth.expiresAt !== undefined) {
          const expiresMs = Date.parse(auth.expiresAt);
          if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
            return {
              jsonrpc: '2.0',
              id,
              status: 401,
              error: { code: -32001, message: 'MCP credential has expired' },
            };
          }
        }

        const companyId = auth.companyId;
        const actorUserId = typeof auth.userId === 'number' ? auth.userId : null;

        // 2. Emergency stop check (instance controller + DB-scoped controller)
        const instanceStop = options.emergencyStopController?.checkStopped({
          companyId,
          agentId: auth.agentId,
        });
        const dbStop = isDbEmergencyStopped(options.db, {
          companyId,
          agentId: auth.agentId,
        });
        if (instanceStop?.stopped || dbStop.stopped) {
          await recordDbAuditLog(options.db, {
            model: 'ai.mcp',
            recordId: companyId,
            operation: 'mcp_emergency_stop_blocked',
            actorId: actorUserId,
            changes: { toolName, reason: instanceStop?.record?.reason ?? dbStop.record?.reason },
          });
          return {
            jsonrpc: '2.0',
            id,
            status: 403,
            error: { code: -32003, message: 'Emergency stop is active for company' },
          };
        }

        // 3. Reject unapproved A2A delegation or unknown tools
        if (toolName.startsWith('a2a.') || !KNOWN_TOOL_NAMES.has(toolName)) {
          await recordDbAuditLog(options.db, {
            model: 'ai.mcp',
            recordId: companyId,
            operation: 'mcp_tool_denied',
            actorId: actorUserId,
            changes: { toolName, reason: 'unapproved_tool_or_a2a' },
          });
          return {
            jsonrpc: '2.0',
            id,
            status: 403,
            error: {
              code: -32003,
              message: `Unapproved A2A or unknown MCP tool "${toolName}" rejected`,
            },
          };
        }

        // 4. Reject oversized or injection/traversal arguments
        const serializedArgs = JSON.stringify(rawArgs);
        if (Buffer.byteLength(serializedArgs, 'utf8') > 32_768 || hasMaliciousArgument(rawArgs)) {
          await recordDbAuditLog(options.db, {
            model: 'ai.mcp',
            recordId: companyId,
            operation: 'mcp_argument_rejected',
            actorId: actorUserId,
            changes: { toolName, reason: 'injection_or_traversal' },
          });
          return {
            jsonrpc: '2.0',
            id,
            status: 400,
            error: {
              code: -32602,
              message: 'MCP tool arguments failed traversal/injection or size validation',
            },
          };
        }

        // 5. Reject cross-company parameter override
        if (typeof rawArgs.companyId === 'number' && rawArgs.companyId !== companyId) {
          await recordDbAuditLog(options.db, {
            model: 'ai.mcp',
            recordId: companyId,
            operation: 'mcp_cross_company_denied',
            actorId: actorUserId,
            changes: { toolName, requestedCompanyId: rawArgs.companyId },
          });
          return {
            jsonrpc: '2.0',
            id,
            status: 403,
            error: { code: -32003, message: 'Cross-company MCP access denied' },
          };
        }

        // 6. Execution-time capability grant recheck against DB when grantId is present
        if (auth.grantId !== undefined && isKnexLike(options.db)) {
          const grantRow = await options
            .db('ai_capability_grants')
            .where({ id: auth.grantId })
            .first();
          const nowMs = Date.now();
          const expMs = grantRow?.expires_at ? Date.parse(String(grantRow.expires_at)) : 0;
          if (
            !grantRow ||
            grantRow.company_id !== companyId ||
            grantRow.status !== 'active' ||
            Boolean(grantRow.revoked_at) ||
            !Number.isFinite(expMs) ||
            expMs <= nowMs
          ) {
            await recordDbAuditLog(options.db, {
              model: 'ai.capability_grant',
              recordId: Number(auth.grantId) || 0,
              operation: 'mcp_grant_revoked_or_expired',
              actorId: actorUserId,
              changes: { toolName, grantId: auth.grantId, status: grantRow?.status ?? 'missing' },
            });
            return {
              jsonrpc: '2.0',
              id,
              status: 403,
              error: {
                code: -32003,
                message: 'Capability grant is revoked, expired, or invalid at execution time',
              },
            };
          }
        }

        // 7. Dispatch specific tools
        if (toolName === 'ai.get_agent_registry' || toolName === 'ai.get_agent') {
          let agents: Record<string, unknown>[] = [];
          if (isKnexLike(options.db)) {
            try {
              agents = await options.db('ai_agents').where({ company_id: companyId }).select('*');
            } catch {
              agents = [];
            }
          }
          return {
            jsonrpc: '2.0',
            id,
            result: redactObject({
              companyId,
              agents,
            }),
          };
        }

        if (toolName === 'ai.work_contract.read' || toolName === 'ai.list_work') {
          if (rawArgs.contractId !== undefined && isKnexLike(options.db)) {
            const contract = await options
              .db('ai_work_contracts')
              .where({ id: rawArgs.contractId })
              .first();
            if (!contract || contract.company_id !== companyId) {
              await recordDbAuditLog(options.db, {
                model: 'ai.work_contract',
                recordId: Number(rawArgs.contractId) || 0,
                operation: 'mcp_cross_company_denied',
                actorId: actorUserId,
                changes: { toolName, contractId: rawArgs.contractId },
              });
              return {
                jsonrpc: '2.0',
                id,
                status: 403,
                error: {
                  code: -32003,
                  message: 'Work contract not found or belongs to another company',
                },
              };
            }
            return {
              jsonrpc: '2.0',
              id,
              result: redactObject({ companyId, contract }),
            };
          }

          let contracts: Record<string, unknown>[] = [];
          if (isKnexLike(options.db)) {
            try {
              contracts = await options
                .db('ai_work_contracts')
                .where({ company_id: companyId })
                .select('*');
            } catch {
              contracts = [];
            }
          }
          return {
            jsonrpc: '2.0',
            id,
            result: redactObject({ companyId, contracts }),
          };
        }

        if (
          toolName === 'knowledge.search_approved' ||
          toolName === 'knowledge.publications.list'
        ) {
          // Strictly reads K0-K9 approved publications only — never ai_memory_candidates!
          let publications: Record<string, unknown>[] = [];
          if (isKnexLike(options.db)) {
            try {
              publications = await options
                .db('knowledge_publications')
                .where({ status: 'approved' })
                .select('*');
            } catch {
              publications = [];
            }
          }
          return {
            jsonrpc: '2.0',
            id,
            result: redactObject({
              companyId,
              source: 'orm-knowledge',
              query: typeof rawArgs.query === 'string' ? rawArgs.query : '',
              publications,
            }),
          };
        }

        if (toolName === 'ai.submit_work_draft' || toolName === 'ai.work_note.submit') {
          const idempotencyKey =
            typeof rawArgs.idempotencyKey === 'string'
              ? rawArgs.idempotencyKey
              : typeof rawArgs.idempotency_key === 'string'
                ? rawArgs.idempotency_key
                : '';
          if (!idempotencyKey.trim()) {
            return {
              jsonrpc: '2.0',
              id,
              status: 400,
              error: {
                code: -32602,
                message: 'Scoped write tool requires a non-empty idempotencyKey',
              },
            };
          }

          if (auth.grants && auth.grants.length > 0) {
            const hasWriteGrant = auth.grants.some(
              (g) =>
                g === 'ai.draft.write@v1' ||
                g === 'ai.work_note_write@v1' ||
                g === 'ai.work_note.write@v1'
            );
            if (!hasWriteGrant) {
              return {
                jsonrpc: '2.0',
                id,
                status: 403,
                error: { code: -32003, message: 'Missing required write capability grant' },
              };
            }
          }

          const payloadForHash = {
            summary: rawArgs.summary ?? '',
            note: rawArgs.note ?? '',
            contractId: rawArgs.contractId ?? null,
          };
          const payloadHash = createHash('sha256')
            .update(JSON.stringify(payloadForHash))
            .digest('hex');
          const cacheKey = `${companyId}:${toolName}:${idempotencyKey}`;
          const existing = idempotencyStore.get(cacheKey);

          if (existing) {
            if (existing.payloadHash !== payloadHash) {
              return {
                jsonrpc: '2.0',
                id,
                status: 409,
                error: {
                  code: -32009,
                  message: 'Conflicting payload for existing idempotency key',
                },
              };
            }
            return {
              jsonrpc: '2.0',
              id,
              result: existing.result,
            };
          }

          const outcome = redactObject({
            status: 'submitted',
            companyId,
            idempotencyKey,
            summary: String(rawArgs.summary ?? rawArgs.note ?? ''),
            auditRef: `mcp_write_${companyId}_${idempotencyKey}`,
          });
          idempotencyStore.set(cacheKey, { payloadHash, result: outcome });
          await recordDbAuditLog(options.db, {
            model: 'ai.work_contract',
            recordId: Number(rawArgs.contractId) || 0,
            operation: 'mcp_submit_work_draft',
            actorId: actorUserId,
            changes: { toolName, idempotencyKey },
          });

          return {
            jsonrpc: '2.0',
            id,
            result: outcome,
          };
        }
      }

      return {
        jsonrpc: '2.0',
        id,
        status: 404,
        error: { code: -32601, message: `Unsupported MCP method "${request.method}"` },
      };
    },
  };
}

export const createMcpServer = createAiMcpServer;
export const createMcpHandler = createAiMcpServer;
