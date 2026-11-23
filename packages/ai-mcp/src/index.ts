import { createHash } from 'node:crypto';
import {
  isDbEmergencyStopped,
  redactObject,
  type EmergencyStopController,
} from '@moonwitness/ai-runtime';
import {
  buildProjectDependencyGraph,
  type TaskDependencyKind,
  type TaskPriority,
  type TaskStatus,
} from '@moonwitness/orm-project';
import { isRecord, type JsonObject, type JsonValue } from '@moonwitness/types';
import {
  EXTENDED_MCP_TOOLS,
  dispatchExtendedMcpTool,
  isExtendedMcpToolName,
  type DesktopQuickCaptureRecord,
  type ExtendedToolProviders,
} from './extended-tools.js';

export {
  EXTENDED_MCP_TOOLS,
  computeMerkleEntryHash,
  dispatchExtendedMcpTool,
  isExtendedMcpToolName,
  redactSecretText,
  verifyMerkleAuditChain,
  type AgiGovernanceSnapshot,
  type DesktopDoctorCheck,
  type DesktopLocalSearchHit,
  type DesktopQuickCaptureRecord,
  type ExtendedMcpToolDescriptor,
  type ExtendedMcpToolName,
  type ExtendedToolDispatchContext,
  type ExtendedToolDispatchOutcome,
  type ExtendedToolProviders,
  type MerkleAuditEntry,
  type PaasBackupPlanEntry,
  type PaasLogRecord,
  type PaasServiceStatus,
} from './extended-tools.js';

interface KnexQueryBuilderLike {
  where(filter: Record<string, unknown>): KnexQueryBuilderLike;
  select(...columns: string[]): Promise<Record<string, unknown>[]>;
  first(): Promise<Record<string, unknown> | undefined>;
  insert(values: Record<string, unknown>): Promise<unknown>;
  update?(values: Record<string, unknown>): Promise<unknown>;
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
  {
    name: 'project.list_projects',
    description: 'List company-scoped projects from project_projects.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'project.read@v1',
  },
  {
    name: 'project.list_tasks',
    description:
      'List company-scoped project tasks with DAG readiness and blocker metadata via buildProjectDependencyGraph.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'project.read@v1',
  },
  {
    name: 'project.next_task',
    description: 'Select the highest-priority DAG-ready task for the company or project.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'project.read@v1',
  },
  {
    name: 'project.create_task',
    description:
      'Create a company-scoped project task idempotently via idempotency_key or external_ref.',
    riskTier: 'R1',
    readOnly: false,
    idempotent: true,
    requiredCapability: 'project.write@v1',
  },
  {
    name: 'project.move_task',
    description:
      'Move a company-scoped task to a stage/status while enforcing unresolved blocking dependencies unless force=true.',
    riskTier: 'R1',
    readOnly: false,
    idempotent: true,
    requiredCapability: 'project.write@v1',
  },
  {
    name: 'project.add_dependency',
    description:
      'Add a company-scoped task dependency edge while preventing self-cycles and DAG cycles.',
    riskTier: 'R1',
    readOnly: false,
    idempotent: true,
    requiredCapability: 'project.write@v1',
  },
  ...EXTENDED_MCP_TOOLS,
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
  readonly extendedToolProviders?: ExtendedToolProviders;
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
  const captureStore = new Map<string, DesktopQuickCaptureRecord>();

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

        // Project / Kanban canonical tools
        if (toolName.startsWith('project.')) {
          const isProjectWrite =
            toolName === 'project.create_task' ||
            toolName === 'project.move_task' ||
            toolName === 'project.add_dependency';
          const requiredCap = isProjectWrite ? 'project.write@v1' : 'project.read@v1';

          if (auth.grants && auth.grants.length > 0 && !auth.grants.includes(requiredCap)) {
            return {
              jsonrpc: '2.0',
              id,
              status: 403,
              error: {
                code: -32003,
                message: `Missing required capability grant "${requiredCap}"`,
              },
            };
          }

          if (!isKnexLike(options.db)) {
            return {
              jsonrpc: '2.0',
              id,
              status: 503,
              error: { code: -32002, message: 'Database connection is not configured for project tools' },
            };
          }

          const db = options.db;
          const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
            urgent: 0,
            high: 1,
            normal: 2,
            low: 3,
          };

