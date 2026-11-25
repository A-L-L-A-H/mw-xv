import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { createServiceToken } from '@moonwitness/orm';
import { startWorkerCommand, type WorkerBootstrapDeps } from '../src/commands/worker-bootstrap.js';
import type { WorkerHealthServer } from '../src/commands/worker-health.js';

function createFakeDb() {
  return {
    destroy: vi.fn(async () => undefined),
  } as unknown as Knex & { destroy: ReturnType<typeof vi.fn> };
}

function createFakeHealthServer() {
  return {
    app: {} as WorkerHealthServer['app'],
    contract: {} as WorkerHealthServer['contract'],
    setReady: vi.fn(),
    beginDrain: vi.fn(),
    close: vi.fn(async () => undefined),
  } as unknown as WorkerHealthServer & {
    beginDrain: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

function createHarness(overrides: Partial<WorkerBootstrapDeps> = {}) {
  const db = createFakeDb();
  const healthServer = createFakeHealthServer();
  const bootstrapApiWorker = vi.fn(async () => undefined);
  const startWorkerHealthServer = vi.fn(async () => healthServer);

  const deps: Partial<WorkerBootstrapDeps> = {
    createDatabase: () => db,
    bootstrapApiWorker,
    startWorkerHealthServer,
    env: {},
    ...overrides,
  };

  return { db, healthServer, bootstrapApiWorker, startWorkerHealthServer, deps };
}

describe('worker-bootstrap', () => {
  it('bootstraps db, registers health and extra services, runs worker, and tears down in LIFO order', async () => {
    const events: string[] = [];
    const { db, healthServer, bootstrapApiWorker, startWorkerHealthServer, deps } = createHarness({
      env: {
        OUTBOX_WORKER_HEALTH_PORT: '9401',
        METRICS_TOKEN: 'worker-metrics-token-at-least-32-characters',
      },
    });
    const extraToken = createServiceToken<{ id: string }>('api.test.extra');
    const healthToken = createServiceToken<WorkerHealthServer | null>('api.workerHealth');

    await startWorkerCommand(
      {
        name: 'outbox-worker',
        healthPortEnvVar: 'OUTBOX_WORKER_HEALTH_PORT',
        metricsToken: 'worker-metrics-token-at-least-32-characters',
        async setup({ db: ctxDb, services, registerCleanup }) {
          expect(ctxDb).toBe(db);
          events.push('setup');
          services.register(extraToken, { id: 'extra-1' }, () => {
            events.push('dispose:extra');
          });
          registerCleanup(() => {
            events.push('cleanup:first');
          });
          registerCleanup(() => {
            events.push('cleanup:second');
          });
        },
        async run({ services, signal, getWorkerHealth, registerCleanup }) {
          expect(signal.aborted).toBe(false);
          expect(getWorkerHealth()).toBe(healthServer);
          expect(services.get(healthToken)).toBe(healthServer);
          expect(services.get(extraToken)).toEqual({ id: 'extra-1' });
          registerCleanup(() => {
            events.push('cleanup:run');
          });
          events.push('run');
        },
      },
      deps
    );

    expect(bootstrapApiWorker).toHaveBeenCalledWith(db);
    expect(startWorkerHealthServer).toHaveBeenCalledWith({
      db,
      host: '127.0.0.1',
      name: 'outbox-worker',
      metricsToken: 'worker-metrics-token-at-least-32-characters',
      port: 9401,
    });
    expect(events).toEqual([
      'setup',
      'run',
      'cleanup:run',
      'cleanup:second',
      'cleanup:first',
      'dispose:extra',
    ]);
    expect(healthServer.close).toHaveBeenCalledTimes(1);
    expect(db.destroy).toHaveBeenCalledTimes(1);
  });

  it('skips starting health server if shutdown aborts during setup', async () => {
    const controller = new AbortController();
    const dispose = vi.fn();
    const { db, startWorkerHealthServer, deps } = createHarness({
      createProcessShutdownController: () => ({
        signal: controller.signal,
        dispose,
      }),
    });

    await startWorkerCommand(
      {
        name: 'jobs-scheduler',
        healthPortEnvVar: 'JOBS_SCHEDULER_HEALTH_PORT',
        setup() {
          controller.abort();
        },
        async run({ signal, getWorkerHealth }) {
          expect(signal.aborted).toBe(true);
          expect(getWorkerHealth()).toBeNull();
        },
      },
      deps
    );

    expect(startWorkerHealthServer).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(db.destroy).toHaveBeenCalledTimes(1);
  });

  it('triggers health drain and aborts signal when shutdown controller stops', async () => {
    let triggerStop: (() => void) | undefined;
    const controller = new AbortController();
    const dispose = vi.fn();
    const { healthServer, deps } = createHarness({
      env: { JOBS_WORKER_HEALTH_PORT: '9402' },
      createProcessShutdownController: (onStopping, options) => {
        triggerStop = () => {
          onStopping?.();
          void options?.services?.disposeAll();
          controller.abort();
        };
        return {
          signal: controller.signal,
          dispose,
        };
      },
    });

    await startWorkerCommand(
      {
        name: 'jobs-worker',
        healthPortEnvVar: 'JOBS_WORKER_HEALTH_PORT',
        async run({ signal }) {
          expect(signal.aborted).toBe(false);
          triggerStop?.();
          expect(signal.aborted).toBe(true);
        },
      },
      deps
    );

    expect(healthServer.beginDrain).toHaveBeenCalledWith('SIGTERM');
    expect(healthServer.close).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('runs full teardown without masking primary error when setup or run fails', async () => {
    const events: string[] = [];
    const { db, healthServer, deps } = createHarness({
      env: { JOBS_WORKER_HEALTH_PORT: '9403' },
    });

    await expect(
      startWorkerCommand(
        {
          name: 'jobs-worker',
          healthPortEnvVar: 'JOBS_WORKER_HEALTH_PORT',
          setup({ registerCleanup }) {
            registerCleanup(() => {
              events.push('cleanup:throws');
              throw new Error('secondary cleanup error');
            });
            registerCleanup(() => {
              events.push('cleanup:ok');
            });
          },
          async run() {
            throw new Error('primary loop failure');
          },
        },
        deps
      )
    ).rejects.toThrow('primary loop failure');

    expect(events).toEqual(['cleanup:ok', 'cleanup:throws']);
    expect(healthServer.close).toHaveBeenCalledTimes(1);
    expect(db.destroy).toHaveBeenCalledTimes(1);
  });

  it('propagates cleanup errors when primary execution succeeds and validates host/port env', async () => {
    const { db, deps } = createHarness({
      env: { WORKER_HEALTH_HOST: '0.0.0.0', JOBS_WORKER_HEALTH_PORT: '9404' },
    });

    await expect(
      startWorkerCommand(
        {
          name: 'jobs-worker',
          healthPortEnvVar: 'JOBS_WORKER_HEALTH_PORT',
          async run() {
            return;
          },
        },
        deps
      )
    ).rejects.toThrow('WORKER_HEALTH_HOST must be a loopback interface');
    expect(db.destroy).toHaveBeenCalledTimes(1);

    const cleanupHarness = createHarness();
    await expect(
      startWorkerCommand(
        {
          name: 'jobs-scheduler',
          healthPortEnvVar: 'JOBS_SCHEDULER_HEALTH_PORT',
          setup({ registerCleanup }) {
            registerCleanup(() => {
              throw new Error('cleanup failure');
            });
          },
          async run() {
            return;
          },
        },
        cleanupHarness.deps
      )
    ).rejects.toThrow('cleanup failure');
    expect(cleanupHarness.db.destroy).toHaveBeenCalledTimes(1);
  });
});
