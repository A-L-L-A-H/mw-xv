import Fastify, { type FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { timingSafeEqual } from 'node:crypto';
import {
  createWorkerHealthContract,
  validateWorkerProbeConfig,
  type WorkerHealthContract,
} from '@moonwitness/jobs';
import { testConnection } from '../database/knex.js';
import { readWhatsAppDatabaseMetrics, renderMetrics } from '../observability/metrics.js';

export { readWorkerHealthPort, readWorkerHealthHost } from '@moonwitness/jobs';

async function readInstalledAddons(db: Knex) {
  return (await db('_orm_addons').select('name', 'version').orderBy('name')) as Array<{
    name: string;
    version: string;
  }>;
}

export interface WorkerHealthOptions {
  db: Knex;
  host: string;
  name: string;
  port: number;
  metricsToken?: string;
}

export interface WorkerHealthServer {
  app: FastifyInstance;
  /** Shared, transport-agnostic health contract (CF-013/CF-014). */
  contract: WorkerHealthContract;
  setReady(ready: boolean): void;
  beginDrain(reason?: string): void;
  close(): Promise<void>;
}

export async function startWorkerHealthServer(
  options: WorkerHealthOptions
): Promise<WorkerHealthServer | null> {
  const config = validateWorkerProbeConfig({
    name: `${options.name.toUpperCase().replace(/[^A-Z0-9]/gu, '_')}_HEALTH`,
    host: options.host,
    port: options.port,
  });
  if (config === null) return null;
  const app = Fastify({ logger: false });
  const contract = createWorkerHealthContract({ worker: options.name });
  contract.registerDependency('database', async () => testConnection(options.db));
  let closing: Promise<void> | undefined;
  app.get('/livez', async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').send(contract.getLiveness())
  );
  app.get('/readyz', async (_request, reply) => {
    const readiness = await contract.getReadiness();
    const dbOk =
      readiness.dependencies.find((dependency) => dependency.name === 'database')?.status === 'up';
    const installedAddons = dbOk ? await readInstalledAddons(options.db).catch(() => []) : [];
    const pool = options.db.client.pool ?? undefined;
    const databasePool = pool
      ? {
          used: pool.numUsed() ?? 0,
          free: pool.numFree() ?? 0,
          capacity: pool.numPendingCreates() ?? 0,
        }
      : undefined;
    return reply
      .header('Cache-Control', 'no-store')
      .status(readiness.ready ? 200 : 503)
      .send({
        ...readiness,
        database: dbOk ? 'connected' : 'disconnected',
        databasePool,
        installedAddons,
      });
  });
  app.get('/metrics', async (request, reply) => {
    const token = options.metricsToken;
    if (!token) return reply.code(404).send({ success: false, error: 'Not found' });
    const authorization = request.headers.authorization ?? '';
    const supplied = authorization.startsWith('Bearer ')
      ? Buffer.from(authorization.slice(7))
      : Buffer.alloc(0);
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({
        success: false,
        error: 'Authentication required',
      });
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(renderMetrics(process.uptime(), await readWhatsAppDatabaseMetrics(options.db)));
  });
  try {
    await app.listen({ host: config.host, port: config.port });
    // Bootstrap is complete once the probe listener is live; specific dependencies
    // still gate readiness through their registered probes.
    contract.markBootstrapped();
  } catch (error) {
    await app.close();
    throw error;
  }
  return {
    app,
    contract,
    setReady(ready) {
      contract.setReady(ready);
    },
    beginDrain(reason = 'shutdown') {
      // Readiness turns false before any in-flight work is drained.
      contract.beginDrain(reason);
    },
    close() {
      contract.markStopped();
      closing ??= app.close();
      return closing;
    },
  };
}
