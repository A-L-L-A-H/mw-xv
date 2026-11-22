import type { JsonObject, JsonValue } from '@moonwitness/types';
import { isJsonObject, isRecord } from '@moonwitness/types';
import type { CapabilityGateway, TypedToolDefinition } from './capability-gateway.js';
import { createRedactor, type RedactionContext } from './redaction.js';
import type { Clock } from './types.js';
import { SYSTEM_CLOCK } from './types.js';

export const MCP_PROTOCOL_VERSION = '2025-03-26';

export interface McpPrincipal {
  readonly authenticated: boolean;
  readonly actorType: 'agent' | 'user';
  readonly actorId: number | string;
  readonly companyId: number;
  readonly runId?: string;
  readonly workContractId?: string;
  readonly policyVersion: number;
  readonly tokenExpiresAt?: string;
  readonly revoked?: boolean;
  readonly confirmationToken?: string;
}

export type McpAuthResolver = (
  authHeaderOrToken: string | undefined
) => Promise<McpPrincipal | null> | McpPrincipal | null;

export interface McpJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: JsonValue;
}

export interface McpJsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: JsonValue;
}

export interface McpJsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: JsonValue;
  readonly error?: McpJsonRpcError;
}

export interface McpServerHealthStatus {
  readonly ok: boolean;
  readonly state: 'stopped' | 'running';
  readonly startedAt?: string;
  readonly activeRequests: number;
  readonly registeredTools: number;
}

export interface McpCallAuditEntry {
  readonly timestamp: string;
  readonly method: string;
  readonly correlationId: string;
  readonly companyId?: number;
  readonly actorId?: number | string;
  readonly toolName?: string;
  readonly outcome: 'ok' | 'unauthenticated' | 'denied' | 'error';
  readonly reasonCode?: string;
  readonly auditRef?: string;
}

export interface McpServerHandlerOptions {
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly gateway: CapabilityGateway;
  readonly resolvePrincipal: McpAuthResolver;
  readonly redactor?: RedactionContext;
  readonly clock?: Clock;
}

function makeRpcError(
  id: string | number | null,
  code: number,
  message: string,
  redactor: RedactionContext,
  data?: JsonValue
): McpJsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message: redactor.redactString(message),
      ...(data !== undefined ? { data: redactor.redactObject(data) } : {}),
    },
  };
}

function formatToolDescription(tool: TypedToolDefinition): string {
  return `${tool.description} [owner=${tool.ownerAddon}; sideEffect=${tool.sideEffect}; riskTier=${tool.riskTier}; classification=${tool.dataClassification}]`;
}

export class McpServerHandler {
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly gateway: CapabilityGateway;
  private readonly resolvePrincipal: McpAuthResolver;
  private readonly redactor: RedactionContext;
  private readonly clock: Clock;
  private state: 'stopped' | 'running' = 'stopped';
  private startedAt?: string;
  private activeRequests = 0;
  private readonly mcpAuditLog: McpCallAuditEntry[] = [];

  constructor(options: McpServerHandlerOptions) {
    this.serverName = options.serverName ?? '@moonwitness/ai-mcp-gateway';
    this.serverVersion = options.serverVersion ?? '1.0.0-rc.1';
    this.gateway = options.gateway;
    this.resolvePrincipal = options.resolvePrincipal;
    this.redactor = options.redactor ?? createRedactor();
    this.clock = options.clock ?? SYSTEM_CLOCK;
  }

  start(): void {
    this.state = 'running';
    this.startedAt = new Date(this.clock.now()).toISOString();
  }

  stop(): void {
    this.state = 'stopped';
  }

  getHealth(): McpServerHealthStatus {
    return {
      ok: this.state === 'running',
      state: this.state,
      startedAt: this.startedAt,
      activeRequests: this.activeRequests,
      registeredTools: this.gateway.listRegisteredTools().length,
    };
  }

  getAuditLog(): readonly McpCallAuditEntry[] {
    return [...this.mcpAuditLog];
  }

