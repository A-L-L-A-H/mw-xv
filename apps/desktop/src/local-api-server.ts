import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
import { isRecord, PlatformError, ValidationError, type JsonObject } from '@moonwitness/types';
import { DESKTOP_ADDONS, LocalSidecarController } from './local-sidecar.js';
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

export interface LocalApiServerOptions {
  readonly sidecar?: LocalSidecarController;
  readonly db?: Knex;
  readonly bridge: DesktopCapabilityBridge;
  readonly host?: string;
  readonly port?: number;
  readonly rpcToken?: string;
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
