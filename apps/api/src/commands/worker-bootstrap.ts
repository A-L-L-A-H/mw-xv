import type { Knex } from 'knex';
import { ServiceContainer, createServiceToken } from '@moonwitness/orm';
import { bootstrapApiWorker } from '../addons/registry.js';
import { createDatabase } from '../database/knex.js';
import { createProcessShutdownController } from '../lifecycle/process-shutdown.js';
import {
  readWorkerHealthHost,
  readWorkerHealthPort,
  startWorkerHealthServer,
  type WorkerHealthServer,
} from './worker-health.js';

export type WorkerCleanup = () => Promise<void> | void;

export interface WorkerCommandContext {
  readonly db: Knex;
  readonly services: ServiceContainer;
  readonly signal: AbortSignal;
  readonly getWorkerHealth: () => WorkerHealthServer | null;
  readonly registerCleanup: (cleanup: WorkerCleanup) => void;
}

export interface WorkerCommandOptions {
  readonly name: string;
  readonly healthPortEnvVar: string;
  readonly metricsToken?: string;
  readonly setup?: (ctx: WorkerCommandContext) => Promise<void> | void;
  readonly run: (ctx: WorkerCommandContext) => Promise<void>;
}

export interface WorkerBootstrapDeps {
  createDatabase: typeof createDatabase;
  bootstrapApiWorker: typeof bootstrapApiWorker;
  createProcessShutdownController: typeof createProcessShutdownController;
  startWorkerHealthServer: typeof startWorkerHealthServer;
  readWorkerHealthHost: typeof readWorkerHealthHost;
  readWorkerHealthPort: typeof readWorkerHealthPort;
  env: NodeJS.ProcessEnv;
}

/**
 * Run a worker CLI command with shared database lifecycle, shutdown signals,
 * service container registration, health probe server, and deterministic teardown.
 */
export async function startWorkerCommand(
  options: WorkerCommandOptions,
  deps: Partial<WorkerBootstrapDeps> = {}
): Promise<void> {
  const createDb = deps.createDatabase ?? createDatabase;
  const bootstrapWorker = deps.bootstrapApiWorker ?? bootstrapApiWorker;
  const createShutdown = deps.createProcessShutdownController ?? createProcessShutdownController;
  const startHealth = deps.startWorkerHealthServer ?? startWorkerHealthServer;
  const readHealthHost = deps.readWorkerHealthHost ?? readWorkerHealthHost;
  const readHealthPort = deps.readWorkerHealthPort ?? readWorkerHealthPort;
  const env = deps.env ?? process.env;

  const db = createDb();
  let workerHealth: WorkerHealthServer | null = null;
  let healthClosePromise: Promise<void> | undefined;
  const closeWorkerHealth = () => {
    if (!workerHealth) return undefined;
    healthClosePromise ??= workerHealth.close();
    return healthClosePromise;
  };
  const services = new ServiceContainer();
  const workerHealthToken = createServiceToken<WorkerHealthServer | null>('api.workerHealth');
  const shutdown = createShutdown(() => workerHealth?.beginDrain('SIGTERM'), { services });
  const cleanups: WorkerCleanup[] = [];
  const ctx: WorkerCommandContext = {
    db,
    services,
    signal: shutdown.signal,
    getWorkerHealth: () => workerHealth,
    registerCleanup: (cleanup) => {
      cleanups.push(cleanup);
    },
  };

  let cleanupError: unknown;
  try {
    await bootstrapWorker(db);
    await options.setup?.(ctx);
    if (!shutdown.signal.aborted) {
      workerHealth = await startHealth({
        db,
        host: readHealthHost(env.WORKER_HEALTH_HOST, 'WORKER_HEALTH_HOST'),
        name: options.name,
        ...(options.metricsToken !== undefined ? { metricsToken: options.metricsToken } : {}),
        port: readHealthPort(env[options.healthPortEnvVar], options.healthPortEnvVar),
      });
      services.register(workerHealthToken, workerHealth, closeWorkerHealth);
    }
    await options.run(ctx);
  } finally {
    shutdown.dispose();
    const recordCleanupError = (error: unknown) => {
      cleanupError ??= error;
    };
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      try {
        await cleanup?.();
      } catch (error) {
        recordCleanupError(error);
      }
    }
    try {
      await services.disposeAll();
    } catch (error) {
      recordCleanupError(error);
    }
    try {
      await closeWorkerHealth();
    } catch (error) {
      recordCleanupError(error);
    }
    try {
      await db.destroy();
    } catch (error) {
      recordCleanupError(error);
    }
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
}
