import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkerHealthContract,
  isSafeBindHost,
  readWorkerHealthHost,
  readWorkerHealthPort,
  sanitizeHealthDetail,
  validateWorkerProbeConfig,
  type WorkerHealthResponse,
} from '../src/health.js';
import { createGracefulDrainController, DrainTimeoutError, raceWithAbort } from '../src/drain.js';

const fixture = fileURLToPath(new URL('./fixtures/drain-worker.mjs', import.meta.url));

interface ChildMessage {
  type: string;
  [key: string]: unknown;
}

const CHILD_STARTUP_TIMEOUT_MS = 30_000;
const DRAIN_ASSERTION_TIMEOUT_MS = 10_000;

describe('shared worker health contract (CF-013 / CF-014)', () => {
  it('keeps readiness false until bootstrap and required dependencies are ready', async () => {
    const clock = 1_000;
    const health = createWorkerHealthContract({
      worker: 'jobs-worker',
      dependencies: ['database', 'redis'],
      now: () => clock,
    });
    expect(health.state).toBe('starting');
    expect(health.isReady()).toBe(false);
    expect((await health.getReadiness()).status).toBe('not-ready');

    health.setDependencyStatus('database', 'up');
    expect(health.isReady()).toBe(false);
    health.markBootstrapped();
    expect(health.isReady()).toBe(false);
    health.setDependencyStatus('redis', 'up');
    expect(health.isReady()).toBe(true);
    expect((await health.getReadiness()).status).toBe('ready');
    expect(health.getLiveness()).toMatchObject({
      status: 'alive',
      worker: 'jobs-worker',
      pid: process.pid,
    });
  });

  it('flips readiness false before drain while liveness stays alive', async () => {
    const order: string[] = [];
    const health = createWorkerHealthContract({ worker: 'outbox-worker', bootstrapped: true });
    health.setDependencyStatus('database', 'up');
    expect(health.isReady()).toBe(true);

    const drain = createGracefulDrainController({
      workerId: 'outbox-worker',
      drainTimeoutMs: 1_000,
      onDrainStart: () => {
        health.beginDrain('SIGTERM');
        order.push(`drain-start:${health.isReady()}`);
      },
    });
    drain.enterJob();
    drain.begin('SIGTERM');
    order.push('await-in-flight');
    expect(order).toEqual(['drain-start:false', 'await-in-flight']);
    expect((await health.getReadiness()).status).toBe('not-ready');
    expect(health.state).toBe('draining');
    expect(health.getLiveness().status).toBe('alive');

    drain.exitJob(true);
    const outcome = drain.finish();
    expect(outcome).toMatchObject({ state: 'drained', completed: 1, timedOut: false });
    health.markStopped();
    expect(health.getLiveness().status).toBe('alive');
    expect(health.isReady()).toBe(false);
  });

  it('turns readiness false on dependency loss and recovers via probes', async () => {
    let databaseUp = true;
    const health = createWorkerHealthContract({ worker: 'jobs-scheduler', bootstrapped: true });
    health.registerDependency('database', () => databaseUp);
    health.setDependencyStatus('database', 'up');
    expect(health.isReady()).toBe(true);

    databaseUp = false;
    const degraded = await health.getReadiness();
    expect(degraded).toMatchObject({
      status: 'not-ready',
      dependencies: [{ name: 'database', status: 'down' }],
    });
    expect(health.isReady()).toBe(false);

    databaseUp = true;
    expect((await health.getReadiness()).status).toBe('ready');
  });

  it('exposes an identical, safe response shape for jobs, scheduler and outbox workers', async () => {
    const contracts = ['jobs-worker', 'jobs-scheduler', 'outbox-worker'].map((worker) => {
      const contract = createWorkerHealthContract({ worker, bootstrapped: true });
      contract.setDependencyStatus('database', 'up');
      return contract;
    });
    const snapshots: WorkerHealthResponse[] = await Promise.all(
      contracts.map((contract) => contract.snapshot())
    );
    const [first, ...rest] = snapshots;
    expect(Object.keys(first.live).sort()).toEqual(['pid', 'status', 'uptimeSeconds', 'worker']);
    expect(Object.keys(first.ready).sort()).toEqual([
      'dependencies',
      'ready',
      'state',
      'status',
      'worker',
    ]);
    for (const snapshot of rest) {
      expect(Object.keys(snapshot.live).sort()).toEqual(Object.keys(first.live).sort());
      expect(Object.keys(snapshot.ready).sort()).toEqual(Object.keys(first.ready).sort());
    }
    expect(JSON.stringify(snapshots)).not.toMatch(/password|secret|token|Bearer/i);
  });

  it('redacts secrets from dependency detail', () => {
    expect(sanitizeHealthDetail('connect failed: password=hunter2 Bearer abc.def token: XYZ')).toBe(
      'connect failed: [REDACTED] [REDACTED] [REDACTED]'
    );
    expect(sanitizeHealthDetail(undefined)).toBeUndefined();
  });

  it('validates ports and only allows loopback bind interfaces with actionable errors', () => {
    expect(readWorkerHealthPort(undefined, 'JOBS_WORKER_HEALTH_PORT')).toBe(0);
    expect(readWorkerHealthPort('9123', 'JOBS_WORKER_HEALTH_PORT')).toBe(9123);
    expect(() => readWorkerHealthPort('-1', 'JOBS_WORKER_HEALTH_PORT')).toThrow(
      'JOBS_WORKER_HEALTH_PORT must be an integer between 0 and 65535'
    );
    expect(() => readWorkerHealthPort('70000', 'JOBS_WORKER_HEALTH_PORT')).toThrow(
      'JOBS_WORKER_HEALTH_PORT must be an integer between 0 and 65535'
    );
    expect(isSafeBindHost('127.0.0.1')).toBe(true);
    expect(isSafeBindHost('::1')).toBe(true);
    expect(isSafeBindHost('0.0.0.0')).toBe(false);
    expect(readWorkerHealthHost(undefined, 'WORKER_HEALTH_HOST')).toBe('127.0.0.1');
    expect(() => readWorkerHealthHost('0.0.0.0', 'WORKER_HEALTH_HOST')).toThrow(
      'WORKER_HEALTH_HOST must be a loopback interface'
    );
    expect(validateWorkerProbeConfig({ name: 'SCHEDULER_HEALTH_PORT', port: 0 })).toBeNull();
    expect(validateWorkerProbeConfig({ name: 'OUTBOX_WORKER_HEALTH_PORT', port: '9100' })).toEqual({
      host: '127.0.0.1',
      port: 9100,
    });
    expect(() =>
      validateWorkerProbeConfig({
        name: 'OUTBOX_WORKER_HEALTH_PORT',
        port: 9100,
        host: '0.0.0.0',
      })
    ).toThrow('OUTBOX_WORKER_HEALTH_PORT_HOST must be a loopback interface');
  });

  it('rejects a non-finite or negative drain timeout', () => {
    expect(() => createGracefulDrainController({ workerId: 'w', drainTimeoutMs: -1 })).toThrow(
      'drainTimeoutMs'
    );
    expect(() =>
      createGracefulDrainController({ workerId: 'w', drainTimeoutMs: Number.NaN })
    ).toThrow('drainTimeoutMs');
  });

  it('bounds in-flight work with raceWithAbort', async () => {
    const controller = new AbortController();
    const never = new Promise<number>(() => {});
    const raced = raceWithAbort(never, controller.signal);
    controller.abort(new DrainTimeoutError('w'));
    await expect(raced).rejects.toBeInstanceOf(DrainTimeoutError);
  });
});

