import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { Knex } from 'knex';
import { timingSafeEqual } from 'node:crypto';
import { Registry } from '@moonwitness/orm';
import type { HealthResponse, RootInfoResponse } from '@moonwitness/types';
import { readWhatsAppDatabaseMetrics, renderMetrics } from '../observability/metrics.js';

interface HealthRoutesOptions {
  metricsToken?: string;
  checkAttachmentStorage?: () => Promise<boolean>;
  checkWhatsAppGateway?: () => Promise<boolean>;
  checkObservability?: () => Promise<import('@moonwitness/orm-observability').ObservabilityStatus>;
}

async function readInstalledAddons(db: Knex) {
  const rows = (await db('_orm_addons').select('name', 'version').orderBy('name')) as Array<{
    name: string;
    version: string;
  }>;
  return rows;
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (fastify, options) => {
  fastify.get('/livez', async (_req, reply) =>
    reply.header('Cache-Control', 'no-store').send({ status: 'alive' })
  );

  const readiness = async (reply: FastifyReply) => {
    const dbOk = await fastify.testConnection();
    const storageOk = options.checkAttachmentStorage
      ? await options.checkAttachmentStorage().catch(() => false)
      : true;
    const installedAddons = dbOk ? await readInstalledAddons(fastify.db).catch(() => []) : [];
    const pool = fastify.db.client.pool ?? undefined;
    const databasePool = pool
      ? {
          used: pool.numUsed() ?? 0,
          free: pool.numFree() ?? 0,
          capacity: pool.numPendingCreates() ?? 0,
        }
      : undefined;

    const schemaReady = fastify.schemaReadiness.ready;
    const observability = options.checkObservability
      ? await options.checkObservability().catch(() => undefined)
      : undefined;
    const status = dbOk && storageOk && schemaReady ? 200 : 503;
    const responseBody: HealthResponse & { observability?: import('@moonwitness/orm-observability').ObservabilityStatus } = {
      status: dbOk && storageOk && schemaReady ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbOk ? 'connected' : 'disconnected',
      databasePool,
      installedAddons,
      schema: {
        status: fastify.schemaReadiness.status ?? (schemaReady ? 'applied' : 'pending'),
        ...(fastify.schemaReadiness.version === undefined
          ? {}
          : { version: fastify.schemaReadiness.version }),
        ...(fastify.schemaReadiness.digest === undefined
          ? {}
          : { digest: fastify.schemaReadiness.digest }),
      },
      attachmentStorage: storageOk ? 'connected' : 'disconnected',
      registeredModels: Registry.getNames(),
      ...(observability ? { observability } : {}),
    };
    return reply.header('Cache-Control', 'no-store').status(status).send(responseBody);
  };

  fastify.get<{ Reply: HealthResponse }>('/readyz', async (_req, reply) => readiness(reply));
  fastify.get<{ Reply: HealthResponse }>('/health', async (_req, reply) => readiness(reply));

  fastify.get('/whatsapp/readyz', async (_req, reply) => {
    const reachable = options.checkWhatsAppGateway
      ? await options.checkWhatsAppGateway().catch(() => false)
      : false;
    return reply
      .header('Cache-Control', 'no-store')
      .status(reachable ? 200 : 503)
      .send({
        status: reachable ? 'reachable' : 'unreachable',
        gateway: reachable ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
      });
  });

  fastify.get('/metrics', async (request, reply) => {
    const token = options.metricsToken;
    if (!token) return reply.code(404).send({ success: false, error: 'Not found' });
    const authorization = request.headers.authorization ?? '';
    const supplied = authorization.startsWith('Bearer ')
      ? Buffer.from(authorization.slice(7))
      : Buffer.alloc(0);
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({
        success: false,
        error: 'Authentication required',
      });
    }
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(renderMetrics(process.uptime(), await readWhatsAppDatabaseMetrics(fastify.db)));
  });

  fastify.get<{ Reply: RootInfoResponse }>('/', async (_req, _reply) => {
    const info: RootInfoResponse = {
      name: 'MoonWitness Enterprise ORM API',
      version: '1.0.0',
      docs: '/docs',
      modelsEndpoint: '/api/models',
      healthEndpoint: '/health',
      jsonrpcEndpoint: '/jsonrpc',
    };
    return info;
  });
};
