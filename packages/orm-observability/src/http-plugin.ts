import { timingSafeEqual } from 'node:crypto';
import type { AddonHttpApp, AddonHttpHostContext, AddonHttpPlugin, AddonHttpReply, AddonHttpRequest } from '@moonwitness/orm';
import type { Knex } from 'knex';
import { decodeLogs, decodeMetrics, decodeTraces } from './otlp.js';
import { QoderTelemetryBridge } from './qoder.js';
import { SqlIngestCredentialRegistry, SqlTelemetryStore } from './sql-store.js';
import type { IngestContext, IngestCredentialRegistry, TelemetryScope, TelemetryStore } from './types.js';

export interface ObservabilityHttpHostContext extends AddonHttpHostContext {
  readonly db?: Knex;
  readonly observabilityIngestToken?: string;
  readonly observabilityStoreOptions?: ConstructorParameters<typeof SqlTelemetryStore>[1];
  readonly ingestCredentials?: IngestCredentialRegistry;
  readonly store?: TelemetryStore;
}
interface CloseableAddonHttpApp extends AddonHttpApp { addHook?(name: 'onClose', handler: () => Promise<void>): unknown }
const INGEST_ROUTE_OPTIONS = { config: { public: true }, rateLimit: { max: 300, timeWindow: '1 minute' }, schema: { security: [] } } as const;
function tokenMatches(presented: string, expected: string): boolean { const left = Buffer.from(presented); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right) }
function noStore(reply: AddonHttpReply): AddonHttpReply { return reply.header('Cache-Control', 'private, no-store') }
function isAdmin(request: AddonHttpRequest): boolean { const role = request.auth?.role; return role === 'system' || role === 'superadmin' }
function deny(reply: AddonHttpReply, status: 401 | 403, error: string): false { noStore(reply); reply.code(status).send({ success: false, error }); return false }
function requireAdmin(request: AddonHttpRequest, reply: AddonHttpReply): boolean {
  if (!request.auth) return deny(reply, 401, 'Authentication required');
  if (!isAdmin(request)) return deny(reply, 403, 'Administrator access required');
  return true;
}
async function readScope(request: AddonHttpRequest, reply: AddonHttpReply, options: ObservabilityHttpHostContext): Promise<TelemetryScope | undefined> {
  noStore(reply);
  if (!request.auth) { deny(reply, 401, 'Authentication required'); return undefined }
  if (isAdmin(request)) return { global: true };
  const companyId = request.auth.companyId;
  if (!companyId || !Number.isSafeInteger(companyId) || companyId < 1) { deny(reply, 403, 'Active company is required'); return undefined }
  if (!options.canAccess?.(request.auth.role, 'observability.telemetry_span', 'read', request.auth.groupPermissions)) { deny(reply, 403, 'Telemetry read access denied'); return undefined }
  const allowed = options.hasCompanyAccess ? await Promise.resolve(options.hasCompanyAccess(request.auth.userId, companyId, request.auth.role ?? 'user')).catch(() => false) : true;
  if (!allowed) { deny(reply, 403, 'Company access denied'); return undefined }
  return { global: false, tenantId: companyId };
}
function queryString(value: unknown): string | undefined { return typeof value === 'string' ? value.slice(0, 512) : undefined }
function queryNumber(value: unknown): number | undefined { if (typeof value === 'number' && Number.isSafeInteger(value)) return value; if (typeof value !== 'string' || !/^\d+$/u.test(value)) return undefined; const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : undefined }
function bodyRecord(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function positiveBodyId(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined }

export const observabilityHttpPlugin: AddonHttpPlugin<AddonHttpApp, ObservabilityHttpHostContext> = async (app, options) => {
  const db = options.db ?? app.db;
  const credentials = options.ingestCredentials ?? (db ? new SqlIngestCredentialRegistry(db) : undefined);
  const store = options.store ?? (db ? new SqlTelemetryStore(db, { closeDb: false, configured: Boolean(options.observabilityIngestToken) || Boolean(credentials), ...options.observabilityStoreOptions }) : undefined);
  if (!store) throw new Error('Observability HTTP plugin requires a shared Knex database');
  const qoderTelemetry = new QoderTelemetryBridge({ store });
  const lifecycleApp: CloseableAddonHttpApp = app;
  lifecycleApp.addHook?.('onClose', async () => { await store.close() });
  const ingestContext = async (request: AddonHttpRequest, reply: AddonHttpReply): Promise<IngestContext | undefined> => {
    const authorization = request.headers.authorization; const bearer = typeof authorization === 'string' ? /^Bearer (.+)$/iu.exec(authorization)?.[1] : undefined;
    const alternate = request.headers['x-observability-token']; const presented = bearer ?? (typeof alternate === 'string' ? alternate : undefined);
    if (presented && credentials) {
      const credential = await credentials.lookup(presented).catch(() => undefined);
      if (credential) return { ...(credential.companyId ? { tenantId: credential.companyId } : {}) };
      // Registry credentials are self-identifying and must never regain access through legacy fallback.
      if (presented.startsWith('mwobs_')) { deny(reply, 401, 'Unauthorized'); return undefined; }
    }
    const legacy = options.observabilityIngestToken;
    if (!presented) {
      if (credentials || (legacy && legacy.length >= 32)) { deny(reply, 401, 'Unauthorized'); return undefined; }
      reply.code(503).send({ success: false, error: 'Observability ingest is not configured' });
      return undefined;
    }
    if (!legacy || legacy.length < 32 || !tokenMatches(presented, legacy)) { deny(reply, 401, 'Unauthorized'); return undefined; }
    return {};
  };
  app.post('/v1/traces', INGEST_ROUTE_OPTIONS, async (request, reply) => {
    const context = await ingestContext(request, reply); if (!context) return;
    const decoded = decodeTraces(request.body); if (!decoded.valid) return reply.code(400).send({ success: false, error: 'Invalid OTLP trace payload' });
    const stored = await store.ingestSpans(decoded.spans, context); const rejected = decoded.rejected + stored.rejected;
    return reply.send(rejected > 0 ? { partialSuccess: { rejectedSpans: String(rejected) } } : {});
  });
  app.post('/v1/metrics', INGEST_ROUTE_OPTIONS, async (request, reply) => {
    const context = await ingestContext(request, reply); if (!context) return;
    const decoded = decodeMetrics(request.body); if (!decoded.valid) return reply.code(400).send({ success: false, error: 'Invalid OTLP metric payload' });
    const stored = await store.ingestMetrics(decoded.metrics, context); const rejected = decoded.rejected + stored.rejected;
    return reply.send(rejected > 0 ? { partialSuccess: { rejectedDataPoints: String(rejected) } } : {});
  });
  app.post('/v1/logs', INGEST_ROUTE_OPTIONS, async (request, reply) => {
    const context = await ingestContext(request, reply); if (!context) return;
    const decoded = decodeLogs(request.body); if (!decoded.valid) return reply.code(400).send({ success: false, error: 'Invalid OTLP log payload' });
    const stored = await store.ingestLogs(decoded.logs, context); const rejected = decoded.rejected + stored.rejected;
    return reply.send(rejected > 0 ? { partialSuccess: { rejectedLogRecords: String(rejected) } } : {});
  });
  app.post('/v1/qoder', INGEST_ROUTE_OPTIONS, async (request, reply) => {
    const context = await ingestContext(request, reply); if (!context) return;
    if (!(await qoderTelemetry.handle(request.body, context))) return reply.code(400).send({ success: false, error: 'Invalid Qoder hook payload' });
    return reply.send({ suppressOutput: true });
  });
  app.get('/api/observability/summary', async (request, reply) => { const scope = await readScope(request, reply, options); if (!scope) return; return { success: true, data: await store.summary(scope) } });
  app.get('/api/observability/traces', async (request, reply) => {
    const scope = await readScope(request, reply, options); if (!scope) return; const page = await store.listTraces({ scope, limit: queryNumber(request.query.limit), cursor: queryString(request.query.cursor), query: queryString(request.query.query), status: queryString(request.query.status) });
    return { success: true, data: { traces: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } };
  });
  app.get('/api/observability/traces/:traceId', async (request, reply) => {
    const scope = await readScope(request, reply, options); if (!scope) return; const trace = await store.getTrace(request.params.traceId.slice(0, 128), { scope, spanCursor: queryString(request.query.spanCursor), logCursor: queryString(request.query.logCursor), spanLimit: queryNumber(request.query.spanLimit), logLimit: queryNumber(request.query.logLimit) });
    if (!trace) return reply.code(404).send({ success: false, error: 'Trace not found' });
    return { success: true, data: { ...trace, spans: trace.spans.items, logs: trace.logs.items, ...(trace.spans.nextCursor ? { spanNextCursor: trace.spans.nextCursor } : {}), ...(trace.logs.nextCursor ? { logNextCursor: trace.logs.nextCursor } : {}) } };
  });
  app.get('/api/observability/logs', async (request, reply) => {
    const scope = await readScope(request, reply, options); if (!scope) return; const page = await store.listLogs({ scope, limit: queryNumber(request.query.limit), cursor: queryString(request.query.cursor), query: queryString(request.query.query), severity: queryString(request.query.severity) });
    return { success: true, data: { logs: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } };
  });
  app.get('/api/observability/metrics', async (request, reply) => {
    const scope = await readScope(request, reply, options); if (!scope) return; const page = await store.listMetrics({ scope, limit: queryNumber(request.query.limit), cursor: queryString(request.query.cursor), query: queryString(request.query.query) });
    return { success: true, data: { metrics: page.items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } };
  });
  app.get('/api/observability/config', async (request, reply) => {
    const scope = await readScope(request, reply, options); if (!scope) return;
    return { success: true, data: { protocol: 'OTLP/HTTP JSON', endpoints: { traces: '/v1/traces', metrics: '/v1/metrics', logs: '/v1/logs' }, integrations: { qoderHooks: '/v1/qoder' }, ...store.limits, scope, status: await store.status?.() } };
  });
  app.get('/api/observability/credentials', async (request, reply) => { if (!requireAdmin(request, reply)) return; if (!credentials) return reply.code(503).send({ success: false, error: 'Credential registry unavailable' }); return { success: true, data: { credentials: await credentials.list() } } });
  app.post('/api/observability/credentials', async (request, reply) => {
    if (!requireAdmin(request, reply)) return; if (!credentials) return reply.code(503).send({ success: false, error: 'Credential registry unavailable' });
    const body = bodyRecord(request.body); const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 128) : ''; const companyId = positiveBodyId(body?.companyId); const userId = positiveBodyId(body?.userId);
    const expiresAt = typeof body?.expiresAt === 'string' && Number.isFinite(Date.parse(body.expiresAt)) ? new Date(body.expiresAt).toISOString() : undefined;
    if (!name || (body?.companyId !== undefined && !companyId) || (body?.userId !== undefined && !userId) || (body?.expiresAt !== undefined && !expiresAt) || (expiresAt && Date.parse(expiresAt) <= Date.now())) return reply.code(400).send({ success: false, error: 'Invalid ingest credential' });
    if (userId && !companyId) return reply.code(400).send({ success: false, error: 'A credential user requires a company' });
    if (companyId && db) {
      const company = await db('base_companies').where({ id: companyId, active: true }).first(); if (!company) return reply.code(400).send({ success: false, error: 'Unknown or inactive company' });
      if (userId) { const membership = await db('base_company_memberships').where({ user_id: userId, company_id: companyId, active: true }).first(); if (!membership) return reply.code(400).send({ success: false, error: 'User is not an active company member' }) }
    }
    const created = await credentials.create({ name, ...(companyId ? { companyId } : {}), ...(userId ? { userId } : {}), ...(expiresAt ? { expiresAt } : {}) });
    noStore(reply); return reply.code(201).send({ success: true, data: created });
  });
  app.post('/api/observability/credentials/:id/revoke', async (request, reply) => {
    if (!requireAdmin(request, reply)) return; if (!credentials) return reply.code(503).send({ success: false, error: 'Credential registry unavailable' });
    const revoked = await credentials.revoke(request.params.id.slice(0, 128)); if (!revoked) return reply.code(404).send({ success: false, error: 'Credential not found' });
    return { success: true, data: { revoked: true } };
  });
};
