import { timingSafeEqual } from 'node:crypto';
import type {
  AddonHttpApp,
  AddonHttpHostContext,
  AddonHttpPlugin,
  AddonHttpReply,
  AddonHttpRequest,
} from '@moonwitness/orm';
import type { Knex } from 'knex';
import { decodeLogs, decodeMetrics, decodeTraces } from './otlp.js';
import { QoderTelemetryBridge } from './qoder.js';
import { SqlTelemetryStore } from './sql-store.js';
import type { TelemetryStore } from './types.js';

export interface ObservabilityHttpHostContext extends AddonHttpHostContext {
  /** Shared API database. The addon never owns or destroys this pool. */
  readonly db?: Knex;
  /** Dedicated ingest credential; absent configuration fails closed with HTTP 503. */
  readonly observabilityIngestToken?: string;
  /** Test/embedding override. Production creates one SQL store for the API process. */
  readonly store?: TelemetryStore;
}

interface CloseableAddonHttpApp extends AddonHttpApp {
  addHook?(name: 'onClose', handler: () => Promise<void>): unknown;
}

const INGEST_RATE_LIMIT = { max: 300, timeWindow: '1 minute' } as const;
const INGEST_ROUTE_OPTIONS = {
  config: { public: true },
  rateLimit: INGEST_RATE_LIMIT,
  schema: { security: [] },
} as const;

function tokenMatches(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorizeIngest(
  request: AddonHttpRequest,
  reply: AddonHttpReply,
  expected: string | undefined
): boolean {
  if (!expected || expected.length < 32) {
    reply.code(503).send({ success: false, error: 'Observability ingest is not configured' });
    return false;
  }
  const authorization = request.headers.authorization;
  const bearer =
    typeof authorization === 'string' ? /^Bearer (.+)$/iu.exec(authorization)?.[1] : undefined;
  const alternate = request.headers['x-observability-token'];
  const presented = bearer ?? (typeof alternate === 'string' ? alternate : undefined);
  if (!presented || !tokenMatches(presented, expected)) {
    reply
      .code(401)
      .header('WWW-Authenticate', 'Bearer')
      .send({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

function noStore(reply: AddonHttpReply): AddonHttpReply {
  return reply.header('Cache-Control', 'private, no-store');
}

function requireAdmin(request: AddonHttpRequest, reply: AddonHttpReply): boolean {
  noStore(reply);
  if (!request.auth) {
    reply.code(401).header('WWW-Authenticate', 'Bearer').send({
      success: false,
      error: 'Authentication required',
    });
    return false;
  }
  if (request.auth.role !== 'system' && request.auth.role !== 'superadmin') {
    // Global telemetry has no tenant attribution yet, so ordinary users cannot read it.
    reply.code(403).send({ success: false, error: 'Administrator access required' });
    return false;
  }
  return true;
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function queryNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export const observabilityHttpPlugin: AddonHttpPlugin<
  AddonHttpApp,
  ObservabilityHttpHostContext
> = async (app, options) => {
  const db = options.db ?? app.db;
  const store = options.store ?? (db ? new SqlTelemetryStore(db, { closeDb: false }) : undefined);
  if (!store) {
    throw new Error('Observability HTTP plugin requires a shared Knex database');
  }
  // Correlation state is intentionally process-local for the single-replica cutover;
  // restarts and multi-replica hook routing cannot correlate across processes.
  const qoderTelemetry = new QoderTelemetryBridge({ store });
  const lifecycleApp: CloseableAddonHttpApp = app;
  lifecycleApp.addHook?.('onClose', async () => {
    await store.close();
  });

  app.post('/v1/traces', INGEST_ROUTE_OPTIONS, async (request, reply) => {
    if (!authorizeIngest(request, reply, options.observabilityIngestToken)) return;
    const decoded = decodeTraces(request.body);
    if (!decoded.valid) {
      return reply.code(400).send({ success: false, error: 'Invalid OTLP trace payload' });
    }
    const stored = await store.ingestSpans(decoded.spans);
    const rejected = decoded.rejected + stored.rejected;
    return reply.send(rejected > 0 ? { partialSuccess: { rejectedSpans: String(rejected) } } : {});
  });

  app.post('/v1/metrics', INGEST_ROUTE_OPTIONS, async (request, reply) => {
    if (!authorizeIngest(request, reply, options.observabilityIngestToken)) return;
    const decoded = decodeMetrics(request.body);
    if (!decoded.valid) {
      return reply.code(400).send({ success: false, error: 'Invalid OTLP metric payload' });
    }
    const stored = await store.ingestMetrics(decoded.metrics);
    const rejected = decoded.rejected + stored.rejected;
    return reply.send(
      rejected > 0 ? { partialSuccess: { rejectedDataPoints: String(rejected) } } : {}
    );
  });

  app.post('/v1/logs', INGEST_ROUTE_OPTIONS, async (request, reply) => {
    if (!authorizeIngest(request, reply, options.observabilityIngestToken)) return;
    const decoded = decodeLogs(request.body);
    if (!decoded.valid) {
      return reply.code(400).send({ success: false, error: 'Invalid OTLP log payload' });
    }
    const stored = await store.ingestLogs(decoded.logs);
    const rejected = decoded.rejected + stored.rejected;
    return reply.send(
      rejected > 0 ? { partialSuccess: { rejectedLogRecords: String(rejected) } } : {}
    );
  });

  app.post('/v1/qoder', INGEST_ROUTE_OPTIONS, async (request, reply) => {
    if (!authorizeIngest(request, reply, options.observabilityIngestToken)) return;
    if (!(await qoderTelemetry.handle(request.body))) {
      return reply.code(400).send({ success: false, error: 'Invalid Qoder hook payload' });
    }
    return reply.send({ suppressOutput: true });
  });

  app.get('/api/observability/summary', async (_request, reply) => {
    if (!requireAdmin(_request, reply)) return;
    await store.pruneExpired?.();
    return { success: true, data: await store.summary() };
  });

  app.get('/api/observability/traces', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await store.pruneExpired?.();
    return {
      success: true,
      data: {
        traces: await store.listTraces({
          limit: queryNumber(request.query.limit),
          query: queryString(request.query.query),
          status: queryString(request.query.status),
        }),
      },
    };
  });

  app.get('/api/observability/traces/:traceId', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await store.pruneExpired?.();
    const traceId = request.params.traceId.slice(0, 128);
    const trace = await store.getTrace(traceId);
    if (!trace) {
      return reply.code(404).send({ success: false, error: 'Trace not found' });
    }
    return { success: true, data: trace };
  });

  app.get('/api/observability/logs', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await store.pruneExpired?.();
    return {
      success: true,
      data: {
        logs: await store.listLogs({
          limit: queryNumber(request.query.limit),
          query: queryString(request.query.query),
          severity: queryString(request.query.severity),
        }),
      },
    };
  });

  app.get('/api/observability/metrics', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    await store.pruneExpired?.();
    return {
      success: true,
      data: {
        metrics: await store.listMetrics({
          limit: queryNumber(request.query.limit),
          query: queryString(request.query.query),
        }),
      },
    };
  });

  app.get('/api/observability/config', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return {
      success: true,
      data: {
        protocol: 'OTLP/HTTP JSON',
        endpoints: {
          traces: '/v1/traces',
          metrics: '/v1/metrics',
          logs: '/v1/logs',
        },
        integrations: { qoderHooks: '/v1/qoder' },
        ...store.limits,
      },
    };
  });
};