  private async authenticate(
    authToken: string | undefined,
    method: string,
    correlationId: string
  ): Promise<
    | { readonly ok: true; readonly principal: McpPrincipal }
    | {
        readonly ok: false;
        readonly code: number;
        readonly message: string;
        readonly reasonCode: string;
      }
  > {
    const principal = await this.resolvePrincipal(authToken);
    const nowIso = new Date(this.clock.now()).toISOString();

    if (!principal || !principal.authenticated) {
      this.mcpAuditLog.push({
        timestamp: nowIso,
        method,
        correlationId,
        outcome: 'unauthenticated',
        reasonCode: 'UNAUTHENTICATED',
      });
      return {
        ok: false,
        code: -32001,
        message: 'MCP request requires valid authentication',
        reasonCode: 'UNAUTHENTICATED',
      };
    }

    if (principal.revoked) {
      this.mcpAuditLog.push({
        timestamp: nowIso,
        method,
        correlationId,
        companyId: principal.companyId,
        actorId: principal.actorId,
        outcome: 'denied',
        reasonCode: 'PRINCIPAL_REVOKED',
      });
      return {
        ok: false,
        code: -32003,
        message: 'MCP principal credential has been revoked',
        reasonCode: 'PRINCIPAL_REVOKED',
      };
    }

    if (principal.tokenExpiresAt !== undefined) {
      const expiresMs = Date.parse(principal.tokenExpiresAt);
      if (!Number.isFinite(expiresMs) || expiresMs <= this.clock.now()) {
        this.mcpAuditLog.push({
          timestamp: nowIso,
          method,
          correlationId,
          companyId: principal.companyId,
          actorId: principal.actorId,
          outcome: 'denied',
          reasonCode: 'TOKEN_EXPIRED',
        });
        return {
          ok: false,
          code: -32001,
          message: 'MCP principal token is expired',
          reasonCode: 'TOKEN_EXPIRED',
        };
      }
    }

    return { ok: true, principal };
  }

  async handleRequest(
    request: McpJsonRpcRequest,
    authToken?: string,
    correlationIdOverride?: string
  ): Promise<McpJsonRpcResponse> {
    const reqId = request.id ?? null;
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return makeRpcError(reqId, -32600, 'Invalid JSON-RPC 2.0 request', this.redactor);
    }

    if (this.state !== 'running') {
      return makeRpcError(reqId, -32002, 'MCP server is stopped', this.redactor);
    }

    const correlationId =
      correlationIdOverride ?? `mcp_${this.clock.now()}_${String(reqId ?? 'notify')}`;
    this.activeRequests += 1;

