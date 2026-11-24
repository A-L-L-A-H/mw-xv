import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import type { Knex } from 'knex';
import {
  Environment,
  Registry,
  applyDomain,
  describeFields,
  validateDomain,
  type AddonHttpHostContext,
  type Domain,
} from '@moonwitness/orm';
import { createAiMcpServer, handleAiMcpHttp, type AiMcpAuthContext } from '@moonwitness/ai-mcp';
import { Model } from 'objection';
import { Company, CompanyMembership, Partner, User } from '@moonwitness/orm-base';
import { projectHttpPlugin } from '@moonwitness/orm-project';
import { workflowHttpPlugin } from '@moonwitness/orm-workflow';
import {
  PAAS_TEMPLATE_CATALOG,
  controlMeshPaasApp,
  deployViaMoonWitnessMesh,
  evaluateMeshFailoverPlan,
  fetchMeshNodeMetrics,
  listMeshPaasApps,
  type ActiveTenantDeployment,
  type MeshPaasAppAction,
  type MeshVpsNode,
} from '@moonwitness/orm-cloud';
import {
  A2AProtocolError,
  DEFAULT_REDTEAM_SCENARIOS,
  buildMerkleAuditTree,
  evaluateExpectedFreeEnergy,
  runAdversarialRedTeamArena,
  runNonRemConsolidation,
  runRemDreamSelfProbe,
  type ActiveInferenceCandidate,
  type ActiveInferencePolicy,
  type DreamKnowledgeNode,
  type DreamSkillNode,
  type EpisodicMemoryItem,
  type RedTeamScenario,
} from '@moonwitness/ai-runtime';
import {
  DEFAULT_BOARD_ORIGIN,
  DEFAULT_LOCALHOST_BOARD_ORIGIN,
  isRecord,
  PlatformError,
  ValidationError,
  type JsonObject,
} from '@moonwitness/types';
import { A2AMeshClient } from './a2a-client.js';
import { searchHybridLocalMemory, type HybridMemoryRecord } from './hybrid-memory.js';
import { DESKTOP_ADDONS, type LocalSidecarController } from './local-sidecar.js';
import { importDesktopTasks } from './importer.js';
import { buildVpsJoinCommand, ensureMeshCredentials } from './mesh-autopilot.js';
import { MeshClientController } from './mesh-client.js';
import { discoverLocalAiProviders } from './local-ai-discovery.js';
import {
  dispatchTaskAgentRun,
  runWorkspaceAssistant,
  type WorkspaceAssistantAction,
} from './ai-assistant.js';
import { createLocalDbBackup, listLocalDbBackups, restoreLocalDbBackup } from './backup.js';
import { DesktopRiskGate, NativeHumanApprovalIssuer } from './risk-gate.js';
import { DesktopLogHub, type DesktopLogLevel, type DesktopLogSource } from './log-hub.js';
import {
  DesktopSyncEngine,
  type RecordLocalMutationInput,
  type SyncRecordVersion,
} from './sync-engine.js';
import {
  searchLocalRagDocuments,
  type LocalRagDocument,
  type LocalRagDocumentKind,
} from './local-rag.js';
import { runDesktopDoctor, runDesktopDoctorRepair } from './doctor.js';
import {
  VpsOnboardingClient,
  type VpsComposeAction,
  type VpsOnboardingAuthContext,
} from './vps-onboarding.js';
import type { DesktopCapabilityBridge } from './types.js';

export interface LocalAuthContext {
  readonly userId: number;
  readonly companyId: number;
  readonly role: 'superadmin' | 'user' | 'system';
  readonly login: string;
  readonly partnerId?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: LocalAuthContext;
    env: Environment;
  }
}

export interface LocalWorkspaceBootstrapResult {
  readonly companyId: number;
  readonly userId: number;
  readonly partnerId: number | null;
  readonly projectId: number;
  readonly stageIds: Readonly<Record<string, number>>;
}

export type DesktopExperienceMode = 'workspace' | 'developer';

export interface LocalApiServerOptions {
  readonly sidecar?: LocalSidecarController;
  readonly db?: Knex;
  readonly bridge: DesktopCapabilityBridge;
  readonly host?: string;
  readonly port?: number;
  readonly rpcToken?: string;
  readonly desktopHomeDir?: string;
  readonly initialMode?: DesktopExperienceMode;
  readonly ispApiUrl?: string;
}

export interface LocalApiServerHandle {
  readonly app: FastifyInstance;
  readonly apiUrl: string;
  readonly mcpUrl: string;
  readonly healthUrl: string;
  readonly port: number;
  readonly rpcToken: string;
  readonly workspace: LocalWorkspaceBootstrapResult;
  stop(): Promise<void>;
}

const INTERNAL_PREFIXES: readonly string[] = Object.freeze(['ai.', 'knowledge.', 'workflow.']);

const STATIC_ALLOWED_CORS_ORIGINS: ReadonlySet<string> = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  DEFAULT_BOARD_ORIGIN,
  DEFAULT_LOCALHOST_BOARD_ORIGIN,
]);

const DEFAULT_STAGES: readonly {
  readonly code: string;
  readonly name: string;
  readonly sequence: number;
  readonly isClosed: boolean;
}[] = [
  { code: 'backlog', name: 'Backlog', sequence: 10, isClosed: false },
  { code: 'in_progress', name: 'In Progress', sequence: 20, isClosed: false },
  { code: 'review', name: 'Review', sequence: 30, isClosed: false },
  { code: 'done', name: 'Done', sequence: 40, isClosed: true },
];

const WORKSPACE_RESTRICTED_CAPABILITIES: readonly string[] = Object.freeze([
  'pty.*',
  'worktree.*',
  'mcp.invoke',
  'mesh.bootstrap',
  'projects.import_taskos',
]);

const WORKSPACE_ALLOWED_RPC_COMMANDS: ReadonlySet<string> = new Set([
  'getStatus',
  'sidecar.getState',
]);

const WORKSPACE_MODE_RESTRICTED_BODY = Object.freeze({
  success: false,
  code: 'WORKSPACE_MODE_RESTRICTED',
  error: 'Switch to DX / Developer mode to use engineering harness capabilities',
});

function isDesktopExperienceMode(value: unknown): value is DesktopExperienceMode {
  return value === 'workspace' || value === 'developer';
}

const DEFAULT_ISP_API_URL = 'http://127.0.0.1:8091';

type IspProxyUpstreamResult = { status: number; body: unknown } | null;

/**
 * Deterministic offline ISP state used when the ISP service is unreachable.
 * Mirrors the Nusantara FTTx deployment so the desktop UI stays functional
 * while the ISP sidecar is down; every field is derived from fixed seed data,
 * never randomized.
 */
const ISP_FALLBACK_SUBSCRIBERS: readonly {
  readonly subscriberId: number;
  readonly username: string;
  readonly fullName: string;
  readonly plan: string;
  readonly status: 'active' | 'suspended';
  readonly monthlyQuotaBytes: number;
  readonly quotaUsedBytes: number;
}[] = Object.freeze([
  {
    subscriberId: 1,
    username: 'widodo.fttx.cbn',
    fullName: 'Widodo Santoso',
    plan: 'Nusantara FTTx Home 50',
    status: 'active',
    monthlyQuotaBytes: 1_099_511_627_776,
    quotaUsedBytes: 412_316_860_416,
  },
  {
    subscriberId: 2,
    username: 'sari.fttx.cbn',
    fullName: 'Sari Rahmawati',
    plan: 'Nusantara FTTx Home 100',
    status: 'active',
    monthlyQuotaBytes: 2_199_023_255_552,
    quotaUsedBytes: 1_521_887_903_744,
  },
  {
    subscriberId: 3,
    username: 'bharata.dedicated.jkt',
    fullName: 'CV Bharata Digital',
    plan: 'Jakarta Dedicated 1:1 200M',
    status: 'suspended',
    monthlyQuotaBytes: 8_796_093_022_208,
    quotaUsedBytes: 8_796_093_022_208,
  },
]);

const ISP_FALLBACK_STATS = Object.freeze({
  totalSubscribers: ISP_FALLBACK_SUBSCRIBERS.length,
  activeSubscribers: ISP_FALLBACK_SUBSCRIBERS.filter((s) => s.status === 'active').length,
  suspendedSubscribers: ISP_FALLBACK_SUBSCRIBERS.filter((s) => s.status === 'suspended').length,
  totalQuotaBytes: ISP_FALLBACK_SUBSCRIBERS.reduce((sum, s) => sum + s.monthlyQuotaBytes, 0),
  usedQuotaBytes: ISP_FALLBACK_SUBSCRIBERS.reduce((sum, s) => sum + s.quotaUsedBytes, 0),
  onlineSessions: 2,
  source: 'fallback' as const,
});

const ISP_FALLBACK_SESSIONS = Object.freeze([
  {
    sessionId: 'radsession-0001-widodo',
    username: 'widodo.fttx.cbn',
    nasIdentifier: 'nas-cbn-fttx-01',
    framedIpAddress: '10.60.10.24',
    startedAt: '2026-11-23T01:12:45Z',
    state: 'active' as const,
  },
  {
    sessionId: 'radsession-0002-sari',
    username: 'sari.fttx.cbn',
    nasIdentifier: 'nas-cbn-fttx-02',
    framedIpAddress: '10.60.11.8',
    startedAt: '2026-11-23T03:40:02Z',
    state: 'active' as const,
  },
]);

interface IspDisconnectInput {
  readonly username?: unknown;
  readonly sessionId?: unknown;
}

async function forwardToIspService(
  ispApiUrl: string,
  method: 'GET' | 'POST',
  routePath: string,
  payload: unknown
): Promise<IspProxyUpstreamResult> {
  const controller = new AbortController();
  const upstreamTimeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${ispApiUrl}${routePath}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(method === 'POST' && payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(upstreamTimeout);
  }
}

function resolveDesktopHomeDirForMode(options: LocalApiServerOptions): string | null {
  if (options.desktopHomeDir && options.desktopHomeDir.trim().length > 0) {
    return options.desktopHomeDir.trim();
  }
  const sqlitePath =
    options.sidecar?.getState().sqlitePath ?? options.bridge.sidecar.getState().sqlitePath;
  if (!sqlitePath || sqlitePath === ':memory:') {
    return ':memory:';
  }
  return path.dirname(sqlitePath);
}

