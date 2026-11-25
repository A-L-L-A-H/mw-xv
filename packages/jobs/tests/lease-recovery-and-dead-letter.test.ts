import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { Job, JobRun, OutboxEvent, jobsManifest } from '../src/models.js';
import {
  enqueueJob,
  registerJobHandler,
  registerOutboxConsumer,
  runOneJob,
  runWorkerLoop,
  runOutboxLoop,
  dispatchOneOutboxEvent,
  LeaseLostError,
} from '../src/runtime.js';
import { listDeadJobs, listDeadOutboxEvents, retryDeadJob } from '../src/dead-letter.js';

describe('lease recovery and dead-letter adversarial cases (CF-015)', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await installAddons(db, [baseManifest, jobsManifest]);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('expired-lease recovery advances fencing and rejects the stale worker completion', async () => {
    let firstStarted: () => void = () => undefined;
    let releaseFirst: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const invocations: string[] = [];
    const fencingTokens: number[] = [];
    const unregister = registerJobHandler({
      name: 'test.stale-completion',
      version: 1,
      parse(payload: unknown): { run: true } {
        if (typeof payload !== 'object' || payload === null || !('run' in payload))
          throw new Error('invalid payload');
        return { run: true };
      },
      async run(_payload, context) {
        fencingTokens.push(context.fencingToken);
        if (context.attempt === 1) {
          invocations.push('stale');
          firstStarted();
          await hold;
          return { from: 'stale' };
        }
        invocations.push('recovery');
        return { from: 'recovery' };
      },
    });
    try {
      const jobId = await enqueueJob('test.stale-completion', { run: true }, { maxAttempts: 3 });
      // Lease is artificially short so the crash window is deterministic.
      const stale = runOneJob({
        workerId: 'stale-worker',
        leaseSeconds: 3,
        heartbeatSeconds: 60,
      });
      await started;

      const claimed = await Job.query().findById(jobId).throwIfNotFound();
      expect(claimed).toMatchObject({
        status: 'running',
        fencing_token: 1,
        lease_owner: 'stale-worker',
      });
      await Job.query()
        .findById(jobId)
        .patch({ lease_until: new Date(0).toISOString() });

      // A second worker reclaims the expired lease and commits a fresh result.
      expect(await runOneJob({ workerId: 'recovery-worker' })).toBe(true);
      expect(await Job.query().findById(jobId)).toMatchObject({
        status: 'succeeded',
        attempts: 2,
        fencing_token: 2,
        lease_owner: null,
      });

      releaseFirst();
      // The stale worker's late commit must not overwrite the recovered result.
      await expect(stale).rejects.toThrow(LeaseLostError);
      expect(invocations).toEqual(['stale', 'recovery']);
      expect(fencingTokens).toEqual([1, 2]);
      expect(await Job.query().findById(jobId)).toMatchObject({
        status: 'succeeded',
        attempts: 2,
        fencing_token: 2,
      });
      const runs = await JobRun.query().where({ job_id: jobId }).orderBy('attempt');
      expect(runs).toHaveLength(2);
      expect(runs[0]).toMatchObject({
        attempt: 1,
        status: 'retrying',
        error_code: 'LEASE_EXPIRED',
      });
      expect(runs[1]).toMatchObject({ attempt: 2, status: 'succeeded' });
      expect(runs[1]?.result).toBe(JSON.stringify({ from: 'recovery' }));
      expect(await runOneJob({ workerId: 'third-worker' })).toBe(false);
    } finally {
      releaseFirst();
      unregister();
    }
  });

  it('advances fencing tokens monotonically across repeated lease re-claims', async () => {
    const unregister = registerJobHandler({
      name: 'test.fencing',
      version: 1,
      parse(payload: unknown): { run: true } {
        if (typeof payload !== 'object' || payload === null || !('run' in payload))
          throw new Error('invalid payload');
        return { run: true };
      },
      async run() {
        return { ok: true };
      },
    });
    try {
      const jobId = await enqueueJob('test.fencing', { run: true }, { maxAttempts: 10 });
      const tokens: number[] = [];
      for (let index = 0; index < 3; index += 1) {
        // Simulate a crashed worker holding an expired lease each round.
        await Job.query()
          .findById(jobId)
          .patch({
            status: 'running',
            lease_owner: `crashed-worker-${index}`,
            lease_until: new Date(0).toISOString(),
            available_at: new Date(0).toISOString(),
          });
        const before = await Job.query().findById(jobId).throwIfNotFound();
        expect(await runOneJob({ workerId: `recovery-worker-${index}` })).toBe(true);
        const after = await Job.query().findById(jobId).throwIfNotFound();
        expect(after.fencing_token).toBe(before.fencing_token + 1);
        expect(after.status).toBe('succeeded');
        tokens.push(after.fencing_token);
      }
      expect(tokens).toEqual([1, 2, 3]);
      expect(tokens[0]).toBeLessThan(tokens[1]!);
      expect(tokens[1]).toBeLessThan(tokens[2]!);
      expect(await JobRun.query().where({ job_id: jobId })).toHaveLength(3);
    } finally {
      unregister();
    }
  });

  it('dead-letters retry-exhausted jobs exactly once and ignores later deliveries', async () => {
    let calls = 0;
    const unregister = registerJobHandler({
      name: 'test.exhaust',
      version: 1,
      parse(payload: unknown): { run: true } {
        if (typeof payload !== 'object' || payload === null || !('run' in payload))
          throw new Error('invalid payload');
        return { run: true };
      },
      async run() {
        calls += 1;
        throw new Error('transient failure');
      },
    });
    try {
      const jobId = await enqueueJob('test.exhaust', { run: true }, { maxAttempts: 2 });
      expect(await runOneJob({ workerId: 'retry-worker', retryBaseSeconds: 0 })).toBe(true);
      expect(await Job.query().findById(jobId)).toMatchObject({ status: 'queued', attempts: 1 });
      await Job.query()
        .findById(jobId)
        .patch({ available_at: new Date(0).toISOString() });
      expect(await runOneJob({ workerId: 'retry-worker' })).toBe(true);
      expect(await Job.query().findById(jobId)).toMatchObject({ status: 'dead', attempts: 2 });

      const deadRuns = await JobRun.query().where({ job_id: jobId, status: 'dead' });
      expect(deadRuns).toHaveLength(1);
      expect(calls).toBe(2);
      expect(await runOneJob({ workerId: 'retry-worker' })).toBe(false);
      expect(calls).toBe(2);
      expect((await listDeadJobs()).filter(({ id }) => id === jobId)).toHaveLength(1);
      expect(await retryDeadJob(jobId)).toBe(true);
      expect(await retryDeadJob(jobId)).toBe(false);
    } finally {
      unregister();
    }
  });

  it('does not duplicate non-idempotent effects on duplicate delivery', async () => {
    let effects = 0;
    const unregister = registerJobHandler({
      name: 'test.effect',
      version: 1,
      parse(payload: unknown): { run: true } {
        if (typeof payload !== 'object' || payload === null || !('run' in payload))
          throw new Error('invalid payload');
        return { run: true };
      },
      async run() {
        effects += 1;
        return { done: true };
      },
    });
    try {
      const ids = await Promise.all([
        enqueueJob('test.effect', { run: true }, { idempotencyKey: 'dedupe-once' }),
        enqueueJob('test.effect', { run: true }, { idempotencyKey: 'dedupe-once' }),
      ]);
      expect(ids[0]).toBe(ids[1]);
      expect(await Job.query().where({ handler: 'test.effect' })).toHaveLength(1);
      expect(await runOneJob({ workerId: 'effect-worker' })).toBe(true);
      expect(effects).toBe(1);
      expect(await runOneJob({ workerId: 'effect-worker' })).toBe(false);
      expect(effects).toBe(1);
    } finally {
      unregister();
    }
  });

  it('only one of two concurrent claimants processes the same outbox event', async () => {
    let started: () => void = () => undefined;
    let release: () => void = () => undefined;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deliveries: number[] = [];
    const unregister = registerOutboxConsumer('outbox.concurrent', async (_payload, eventId) => {
      deliveries.push(eventId);
      started();
      await hold;
    });
    try {
      const event = await OutboxEvent.query().insertAndFetch({
        event_type: 'outbox.concurrent',
        aggregate_model: 'base.partner',
        aggregate_id: 1,
        payload: '{}',
        available_at: new Date().toISOString(),
        max_attempts: 3,
      });
      const first = dispatchOneOutboxEvent('outbox-one');
      await began;
      expect(await dispatchOneOutboxEvent('outbox-two')).toBe(false);
      release();
      expect(await first).toBe(true);
      expect(deliveries).toEqual([event.id]);
      expect(await OutboxEvent.query().findById(event.id)).toMatchObject({
        status: 'published',
        attempts: 1,
        fencing_token: 1,
        lease_owner: null,
      });
    } finally {
      release();
      unregister();
    }
  });

  it('dead-letters retry-exhausted outbox events exactly once', async () => {
    let attempts = 0;
    const unregister = registerOutboxConsumer('outbox.exhaust', async () => {
      attempts += 1;
      throw new Error('delivery failed');
    });
    try {
      const event = await OutboxEvent.query().insertAndFetch({
        event_type: 'outbox.exhaust',
        aggregate_model: 'base.partner',
        aggregate_id: 2,
        payload: '{}',
        available_at: new Date(0).toISOString(),
        max_attempts: 2,
      });
      expect(await dispatchOneOutboxEvent('outbox-retry')).toBe(true);
      expect(await OutboxEvent.query().findById(event.id)).toMatchObject({
        status: 'pending',
        attempts: 1,
      });
      // Skip the retry backoff so the exhaustion transition is deterministic.
      await OutboxEvent.query()
        .findById(event.id)
        .patch({ available_at: new Date(0).toISOString() });
      expect(await dispatchOneOutboxEvent('outbox-retry')).toBe(true);
      const dead = await OutboxEvent.query().findById(event.id).throwIfNotFound();
      expect(dead).toMatchObject({ status: 'dead', attempts: 2 });
      expect(dead.last_error).toContain('JOB_FAILED');
      expect(attempts).toBe(2);
      expect(await dispatchOneOutboxEvent('outbox-retry')).toBe(false);
      expect(attempts).toBe(2);
      expect((await listDeadOutboxEvents()).filter(({ id }) => id === event.id)).toHaveLength(1);
    } finally {
      unregister();
    }
  });

  it('recovers a crashed outbox lease without replaying an already published event', async () => {
    const deliveries: number[] = [];
    const unregister = registerOutboxConsumer('outbox.restart', async (_payload, eventId) => {
      deliveries.push(eventId);
    });
    try {
      const event = await OutboxEvent.query().insertAndFetch({
        event_type: 'outbox.restart',
        aggregate_model: 'base.partner',
        aggregate_id: 3,
        payload: '{}',
        available_at: new Date(0).toISOString(),
        status: 'processing',
        attempts: 1,
        max_attempts: 3,
        fencing_token: 1,
        lease_owner: 'crashed-outbox',
        lease_until: new Date(0).toISOString(),
      });
      expect(await dispatchOneOutboxEvent('restarted-outbox')).toBe(true);
      expect(deliveries).toEqual([event.id]);
      expect(await OutboxEvent.query().findById(event.id)).toMatchObject({
        status: 'published',
        attempts: 2,
        fencing_token: 2,
        lease_owner: null,
      });
      // A restart must not redeliver a completed event.
      expect(await dispatchOneOutboxEvent('restarted-outbox')).toBe(false);
      expect(deliveries).toEqual([event.id]);
    } finally {
      unregister();
    }
  });

  it('worker loop survives a transient lease loss instead of terminating', async () => {
    const controller = new AbortController();
    let calls = 0;
    const seen: string[] = [];
    await runWorkerLoop(
      { workerId: 'loop-worker' },
      controller.signal,
      0,
      {},
      {
        runJob: async () => {
          calls += 1;
          if (calls === 1) throw new LeaseLostError();
          seen.push('continued');
          controller.abort();
          return true;
        },
        onLeaseLost: (kind) => seen.push(kind),
      }
    );
    expect(calls).toBe(2);
    expect(seen).toEqual(['job', 'continued']);
  });

  it('outbox loop survives a transient lease loss instead of terminating', async () => {
    const controller = new AbortController();
    let calls = 0;
    const seen: string[] = [];
    await runOutboxLoop('outbox-loop-worker', controller.signal, 0, {
      dispatchEvent: async () => {
        calls += 1;
        if (calls === 1) throw new LeaseLostError();
        seen.push('continued');
        controller.abort();
        return true;
      },
      onLeaseLost: (kind) => seen.push(kind),
    });
    expect(calls).toBe(2);
    expect(seen).toEqual(['outbox', 'continued']);
  });
});
