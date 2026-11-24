import type { Knex } from 'knex';
import type { SeedContext, SeedResult } from '@moonwitness/orm-base';
import { BotFlow, BotFlowStep, BotRun, BotStepRun, BotRunQueue, BotSchedule } from './models.js';

export const BOT_ORCHESTRATOR_SEED_VERSION = '1.0.0';
export const BOT_ORCHESTRATOR_DEPENDENCIES = ['orm-base'] as const;

export interface BotOrchestratorSeedOptions {
  /** Seed data is DISABLED by default; pass enabled: true explicitly. */
  readonly enabled?: boolean;
  readonly companyId?: number;
}

const BOT_TABLES = [
  BotFlowStep.tableName,
  BotStepRun.tableName,
  BotRun.tableName,
  BotRunQueue.tableName,
  BotSchedule.tableName,
  BotFlow.tableName,
];

export async function countBotOrchestratorRows(db: Knex): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    BOT_TABLES.map(async (table) => {
      const row = await db(table).count({ count: '*' }).first();
      counts[table] = Number(row?.count ?? 0);
    })
  );
  return counts;
}

export async function seedBotOrchestrator(ctx: {
  db: Knex;
  options?: BotOrchestratorSeedOptions;
}): Promise<SeedResult> {
  const options = ctx.options ?? {};

  if (options.enabled !== true) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  const db = ctx.db;
  let inserted = 0;
  let updated = 0;

  // Seed BotFlow - upsert by code
  const existingFlow = await db(BotFlow.tableName)
    .where({ code: 'BOT-CORE-001' })
    .first();

  let flowId: number;
  if (existingFlow) {
    await db(BotFlow.tableName)
      .where({ id: existingFlow.id })
      .update({
        name: 'Core Bot Flow',
        status: 'active',
        version: '1.0.0',
        updated_at: new Date(),
      });
    flowId = existingFlow.id;
    updated += 1;
  } else {
    const [flow] = await db(BotFlow.tableName)
      .insert({
        code: 'BOT-CORE-001',
        name: 'Core Bot Flow',
        status: 'active',
        version: '1.0.0',
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id');
    flowId = flow.id;
    inserted += 1;
  }

  // Seed BotFlowSteps for the core flow - upsert by (flow_id, sequence)
  const steps = [
    { flow_id: flowId, sequence: 10, name: 'Start', kind: 'start', handler: 'start' },
    { flow_id: flowId, sequence: 20, name: 'Process', kind: 'action', handler: 'process', next_step: 30 },
    { flow_id: flowId, sequence: 30, name: 'Decision', kind: 'condition', handler: 'decide', next_step: 40, error_step: 50 },
    { flow_id: flowId, sequence: 40, name: 'Success', kind: 'action', handler: 'success', next_step: 50 },
    { flow_id: flowId, sequence: 50, name: 'End', kind: 'end', handler: 'end' },
  ];

  for (const step of steps) {
    const existingStep = await db(BotFlowStep.tableName)
      .where({ flow_id: flowId, sequence: step.sequence })
      .first();

    if (existingStep) {
      await db(BotFlowStep.tableName)
        .where({ id: existingStep.id })
        .update({ ...step, updated_at: new Date() });
      updated += 1;
    } else {
      await db(BotFlowStep.tableName).insert({ ...step, created_at: new Date(), updated_at: new Date() });
      inserted += 1;
    }
  }

  // Seed BotSchedule - upsert by (flow_id, name)
  const existingSchedule = await db(BotSchedule.tableName)
    .where({ flow_id: flowId, name: 'Daily Run' })
    .first();

  if (existingSchedule) {
    await db(BotSchedule.tableName)
      .where({ id: existingSchedule.id })
      .update({
        kind: 'cron',
        cron_expression: '0 2 * * *',
        next_run_at: new Date(Date.now() + 86_400_000),
        updated_at: new Date(),
      });
    updated += 1;
  } else {
    await db(BotSchedule.tableName).insert({
      flow_id: flowId,
      name: 'Daily Run',
      kind: 'cron',
      cron_expression: '0 2 * * *',
      next_run_at: new Date(Date.now() + 86_400_000),
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    });
    inserted += 1;
  }

  return { inserted, updated, skipped: 0 };
}