          const toGraphTasks = (rows: readonly Record<string, unknown>[]) =>
            rows.map((row) => ({
              id: Number(row.id),
              code: String(row.code ?? ''),
              title: String(row.title ?? ''),
              status: (typeof row.status === 'string' ? row.status : 'backlog') as TaskStatus,
              priority: (typeof row.priority === 'string' ? row.priority : 'normal') as TaskPriority,
              stage_id: typeof row.stage_id === 'number' ? row.stage_id : null,
            }));

          const toGraphDeps = (rows: readonly Record<string, unknown>[]) =>
            rows.map((row) => ({
              id: typeof row.id === 'number' ? row.id : undefined,
              task_id: Number(row.task_id),
              depends_on_id: Number(row.depends_on_id),
              kind: (row.kind === 'relates_to' ? 'relates_to' : 'blocks') as TaskDependencyKind,
              active: row.active === undefined ? true : Boolean(row.active),
            }));

          const resolveProjectId = async (): Promise<number | null | 'not_found'> => {
            const rawProjectId = rawArgs.project_id ?? rawArgs.projectId;
            if (typeof rawProjectId === 'number' && Number.isSafeInteger(rawProjectId) && rawProjectId > 0) {
              const proj = await db('project_projects')
                .where({ id: rawProjectId, company_id: companyId })
                .first();
              return proj ? rawProjectId : 'not_found';
            }
            const rawProjectCode = rawArgs.project_code ?? rawArgs.projectCode;
            if (typeof rawProjectCode === 'string' && rawProjectCode.trim().length > 0) {
              const proj = await db('project_projects')
                .where({ code: rawProjectCode.trim(), company_id: companyId })
                .first();
              return proj && typeof proj.id === 'number' ? proj.id : 'not_found';
            }
            return null;
          };

          if (toolName === 'project.list_projects') {
            const filter: Record<string, unknown> = { company_id: companyId };
            if (typeof rawArgs.status === 'string' && rawArgs.status.trim()) {
              filter.status = rawArgs.status.trim();
            }
            const projects = await db('project_projects').where(filter).select('*');
            return {
              jsonrpc: '2.0',
              id,
              result: redactObject({ companyId, projects }),
            };
          }

          if (toolName === 'project.list_tasks' || toolName === 'project.next_task') {
            const resolvedProjectId = await resolveProjectId();
            if (resolvedProjectId === 'not_found') {
              return {
                jsonrpc: '2.0',
                id,
                result: redactObject(
                  toolName === 'project.next_task'
                    ? { companyId, task: null, ready_count: 0 }
                    : { companyId, tasks: [], ready_task_ids: [], blocked_task_ids: [] }
                ),
              };
            }

            const taskFilter: Record<string, unknown> = { company_id: companyId };
            if (resolvedProjectId !== null) {
              taskFilter.project_id = resolvedProjectId;
            }
            const allTasks = await db('project_tasks').where(taskFilter).select('*');
            const allDeps = await db('project_task_dependencies')
              .where({ company_id: companyId })
              .select('*');

            const graph = buildProjectDependencyGraph(toGraphTasks(allTasks), toGraphDeps(allDeps));
            const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

            const enriched: Array<
              Record<string, unknown> & {
                readonly is_ready: boolean;
                readonly blocked_by_ids: readonly number[];
                readonly blocks_ids: readonly number[];
              }
            > = allTasks.map((task) => {
              const node = nodeById.get(Number(task.id));
              return {
                ...task,
                is_ready: node?.is_ready ?? false,
                blocked_by_ids: node?.blocked_by_ids ?? [],
                blocks_ids: node?.blocks_ids ?? [],
              };
            });

            if (toolName === 'project.next_task') {
              const readyTasks = enriched
                .filter((task) => task.is_ready)
                .sort((a, b) => {
                  const pa = PRIORITY_RANK[(a.priority as TaskPriority) ?? 'normal'] ?? 2;
                  const pb = PRIORITY_RANK[(b.priority as TaskPriority) ?? 'normal'] ?? 2;
                  if (pa !== pb) return pa - pb;
                  const posA = typeof a.position === 'number' ? a.position : 100;
                  const posB = typeof b.position === 'number' ? b.position : 100;
                  if (posA !== posB) return posA - posB;
                  return Number(a.id) - Number(b.id);
                });
              return {
                jsonrpc: '2.0',
                id,
                result: redactObject({
                  companyId,
                  task: readyTasks[0] ?? null,
                  ready_count: readyTasks.length,
                }),
              };
            }

            const statusFilter = typeof rawArgs.status === 'string' ? rawArgs.status.trim() : null;
            const priorityFilter =
              typeof rawArgs.priority === 'string' ? rawArgs.priority.trim() : null;
            const readyOnly = rawArgs.ready_only === true || rawArgs.readyOnly === true;

            const filtered = enriched.filter((task) => {
              if (statusFilter && task.status !== statusFilter) return false;
              if (priorityFilter && task.priority !== priorityFilter) return false;
              if (readyOnly && !task.is_ready) return false;
              return true;
            });

            return {
              jsonrpc: '2.0',
              id,
              result: redactObject({
                companyId,
                tasks: filtered,
                ready_task_ids: graph.ready_task_ids,
                blocked_task_ids: graph.blocked_task_ids,
              }),
            };
          }

