import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { decodeLogs, decodeMetrics, decodeTraces } from './otlp.js';
import { QoderTelemetryBridge } from './qoder.js';
import { TelemetryStore } from './store.js';

export interface BuildAppOptions {
  store?: TelemetryStore;
  publicDir?: string;
}

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const publicFiles = new Map<string, { file: string; contentType: string }>([
  ['/index.html', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', contentType: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', contentType: 'text/css; charset=utf-8' }],
  ['/favicon.svg', { file: 'favicon.svg', contentType: 'image/svg+xml' }],
]);

function queryRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function queryNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value);
  return undefined;
}

async function sendPublicFile(
  reply: FastifyReply,
  route: string,
  directory: string
): Promise<FastifyReply> {
  const asset = route === '/' ? publicFiles.get('/index.html') : publicFiles.get(route);
  if (!asset) return reply.code(404).send({ error: 'Not found' });
  try {
    const content = await readFile(path.join(directory, asset.file));
    return reply.header('Cache-Control', 'no-cache').type(asset.contentType).send(content);
  } catch {
    return reply.code(404).send({ error: 'Dashboard asset not found' });
  }
}

export function buildApp(options: BuildAppOptions = {}): {
  app: FastifyInstance;
  store: TelemetryStore;
} {
  const store = options.store ?? new TelemetryStore();
  const qoderTelemetry = new QoderTelemetryBridge({ store });
  const directory = options.publicDir ?? publicDirectory;
  const app = Fastify({
    bodyLimit: 4 * 1024 * 1024,
    genReqId: () => randomUUID(),
    logger: false,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode >= 500) console.error(error);
    return reply.code(statusCode).send({
      error:
        statusCode >= 500
          ? 'Internal server error'
          : error instanceof Error
            ? error.message
            : 'Request failed',
      requestId: request.id,
    });
  });

  app.get('/healthz', async () => ({
    status: 'ok',
    revision: store.revision,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.post('/v1/traces', async (request, reply) => {
    const decoded = decodeTraces(request.body);
    if (!decoded.valid) return reply.code(400).send({ error: 'Invalid OTLP trace payload' });
    const stored = store.ingestSpans(decoded.spans);
    const rejected = decoded.rejected + stored.rejected;
    return reply.send(rejected > 0 ? { partialSuccess: { rejectedSpans: String(rejected) } } : {});
  });

  app.post('/v1/metrics', async (request, reply) => {
    const decoded = decodeMetrics(request.body);
    if (!decoded.valid) return reply.code(400).send({ error: 'Invalid OTLP metric payload' });
    const stored = store.ingestMetrics(decoded.metrics);
    const rejected = decoded.rejected + stored.rejected;
    return reply.send(
      rejected > 0 ? { partialSuccess: { rejectedDataPoints: String(rejected) } } : {}
    );
  });

  app.post('/v1/logs', async (request, reply) => {
    const decoded = decodeLogs(request.body);
    if (!decoded.valid) return reply.code(400).send({ error: 'Invalid OTLP log payload' });
    const stored = store.ingestLogs(decoded.logs);
    const rejected = decoded.rejected + stored.rejected;
    return reply.send(
      rejected > 0 ? { partialSuccess: { rejectedLogRecords: String(rejected) } } : {}
    );
  });

  app.post('/v1/qoder', async (request, reply) => {
    if (!qoderTelemetry.handle(request.body)) {
      return reply.code(400).send({ error: 'Invalid Qoder hook payload' });
    }
    return reply.send({ suppressOutput: true });
  });

  app.get('/api/summary', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return store.summary();
  });

  app.get('/api/traces', async (request, reply) => {
    const query = queryRecord(request.query);
    reply.header('Cache-Control', 'no-store');
    return {
      traces: store.listTraces({
        limit: queryNumber(query.limit),
        query: queryString(query.query),
        status: queryString(query.status),
      }),
    };
  });

  app.get('/api/traces/:traceId', async (request, reply) => {
    const query = queryRecord(request.params);
    const traceId = queryString(query.traceId)?.slice(0, 128) ?? '';
    reply.header('Cache-Control', 'no-store');
    const trace = store.getTrace(traceId);
    return trace ? trace : reply.code(404).send({ error: 'Trace not found' });
  });

  app.get('/api/logs', async (request, reply) => {
    const query = queryRecord(request.query);
    reply.header('Cache-Control', 'no-store');
    return {
      logs: store.listLogs({
        limit: queryNumber(query.limit),
        query: queryString(query.query),
        severity: queryString(query.severity),
      }),
    };
  });

  app.get('/api/metrics', async (request, reply) => {
    const query = queryRecord(request.query);
    reply.header('Cache-Control', 'no-store');
    return {
      metrics: store.listMetrics({
        limit: queryNumber(query.limit),
        query: queryString(query.query),
      }),
    };
  });

  app.get('/api/config', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      protocol: 'OTLP/HTTP JSON',
      endpoints: {
        traces: '/v1/traces',
        metrics: '/v1/metrics',
        logs: '/v1/logs',
      },
      integrations: {
        qoderHooks: '/v1/qoder',
      },
      ...store.limits,
    };
  });

  app.get('/', async (_request, reply) => sendPublicFile(reply, '/', directory));
  app.get('/index.html', async (_request, reply) =>
    sendPublicFile(reply, '/index.html', directory)
  );
  app.get('/app.js', async (_request, reply) => sendPublicFile(reply, '/app.js', directory));
  app.get('/styles.css', async (_request, reply) =>
    sendPublicFile(reply, '/styles.css', directory)
  );
  app.get('/favicon.svg', async (_request, reply) =>
    sendPublicFile(reply, '/favicon.svg', directory)
  );

  return { app, store };
}