    try {
      const auth = await this.authenticate(authToken, request.method, correlationId);
      if (!auth.ok) {
        return makeRpcError(reqId, auth.code, auth.message, this.redactor, {
          reasonCode: auth.reasonCode,
          correlationId,
        });
      }
      const { principal } = auth;

      if (request.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: reqId,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: {
              name: this.serverName,
              version: this.serverVersion,
            },
          },
        };
      }

      if (request.method === 'ping') {
        return { jsonrpc: '2.0', id: reqId, result: {} };
      }

      if (request.method === 'tools/list') {
        const authorizedTools = await this.gateway.listAuthorizedToolsForPrincipal({
          companyId: principal.companyId,
          agentId: principal.actorId,
          workContractId: principal.workContractId,
          policyVersion: principal.policyVersion,
        });

        this.mcpAuditLog.push({
          timestamp: new Date(this.clock.now()).toISOString(),
          method: 'tools/list',
          correlationId,
          companyId: principal.companyId,
          actorId: principal.actorId,
          outcome: 'ok',
        });

        return {
          jsonrpc: '2.0',
          id: reqId,
          result: {
            tools: authorizedTools.map((tool) => ({
              name: tool.name,
              description: formatToolDescription(tool),
              inputSchema: tool.inputSchema as unknown as JsonObject,
              annotations: {
                readOnlyHint: tool.sideEffect === 'read_only',
                destructiveHint: tool.sideEffect === 'destructive',
                idempotentHint: tool.idempotent,
                riskTier: tool.riskTier,
                dataClassification: tool.dataClassification,
              },
            })),
          },
        };
      }

      if (request.method === 'tools/call') {
        if (!isRecord(request.params) || typeof request.params.name !== 'string') {
          return makeRpcError(reqId, -32602, 'tools/call requires params.name', this.redactor);
        }

        const toolName = request.params.name;
        const rawArgs = request.params.arguments ?? {};
        if (!isJsonObject(rawArgs)) {
          return makeRpcError(
            reqId,
            -32602,
            'tools/call params.arguments must be a JSON object',
            this.redactor
          );
        }

        // Cross-company isolation guard: caller cannot request data for another company
        if (typeof rawArgs.companyId === 'number' && rawArgs.companyId !== principal.companyId) {
          const reasonCode = 'CROSS_COMPANY_MCP_DENIED';
          this.mcpAuditLog.push({
            timestamp: new Date(this.clock.now()).toISOString(),
            method: 'tools/call',
            correlationId,
            companyId: principal.companyId,
            actorId: principal.actorId,
            toolName,
            outcome: 'denied',
            reasonCode,
          });
          return makeRpcError(
            reqId,
            -32003,
            `Cross-company tool access rejected (principal company ${principal.companyId} !== requested ${rawArgs.companyId})`,
            this.redactor,
            { reasonCode, correlationId }
          );
        }

        const idempotencyKey =
          typeof request.params.idempotencyKey === 'string'
            ? request.params.idempotencyKey
            : typeof rawArgs.idempotencyKey === 'string'
              ? rawArgs.idempotencyKey
              : undefined;

        const invocation = await this.gateway.invoke(toolName, rawArgs, {
          actorType: principal.actorType,
          actorId: principal.actorId,
          companyId: principal.companyId,
          runId: principal.runId ?? `mcp-run-${correlationId}`,
          workContractId: principal.workContractId,
          correlationId,
          policyVersion: principal.policyVersion,
          confirmationToken: principal.confirmationToken,
          idempotencyKey,
        });

        if (!invocation.allowed) {
          this.mcpAuditLog.push({
            timestamp: new Date(this.clock.now()).toISOString(),
            method: 'tools/call',
            correlationId,
            companyId: principal.companyId,
            actorId: principal.actorId,
            toolName,
            outcome: 'denied',
            reasonCode: invocation.denial.reasonCode,
            auditRef: invocation.denial.auditRef,
          });
          return {
            jsonrpc: '2.0',
            id: reqId,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(invocation.denial),
                },
              ],
              structuredContent: invocation.denial as unknown as JsonObject,
            },
          };
        }

        this.mcpAuditLog.push({
          timestamp: new Date(this.clock.now()).toISOString(),
          method: 'tools/call',
          correlationId,
          companyId: principal.companyId,
          actorId: principal.actorId,
          toolName,
          outcome: 'ok',
          auditRef: invocation.auditRef,
        });

        return {
          jsonrpc: '2.0',
          id: reqId,
          result: {
            isError: false,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  untrustedData: true,
                  auditRef: invocation.auditRef,
                  idempotentReplay: invocation.idempotentReplay,
                  data: invocation.output,
                }),
              },
            ],
            structuredContent: {
              untrustedData: true,
              auditRef: invocation.auditRef,
              idempotentReplay: invocation.idempotentReplay,
              data: invocation.output,
            },
          },
        };
      }

      return makeRpcError(reqId, -32601, `Method not found: "${request.method}"`, this.redactor);
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    }
  }
}

export interface MoonWitnessDomainServices {
  readonly getAgentRegistryEntry: (
    companyId: number,
    agentCode: string
  ) => Promise<JsonValue | null> | JsonValue | null;
  readonly getAssignedWorkContract: (
    companyId: number,
    workContractId: string
  ) => Promise<JsonValue | null> | JsonValue | null;
  readonly readApprovedKnowledge: (
    companyId: number,
    query: string
  ) => Promise<readonly JsonValue[]> | readonly JsonValue[];
  readonly getEvidenceReference: (
    companyId: number,
    storageKey: string
  ) => Promise<JsonValue | null> | JsonValue | null;
  readonly appendWorkContractNote?: (params: {
    readonly companyId: number;
    readonly workContractId: string;
    readonly actorId: number | string;
    readonly note: string;
    readonly idempotencyKey: string;
  }) => Promise<{ readonly noteId: string; readonly recordedAt: string }>;
}