          if (toolName === 'project.create_task') {
            const title = typeof rawArgs.title === 'string' ? rawArgs.title.trim() : '';
            if (!title) {
              return {
                jsonrpc: '2.0',
                id,
                status: 400,
                error: { code: -32602, message: 'project.create_task requires a non-empty title' },
              };
            }

            const resolvedProjectId = await resolveProjectId();
            if (resolvedProjectId === null || resolvedProjectId === 'not_found') {
              return {
                jsonrpc: '2.0',
                id,
                status: 403,
                error: {
                  code: -32003,
                  message: 'Project not found or belongs to another company',
                },
              };
            }

            const idempotencyKey =
              typeof rawArgs.idempotency_key === 'string' && rawArgs.idempotency_key.trim()
                ? rawArgs.idempotency_key.trim()
                : typeof rawArgs.idempotencyKey === 'string' && rawArgs.idempotencyKey.trim()
                  ? rawArgs.idempotencyKey.trim()
                  : null;
            const externalRef =
              typeof rawArgs.external_ref === 'string' && rawArgs.external_ref.trim()
                ? rawArgs.external_ref.trim()
                : typeof rawArgs.externalRef === 'string' && rawArgs.externalRef.trim()
                  ? rawArgs.externalRef.trim()
                  : idempotencyKey;

            if (externalRef) {
              const existingTask = await db('project_tasks')
                .where({ company_id: companyId, external_ref: externalRef })
                .first();
              if (existingTask) {
                return {
                  jsonrpc: '2.0',
                  id,
                  result: redactObject({
                    companyId,
                    created: false,
                    idempotent_replay: true,
                    task: existingTask,
                  }),
                };
              }
            }

            let stageId: number | null = null;
            const rawStageId = rawArgs.stage_id ?? rawArgs.stageId;
            if (typeof rawStageId === 'number' && Number.isSafeInteger(rawStageId) && rawStageId > 0) {
              const stage = await db('project_stages')
                .where({ id: rawStageId, company_id: companyId })
                .first();
              if (!stage || (stage.project_id !== null && stage.project_id !== undefined && stage.project_id !== resolvedProjectId)) {
                return {
                  jsonrpc: '2.0',
                  id,
                  status: 403,
                  error: { code: -32003, message: 'Stage not found or not valid for project' },
                };
              }
              stageId = rawStageId;
            } else {
              const projectStages = await db('project_stages')
                .where({ company_id: companyId })
                .select('*');
              const matchingStage =
                projectStages.find((s) => s.project_id === resolvedProjectId) ??
                projectStages.find((s) => s.project_id === null || s.project_id === undefined);
              if (!matchingStage || typeof matchingStage.id !== 'number') {
                return {
                  jsonrpc: '2.0',
                  id,
                  status: 400,
                  error: { code: -32602, message: 'No valid stage found for project' },
                };
              }
              stageId = matchingStage.id;
            }

            const code =
              typeof rawArgs.code === 'string' && rawArgs.code.trim()
                ? rawArgs.code.trim()
                : `TASK-${createHash('sha256')
                    .update(`${companyId}:${resolvedProjectId}:${title}:${externalRef ?? Date.now()}`)
                    .digest('hex')
                    .slice(0, 8)
                    .toUpperCase()}`;

            const newTaskRow: Record<string, unknown> = {
              company_id: companyId,
              project_id: resolvedProjectId,
              stage_id: stageId,
              code,
              title,
              description: typeof rawArgs.description === 'string' ? rawArgs.description : null,
              priority: typeof rawArgs.priority === 'string' ? rawArgs.priority : 'normal',
              status: typeof rawArgs.status === 'string' ? rawArgs.status : 'backlog',
              position: typeof rawArgs.position === 'number' ? rawArgs.position : 100,
              external_ref: externalRef,
            };

            await db('project_tasks').insert(newTaskRow);
            const createdTask =
              (await db('project_tasks').where({ company_id: companyId, code }).first()) ?? newTaskRow;

            await recordDbAuditLog(options.db, {
              model: 'project.task',
              recordId: Number(createdTask.id) || 0,
              operation: 'mcp_create_task',
              actorId: actorUserId,
              changes: { toolName, code, project_id: resolvedProjectId, external_ref: externalRef },
            });

            return {
              jsonrpc: '2.0',
              id,
              result: redactObject({
                companyId,
                created: true,
                idempotent_replay: false,
                task: createdTask,
              }),
            };
          }

