import knex, { type Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest } from '../src/manifest.js';
import { botOrchestratorSeedManifest } from '../src/seed-manifest.js';
import { seedBotOrchestrator } from '../src/seed.js';
import {
  BotFlow,
  BotFlowStep,
  BotRun,
  BotStepRun,
  BotSchedule,
  BotRunQueue,
  BotFlowStatus,
  BotRunStatus,
  BotStepKind,
  BotStepRunStatus,
} from '../src/models.js';
import {
  canTransitionFlow,
  canTransitionRun,
  canTransitionStepRun,
  validateStepKindSequence,
  validateCronExpression,
} from '../src/domain.js';

describe('orm-bot-orchestrator addon', () => {
  let db: Knex;
  afterEach(async () => {
    if (db) await db.destroy();
  });

  const database = () =>
    (db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(
          connection: { pragma(sql: string): unknown },
          done: (error: Error | null, connection: unknown) => void
        ) {
          connection.pragma('foreign_keys = ON');
          done(null, connection);
        },
      },
    }));

  it('declares bot-orchestrator namespace models with bot_ table prefix and external_ref columns', () => {
    for (const model of manifest.models) {
      expect(model.modelName.startsWith('bot.')).toBe(true);
      expect(model.tableName.startsWith('bot_')).toBe(true);
    }
    expect(manifest.models.map((m) => m.modelName)).toEqual([
      'bot.flow',
      'bot.flow_step',
      'bot.run',
      'bot.step_run',
      'bot.schedule',
      'bot.run_queue',
    ]);
    expect(manifest.depends).toContain('base');
    expect(manifest.menus).toHaveLength(6);
  });

  it('installs idempotently with seed disabled by default and external_ref columns present', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);
    await installAddons(connection, [manifest, baseManifest]);

    for (const table of [
      'bot_flows',
      'bot_flow_steps',
      'bot_runs',
      'bot_step_runs',
      'bot_schedules',
      'bot_run_queue',
    ]) {
      expect(await connection.schema.hasColumn(table, 'external_ref')).toBe(true);
    }

    expect(await connection('bot_flows').count({ count: '*' }).first()).toMatchObject({ count: 0 });
    expect(await connection('bot_runs').count({ count: '*' }).first()).toMatchObject({ count: 0 });
  });

  it('persists the full bot orchestrator graph with flows, steps, runs, step runs, schedules, queue', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);

    const flow = await BotFlow.query(connection).insertAndFetch({
      code: 'BOT-TEST-001',
      name: 'Test Flow',
      status: 'active',
      version: '1.0.0',
    });

    const step1 = await BotFlowStep.query(connection).insertAndFetch({
      flow_id: flow.id,
      sequence: 10,
      name: 'Start',
      kind: 'start',
      handler: 'start',
      next_step: 20,
    });

    const step2 = await BotFlowStep.query(connection).insertAndFetch({
      flow_id: flow.id,
      sequence: 20,
      name: 'Action',
      kind: 'action',
      handler: 'process',
      next_step: 30,
    });

    const run = await BotRun.query(connection).insertAndFetch({
      flow_id: flow.id,
      status: 'running',
      trigger: 'schedule',
      context: { key: 'value' },
    });

    const stepRun1 = await BotStepRun.query(connection).insertAndFetch({
      run_id: run.id,
      step_id: step1.id,
      sequence: 10,
      status: 'succeeded',
      started_at: '2026-01-01T08:00:00.000Z',
      finished_at: '2026-01-01T08:00:01.000Z',
    });

    const stepRun2 = await BotStepRun.query(connection).insertAndFetch({
      run_id: run.id,
      step_id: step2.id,
      sequence: 20,
      status: 'in_progress',
      started_at: '2026-01-01T08:00:01.000Z',
    });

    const schedule = await BotSchedule.query(connection).insertAndFetch({
      flow_id: flow.id,
      name: 'Test Schedule',
      kind: 'interval',
      interval_seconds: 3600,
      next_run_at: '2026-01-02T08:00:00.000Z',
      status: 'active',
    });

    const queueEntry = await BotRunQueue.query(connection).insertAndFetch({
      flow_id: flow.id,
      run_id: run.id,
      priority: 50,
      payload: { test: true },
      queued_at: '2026-01-01T07:59:00.000Z',
    });

    expect(step1.flow_id).toBe(flow.id);
    expect(step2.flow_id).toBe(flow.id);
    expect(run.flow_id).toBe(flow.id);
    expect(stepRun1.run_id).toBe(run.id);
    expect(stepRun1.step_id).toBe(step1.id);
    expect(stepRun2.run_id).toBe(run.id);
    expect(stepRun2.step_id).toBe(step2.id);
    expect(schedule.flow_id).toBe(flow.id);
    expect(queueEntry.flow_id).toBe(flow.id);
    expect(queueEntry.run_id).toBe(run.id);
  });

  it('canTransitionFlow validates allowed state transitions', () => {
    expect(canTransitionFlow({ from: 'draft', to: 'active' })).toBe(true);
    expect(canTransitionFlow({ from: 'draft', to: 'archived' })).toBe(true);
    expect(canTransitionFlow({ from: 'active', to: 'paused' })).toBe(true);
    expect(canTransitionFlow({ from: 'active', to: 'archived' })).toBe(true);
    expect(canTransitionFlow({ from: 'paused', to: 'active' })).toBe(true);
    expect(canTransitionFlow({ from: 'paused', to: 'archived' })).toBe(true);
    expect(canTransitionFlow({ from: 'active', to: 'draft' })).toBe(false);
    expect(canTransitionFlow({ from: 'archived', to: 'active' })).toBe(false);
  });

  it('canTransitionRun validates allowed state transitions', () => {
    expect(canTransitionRun({ from: 'pending', to: 'running' })).toBe(true);
    expect(canTransitionRun({ from: 'pending', to: 'cancelled' })).toBe(true);
    expect(canTransitionRun({ from: 'running', to: 'succeeded' })).toBe(true);
    expect(canTransitionRun({ from: 'running', to: 'failed' })).toBe(true);
    expect(canTransitionRun({ from: 'running', to: 'cancelled' })).toBe(true);
    expect(canTransitionRun({ from: 'pending', to: 'succeeded' })).toBe(false);
    expect(canTransitionRun({ from: 'succeeded', to: 'pending' })).toBe(false);
  });

  it('canTransitionStepRun validates allowed state transitions', () => {
    expect(canTransitionStepRun({ from: 'pending', to: 'in_progress' })).toBe(true);
    expect(canTransitionStepRun({ from: 'pending', to: 'skipped' })).toBe(true);
    expect(canTransitionStepRun({ from: 'in_progress', to: 'succeeded' })).toBe(true);
    expect(canTransitionStepRun({ from: 'in_progress', to: 'failed' })).toBe(true);
    expect(canTransitionStepRun({ from: 'in_progress', to: 'skipped' })).toBe(true);
    expect(canTransitionStepRun({ from: 'pending', to: 'succeeded' })).toBe(false);
    expect(canTransitionStepRun({ from: 'succeeded', to: 'pending' })).toBe(false);
  });

  it('validateStepKindSequence checks step kind ordering', () => {
    expect(validateStepKindSequence('start', 'action')).toBe(true);
    expect(validateStepKindSequence('action', 'condition')).toBe(true);
    expect(validateStepKindSequence('condition', 'end')).toBe(true);
    expect(validateStepKindSequence('start', 'end')).toBe(true);
    expect(validateStepKindSequence('action', 'start')).toBe(false);
    expect(validateStepKindSequence('end', 'action')).toBe(false);
    expect(validateStepKindSequence('unknown', 'action')).toBe(false);
  });

  it('validateCronExpression validates cron syntax', () => {
    expect(validateCronExpression('0 2 * * *')).toEqual({ valid: true, reason: null });
    expect(validateCronExpression('*/5 * * * *')).toEqual({ valid: true, reason: null });
    expect(validateCronExpression('30 12 1 1 0')).toEqual({ valid: true, reason: null });
    expect(validateCronExpression('60 2 * * *')).toEqual({
      valid: false,
      reason: 'minute out of range (0-59)',
    });
    expect(validateCronExpression('0 24 * * *')).toEqual({
      valid: false,
      reason: 'hour out of range (0-23)',
    });
    expect(validateCronExpression('0 2 32 * *')).toEqual({
      valid: false,
      reason: 'day of month out of range (1-31)',
    });
    expect(validateCronExpression('0 2 * 13 *')).toEqual({
      valid: false,
      reason: 'month out of range (1-12)',
    });
    expect(validateCronExpression('0 2 * * 7')).toEqual({
      valid: false,
      reason: 'day of week out of range (0-6)',
    });
    expect(validateCronExpression('0 2 * *')).toEqual({
      valid: false,
      reason: 'Cron expression must have 5 fields (minute hour day month weekday)',
    });
    expect(validateCronExpression('invalid')).toEqual({
      valid: false,
      reason: 'Invalid minute field: invalid',
    });
  });

  it('bot seed manifest writes nothing unless explicitly enabled', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);

    const disabled = await botOrchestratorSeedManifest.seed({ db: connection });
    expect(disabled).toEqual({ inserted: 0, updated: 0, skipped: 0 });
    expect(await connection('bot_flows').count({ count: '*' }).first()).toMatchObject({ count: 0 });

    const enabled = await seedBotOrchestrator({
      db: connection,
      options: { enabled: true, companyId: 1 },
    });
    expect(enabled.inserted).toBeGreaterThan(0);
    expect(await connection('bot_flows').where({ code: 'BOT-CORE-001' })).toHaveLength(1);
    expect(
      await connection('bot_flow_steps').where({ flow_id: enabled.inserted > 0 ? 1 : 0 })
    ).toHaveLength(5);
    expect(await connection('bot_schedules').where({ name: 'Daily Run' })).toHaveLength(1);

    const repeat = await seedBotOrchestrator({
      db: connection,
      options: { enabled: true, companyId: 1 },
    });
    expect(repeat.inserted).toBe(0);
    expect(repeat.updated).toBeGreaterThan(0);
    expect(repeat.skipped).toBe(0);
  });

  it('exposes a seed manifest compatible with AddonSeedManifest', () => {
    expect(botOrchestratorSeedManifest.seedVersion).toBe('1.0.0');
    expect(botOrchestratorSeedManifest.dependencies).toEqual(['orm-base']);
    expect(typeof botOrchestratorSeedManifest.seed).toBe('function');
  });
});