export function registerMoonWitnessMcpTools(
  gateway: CapabilityGateway,
  services: MoonWitnessDomainServices
): void {
  gateway.registerTool({
    name: 'mw_agent_registry_read',
    version: 1,
    capability: 'agent.registry_read@v1',
    ownerAddon: 'orm-ai',
    riskTier: 'R0',
    dataClassification: 'local_only',
    sideEffect: 'read_only',
    requiresConfirmation: false,
    idempotent: true,
    description: 'Read company-scoped AI agent registry record via orm-ai service.',
    inputSchema: {
      type: 'object',
      required: ['agentCode'],
      properties: {
        companyId: { type: 'integer', minimum: 1 },
        agentCode: { type: 'string', minLength: 1, maxLength: 128 },
      },
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const agentCode = String(args.agentCode);
      const record = await services.getAgentRegistryEntry(context.companyId, agentCode);
      return { found: record !== null, record };
    },
  });

  gateway.registerTool({
    name: 'mw_work_contract_read',
    version: 1,
    capability: 'work.contract_read@v1',
    ownerAddon: 'orm-ai',
    riskTier: 'R0',
    dataClassification: 'local_only',
    sideEffect: 'read_only',
    requiresConfirmation: false,
    idempotent: true,
    description: 'Read assigned work contract and acceptance criteria within company scope.',
    inputSchema: {
      type: 'object',
      required: ['workContractId'],
      properties: {
        companyId: { type: 'integer', minimum: 1 },
        workContractId: { type: 'string', minLength: 1, maxLength: 128 },
      },
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const contractId = String(args.workContractId);
      const contract = await services.getAssignedWorkContract(context.companyId, contractId);
      return { found: contract !== null, contract };
    },
  });

  gateway.registerTool({
    name: 'mw_knowledge_approved_read',
    version: 1,
    capability: 'knowledge.approved_read@v1',
    ownerAddon: 'orm-knowledge',
    riskTier: 'R0',
    dataClassification: 'local_only',
    sideEffect: 'read_only',
    requiresConfirmation: false,
    idempotent: true,
    description: 'Read approved K0-K9 knowledge records through approved read projection.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        companyId: { type: 'integer', minimum: 1 },
        query: { type: 'string', minLength: 1, maxLength: 500 },
      },
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const items = await services.readApprovedKnowledge(context.companyId, String(args.query));
      return { items: [...items] };
    },
  });

  gateway.registerTool({
    name: 'mw_evidence_ref_read',
    version: 1,
    capability: 'evidence.ref_read@v1',
    ownerAddon: 'orm-storage',
    riskTier: 'R0',
    dataClassification: 'local_only',
    sideEffect: 'read_only',
    requiresConfirmation: false,
    idempotent: true,
    description: 'Read evidence artifact manifest reference within company scope.',
    inputSchema: {
      type: 'object',
      required: ['storageKey'],
      properties: {
        companyId: { type: 'integer', minimum: 1 },
        storageKey: { type: 'string', minLength: 1, maxLength: 128 },
      },
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const ref = await services.getEvidenceReference(context.companyId, String(args.storageKey));
      return { found: ref !== null, evidence: ref };
    },
  });

  if (services.appendWorkContractNote) {
    const appendFn = services.appendWorkContractNote;
    gateway.registerTool({
      name: 'mw_work_contract_append_note',
      version: 1,
      capability: 'work.note_append@v1',
      ownerAddon: 'orm-ai',
      riskTier: 'R1',
      dataClassification: 'local_only',
      sideEffect: 'reversible_write',
      requiresConfirmation: false,
      idempotent: true,
      description:
        'Append an idempotent progress note to an assigned work contract via domain service.',
      inputSchema: {
        type: 'object',
        required: ['workContractId', 'note'],
        properties: {
          companyId: { type: 'integer', minimum: 1 },
          workContractId: { type: 'string', minLength: 1, maxLength: 128 },
          note: { type: 'string', minLength: 1, maxLength: 4000 },
          idempotencyKey: { type: 'string', minLength: 1, maxLength: 128 },
        },
        additionalProperties: false,
      },
      execute: async (args, context) => {
        const result = await appendFn({
          companyId: context.companyId,
          workContractId: String(args.workContractId),
          actorId: context.actorId,
          note: String(args.note),
          idempotencyKey: context.idempotencyKey ?? '',
        });
        return {
          status: 'recorded',
          noteId: result.noteId,
          recordedAt: result.recordedAt,
        };
      },
    });
  }
}