          if (toolName === 'project.move_task') {
            const rawTaskId = rawArgs.task_id ?? rawArgs.taskId;
            const rawTaskCode = rawArgs.task_code ?? rawArgs.taskCode;
            let task: Record<string, unknown> | undefined;
            if (typeof rawTaskId === 'number' && Number.isSafeInteger(rawTaskId) && rawTaskId > 0) {
              task = await db('project_tasks').where({ id: rawTaskId, company_id: companyId }).first();
            } else if (typeof rawTaskCode === 'string' && rawTaskCode.trim()) {
              task = await db('project_tasks')
                .where({ code: rawTaskCode.trim(), company_id: companyId })
                .first();
            }

            if (!task || task.company_id !== companyId) {
              return {
                jsonrpc: '2.0',
                id,
                status: 403,
                error: { code: -32003, message: 'Task not found or belongs to another company' },
              };
            }

            const taskId = Number(task.id);
            const targetStatus =
              typeof rawArgs.status === 'string' && rawArgs.status.trim()
                ? rawArgs.status.trim()
                : undefined;
            const targetStageId =
              typeof (rawArgs.stage_id ?? rawArgs.stageId) === 'number'
                ? Number(rawArgs.stage_id ?? rawArgs.stageId)
                : undefined;
            const force = rawArgs.force === true;

            if (targetStageId !== undefined) {
              const stage = await db('project_stages')
                .where({ id: targetStageId, company_id: companyId })
                .first();
              if (
                !stage ||
                (stage.project_id !== null &&
                  stage.project_id !== undefined &&
                  stage.project_id !== task.project_id)
              ) {
                return {
                  jsonrpc: '2.0',
                  id,
                  status: 403,
                  error: { code: -32003, message: 'Target stage not found or belongs to another company/project' },
                };
              }
            }

            if (targetStatus === 'in_progress' && !force) {
              const allTasks = await db('project_tasks').where({ company_id: companyId }).select('*');
              const allDeps = await db('project_task_dependencies')
                .where({ company_id: companyId })
                .select('*');
              const graph = buildProjectDependencyGraph(toGraphTasks(allTasks), toGraphDeps(allDeps));
              const node = graph.nodes.find((n) => n.id === taskId);
              if (node && node.blocked_by_ids.length > 0) {
                return {
                  jsonrpc: '2.0',
                  id,
                  status: 409,
                  error: {
                    code: -32009,
                    message: 'Cannot move blocked task to in_progress while unresolved blocks dependencies exist',
                    data: { blocked_by_ids: [...node.blocked_by_ids] },
                  },
                };
              }
            }

            const updates: Record<string, unknown> = {};
            if (targetStageId !== undefined) updates.stage_id = targetStageId;
            if (targetStatus !== undefined) updates.status = targetStatus;
            if (typeof (rawArgs.blocked_reason ?? rawArgs.blockedReason) === 'string') {
              updates.blocked_reason = rawArgs.blocked_reason ?? rawArgs.blockedReason;
            }

            const qb = db('project_tasks').where({ id: taskId, company_id: companyId });
            if (typeof qb.update === 'function' && Object.keys(updates).length > 0) {
              await qb.update(updates);
            }
            const updatedTask =
              (await db('project_tasks').where({ id: taskId, company_id: companyId }).first()) ?? {
                ...task,
                ...updates,
              };

            await recordDbAuditLog(options.db, {
              model: 'project.task',
              recordId: taskId,
              operation: 'mcp_move_task',
              actorId: actorUserId,
              changes: { toolName, ...updates, force },
            });

            return {
              jsonrpc: '2.0',
              id,
              result: redactObject({
                companyId,
                moved: true,
                task: updatedTask,
              }),
            };
          }