describe('child-process worker drain scenarios (CF-013)', () => {
  const children: ChildProcessWithoutNullStreams[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) {
      if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
    }
  });

  function spawnWorker(mode: string, timeoutMs = 300): ChildProcessWithoutNullStreams {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', fixture, mode, String(timeoutMs)],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    children.push(child);
    return child;
  }

  function messagesOf(child: ChildProcessWithoutNullStreams): ChildMessage[] {
    const messages: ChildMessage[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue;
        try {
          messages.push(JSON.parse(line) as ChildMessage);
        } catch {
          // ignore non-JSON diagnostics
        }
      }
    });
    return messages;
  }

  function waitForMessage(
    child: ChildProcessWithoutNullStreams,
    messages: ChildMessage[],
    type: string,
    timeoutMs = CHILD_STARTUP_TIMEOUT_MS
  ): Promise<ChildMessage> {
    return new Promise((resolve, reject) => {
      const buffered = messages.find((message) => message.type === type);
      if (buffered) return resolve(buffered);

      let stdout = '';
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.off('exit', onExit);
      };
      const onData = (chunk: Buffer) => {
        stdout += String(chunk);
        let newline = stdout.indexOf('\n');
        while (newline !== -1) {
          const line = stdout.slice(0, newline);
          stdout = stdout.slice(newline + 1);
          if (line.trim()) {
            try {
              const message = JSON.parse(line) as ChildMessage;
              if (message.type === type) {
                cleanup();
                resolve(message);
                return;
              }
            } catch {
              // Ignore non-JSON diagnostics.
            }
          }
          newline = stdout.indexOf('\n');
        }
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new Error(
            `Child exited before "${type}" message (code=${String(code)}, signal=${String(signal)})`
          )
        );
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for "${type}" message`));
      }, timeoutMs);

      child.stdout.on('data', onData);
      child.once('exit', onExit);
    });
  }

  function signalDrain(child: ChildProcessWithoutNullStreams, message: ChildMessage): void {
    // "ready" proves the child installed its drain handler; stdin is a
    // deterministic trigger that cannot be delivered before that point, as a
    // process-level SIGTERM can on a loaded CI runner.
    child.stdin.write(JSON.stringify({ command: 'drain', reason: message.type }) + '\n');
  }

  function waitForExit(
    child: ChildProcessWithoutNullStreams
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal }))
    );
  }

  it(
    'drains in-flight work normally and flips readiness before draining',
    async () => {
      const child = spawnWorker('drain', 1_000);
      const messages = messagesOf(child);
      const ready = await waitForMessage(child, messages, 'ready');
      expect(ready).toMatchObject({ ready: true });
      const exited = waitForExit(child);
      signalDrain(child, ready);

      expect(await waitForMessage(child, messages, 'drain-started')).toMatchObject({
        ready: false,
        state: 'draining',
      });
      expect(await waitForMessage(child, messages, 'outcome')).toMatchObject({
        state: 'drained',
        completed: 1,
        abandoned: 0,
        timedOut: false,
        ready: false,
      });
      expect(await exited).toMatchObject({ code: 0, signal: null });
    },
    CHILD_STARTUP_TIMEOUT_MS
  );

  it(
    'bounds a stuck in-flight job with a drain timeout',
    async () => {
      const child = spawnWorker('timeout', 200);
      const messages = messagesOf(child);
      const ready = await waitForMessage(child, messages, 'ready');
      expect(ready).toMatchObject({ ready: true });
      const exited = waitForExit(child);
      const drainStartedAt = Date.now();
      signalDrain(child, ready);

      expect(await waitForMessage(child, messages, 'outcome')).toMatchObject({
        state: 'abandoned',
        abandoned: 1,
        timedOut: true,
        error: 'DrainTimeoutError',
        ready: false,
      });
      expect(Date.now() - drainStartedAt).toBeLessThan(DRAIN_ASSERTION_TIMEOUT_MS);
      expect(await exited).toMatchObject({ code: 0 });
    },
    CHILD_STARTUP_TIMEOUT_MS
  );

  it(
    'forced termination stops the child without a graceful commit',
    async () => {
      const child = spawnWorker('forced', 1_000);
      const messages = messagesOf(child);
      expect(await waitForMessage(child, messages, 'ready')).toMatchObject({ ready: true });
      const exited = waitForExit(child);
      child.kill('SIGKILL');
      expect(await exited).toMatchObject({ signal: 'SIGKILL' });
      expect(messages.some((message) => message.type === 'outcome')).toBe(false);
    },
    CHILD_STARTUP_TIMEOUT_MS
  );
});