function loadInitialDesktopMode(
  options: LocalApiServerOptions,
  desktopHomeDir: string | null
): DesktopExperienceMode {
  const envMode = process.env.MW_DESKTOP_MODE?.trim();
  if (isDesktopExperienceMode(envMode)) {
    return envMode;
  }
  if (options.initialMode && isDesktopExperienceMode(options.initialMode)) {
    return options.initialMode;
  }
  if (desktopHomeDir && desktopHomeDir !== ':memory:') {
    const modeFilePath = path.join(desktopHomeDir, 'mode.json');
    if (existsSync(modeFilePath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(modeFilePath, 'utf8'));
        if (isRecord(parsed) && isDesktopExperienceMode(parsed.mode)) {
          return parsed.mode;
        }
      } catch {
        // Ignore malformed mode.json and fall back to default
      }
    }
  }
  return 'developer';
}

function persistDesktopMode(desktopHomeDir: string | null, mode: DesktopExperienceMode): void {
  if (!desktopHomeDir || desktopHomeDir === ':memory:') {
    return;
  }
  mkdirSync(desktopHomeDir, { recursive: true });
  const modeFilePath = path.join(desktopHomeDir, 'mode.json');
  writeFileSync(
    modeFilePath,
    JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

function buildDesktopModePayload(mode: DesktopExperienceMode): {
  readonly mode: DesktopExperienceMode;
  readonly restrictedCapabilities: readonly string[];
} {
  return {
    mode,
    restrictedCapabilities: mode === 'workspace' ? [...WORKSPACE_RESTRICTED_CAPABILITIES] : [],
  };
}

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  // Strict allowlist only — no wildcard localhost fallback (TASK-EX-05 / TAUD-XX)
  return STATIC_ALLOWED_CORS_ORIGINS.has(origin);
}

function isInternalModel(modelName: string): boolean {
  return INTERNAL_PREFIXES.some((prefix) => modelName.startsWith(prefix));
}

function safeTokenEquals(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(actual, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

function extractBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

async function insertAndGetId(
  db: Knex,
  table: string,
  payload: Record<string, unknown>,
  lookupWhere: Record<string, unknown>
): Promise<number> {
  const inserted = (await db(table).insert(payload).returning('id')) as Array<
    { id: number } | number
  >;
  const first = inserted[0];
  if (typeof first === 'number' && first > 0) return first;
  if (first && typeof first === 'object' && typeof first.id === 'number' && first.id > 0) {
    return first.id;
  }
  const fetched = (await db(table).where(lookupWhere).first()) as { id: number } | undefined;
  if (!fetched) {
    throw new Error(`Failed to resolve inserted row ID in ${table}`);
  }
  return fetched.id;
}

/**
 * Idempotently seeds the local offline workspace:
 * - Company ('local-workspace' / 'Local Workspace')
 * - Local operator User (login: 'local', role: 'superadmin')
 * - CompanyMembership
 * - Default Project (code: 'default', name: 'Local Workspace')
 * - 4 ProjectStage rows (backlog, in_progress, review, done)
 */
export async function ensureLocalWorkspaceBootstrap(
  db: Knex
): Promise<LocalWorkspaceBootstrapResult> {
  const now = new Date().toISOString();

  // 1. Default Company
  let company = (await db(Company.tableName)
    .where({ name: 'Local Workspace' })
    .orWhere({ name: 'local-workspace' })
    .first()) as { id: number } | undefined;
  if (!company) {
    company = (await db(Company.tableName).orderBy('id', 'asc').first()) as
      { id: number } | undefined;
  }
  const companyId = company
    ? company.id
    : await insertAndGetId(
        db,
        Company.tableName,
        {
          name: 'Local Workspace',
          active: true,
          create_date: now,
          write_date: now,
        },
        { name: 'Local Workspace' }
      );

  // 2. Local operator Partner & User
  let partner = (await db(Partner.tableName).where({ name: 'Local Operator' }).first()) as
    { id: number } | undefined;
  if (!partner) {
    const partnerIdInserted = await insertAndGetId(
      db,
      Partner.tableName,
      {
        name: 'Local Operator',
        email: 'local@moonwitness.local',
        active: true,
        create_date: now,
        write_date: now,
      },
      { name: 'Local Operator' }
    );
    partner = { id: partnerIdInserted };
  }

  const user = (await db(User.tableName).where({ login: 'local' }).first()) as
    { id: number; partner_id?: number | null } | undefined;
  const userId = user
    ? user.id
    : await insertAndGetId(
        db,
        User.tableName,
        {
          login: 'local',
          role: 'superadmin',
          partner_id: partner.id,
          active: true,
          create_date: now,
          write_date: now,
        },
        { login: 'local' }
      );
  const partnerId = user?.partner_id ?? partner.id;

  // 3. CompanyMembership
  const membership = (await db(CompanyMembership.tableName)
    .where({ user_id: userId, company_id: companyId })
    .first()) as { id: number } | undefined;
  if (!membership) {
    await db(CompanyMembership.tableName).insert({
      user_id: userId,
      company_id: companyId,
      is_default: true,
      active: true,
      create_uid: userId,
      write_uid: userId,
      create_date: now,
      write_date: now,
    });
  }

  // 4. Default Project
  const existingProject = (await db('project_projects')
    .where({ company_id: companyId, code: 'default' })
    .first()) as { id: number } | undefined;
  const projectId = existingProject
    ? existingProject.id
    : await insertAndGetId(
        db,
        'project_projects',
        {
          company_id: companyId,
          code: 'default',
          name: 'Local Workspace',
          status: 'active',
          sequence: 10,
          active: true,
          create_uid: userId,
          write_uid: userId,
          create_date: now,
          write_date: now,
        },
        { company_id: companyId, code: 'default' }
      );

  // 5. 4 ProjectStage rows
  const stageIds: Record<string, number> = {};
  for (const stage of DEFAULT_STAGES) {
    const existingStage = (await db('project_stages')
      .where({ company_id: companyId, project_id: projectId, code: stage.code })
      .first()) as { id: number } | undefined;
    stageIds[stage.code] = existingStage
      ? existingStage.id
      : await insertAndGetId(
          db,
          'project_stages',
          {
            company_id: companyId,
            project_id: projectId,
            code: stage.code,
            name: stage.name,
            sequence: stage.sequence,
            is_closed: stage.isClosed,
            fold: false,
            active: true,
            create_uid: userId,
            write_uid: userId,
            create_date: now,
            write_date: now,
          },
          { company_id: companyId, project_id: projectId, code: stage.code }
        );
  }

  return {
    companyId,
    userId,
    partnerId,
    projectId,
    stageIds,
  };
}

async function dispatchDesktopRpcCommand(
  bridge: DesktopCapabilityBridge,
  command: string,
  payload: unknown
): Promise<unknown> {
  const args = isRecord(payload) ? payload : {};
  switch (command) {
    case 'getStatus':
      return bridge.getStatus();
    case 'worktree.listLeases':
      return bridge.worktree.listLeases();
    case 'worktree.acquire':
      return bridge.worktree.acquire(
        args as unknown as Parameters<typeof bridge.worktree.acquire>[0]
      );
    case 'worktree.readFile':
      return bridge.worktree.readFile(String(args.runId ?? ''), String(args.relativePath ?? ''));
    case 'worktree.diff':
      return bridge.worktree.diff(String(args.runId ?? ''));
    case 'worktree.release':
      return bridge.worktree.release(String(args.runId ?? ''));
    case 'pty.execute':
      return bridge.pty.execute(
        args.request as Parameters<typeof bridge.pty.execute>[0],
        args.auth as Parameters<typeof bridge.pty.execute>[1]
      );
    case 'risk.evaluate':
      return bridge.risk.evaluate(args as unknown as Parameters<typeof bridge.risk.evaluate>[0]);
    case 'risk.getAuditLog':
      return bridge.risk.getAuditLog(typeof args.limit === 'number' ? args.limit : undefined);
    case 'sidecar.getState':
      return bridge.sidecar.getState();
    case 'sidecar.setOfflineMode':
      return bridge.sidecar.setOfflineMode(Boolean(args.offline));
    case 'sidecar.setActiveCompany':
      return bridge.sidecar.setActiveCompany(
        typeof args.companyId === 'number' ? args.companyId : null
      );
    case 'sidecar.getActiveCompany':
      return bridge.sidecar.getActiveCompany();
    case 'sidecar.listEnvelopes':
      return bridge.sidecar.listEnvelopes(
        Array.isArray(args.domain) ? (args.domain as Domain) : undefined,
        typeof args.companyId === 'number' ? { companyId: args.companyId } : undefined
      );
    case 'mcp.listServers':
      return bridge.mcp.listServers();
    case 'mcp.invoke':
      return bridge.mcp.invoke(args as unknown as Parameters<typeof bridge.mcp.invoke>[0]);
    default:
      throw new ValidationError(`Unknown desktop RPC command '${command}'`);
  }
}

export async function startLocalApiServer(
  options: LocalApiServerOptions
): Promise<LocalApiServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4242;
  const rpcToken = options.rpcToken ?? randomBytes(32).toString('hex');
  const desktopHomeDir = resolveDesktopHomeDirForMode(options);
  let currentMode: DesktopExperienceMode = loadInitialDesktopMode(options, desktopHomeDir);

  let db: Knex | null = options.db ?? options.sidecar?.getOrmKnex() ?? null;
  if (!db) {
    if (options.sidecar) {
      await options.sidecar.initializeOrmAddons(DESKTOP_ADDONS);
      db = options.sidecar.getOrmKnex();
    } else {
      await options.bridge.sidecar.initializeOrmAddons();
      db = (Model.knex() as Knex | undefined) ?? null;
    }
  }
  if (!db) {
    throw new Error('LocalSidecarController failed to initialize SQLite ORM Knex handle');
  }

  const workspace = await ensureLocalWorkspaceBootstrap(db);
  if (options.sidecar) {
    options.sidecar.setActiveCompany(workspace.companyId);
  } else {
    options.bridge.sidecar.setActiveCompany(workspace.companyId);
  }

  const validAccessTokens = new Set<string>();
  const validRefreshTokens = new Set<string>();

  const issueSession = () => {
    const accessToken = `mw_local_${randomBytes(24).toString('hex')}`;
    const refreshToken = `mw_local_rt_${randomBytes(24).toString('hex')}`;
    validAccessTokens.add(accessToken);
    validRefreshTokens.add(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 86400,
      refresh_token: refreshToken,
      refresh_expires_at: refreshExpiresAt,
      user: {
        id: workspace.userId,
        login: 'local',
        role: 'superadmin' as const,
        partner_id: workspace.partnerId,
      },
    };
  };

  const defaultAuthContext: LocalAuthContext = {
    userId: workspace.userId,
    companyId: workspace.companyId,
    role: 'superadmin',
    login: 'local',
    ...(workspace.partnerId !== null ? { partnerId: workspace.partnerId } : {}),
  };

  const mcpServer = createAiMcpServer({
    db,
  });

  const app = Fastify({
    bodyLimit: 2 * 1024 * 1024,
    logger: false,
    genReqId: () => randomUUID(),
  });

  const logHub = new DesktopLogHub({
    ...(desktopHomeDir && desktopHomeDir !== ':memory:' ? { desktopHomeDir } : {}),
    knownSecrets: [rpcToken],
  });

  app.addHook('onError', async (req, _reply, err) => {
    logHub.ingest({
      level: 'error',
      source: 'sidecar',
      message: `${req.method} ${req.url} failed: ${err.message}`,
      ...(err.stack ? { detail: err.stack } : {}),
    });
  });

  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode >= 400 && !req.url.startsWith('/api/desktop/logs')) {
      logHub.ingest({
        level: reply.statusCode >= 500 ? 'error' : 'warn',
        source: 'sidecar',
        message: `${req.method} ${req.url} -> HTTP ${reply.statusCode}`,
      });
    }
  });

  // @fastify/cors is compiled against a different fastify patch release than this
  // workspace, so its plugin signature is structurally incompatible with the app
  // instance. Adapt the instance parameter without changing runtime behaviour.
  const corsPlugin = cors as unknown as (
    instance: FastifyInstance,
    options: Parameters<typeof cors>[1],
    done: Parameters<typeof cors>[2]
  ) => void;

  await app.register(corsPlugin, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      cb(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-company-id',
      'x-mw-desktop-token',
      'x-request-id',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PlatformError) {
      return reply.code(error.httpStatus).send({
        success: false,
        error: error.message,
        code: error.code ?? error.name,
        requestId: request.id,
      });
    }
    const statusCode =
      isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : 500;
    return reply.code(statusCode).send({
      success: false,
      error: error instanceof Error ? error.message : 'Internal Server Error',
      code: `HTTP_${statusCode}`,
      requestId: request.id,
    });
  });

  app.addHook('preHandler', async (req) => {
    const token = extractBearerToken(req);
    if (token && validAccessTokens.has(token)) {
      req.auth = defaultAuthContext;
    }
    req.env = options.sidecar
      ? options.sidecar.createScopedEnvironment(workspace.companyId, workspace.userId)
      : new Environment({
          companyId: workspace.companyId,
          userId: workspace.userId,
        });
  });

  // Health & readiness probes
  const healthPayload = () => {
    const sidecarState = options.sidecar
      ? options.sidecar.getState()
      : options.bridge.sidecar.getState();
    return {
      ok: sidecarState.status !== 'stopped',
      status: sidecarState.status !== 'stopped' ? 'ok' : 'stopped',
      protocolVersion: options.bridge.protocolVersion,
      hostSurface: options.bridge.hostSurface,
      sidecar: sidecarState,
    };
  };

  app.get('/healthz', async () => healthPayload());
  app.get('/livez', async () => healthPayload());
  app.get('/readyz', async () => healthPayload());

  // Offline local auth routes
  app.post('/auth/login', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { success: true, data: issueSession() };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const body = isRecord(req.body) ? req.body : {};
    const rt = typeof body.refresh_token === 'string' ? body.refresh_token : '';
    if (!rt || !validRefreshTokens.has(rt)) {
      return reply.code(401).send({ success: false, error: 'Invalid refresh token' });
    }
    validRefreshTokens.delete(rt);
    reply.header('Cache-Control', 'no-store');
    return { success: true, data: issueSession() };
  });

  app.get('/auth/me', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    return {
      success: true,
      data: {
        id: req.auth.userId,
        login: req.auth.login,
        name: 'Local Operator',
        email: 'local@moonwitness.local',
        role: req.auth.role,
        partner_id: req.auth.partnerId ?? null,
        company_id: req.auth.companyId,
      },
    };
  });

  app.post('/auth/logout', async (req) => {
    const token = extractBearerToken(req);
    if (token) validAccessTokens.delete(token);
    const body = isRecord(req.body) ? req.body : {};
    if (typeof body.refresh_token === 'string') {
      validRefreshTokens.delete(body.refresh_token);
    }
    return { success: true };
  });

  // /api/app/bootstrap (matching apps/api/src/routes/bootstrap.routes.ts shape)
  app.get('/api/app/bootstrap', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({
        success: false,
        error: 'Authentication required',
        code: 'UNAUTHORIZED',
        requestId: req.id,
      });
    }

    const accessibleModels = Array.from(Registry.getAll().keys()).map((name) => ({
      name,
      permissions: {
        read: true,
        create: !isInternalModel(name),
        write: !isInternalModel(name),
        unlink: !isInternalModel(name),
      },
    }));

    return {
      success: true,
      requestId: req.id,
      data: {
        registryGeneration: 1,
        user: {
          id: req.auth.userId,
          login: req.auth.login,
          name: 'Local Operator',
          email: 'local@moonwitness.local',
          role: req.auth.role,
          partnerId: req.auth.partnerId ?? null,
          companyId: req.auth.companyId,
        },
        activeCompany: { id: workspace.companyId, name: 'Local Workspace' },
        companies: [{ id: workspace.companyId, name: 'Local Workspace', isDefault: true }],
        addons: DESKTOP_ADDONS.map((addon) => addon.name),
        menus: [],
        actions: [],
        models: accessibleModels,
        skin: {
          theme: 'default',
        },
      },
    };
  });

  // /api/models
  app.get('/api/models', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const models = Array.from(Registry.getAll().entries()).map(([name, ModelClass]) => ({
      name,
      table: ModelClass.tableName,
      displayField: ModelClass.displayField,
      fields: describeFields(ModelClass),
    }));
    return { success: true, data: models };
  });

  // Offline admin & notification loopback endpoints backed by local.db
  const countTableRows = async (
    table: string,
    filter?: (qb: Knex.QueryBuilder) => Knex.QueryBuilder
  ): Promise<number> => {
    if (!(await db.schema.hasTable(table))) return 0;
    let qb = db(table);
    if (filter) qb = filter(qb);
    const row = (await qb.count({ count: '*' }).first()) as { count?: number | string } | undefined;
    return Number(row?.count ?? 0);
  };

  app.get('/admin/jobs/health', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const [queued, running, dead, outboxPending, outboxDead] = await Promise.all([
      countTableRows('base_jobs', (qb) => qb.where({ status: 'queued' })),
      countTableRows('base_jobs', (qb) => qb.where({ status: 'running' })),
      countTableRows('base_jobs', (qb) => qb.where({ status: 'dead' })),
      countTableRows('base_outbox_events', (qb) => qb.whereIn('status', ['pending', 'processing'])),
      countTableRows('base_outbox_events', (qb) => qb.where({ status: 'dead' })),
    ]);
    let oldestQueuedAt: string | null = null;
    if (await db.schema.hasTable('base_jobs')) {
      const oldest = (await db('base_jobs')
        .where({ status: 'queued' })
        .orderBy('available_at', 'asc')
        .first()) as { available_at?: string | null } | undefined;
      oldestQueuedAt = oldest?.available_at ?? null;
    }
    return {
      success: true,
      data: {
        queued,
        running,
        dead,
        outboxPending,
        outboxDead,
        oldestQueuedAt,
      },
    };
  });

  app.get('/admin/crons', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (!(await db.schema.hasTable('base_crons'))) {
      return { success: true, data: [] };
    }
    const crons = await db('base_crons')
      .orderBy('name', 'asc')
      .select(
        'id',
        'code',
        'name',
        'handler',
        'company_id',
        'cron_expression',
        'timezone',
        'enabled',
        'next_run_at',
        'misfire_policy',
        'concurrency_policy'
      );
    return { success: true, data: crons };
  });

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/admin/jobs',
    async (req, reply) => {
      if (!req.auth) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }
      const limit = Number(req.query.limit ?? 50);
      const allowedStatuses = new Set(['queued', 'running', 'succeeded', 'dead', 'cancelled']);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return reply.code(400).send({ success: false, error: 'limit must be between 1 and 200' });
      }
      if (req.query.status && !allowedStatuses.has(req.query.status)) {
        return reply.code(400).send({ success: false, error: 'Invalid job status' });
      }
      if (!(await db.schema.hasTable('base_jobs'))) {
        return { success: true, data: [] };
      }
      let query = db('base_jobs').orderBy('id', 'desc').limit(limit);
      if (req.query.status) {
        query = query.where({ status: req.query.status });
      }
      const jobs = await query.select(
        'id',
        'handler',
        'handler_version',
        'company_id',
        'status',
        'priority',
        'available_at',
        'attempts',
        'max_attempts',
        'lease_owner',
        'lease_until',
        'fencing_token',
        'create_date'
      );
      return { success: true, data: jobs };
    }
  );

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/admin/outbox',
    async (req, reply) => {
      if (!req.auth) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }
      const limit = Number(req.query.limit ?? 50);
      const allowedStatuses = new Set(['pending', 'processing', 'published', 'dead']);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return reply.code(400).send({ success: false, error: 'limit must be between 1 and 200' });
      }
      if (req.query.status && !allowedStatuses.has(req.query.status)) {
        return reply.code(400).send({ success: false, error: 'Invalid outbox status' });
      }
      if (!(await db.schema.hasTable('base_outbox_events'))) {
        return { success: true, data: [] };
      }
      let query = db('base_outbox_events').orderBy('id', 'desc').limit(limit);
      if (req.query.status) {
        query = query.where({ status: req.query.status });
      }
      const events = await query.select(
        'id',
        'event_type',
        'aggregate_model',
        'aggregate_id',
        'company_id',
        'status',
        'attempts',
        'max_attempts',
        'available_at',
        'last_error',
        'created_at',
        'published_at'
      );
      return { success: true, data: events };
    }
  );

  const notificationInboxRateLimitMax = 60;
  const notificationInboxRateLimitWindowMs = 60_000;
  const notificationInboxRateLimitWindows = new Map<string, { startedAt: number; count: number }>();

  app.get<{ Querystring: { limit?: string } }>(
    '/notifications/inbox',
    {
      preHandler: async (req, reply) => {
        // Unauthenticated requests keep the handler's existing 401 response and do not consume quota.
        if (!req.auth) return;
        const key = `${req.auth.companyId}:${req.auth.userId}`;
        const now = Date.now();
        let rateWindow = notificationInboxRateLimitWindows.get(key);
        if (!rateWindow || now - rateWindow.startedAt >= notificationInboxRateLimitWindowMs) {
          rateWindow = { startedAt: now, count: 0 };
          notificationInboxRateLimitWindows.set(key, rateWindow);
        }
        rateWindow.count += 1;
        if (rateWindow.count > notificationInboxRateLimitMax) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((rateWindow.startedAt + notificationInboxRateLimitWindowMs - now) / 1_000)
          );
          return reply.code(429).header('retry-after', retryAfterSeconds).send({
            success: false,
            error: 'Rate limit exceeded',
            code: 'RATE_LIMITED',
            requestId: req.id,
          });
        }
      },
    },
    async (req, reply) => {
      if (!req.auth) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }
      const limit = Number(req.query.limit ?? 20);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return reply.code(400).send({ success: false, error: 'limit must be between 1 and 200' });
      }
      if (!(await db.schema.hasTable('notification_notifications'))) {
        return { success: true, data: [], unreadCount: 0 };
      }
      const notifications = await db('notification_notifications')
        .orderBy('id', 'desc')
        .limit(limit)
        .select('*');
      const unreadCount = await countTableRows('notification_notifications', (qb) =>
        qb.where({ read: false })
      ).catch(() => 0);
      return { success: true, data: notifications, unreadCount };
    }
  );

  // INV-014 Addon HTTP plugins (project & workflow)
  const addonHostContext: AddonHttpHostContext = {
    canAccess: () => true,
    hasCompanyAccess: async (_userId, companyId) => companyId === workspace.companyId,
  };
  await app.register(async (instance) => {
    await projectHttpPlugin(
      instance as unknown as Parameters<typeof projectHttpPlugin>[0],
      addonHostContext
    );
    await workflowHttpPlugin(
      instance as unknown as Parameters<typeof workflowHttpPlugin>[0],
      addonHostContext
    );
  });

  // Generic CRUD /api/:model and /api/:model/:id
  app.get<{
    Params: { model: string };
    Querystring: { domain?: string; limit?: string; offset?: string };
  }>('/api/:model', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const modelName = req.params.model;
    if (isInternalModel(modelName)) {
      return reply.code(403).send({
        success: false,
        error: `Model '${modelName}' is restricted to domain routes`,
      });
    }
    if (!Registry.has(modelName)) {
      return reply.code(404).send({ success: false, error: `Model '${modelName}' not found` });
    }
    const ModelClass = req.env.get(modelName);
    let domain: Domain = [];
    if (req.query.domain) {
      try {
        domain = validateDomain(
          JSON.parse(req.query.domain) as unknown,
          new Set(Object.keys(ModelClass.jsonSchema.properties ?? {}))
        );
      } catch {
        return reply.code(400).send({ success: false, error: 'Invalid domain filter' });
      }
    }
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit ?? '100', 10) || 100));
    const offset = Math.max(0, Number.parseInt(req.query.offset ?? '0', 10) || 0);
    const qb = ModelClass.query();
    applyDomain(qb, domain);
    const rows = await qb.limit(limit).offset(offset);
    return { success: true, data: rows, count: rows.length };
  });

  app.get<{ Params: { model: string; id: string } }>('/api/:model/:id', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const modelName = req.params.model;
    if (isInternalModel(modelName)) {
      return reply.code(403).send({
        success: false,
        error: `Model '${modelName}' is restricted to domain routes`,
      });
    }
    if (!Registry.has(modelName)) {
      return reply.code(404).send({ success: false, error: `Model '${modelName}' not found` });
    }
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid record ID' });
    }
    const ModelClass = req.env.get(modelName);
    const row = await ModelClass.query().findById(id);
    if (!row) {
      return reply.code(404).send({ success: false, error: 'Record not found' });
    }
    return { success: true, data: row };
  });

  app.post<{ Params: { model: string } }>('/api/:model', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const modelName = req.params.model;
    if (isInternalModel(modelName)) {
      return reply.code(403).send({
        success: false,
        error: `Model '${modelName}' is restricted to domain routes`,
      });
    }
    if (!Registry.has(modelName)) {
      return reply.code(404).send({ success: false, error: `Model '${modelName}' not found` });
    }
    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Request body must be a JSON object' });
    }
    const ModelClass = req.env.get(modelName);
    const created = await ModelClass.query().insertAndFetch(req.body);
    return reply.code(201).send({ success: true, data: created });
  });

  app.patch<{ Params: { model: string; id: string } }>('/api/:model/:id', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const modelName = req.params.model;
    if (isInternalModel(modelName)) {
      return reply.code(403).send({
        success: false,
        error: `Model '${modelName}' is restricted to domain routes`,
      });
    }
    if (!Registry.has(modelName)) {
      return reply.code(404).send({ success: false, error: `Model '${modelName}' not found` });
    }
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid record ID' });
    }
    if (!isRecord(req.body)) {
      return reply.code(400).send({ success: false, error: 'Request body must be a JSON object' });
    }
    const ModelClass = req.env.get(modelName);
    const updated = await ModelClass.query().patchAndFetchById(id, req.body);
    if (!updated) {
      return reply.code(404).send({ success: false, error: 'Record not found' });
    }
    return { success: true, data: updated };
  });

  app.delete<{ Params: { model: string; id: string } }>('/api/:model/:id', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const modelName = req.params.model;
    if (isInternalModel(modelName)) {
      return reply.code(403).send({
        success: false,
        error: `Model '${modelName}' is restricted to domain routes`,
      });
    }
    if (!Registry.has(modelName)) {
      return reply.code(404).send({ success: false, error: `Model '${modelName}' not found` });
    }
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id < 1) {
      return reply.code(400).send({ success: false, error: 'Invalid record ID' });
    }
    const ModelClass = req.env.get(modelName);
    const deleted = await ModelClass.query().deleteById(id);
    if (!deleted) {
      return reply.code(404).send({ success: false, error: 'Record not found' });
    }
    return { success: true, deleted: true };
  });

  // /jsonrpc
  app.post('/jsonrpc', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32001, message: 'Authentication required' },
      });
    }
    const body = isRecord(req.body) ? req.body : {};
    const rpcId = (body.id as string | number | null | undefined) ?? null;
    const params = isRecord(body.params) ? body.params : {};
    const modelName = typeof params.model === 'string' ? params.model : '';
    const method = typeof params.method === 'string' ? params.method : String(body.method ?? '');

    if (!modelName || !Registry.has(modelName) || isInternalModel(modelName)) {
      return reply.code(400).send({
        jsonrpc: '2.0',
        id: rpcId,
        error: { code: -32602, message: `Invalid or restricted model '${modelName}'` },
      });
    }

    const ModelClass = req.env.get(modelName);
    if (method === 'search_read') {
      const domain = Array.isArray(params.domain) ? (params.domain as Domain) : [];
      const rows = await ModelClass.search_read(domain, {
        context: { companyId: workspace.companyId },
      });
      return { jsonrpc: '2.0', id: rpcId, result: rows };
    }
    if (method === 'create' && isRecord(params.values)) {
      const created = await ModelClass.query().insertAndFetch(params.values as JsonObject);
      return { jsonrpc: '2.0', id: rpcId, result: created };
    }
    return reply.code(400).send({
      jsonrpc: '2.0',
      id: rpcId,
      error: { code: -32601, message: `Unsupported JSON-RPC method '${method}'` },
    });
  });

  // Desktop loopback endpoints: Mesh Fleet & TaskOS import
  const buildRedactedMeshPayload = () => {
    const status = ensureMeshCredentials();
    const joinCommand = buildVpsJoinCommand({
      networkName: status.networkName,
      subnet: status.subnet,
    });
    return {
      configured: true,
      networkName: status.networkName,
      subnet: status.subnet,
      redactedSecret: status.redactedSecret,
      secretRefPath: status.secretRefPath,
      created: status.created,
      joinCommand,
      nodes: [] as Array<{
        id: string;
        hostname: string;
        meshIp: string;
        status: 'online' | 'degraded' | 'offline';
        containers: Array<{
          id: string;
          name: string;
          image: string;
          status: string;
          health: 'healthy' | 'unhealthy' | 'starting' | 'unknown';
        }>;
      }>,
    };
  };

  app.get('/api/desktop/mode', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    return { success: true, data: buildDesktopModePayload(currentMode) };
  });

  app.post('/api/desktop/mode', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    if (!isDesktopExperienceMode(body.mode)) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_DESKTOP_MODE',
        error: "mode must be 'workspace' or 'developer'",
      });
    }
    currentMode = body.mode;
    persistDesktopMode(desktopHomeDir, currentMode);
    return { success: true, data: buildDesktopModePayload(currentMode) };
  });

  const meshClientController = new MeshClientController({
    ...(desktopHomeDir && desktopHomeDir !== ':memory:' ? { desktopHomeDir } : {}),
  });

  app.get('/api/desktop/mesh/status', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    return {
      success: true,
      data: {
        ...buildRedactedMeshPayload(),
        clientStatus: meshClientController.getStatus(),
      },
    };
  });

  app.post('/api/desktop/mesh/bootstrap', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    return { success: true, data: buildRedactedMeshPayload() };
  });

  app.post('/api/desktop/mesh/connect', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const status = meshClientController.start();
    logHub.ingest({
      level: 'info',
      source: 'mesh',
      message: `Mesh client connect initiated for network ${status.networkName} (state=${status.state})`,
    });
    return { success: true, data: status };
  });

  app.post('/api/desktop/mesh/disconnect', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const status = meshClientController.stop();
    logHub.ingest({
      level: 'info',
      source: 'mesh',
      message: `Mesh client disconnected for network ${status.networkName} (state=${status.state})`,
    });
    return { success: true, data: status };
  });

  app.get('/api/desktop/mesh/peers', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    try {
      const peers = await meshClientController.discoverPeers();
      return { success: true, data: { status: meshClientController.getStatus(), peers } };
    } catch {
      return { success: true, data: { status: meshClientController.getStatus(), peers: [] } };
    }
  });

  app.post('/api/desktop/projects/import-taskos', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const body = isRecord(req.body) ? req.body : {};
    const requestedPath =
      typeof body.sourcePath === 'string' && body.sourcePath.trim().length > 0
        ? body.sourcePath.trim()
        : null;

    const candidates = requestedPath
      ? [path.resolve(requestedPath)]
      : [
          path.resolve(process.cwd(), 'docs/tasks/tasks.json'),
          path.resolve(process.cwd(), '../../docs/tasks/tasks.json'),
          path.resolve(process.cwd(), '../docs/tasks/tasks.json'),
        ];

    const resolvedSource = candidates.find((candidate) => existsSync(candidate));
    if (!resolvedSource) {
      return reply.code(404).send({
        success: false,
        error: 'TaskOS source file docs/tasks/tasks.json not found.',
      });
    }

    const summary = await importDesktopTasks({
      db,
      companyId: workspace.companyId,
      userId: workspace.userId,
      sourcePath: resolvedSource,
    });
    return { success: true, data: summary };
  });

  // Desktop loopback endpoints: Local AI Discovery (available in BOTH workspace & developer modes)
  app.get('/api/desktop/ai/models', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const discovery = await discoverLocalAiProviders();
    return { success: true, data: discovery };
  });

  // Desktop loopback endpoints: Local SQLite Backups (available in BOTH workspace & developer modes)
  const resolveLocalBackupContext = (): {
    sqlitePath: string | null;
    backupsDir: string | null;
  } => {
    const sqlitePath =
      options.sidecar?.getState().sqlitePath ??
      options.bridge.sidecar.getState().sqlitePath ??
      null;
    if (!sqlitePath || sqlitePath === ':memory:') {
      return { sqlitePath: ':memory:', backupsDir: null };
    }
    const baseDir =
      desktopHomeDir && desktopHomeDir !== ':memory:' ? desktopHomeDir : path.dirname(sqlitePath);
    return {
      sqlitePath,
      backupsDir: path.join(baseDir, 'backups'),
    };
  };

  app.get('/api/desktop/backups', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const { sqlitePath, backupsDir } = resolveLocalBackupContext();
    if (!backupsDir || !sqlitePath || sqlitePath === ':memory:') {
      return {
        success: true,
        data: {
          sqlitePath: ':memory:',
          backupsDir: null,
          backups: [],
        },
      };
    }
    const backups = await listLocalDbBackups(backupsDir);
    return {
      success: true,
      data: {
        sqlitePath,
        backupsDir,
        backups,
      },
    };
  });

  app.post('/api/desktop/backups', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const { sqlitePath, backupsDir } = resolveLocalBackupContext();
    if (!backupsDir || !sqlitePath || sqlitePath === ':memory:') {
      return reply.code(400).send({
        success: false,
        code: 'IN_MEMORY_DB_UNSUPPORTED',
        error: 'Cannot back up an in-memory SQLite database',
      });
    }
    const entry = await createLocalDbBackup(sqlitePath, backupsDir);
    return reply.code(201).send({ success: true, data: entry });
  });

  app.post('/api/desktop/backups/restore', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const { sqlitePath, backupsDir } = resolveLocalBackupContext();
    if (!backupsDir || !sqlitePath || sqlitePath === ':memory:') {
      return reply.code(400).send({
        success: false,
        code: 'IN_MEMORY_DB_UNSUPPORTED',
        error: 'Cannot restore into an in-memory SQLite database',
      });
    }
    const body = isRecord(req.body) ? req.body : {};
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    if (!fileName) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_BACKUP_FILENAME',
        error: 'fileName is required',
      });
    }
    if (body.confirm !== true) {
      return reply.code(400).send({
        success: false,
        code: 'RESTORE_CONFIRMATION_REQUIRED',
        error: 'Explicit confirm: true is required to restore local.db',
      });
    }
    try {
      const restored = await restoreLocalDbBackup(fileName, sqlitePath, backupsDir);
      return { success: true, data: restored };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Backup restore failed';
      return reply.code(400).send({
        success: false,
        code: 'BACKUP_RESTORE_FAILED',
        error: message,
      });
    }
  });

  // Desktop loopback endpoints: Remote VPS Onboarding (DX / Developer mode ONLY)
  const vpsApprovalIssuer = new NativeHumanApprovalIssuer();
  const vpsRiskGate = new DesktopRiskGate({
    approvalVerifier: (token) => vpsApprovalIssuer.verifyToken(token),
    requireSignedApprovals: true,
  });

  const buildVpsAuthContext = (
    tier: 'R0' | 'R2' | 'R3',
    action?: 'upstream.sync_push' | 'service.local_start'
  ): VpsOnboardingAuthContext => {
    const runId = `desktop-vps-${randomUUID()}`;
    const approval =
      tier === 'R3' && action
        ? vpsApprovalIssuer.issueToken({
            approvedByUserId: workspace.userId,
            action,
            runId,
          })
        : undefined;
    return {
      runId,
      companyId: workspace.companyId,
      agentId: workspace.userId,
      expectedPolicyVersion: 1,
      dataClassification: 'cloud_eligible',
      grant: {
        grantId: `grant-desktop-vps-${tier}`,
        companyId: workspace.companyId,
        agentId: workspace.userId,
        capability: 'vps.onboarding@v1',
        allowedRiskTier: tier,
        allowedClassification: 'cloud_eligible',
        policyVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        maxCallsPerRun: 20,
      },
      ...(approval ? { humanApproval: approval } : {}),
    };
  };

  const resolveVpsClient = (): {
    client: VpsOnboardingClient | null;
    nodeId: string;
    meshIp: string;
  } => {
    const nodeId = process.env.MW_VPS_NODE_ID?.trim() || 'moonwitness-vps';
    const controlPlaneUrl =
      process.env.MW_VPS_CONTROL_PLANE_URL?.trim() || 'http://10.144.0.1:3003';
    const remoteApiUrl = process.env.MW_VPS_REMOTE_API_URL?.trim() || undefined;
    const adminToken = process.env.MW_VPS_ADMIN_TOKEN?.trim() || '';
    let meshIp = '10.144.0.1';
    try {
      meshIp = new URL(controlPlaneUrl).hostname.replace(/^\[|\]$/gu, '');
    } catch {
      // Keep default meshIp
    }
    if (!adminToken) {
      return { client: null, nodeId, meshIp };
    }
    const vpsClient = new VpsOnboardingClient(
      {
        nodeId,
        controlPlaneUrl,
        ...(remoteApiUrl ? { remoteApiUrl } : {}),
        adminToken,
      },
      { riskGate: vpsRiskGate }
    );
    return { client: vpsClient, nodeId, meshIp };
  };

  const handleGetVpsStatus = async (
    req: FastifyRequest,
    reply: { code: (n: number) => { send: (body: unknown) => unknown } }
  ) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const { client: vpsClient, nodeId, meshIp } = resolveVpsClient();
    if (!vpsClient) {
      return {
        success: true,
        data: {
          nodeId,
          meshIp,
          apiHealth: 'offline' as const,
          boardHealth: 'offline' as const,
          controlPlaneHealth: 'offline' as const,
          superadminBootstrapped: false,
          composeServices: [] as string[],
          redactedSummary: 'VPS admin token not configured (set MW_VPS_ADMIN_TOKEN).',
        },
      };
    }
    try {
      const status = await vpsClient.getOnboardingStatus(buildVpsAuthContext('R0'));
      return { success: true, data: status };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'VPS control plane unreachable';
      return {
        success: true,
        data: {
          nodeId,
          meshIp,
          apiHealth: 'offline' as const,
          boardHealth: 'offline' as const,
          controlPlaneHealth: 'offline' as const,
          superadminBootstrapped: false,
          composeServices: [] as string[],
          redactedSummary: message,
        },
      };
    }
  };

  app.get('/api/desktop/vps/status', handleGetVpsStatus);
  app.get('/api/desktop/vps/onboarding/status', handleGetVpsStatus);

  app.post('/api/desktop/vps/onboarding/compose', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const { client: vpsClient } = resolveVpsClient();
    if (!vpsClient) {
      return reply.code(400).send({
        success: false,
        code: 'VPS_NOT_CONFIGURED',
        error: 'MW_VPS_ADMIN_TOKEN is not configured',
      });
    }
    const body = isRecord(req.body) ? req.body : {};
    const action = body.action;
    if (action !== 'up' && action !== 'restart' && action !== 'rebuild' && action !== 'down') {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_COMPOSE_ACTION',
        error: "action must be 'up', 'restart', 'rebuild', or 'down'",
      });
    }
    const services = Array.isArray(body.services)
      ? body.services.filter((s): s is string => typeof s === 'string')
      : undefined;
    const isHighImpact = action === 'down' || action === 'rebuild';
    const result = await vpsClient.controlComposeStack(
      { action: action as VpsComposeAction, ...(services ? { services } : {}) },
      buildVpsAuthContext(
        isHighImpact ? 'R3' : 'R2',
        isHighImpact ? 'upstream.sync_push' : 'service.local_start'
      )
    );
    return { success: true, data: result };
  });

  const handleVpsSuperadminOnboarding = async (
    req: FastifyRequest,
    reply: { code: (n: number) => { send: (body: unknown) => unknown } }
  ) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const { client: vpsClient } = resolveVpsClient();
    if (!vpsClient) {
      return reply.code(400).send({
        success: false,
        code: 'VPS_NOT_CONFIGURED',
        error: 'MW_VPS_ADMIN_TOKEN is not configured',
      });
    }
    const body = isRecord(req.body) ? req.body : {};
    const login = typeof body.login === 'string' ? body.login.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined;
    const result = await vpsClient.bootstrapSuperadmin(
      { login, password, ...(displayName ? { displayName } : {}) },
      buildVpsAuthContext('R3', 'upstream.sync_push')
    );
    return { success: true, data: result };
  };

  app.post('/api/desktop/vps/onboarding', handleVpsSuperadminOnboarding);
  app.post('/api/desktop/vps/onboarding/superadmin', handleVpsSuperadminOnboarding);

  // Wave O — Desktop ISP proxy (forwards to ISP service, deterministic fallback offline)
  const ispApiUrl =
    options.ispApiUrl ??
    process.env.ISP_API_URL ??
    (process.env.MW_ISP_SIDECAR_URL && process.env.MW_ISP_SIDECAR_URL.trim().length > 0
      ? process.env.MW_ISP_SIDECAR_URL.trim()
      : DEFAULT_ISP_API_URL);

  app.get('/api/desktop/isp/subscribers', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const upstream = await forwardToIspService(ispApiUrl, 'GET', '/api/isp/subscribers', undefined);
    if (upstream) {
      return reply.code(upstream.status).send(upstream.body);
    }
    return { success: true, data: { subscribers: ISP_FALLBACK_SUBSCRIBERS, source: 'fallback' } };
  });

  app.post('/api/desktop/isp/subscribers', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const body = isRecord(req.body) ? req.body : {};
    const upstream = await forwardToIspService(ispApiUrl, 'POST', '/api/isp/subscribers', body);
    if (upstream) {
      return reply.code(upstream.status).send(upstream.body);
    }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const plan = typeof body.plan === 'string' ? body.plan.trim() : '';
    if (!username || !fullName || !plan) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_ISP_SUBSCRIBER_REQUEST',
        error: 'username, fullName and plan are required',
      });
    }
    const nextId =
      ISP_FALLBACK_SUBSCRIBERS.reduce((max, s) => Math.max(max, s.subscriberId), 0) + 1;
    return {
      success: true,
      data: {
        subscriber: {
          subscriberId: nextId,
          username,
          fullName,
          plan,
          status: 'active',
          monthlyQuotaBytes: 1_099_511_627_776,
          quotaUsedBytes: 0,
        },
        source: 'fallback',
      },
    };
  });

  app.get('/api/desktop/isp/sessions', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const upstream = await forwardToIspService(ispApiUrl, 'GET', '/api/isp/sessions', undefined);
    if (upstream) {
      return reply.code(upstream.status).send(upstream.body);
    }
    return { success: true, data: { sessions: ISP_FALLBACK_SESSIONS, source: 'fallback' } };
  });

  app.post('/api/desktop/isp/disconnect', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const body = isRecord(req.body) ? req.body : {};
    const upstream = await forwardToIspService(ispApiUrl, 'POST', '/api/isp/disconnect', body);
    if (upstream) {
      return reply.code(upstream.status).send(upstream.body);
    }
    const input: IspDisconnectInput = body;
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    if (!username && !sessionId) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_ISP_DISCONNECT_REQUEST',
        error: 'username or sessionId is required',
      });
    }
    const matched = ISP_FALLBACK_SESSIONS.find(
      (session) =>
        (username.length > 0 && session.username === username) ||
        (sessionId.length > 0 && session.sessionId === sessionId)
    );
    if (!matched) {
      return reply.code(404).send({
        success: false,
        code: 'ISP_SESSION_NOT_FOUND',
        error: 'No matching active session in fallback ISP state',
      });
    }
    return {
      success: true,
      data: {
        disconnected: true,
        sessionId: matched.sessionId,
        username: matched.username,
        nasIdentifier: matched.nasIdentifier,
        source: 'fallback',
      },
    };
  });

  app.get('/api/desktop/isp/stats', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const upstream = await forwardToIspService(ispApiUrl, 'GET', '/api/isp/stats', undefined);
    if (upstream) {
      return reply.code(upstream.status).send(upstream.body);
    }
    return { success: true, data: ISP_FALLBACK_STATS };
  });

  // Desktop AI Assistant & Autonomous Task Runner
  const VALID_ASSISTANT_ACTIONS = new Set<WorkspaceAssistantAction>([
    'summarize_tasks',
    'draft_note',
    'search_knowledge',
    'chat',
  ]);

  app.post('/api/desktop/ai/assist', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const rawAction = typeof body.action === 'string' ? body.action.trim() : 'chat';
    const action: WorkspaceAssistantAction = VALID_ASSISTANT_ACTIONS.has(
      rawAction as WorkspaceAssistantAction
    )
      ? (rawAction as WorkspaceAssistantAction)
      : 'chat';
    const prompt = typeof body.prompt === 'string' ? body.prompt : '';
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : undefined;
    const model = typeof body.model === 'string' ? body.model.trim() : undefined;
    const tasks = Array.isArray(body.tasks) ? body.tasks : undefined;
    const knowledge = Array.isArray(body.knowledge) ? body.knowledge : undefined;

    const result = await runWorkspaceAssistant({
      mode: currentMode,
      action,
      prompt,
      ...(endpoint ? { endpoint } : {}),
      ...(model ? { model } : {}),
      ...(tasks ? { tasks } : {}),
      ...(knowledge ? { knowledge } : {}),
      autoDiscover: body.autoDiscover === true,
    });
    return { success: true, data: result };
  });

  app.post('/api/desktop/ai/run-task', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const body = isRecord(req.body) ? req.body : {};
    const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : taskId || 'TASK';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!taskId || !title) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_TASK_AGENT_REQUEST',
        error: 'taskId and title are required',
      });
    }
    const model = typeof body.model === 'string' ? body.model.trim() : undefined;
    const baseRef = typeof body.baseRef === 'string' ? body.baseRef.trim() : undefined;
    const allowedPaths = Array.isArray(body.allowedPaths)
      ? body.allowedPaths.filter((p): p is string => typeof p === 'string')
      : undefined;
    const verificationCommands = Array.isArray(body.verificationCommands)
      ? body.verificationCommands.filter((c): c is string => typeof c === 'string')
      : undefined;

    const result = await dispatchTaskAgentRun({
      mode: currentMode,
      taskId,
      code,
      title,
      description,
      ...(model ? { model } : {}),
      ...(baseRef ? { baseRef } : {}),
      ...(allowedPaths ? { allowedPaths } : {}),
      ...(verificationCommands ? { verificationCommands } : {}),
      acquireWorktree: body.acquireWorktree === true,
      riskGate: vpsRiskGate,
      auth: {
        companyId: workspace.companyId,
        agentId: workspace.userId,
        expectedPolicyVersion: 1,
        dataClassification: 'local_only',
        grant: {
          grantId: `grant-desktop-task-agent-${taskId}`,
          companyId: workspace.companyId,
          agentId: workspace.userId,
          capability: 'ai.task_agent_run@v1',
          allowedRiskTier: 'R2',
          allowedClassification: 'local_only',
          policyVersion: 1,
          status: 'active',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          maxCallsPerRun: 10,
        },
      },
    });
    return { success: true, data: result };
  });

  // Desktop MoonWitness Mesh PaaS Studio routes (DX mode only)
  const resolveMeshPaasConfig = (): { endpoint: string; token: string } => {
    const endpoint = process.env.MW_VPS_CONTROL_PLANE_URL?.trim() || 'http://10.144.0.1:3003';
    const token =
      process.env.MW_VPS_ADMIN_TOKEN?.trim() || process.env.CONTROL_PLANE_TOKEN?.trim() || '';
    return { endpoint, token };
  };

  app.get('/api/desktop/paas/metrics', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const { endpoint, token } = resolveMeshPaasConfig();
    try {
      const metrics = await fetchMeshNodeMetrics({ endpoint, ...(token ? { token } : {}) });
      return { success: true, data: metrics };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Mesh PaaS node unreachable';
      return reply
        .code(502)
        .send({ success: false, code: 'MESH_PAAS_UNREACHABLE', error: message });
    }
  });

  app.get('/api/desktop/paas/apps', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const { endpoint, token } = resolveMeshPaasConfig();
    try {
      const apps = await listMeshPaasApps({ endpoint, ...(token ? { token } : {}) });
      return { success: true, data: apps };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Mesh PaaS node unreachable';
      return reply
        .code(502)
        .send({ success: false, code: 'MESH_PAAS_UNREACHABLE', error: message });
    }
  });

  app.post('/api/desktop/paas/apps/deploy', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const body = isRecord(req.body) ? req.body : {};
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const image = typeof body.image === 'string' ? body.image.trim() : '';
    if (!slug || !image) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_PAAS_DEPLOY_REQUEST',
        error: 'slug and image are required',
      });
    }
    const domain = typeof body.domain === 'string' ? body.domain.trim() : undefined;
    const port =
      typeof body.port === 'number' && Number.isInteger(body.port) ? body.port : undefined;
    const tenant = typeof body.tenant === 'string' ? body.tenant.trim() : undefined;
    const env = isRecord(body.env)
      ? Object.fromEntries(
          Object.entries(body.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : undefined;

    const { endpoint, token } = resolveMeshPaasConfig();
    try {
      const result = await deployViaMoonWitnessMesh({
        endpoint,
        ...(token ? { token } : {}),
        slug,
        image,
        ...(domain ? { domain } : {}),
        ...(port !== undefined ? { port } : {}),
        ...(tenant ? { tenant } : {}),
        ...(env ? { env } : {}),
      });
      return { success: true, data: result };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Mesh PaaS deploy failed';
      return reply
        .code(502)
        .send({ success: false, code: 'MESH_PAAS_DEPLOY_FAILED', error: message });
    }
  });

  const VALID_PAAS_ACTIONS = new Set<MeshPaasAppAction>(['restart', 'stop', 'delete', 'logs']);

  app.post<{ Params: { slug: string; action: string } }>(
    '/api/desktop/paas/apps/:slug/:action',
    async (req, reply) => {
      if (!req.auth) {
        return reply.code(401).send({ success: false, error: 'Authentication required' });
      }
      if (currentMode === 'workspace') {
        return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
      }
      const slug = req.params.slug.trim();
      const action = req.params.action.trim() as MeshPaasAppAction;
      if (!slug || !VALID_PAAS_ACTIONS.has(action)) {
        return reply.code(400).send({
          success: false,
          code: 'INVALID_PAAS_ACTION',
          error: "action must be 'restart', 'stop', 'delete', or 'logs'",
        });
      }
      const { endpoint, token } = resolveMeshPaasConfig();
      try {
        const result = await controlMeshPaasApp({
          endpoint,
          ...(token ? { token } : {}),
          appIdOrSlug: slug,
          action,
        });
        return { success: true, data: result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Mesh PaaS action failed';
        return reply
          .code(502)
          .send({ success: false, code: 'MESH_PAAS_ACTION_FAILED', error: message });
      }
    }
  );

  // POST /api/desktop/a2a/delegate (DX-only; blocked 403 in workspace mode)
  app.post('/api/desktop/a2a/delegate', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const body = isRecord(req.body) ? req.body : {};
    const targetEndpoint =
      typeof body.targetEndpoint === 'string' ? body.targetEndpoint.trim() : '';
    const targetAgentId = typeof body.targetAgentId === 'string' ? body.targetAgentId.trim() : '';
    const sourceAgentId =
      typeof body.sourceAgentId === 'string' && body.sourceAgentId.trim().length > 0
        ? body.sourceAgentId.trim()
        : `desktop-user-${req.auth.userId}`;
    const payload = isRecord(body.payload) ? body.payload : null;
    if (!targetEndpoint || !targetAgentId || !payload) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_A2A_DELEGATION_REQUEST',
        error: 'targetEndpoint, targetAgentId, and object payload are required',
      });
    }
    const delegationDepth =
      typeof body.delegationDepth === 'number' && Number.isInteger(body.delegationDepth)
        ? body.delegationDepth
        : 1;
    const fencingToken =
      typeof body.fencingToken === 'number' && Number.isInteger(body.fencingToken)
        ? body.fencingToken
        : Date.now();
    const rawClassification =
      typeof body.dataClassification === 'string' ? body.dataClassification.trim() : 'local_only';
    const dataClassification: 'local_only' | 'cloud_eligible' | 'restricted' =
      rawClassification === 'local_only' ||
      rawClassification === 'cloud_eligible' ||
      rawClassification === 'restricted'
        ? rawClassification
        : 'local_only';
    const ttlMs =
      typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) && body.ttlMs > 0
        ? Math.floor(body.ttlMs)
        : 60_000;
    const runId =
      typeof body.runId === 'string' && body.runId.trim().length > 0
        ? body.runId.trim()
        : `a2a-${randomUUID()}`;
    const agentId =
      typeof body.agentId === 'number' && Number.isSafeInteger(body.agentId) && body.agentId > 0
        ? body.agentId
        : req.auth.userId;

    const signingSecret =
      process.env.MOONWITNESS_A2A_SECRET?.trim() ||
      process.env.MOONWITNESS_CONTROL_PLANE_TOKEN?.trim() ||
      rpcToken;
    const a2aClient = new A2AMeshClient({
      signingSecret,
      riskGate: new DesktopRiskGate(),
    });
    const expiresIso = new Date(Date.now() + ttlMs).toISOString();

    try {
      const result = await a2aClient.delegateToMeshNode({
        runId,
        agentId,
        sourceAgentId,
        targetAgentId,
        ...(typeof body.sourceEndpoint === 'string' && body.sourceEndpoint.trim().length > 0
          ? { sourceEndpoint: body.sourceEndpoint.trim() }
          : {}),
        targetEndpoint,
        companyId: req.auth.companyId,
        delegationDepth,
        dataClassification,
        fencingToken,
        ttlMs,
        payload,
        expectedPolicyVersion: 1,
        grant: {
          grantId: `a2a-grant-${randomUUID()}`,
          companyId: req.auth.companyId,
          agentId,
          capability: 'mesh.delegate@v1',
          policyVersion: 1,
          allowedRiskTier: 'R2',
          allowedClassification: dataClassification,
          maxCallsPerRun: 5,
          status: 'active',
          expiresAt: expiresIso,
        },
      });
      return reply.code(result.ok ? 200 : result.statusCode || 502).send({
        success: result.ok,
        data: result,
      });
    } catch (err: unknown) {
      if (err instanceof A2AProtocolError) {
        return reply.code(400).send({
          success: false,
          code: err.reasonCode,
          error: err.message,
        });
      }
      const message = err instanceof Error ? err.message : 'A2A delegation failed';
      return reply.code(502).send({
        success: false,
        code: 'A2A_DELEGATION_FAILED',
        error: message,
      });
    }
  });

  // POST /api/desktop/memory/search — Hybrid Local Memory (BM25 + Ollama cosine rerank)
  // Active in BOTH workspace and developer modes.
  app.post('/api/desktop/memory/search', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_MEMORY_SEARCH_REQUEST',
        error: 'query is required',
      });
    }

    const rawRecords = Array.isArray(body.records) ? body.records : [];
    const records: HybridMemoryRecord[] = [];
    for (const item of rawRecords) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const title = typeof item.title === 'string' ? item.title : '';
      const textBody = typeof item.body === 'string' ? item.body : '';
      const rawKind = typeof item.kind === 'string' ? item.kind : 'document';
      const kind: HybridMemoryRecord['kind'] =
        rawKind === 'document' || rawKind === 'task' || rawKind === 'run_note'
          ? rawKind
          : 'document';
      const companyId =
        typeof item.companyId === 'number' && Number.isSafeInteger(item.companyId)
          ? item.companyId
          : req.auth.companyId;
      if (!id) continue;
      records.push({
        id,
        companyId,
        kind,
        title,
        body: textBody,
        ...(Array.isArray(item.tags)
          ? { tags: item.tags.filter((tag): tag is string => typeof tag === 'string') }
          : {}),
        ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}),
      });
    }

    const limit =
      typeof body.limit === 'number' && Number.isFinite(body.limit) && body.limit > 0
        ? Math.floor(body.limit)
        : undefined;
    const ollamaEndpoint =
      typeof body.ollamaEndpoint === 'string' && body.ollamaEndpoint.trim().length > 0
        ? body.ollamaEndpoint.trim()
        : undefined;
    const embeddingModel =
      typeof body.embeddingModel === 'string' && body.embeddingModel.trim().length > 0
        ? body.embeddingModel.trim()
        : undefined;
    const timeoutMs =
      typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs) && body.timeoutMs > 0
        ? Math.floor(body.timeoutMs)
        : undefined;

    const result = await searchHybridLocalMemory({
      companyId: req.auth.companyId,
      query,
      records,
      ...(limit !== undefined ? { limit } : {}),
      ...(ollamaEndpoint !== undefined ? { ollamaEndpoint } : {}),
      ...(embeddingModel !== undefined ? { embeddingModel } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    return { success: true, data: result };
  });

  // GET /api/desktop/paas/templates — 1-Click PaaS Template Catalog (DX mode only)
  app.get('/api/desktop/paas/templates', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    return {
      success: true,
      data: {
        templates: PAAS_TEMPLATE_CATALOG,
      },
    };
  });

  // POST /api/desktop/paas/failover-plan — Multi-VPS EasyTier Mesh HA Failover Plan (DX mode only)
  app.post('/api/desktop/paas/failover-plan', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const body = isRecord(req.body) ? req.body : {};
    if (!Array.isArray(body.nodes) || !Array.isArray(body.deployments)) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_FAILOVER_PLAN_REQUEST',
        error: 'nodes and deployments arrays are required',
      });
    }

    const nodes = body.nodes as readonly MeshVpsNode[];
    const deployments = body.deployments as readonly ActiveTenantDeployment[];
    const minStandbyHeadroomMb =
      typeof body.minStandbyHeadroomMb === 'number' && Number.isFinite(body.minStandbyHeadroomMb)
        ? body.minStandbyHeadroomMb
        : undefined;
    const maxCpuLoadPercent =
      typeof body.maxCpuLoadPercent === 'number' && Number.isFinite(body.maxCpuLoadPercent)
        ? body.maxCpuLoadPercent
        : undefined;

    const plan = evaluateMeshFailoverPlan({
      nodes,
      deployments,
      ...(minStandbyHeadroomMb !== undefined ? { minStandbyHeadroomMb } : {}),
      ...(maxCpuLoadPercent !== undefined ? { maxCpuLoadPercent } : {}),
    });
    return { success: true, data: plan };
  });

  // POST /api/desktop/ai/sleep-dream — M16.01 Non-REM Consolidation + REM Dream Self-Probing (active in both modes)
  app.post('/api/desktop/ai/sleep-dream', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const companyId =
      typeof body.companyId === 'string' && body.companyId.trim().length > 0
        ? body.companyId.trim()
        : String(req.auth.companyId);
    const nowIso =
      typeof body.nowIso === 'string' && body.nowIso.trim().length > 0
        ? body.nowIso.trim()
        : new Date().toISOString();
    const memories = Array.isArray(body.memories)
      ? (body.memories as readonly EpisodicMemoryItem[])
      : [];
    const knowledgeNodes = Array.isArray(body.knowledgeNodes)
      ? (body.knowledgeNodes as readonly DreamKnowledgeNode[])
      : [];
    const skillNodes = Array.isArray(body.skillNodes)
      ? (body.skillNodes as readonly DreamSkillNode[])
      : [];

    const nonRem = runNonRemConsolidation(memories, {
      companyId,
      nowIso,
      ...(typeof body.maxAgeMs === 'number' && Number.isFinite(body.maxAgeMs)
        ? { maxAgeMs: body.maxAgeMs }
        : {}),
      ...(typeof body.minImportanceBps === 'number' && Number.isFinite(body.minImportanceBps)
        ? { minImportanceBps: body.minImportanceBps }
        : {}),
      ...(typeof body.minConfidenceBps === 'number' && Number.isFinite(body.minConfidenceBps)
        ? { minConfidenceBps: body.minConfidenceBps }
        : {}),
    });
    const rem = runRemDreamSelfProbe(knowledgeNodes, skillNodes);

    return {
      success: true,
      data: {
        nonRem,
        rem,
      },
    };
  });

  // POST /api/desktop/ai/active-inference — M16.02 Expected Free Energy Action Selection (active in both modes)
  app.post('/api/desktop/ai/active-inference', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    if (!Array.isArray(body.candidates)) {
      return reply.code(400).send({
        success: false,
        code: 'INVALID_ACTIVE_INFERENCE_REQUEST',
        error: 'candidates array is required',
      });
    }
    const candidates = body.candidates as readonly ActiveInferenceCandidate[];
    const policy = isRecord(body.policy)
      ? (body.policy as ActiveInferencePolicy)
      : { companyId: String(req.auth.companyId) };
    const decision = evaluateExpectedFreeEnergy(candidates, policy);
    return { success: true, data: decision };
  });

  // GET /api/desktop/audit/merkle-root — M16.03 RFC 6962 Merkle Audit Root over local audit log / outbox (active in both modes)
  app.get('/api/desktop/audit/merkle-root', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const events: unknown[] = [];
    try {
      const hasOutbox = await db.schema.hasTable('desktop_sync_outbox');
      if (hasOutbox) {
        const rows = await db('desktop_sync_outbox')
          .select('id', 'entity_type', 'entity_id', 'operation', 'status', 'created_at')
          .orderBy('id', 'asc')
          .limit(500);
        for (const row of rows) {
          events.push({ source: 'desktop_sync_outbox', ...row });
        }
      }
    } catch {
      // Fallback to empty/baseline event set if outbox table is unavailable
    }
    if (events.length === 0) {
      events.push({
        source: 'desktop_audit_genesis',
        companyId: req.auth.companyId,
        mode: currentMode,
      });
    }
    const tree = buildMerkleAuditTree(events);
    return {
      success: true,
      data: {
        leafCount: tree.leafCount,
        rootHash: tree.rootHash,
        rfc6962DomainSeparated: tree.rfc6962DomainSeparated,
        automatedSelfAccept: tree.automatedSelfAccept,
        automatedPromotionAllowed: tree.automatedPromotionAllowed,
        treeSha256: tree.treeSha256,
      },
    };
  });

  // POST /api/desktop/ai/redteam-arena — M16.04 Adversarial Red-Team Self-Play Arena (DX mode only)
  app.post('/api/desktop/ai/redteam-arena', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    if (currentMode === 'workspace') {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }
    const body = isRecord(req.body) ? req.body : {};
    const scenarios =
      Array.isArray(body.scenarios) && body.scenarios.length > 0
        ? (body.scenarios as readonly RedTeamScenario[])
        : DEFAULT_REDTEAM_SCENARIOS;

    const report = runAdversarialRedTeamArena(scenarios, (scenario) => ({
      blocked: true,
      reasonCode: `CONSTITUTIONAL_GUARD_${scenario.category.toUpperCase()}`,
      summary: `Blocked ${scenario.category} scenario (${scenario.scenarioId}) under fail-closed desktop guardrails.`,
    }));

    return { success: true, data: report };
  });

  const isDesktopLogLevel = (value: unknown): value is DesktopLogLevel =>
    value === 'info' || value === 'warn' || value === 'error';

  const isDesktopLogSource = (value: unknown): value is DesktopLogSource =>
    value === 'rust' ||
    value === 'sidecar' ||
    value === 'webview' ||
    value === 'mcp' ||
    value === 'mesh';

  // Centralized Desktop Logs (active in BOTH Workspace & DX modes)
  app.get('/api/desktop/logs', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const query = isRecord(req.query) ? req.query : {};
    const level = query.level === 'all' || isDesktopLogLevel(query.level) ? query.level : undefined;
    const source =
      query.source === 'all' || isDesktopLogSource(query.source) ? query.source : undefined;
    const search = typeof query.search === 'string' ? query.search : undefined;
    const parsedLimit =
      typeof query.limit === 'string' && query.limit.trim().length > 0
        ? Number.parseInt(query.limit, 10)
        : undefined;
    const limit =
      typeof parsedLimit === 'number' && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : undefined;

    const entries = logHub.list({
      ...(level !== undefined ? { level } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(search !== undefined ? { search } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });

    return {
      success: true,
      entries,
      total: logHub.getEntryCount(),
    };
  });

  app.post('/api/desktop/logs/ingest', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return reply.code(400).send({
        success: false,
        error: 'Log message is required',
      });
    }
    const level: DesktopLogLevel = isDesktopLogLevel(body.level) ? body.level : 'info';
    const source: DesktopLogSource = isDesktopLogSource(body.source) ? body.source : 'webview';
    const detail = typeof body.detail === 'string' ? body.detail : undefined;
    const timestamp = typeof body.timestamp === 'string' ? body.timestamp : undefined;

    const entry = logHub.ingest({
      level,
      source,
      message,
      ...(detail !== undefined ? { detail } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
    });

    return { success: true, entry };
  });

  app.post('/api/desktop/logs/clear', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    logHub.clear();
    return { success: true, cleared: true };
  });

  app.get('/api/desktop/logs/bundle', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const markdown = logHub.formatBundle({
      appVersion: '1.0.0-rc.1',
      platform: process.platform,
      mode: currentMode,
      sidecarUrl: `http://${host}:${port}`,
    });
    return {
      success: true,
      markdown,
      bundle: markdown,
      entryCount: logHub.getEntryCount(),
    };
  });

  // Wave D.20 — Offline-First Bidirectional Delta Sync Engine (active in BOTH modes)
  const syncEngine = new DesktopSyncEngine({
    nodeId: `desktop-${workspace.companyId}`,
  });

  app.get('/api/desktop/sync/status', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    return { success: true, data: syncEngine.getStatus() };
  });

  app.post('/api/desktop/sync/plan', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    if (Array.isArray(body.localMutations)) {
      for (const rawMutation of body.localMutations) {
        if (!isRecord(rawMutation)) continue;
        const entityType =
          typeof rawMutation.entityType === 'string' ? rawMutation.entityType.trim() : '';
        const entityId =
          typeof rawMutation.entityId === 'string' ? rawMutation.entityId.trim() : '';
        const operation = rawMutation.operation === 'delete' ? 'delete' : 'upsert';
        if (!entityType || !entityId) continue;
        const mutationInput: RecordLocalMutationInput = {
          entityType,
          entityId,
          operation,
          ...(isRecord(rawMutation.fields) ? { fields: rawMutation.fields } : {}),
        };
        syncEngine.recordLocalMutation(mutationInput);
      }
    }
    const remoteVersions: SyncRecordVersion[] = Array.isArray(body.remoteVersions)
      ? (body.remoteVersions as SyncRecordVersion[])
      : [];
    const plan = syncEngine.planBidirectionalSync(remoteVersions);
    return { success: true, data: plan };
  });

  // Wave D.21 — Native OS Quick-Capture (active in BOTH modes)
  app.post('/api/desktop/quick-capture', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return reply.code(400).send({
        success: false,
        error: 'Quick-capture title is required',
      });
    }
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const source =
      typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'quick_capture';
    const stageId = workspace.stageIds.backlog ?? Object.values(workspace.stageIds)[0];
    const nowIso = new Date().toISOString();

    const inserted = await db('project_task').insert({
      name: title,
      description,
      project_id: workspace.projectId,
      stage_id: stageId,
      company_id: workspace.companyId,
      user_id: workspace.userId,
      priority: 'normal',
      state: 'open',
      create_date: nowIso,
      write_date: nowIso,
    });
    const taskId = Array.isArray(inserted) ? Number(inserted[0]) : Number(inserted);

    syncEngine.recordLocalMutation({
      entityType: 'project.task',
      entityId: String(taskId),
      operation: 'upsert',
      fields: {
        name: title,
        description,
        project_id: workspace.projectId,
        stage_id: stageId,
      },
      updatedAt: nowIso,
    });

    const logEntry = logHub.ingest({
      level: 'info',
      source: 'sidecar',
      message: `Quick-capture inbox task #${taskId} created (${source}): ${title}`,
    });

    return {
      success: true,
      data: {
        task: {
          id: taskId,
          name: title,
          description,
          projectId: workspace.projectId,
          stageId,
        },
        logEntry,
      },
    };
  });

  // Wave D.22 — Embedded Local Offline Hybrid RAG Search Hub (active in BOTH modes)
  app.post('/api/desktop/ai/local-search', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const body = isRecord(req.body) ? req.body : {};
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return reply.code(400).send({
        success: false,
        error: 'Search query is required',
      });
    }
    const limit =
      typeof body.limit === 'number' && Number.isFinite(body.limit) && body.limit > 0
        ? body.limit
        : 20;
    const kinds = Array.isArray(body.kinds)
      ? body.kinds.filter(
          (k): k is LocalRagDocumentKind => k === 'task' || k === 'doc' || k === 'log'
        )
      : undefined;

    const corpus: LocalRagDocument[] = [];
    try {
      const hasTasks = await db.schema.hasTable('project_task');
      if (hasTasks) {
        const tasks = await db('project_task')
          .select('id', 'name', 'description', 'priority', 'state')
          .where('company_id', req.auth.companyId)
          .limit(300);
        for (const task of tasks) {
          corpus.push({
            id: `task:${String(task.id)}`,
            kind: 'task',
            title: String(task.name ?? ''),
            body: String(task.description ?? ''),
            metadata: { taskId: task.id, priority: task.priority, state: task.state },
          });
        }
      }
    } catch {
      // Non-fatal if task table is absent
    }

    if (Array.isArray(body.documents)) {
      for (const rawDoc of body.documents) {
        if (!isRecord(rawDoc)) continue;
        const docId = typeof rawDoc.id === 'string' ? rawDoc.id : `doc:${corpus.length + 1}`;
        const docTitle = typeof rawDoc.title === 'string' ? rawDoc.title : '';
        const docBody = typeof rawDoc.body === 'string' ? rawDoc.body : '';
        corpus.push({
          id: docId,
          kind: 'doc',
          title: docTitle,
          body: docBody,
        });
      }
    }

    for (const entry of logHub.list({ limit: 200 })) {
      corpus.push({
        id: `log:${entry.id}`,
        kind: 'log',
        title: `${entry.source} [${entry.level}]`,
        body: entry.detail ? `${entry.message} ${entry.detail}` : entry.message,
        metadata: { timestamp: entry.timestamp, source: entry.source, level: entry.level },
      });
    }

    const result = searchLocalRagDocuments(corpus, query, {
      limit,
      ...(kinds && kinds.length > 0 ? { kinds } : {}),
    });
    return { success: true, data: result };
  });

  // Wave D.23 — Desktop Self-Repair Doctor (active in BOTH modes)
  app.get('/api/desktop/doctor', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const report = await runDesktopDoctor({
      db,
      desktopHomeDir,
      apiPort: port,
      apiHealthy: true,
    });
    return { success: true, data: report };
  });

  app.post('/api/desktop/doctor/repair', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    const repairResult = await runDesktopDoctorRepair({
      db,
      desktopHomeDir,
      apiPort: port,
      apiHealthy: true,
    });
    logHub.ingest({
      level: 'info',
      source: 'sidecar',
      message: `Desktop doctor repair completed (actions=${repairResult.actionsTaken.length}, pruned=${repairResult.prunedTempFiles})`,
    });
    return { success: true, data: repairResult };
  });

  // POST /_desktop/rpc protected by ephemeral x-mw-desktop-token
  app.post('/_desktop/rpc', async (req, reply) => {
    const rawHeader = req.headers['x-mw-desktop-token'];
    const token = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!token || !safeTokenEquals(rpcToken, token)) {
      return reply.code(401).send({
        success: false,
        error: 'Invalid or missing x-mw-desktop-token',
        code: 'DESKTOP_RPC_UNAUTHORIZED',
      });
    }

    const body = isRecord(req.body) ? req.body : {};
    const command = typeof body.command === 'string' ? body.command.trim() : '';
    if (!command) {
      return reply.code(400).send({
        success: false,
        error: 'Missing RPC command',
        code: 'INVALID_RPC_REQUEST',
      });
    }

    if (currentMode === 'workspace' && !WORKSPACE_ALLOWED_RPC_COMMANDS.has(command)) {
      return reply.code(403).send(WORKSPACE_MODE_RESTRICTED_BODY);
    }

    const result = await dispatchDesktopRpcCommand(options.bridge, command, body.payload);
    return { success: true, data: result };
  });

  // POST /mcp (Streamable HTTP MCP)
  const localMcpAuth: AiMcpAuthContext = {
    companyId: workspace.companyId,
    userId: workspace.userId,
    actorRole: 'superadmin',
    role: 'superadmin',
    grants: ['agent.registry_read@v1', 'project.read@v1', 'project.write@v1'],
  };

  app.post('/mcp', async (req, reply) => {
    const response = await handleAiMcpHttp(mcpServer, req.body, localMcpAuth);
    const status = typeof response.status === 'number' ? response.status : 200;
    return reply.code(status).send(response);
  });

  await app.listen({ host, port });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    await app.close();
    throw new Error('Failed to resolve LocalApiServer listening address');
  }

  const boundPort = address.port;
  const apiUrl = `http://${host}:${boundPort}`;

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    meshClientController.stop();
    await app.close();
  };

  return {
    app,
    apiUrl,
    mcpUrl: `${apiUrl}/mcp`,
    healthUrl: `${apiUrl}/healthz`,
    port: boundPort,
    rpcToken,
    workspace,
    stop,
  };
}