          if (toolName === 'project.add_dependency') {
            const taskId = Number(rawArgs.task_id ?? rawArgs.taskId);
            const dependsOnId = Number(rawArgs.depends_on_id ?? rawArgs.dependsOnId);
            const kind: TaskDependencyKind =
              rawArgs.kind === 'relates_to' ? 'relates_to' : 'blocks';

            if (
              !Number.isSafeInteger(taskId) ||
              taskId <= 0 ||
              !Number.isSafeInteger(dependsOnId) ||
              dependsOnId <= 0
            ) {
              return {
                jsonrpc: '2.0',
                id,
                status: 400,
                error: { code: -32602, message: 'Valid positive task_id and depends_on_id are required' },
              };
            }

            if (taskId === dependsOnId) {
              return {
                jsonrpc: '2.0',
                id,
                status: 400,
                error: { code: -32602, message: 'Self-dependency cycle is not allowed' },
              };
            }

            const [task, blocker] = await Promise.all([
              db('project_tasks').where({ id: taskId, company_id: companyId }).first(),
              db('project_tasks').where({ id: dependsOnId, company_id: companyId }).first(),
            ]);

            if (!task || !blocker || task.company_id !== companyId || blocker.company_id !== companyId) {
              return {
                jsonrpc: '2.0',
                id,
                status: 403,
                error: { code: -32003, message: 'Task or dependency not found in company scope' },
              };
            }

            const existingDep = await db('project_task_dependencies')
              .where({ company_id: companyId, task_id: taskId, depends_on_id: dependsOnId })
              .first();
            if (existingDep) {
              return {
                jsonrpc: '2.0',
                id,
                result: redactObject({
                  companyId,
                  created: false,
                  idempotent_replay: true,
                  dependency: existingDep,
                }),
              };
            }

            if (kind === 'blocks') {
              const allTasks = await db('project_tasks').where({ company_id: companyId }).select('*');
              const allDeps = await db('project_task_dependencies')
                .where({ company_id: companyId })
                .select('*');

              // Treat all tasks as non-terminal so buildProjectDependencyGraph exposes all active blocks edges
              const normalizedTasks = toGraphTasks(allTasks).map((t) => ({
                ...t,
                status: 'backlog' as TaskStatus,
              }));
              const graph = buildProjectDependencyGraph(normalizedTasks, [
                ...toGraphDeps(allDeps),
                { task_id: taskId, depends_on_id: dependsOnId, kind: 'blocks', active: true },
              ]);
              const blockedByLookup = new Map(graph.nodes.map((n) => [n.id, n.blocked_by_ids]));

              // Check if taskId is reachable from dependsOnId via blocked_by_ids
              const visited = new Set<number>([dependsOnId]);
              const queue: number[] = [dependsOnId];
              let hasCycle = false;
              while (queue.length > 0) {
                const current = queue.shift()!;
                for (const next of blockedByLookup.get(current) ?? []) {
                  if (next === taskId) {
                    hasCycle = true;
                    break;
                  }
                  if (!visited.has(next)) {
                    visited.add(next);
                    queue.push(next);
                  }
                }
                if (hasCycle) break;
              }

              if (hasCycle) {
                return {
                  jsonrpc: '2.0',
                  id,
                  status: 409,
                  error: {
                    code: -32009,
                    message: 'Adding dependency would create a cycle in the project task DAG',
                  },
                };
              }
            }

            const depRow: Record<string, unknown> = {
              company_id: companyId,
              task_id: taskId,
              depends_on_id: dependsOnId,
              kind,
            };
            await db('project_task_dependencies').insert(depRow);
            const createdDep =
              (await db('project_task_dependencies')
                .where({ company_id: companyId, task_id: taskId, depends_on_id: dependsOnId })
                .first()) ?? depRow;

            await recordDbAuditLog(options.db, {
              model: 'project.task_dependency',
              recordId: Number(createdDep.id) || 0,
              operation: 'mcp_add_dependency',
              actorId: actorUserId,
              changes: { toolName, task_id: taskId, depends_on_id: dependsOnId, kind },
            });

            return {
              jsonrpc: '2.0',
              id,
              result: redactObject({
                companyId,
                created: true,
                dependency: createdDep,
              }),
            };
          }
        }

        if (isExtendedMcpToolName(toolName)) {
          const outcome = await dispatchExtendedMcpTool(toolName, rawArgs, {
            companyId,
            actorUserId,
            providers: options.extendedToolProviders,
            captureStore,
          });
          if (!outcome.ok) {
            return {
              jsonrpc: '2.0',
              id,
              status: outcome.status,
              error: { code: outcome.code, message: outcome.message },
            };
          }
          await recordDbAuditLog(options.db, {
            model: 'ai.mcp',
            recordId: companyId,
            operation: `mcp_tool_${toolName.replace(/\./gu, '_')}`,
            actorId: actorUserId,
            changes: { toolName },
          });
          return {
            jsonrpc: '2.0',
            id,
            result: outcome.result,
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

export async function handleAiMcpHttp(
  server: AiMcpServer,
  body: unknown,
  authContext?: AiMcpAuthContext | null
): Promise<AiMcpResponse> {
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return {
        jsonrpc: '2.0',
        id: null,
        status: 400,
        error: { code: -32700, message: 'Parse error: invalid JSON body' },
      };
    }
  }

  if (!isRecord(parsed) || typeof parsed.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: isRecord(parsed) && (typeof parsed.id === 'string' || typeof parsed.id === 'number') ? parsed.id : null,
      status: 400,
      error: { code: -32600, message: 'Invalid Request: expected JSON-RPC 2.0 object with method' },
    };
  }

  return server.handleRequest(parsed as unknown as AiMcpRequest, authContext);
}

