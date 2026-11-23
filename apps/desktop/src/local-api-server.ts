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
import {
  createAiMcpServer,
  handleAiMcpHttp,
  type AiMcpAuthContext,
} from '@moonwitness/ai-mcp';
import { Model } from 'objection';
import { Company, CompanyMembership, Partner, User } from '@moonwitness/orm-base';
import { projectHttpPlugin } from '@moonwitness/orm-project';
import { workflowHttpPlugin } from '@moonwitness/orm-workflow';
import {
  controlMeshPaasApp,
  deployViaMoonWitnessMesh,
  fetchMeshNodeMetrics,
  listMeshPaasApps,
  type MeshPaasAppAction,
} from '@moonwitness/orm-cloud';
import { isRecord, PlatformError, ValidationError, type JsonObject } from '@moonwitness/types';
import { DESKTOP_ADDONS, LocalSidecarController } from './local-sidecar.js';
import { importDesktopTasks } from './importer.js';
import { buildVpsJoinCommand, ensureMeshCredentials } from './mesh-autopilot.js';
import { MeshClientController } from './mesh-client.js';
import { discoverLocalAiProviders } from './local-ai-discovery.js';
import {
  dispatchTaskAgentRun,
  runWorkspaceAssistant,
  type WorkspaceAssistantAction,
} from './ai-assistant.js';
import {
  createLocalDbBackup,
  listLocalDbBackups,
  restoreLocalDbBackup,
} from './backup.js';
import { DesktopRiskGate, NativeHumanApprovalIssuer } from './risk-gate.js';
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

const INTERNAL_PREFIXES: readonly string[] = Object.freeze([
  'ai.',
  'knowledge.',
  'workflow.',
]);

const STATIC_ALLOWED_CORS_ORIGINS: ReadonlySet<string> = new Set([
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
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
  if (STATIC_ALLOWED_CORS_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
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
      | { id: number }
      | undefined;
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
    | { id: number }
    | undefined;
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

  let user = (await db(User.tableName).where({ login: 'local' }).first()) as
    | { id: number; partner_id?: number | null }
    | undefined;
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
      return bridge.worktree.acquire(args as unknown as Parameters<typeof bridge.worktree.acquire>[0]);
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

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-mw-desktop-token', 'x-request-id'],
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

  app.get<{ Querystring: { limit?: string } }>(
    '/notifications/inbox',
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
    await projectHttpPlugin(instance as unknown as Parameters<typeof projectHttpPlugin>[0], addonHostContext);
    await workflowHttpPlugin(instance as unknown as Parameters<typeof workflowHttpPlugin>[0], addonHostContext);
  });

  // Generic CRUD /api/:model and /api/:model/:id
  app.get<{ Params: { model: string }; Querystring: { domain?: string; limit?: string; offset?: string } }>(
    '/api/:model',
    async (req, reply) => {
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
    }
  );

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

  app.get('/api/desktop/mesh/status', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ success: false, error: 'Authentication required' });
    }
    return { success: true, data: buildRedactedMeshPayload() };
  });

  const meshClientController = new MeshClientController({
    ...(desktopHomeDir && desktopHomeDir !== ':memory:' ? { desktopHomeDir } : {}),
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
      options.sidecar?.getState().sqlitePath ?? options.bridge.sidecar.getState().sqlitePath ?? null;
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

  const handleGetVpsStatus = async (req: FastifyRequest, reply: { code: (n: number) => { send: (body: unknown) => unknown } }) => {
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
    const endpoint =
      process.env.MW_VPS_CONTROL_PLANE_URL?.trim() || 'http://10.144.0.1:3003';
    const token =
      process.env.MW_VPS_ADMIN_TOKEN?.trim() ||
      process.env.CONTROL_PLANE_TOKEN?.trim() ||
      '';
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
      return reply.code(502).send({ success: false, code: 'MESH_PAAS_UNREACHABLE', error: message });
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
      return reply.code(502).send({ success: false, code: 'MESH_PAAS_UNREACHABLE', error: message });
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
    const port = typeof body.port === 'number' && Number.isInteger(body.port) ? body.port : undefined;
    const tenant = typeof body.tenant === 'string' ? body.tenant.trim() : undefined;
    const env = isRecord(body.env)
      ? Object.fromEntries(
          Object.entries(body.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
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
      return reply.code(502).send({ success: false, code: 'MESH_PAAS_DEPLOY_FAILED', error: message });
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
        return reply.code(502).send({ success: false, code: 'MESH_PAAS_ACTION_FAILED', error: message });
      }
    }
  );

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
    grants: [
      'agent.registry_read@v1',
      'project.read@v1',
      'project.write@v1',
    ],
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