export interface AiMcpStdioStreams {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

export interface AiMcpStdioHandle {
  readonly done: Promise<void>;
  close(): Promise<void>;
}

export function serveAiMcpStdio(
  server: AiMcpServer,
  authContext?: AiMcpAuthContext | null,
  streams?: AiMcpStdioStreams
): AiMcpStdioHandle {
  const input: NodeJS.ReadableStream = streams?.input ?? process.stdin;
  const output: NodeJS.WritableStream = streams?.output ?? process.stdout;
  let buffer = Buffer.alloc(0);
  let closed = false;
  let pending: Promise<void> = Promise.resolve();

  const writeResponse = (response: AiMcpResponse, framing: 'content-length' | 'ndjson') => {
    const payload = JSON.stringify(response);
    if (framing === 'content-length') {
      const byteLen = Buffer.byteLength(payload, 'utf8');
      output.write(`Content-Length: ${byteLen}\r\n\r\n${payload}`);
    } else {
      output.write(`${payload}\n`);
    }
  };

  const dispatchMessage = async (raw: string, framing: 'content-length' | 'ndjson') => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      writeResponse(
        {
          jsonrpc: '2.0',
          id: null,
          status: 400,
          error: { code: -32700, message: 'Parse error: invalid JSON' },
        },
        framing
      );
      return;
    }

    if (!isRecord(parsed) || typeof parsed.method !== 'string') {
      writeResponse(
        {
          jsonrpc: '2.0',
          id:
            isRecord(parsed) && (typeof parsed.id === 'string' || typeof parsed.id === 'number')
              ? parsed.id
              : null,
          status: 400,
          error: { code: -32600, message: 'Invalid Request' },
        },
        framing
      );
      return;
    }

    const response = await server.handleRequest(parsed as unknown as AiMcpRequest, authContext);
    // JSON-RPC 2.0 notifications omit id and expect no response
    if (Object.hasOwn(parsed, 'id')) {
      writeResponse(response, framing);
    }
  };

  const processBuffer = () => {
    while (buffer.length > 0) {
      // Skip leading CR/LF whitespace between frames
      let start = 0;
      while (start < buffer.length && (buffer[start] === 0x0d || buffer[start] === 0x0a)) {
        start++;
      }
      if (start > 0) {
        buffer = buffer.subarray(start);
      }
      if (buffer.length === 0) break;

      const headPreview = buffer.subarray(0, Math.min(buffer.length, 32)).toString('utf8');
      if (/^content-length\s*:/iu.test(headPreview)) {
        const headerEndCrlf = buffer.indexOf('\r\n\r\n');
        const headerEndLf = buffer.indexOf('\n\n');
        const headerEnd =
          headerEndCrlf !== -1 && (headerEndLf === -1 || headerEndCrlf < headerEndLf)
            ? headerEndCrlf
            : headerEndLf;
        const sepLen = headerEnd === headerEndCrlf ? 4 : 2;
        if (headerEnd === -1) break;

        const headerText = buffer.subarray(0, headerEnd).toString('utf8');
        const match = /content-length\s*:\s*(\d+)/iu.exec(headerText);
        if (!match) {
          buffer = buffer.subarray(headerEnd + sepLen);
          continue;
        }
        const contentLength = Number(match[1]);
        const totalLength = headerEnd + sepLen + contentLength;
        if (buffer.length < totalLength) break;

        const body = buffer.subarray(headerEnd + sepLen, totalLength).toString('utf8');
        buffer = buffer.subarray(totalLength);
        pending = pending.then(() => dispatchMessage(body, 'content-length'));
      } else {
        const newlineIdx = buffer.indexOf(0x0a);
        if (newlineIdx === -1) break;
        const line = buffer.subarray(0, newlineIdx).toString('utf8');
        buffer = buffer.subarray(newlineIdx + 1);
        pending = pending.then(() => dispatchMessage(line, 'ndjson'));
      }
    }
  };

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const onData = (chunk: Buffer | string) => {
    if (closed) return;
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    buffer = Buffer.concat([buffer, buf]);
    processBuffer();
  };

  const onEnd = () => {
    if (!closed && buffer.length > 0) {
      const remaining = buffer.toString('utf8').trim();
      buffer = Buffer.alloc(0);
      if (remaining) {
        pending = pending.then(() => dispatchMessage(remaining, 'ndjson'));
      }
    }
    void pending.finally(() => {
      resolveDone();
    });
  };

  input.on('data', onData);
  input.on('end', onEnd);

  return {
    done,
    async close() {
      if (closed) return;
      closed = true;
      input.off('data', onData);
      input.off('end', onEnd);
      await pending;
      resolveDone();
    },
  };
}

export const createMcpServer = createAiMcpServer;
export const createMcpHandler = createAiMcpServer;
