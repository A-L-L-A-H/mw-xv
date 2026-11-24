import type { Knex } from 'knex';
import { TRIGGER_KINDS, AUTOMATION_ACTION_KINDS, AUTOMATION_RUN_STATUSES } from './models.js';

export const AUTOMATION_SEED_VERSION = '1.0.0';

export interface AutomationTriggerSeed {
  readonly kind: (typeof TRIGGER_KINDS)[number];
  readonly ref: string;
  readonly config: Record<string, unknown>;
  readonly is_active: boolean;
}

export interface AutomationRuleSeed {
  readonly name: string;
  readonly code: string;
  readonly trigger_ref: string;
  readonly trigger_kind: (typeof TRIGGER_KINDS)[number];
  readonly condition: Record<string, unknown> | null;
  readonly action_kind: (typeof AUTOMATION_ACTION_KINDS)[number];
  readonly action_config: Record<string, unknown>;
  readonly sequence: number;
  readonly cooldown_minutes: number;
  readonly dedupe_key_template: string | null;
  readonly is_active: boolean;
}

const TRIGGER_SEEDS: readonly AutomationTriggerSeed[] = [
  {
    kind: 'webhook',
    ref: 'default',
    config: { path: '/webhook/automation', secret_header: 'x-webhook-secret' },
    is_active: true,
  },
  {
    kind: 'cron',
    ref: 'hourly',
    config: { schedule: '0 * * * *', timezone: 'UTC' },
    is_active: true,
  },
  {
    kind: 'cron',
    ref: 'daily',
    config: { schedule: '0 0 * * *', timezone: 'UTC' },
    is_active: true,
  },
  {
    kind: 'signal.scored',
    ref: 'default',
    config: { min_score: 70 },
    is_active: true,
  },
  {
    kind: 'manual',
    ref: 'default',
    config: {},
    is_active: true,
  },
];

const RULE_SEEDS: readonly AutomationRuleSeed[] = [
  {
    name: 'Log webhook events',
    code: 'core.log_webhook',
    trigger_ref: 'default',
    trigger_kind: 'webhook',
    condition: null,
    action_kind: 'notify',
    action_config: { channel: 'in_app', template: 'webhook.received' },
    sequence: 10,
    cooldown_minutes: 0,
    dedupe_key_template: 'webhook:{trigger.ref}:{payload.event_id}',
    is_active: true,
  },
  {
    name: 'Daily summary notification',
    code: 'core.daily_summary',
    trigger_ref: 'daily',
    trigger_kind: 'cron',
    condition: null,
    action_kind: 'notify',
    action_config: { channel: 'email', template: 'daily.summary' },
    sequence: 10,
    cooldown_minutes: 1440,
    dedupe_key_template: 'cron:daily:{trigger.ref}',
    is_active: true,
  },
];

function cloneTrigger(t: AutomationTriggerSeed): AutomationTriggerSeed {
  return { ...t, config: { ...t.config } };
}

function cloneRule(r: AutomationRuleSeed): AutomationRuleSeed {
  return {
    ...r,
    condition: r.condition ? { ...r.condition } : null,
    action_config: { ...r.action_config },
  };
}

export function buildAutomationInitialSeed() {
  return {
    version: AUTOMATION_SEED_VERSION,
    triggers: TRIGGER_SEEDS.map(cloneTrigger),
    rules: RULE_SEEDS.map(cloneRule),
  };
}

export interface AutomationSeedResult {
  readonly triggersInserted: number;
  readonly triggersUpdated: number;
  readonly rulesInserted: number;
  readonly rulesUpdated: number;
}

export async function seedAutomationCore(ctx: {
  db: Knex;
  companyId?: number;
}): Promise<AutomationSeedResult> {
  const db = ctx.db;
  const companyId = ctx.companyId ?? 1;

  let triggersInserted = 0;
  let triggersUpdated = 0;
  let rulesInserted = 0;
  let rulesUpdated = 0;

  for (const trigger of buildAutomationInitialSeed().triggers) {
    const existing = await db('automation_triggers')
      .where({ kind: trigger.kind, ref: trigger.ref, company_id: companyId })
      .first('id');

    if (existing) {
      await db('automation_triggers')
        .where({ id: existing.id })
        .update({
          config: JSON.stringify(trigger.config),
          is_active: trigger.is_active,
          updated_at: new Date(),
        });
      triggersUpdated++;
    } else {
      await db('automation_triggers').insert({
        kind: trigger.kind,
        ref: trigger.ref,
        config: JSON.stringify(trigger.config),
        is_active: trigger.is_active,
        company_id: companyId,
        created_at: new Date(),
        updated_at: new Date(),
      });
      triggersInserted++;
    }
  }

  for (const rule of buildAutomationInitialSeed().rules) {
    const triggerRow = await db('automation_triggers')
      .where({ kind: rule.trigger_kind, ref: rule.trigger_ref, company_id: companyId })
      .first('id');

    if (!triggerRow) continue;

    const existing = await db('automation_rules')
      .where({ code: rule.code, company_id: companyId })
      .first('id');

    const ruleValues = {
      name: rule.name,
      code: rule.code,
      trigger_id: triggerRow.id,
      condition: rule.condition ? JSON.stringify(rule.condition) : null,
      action_kind: rule.action_kind,
      action_config: JSON.stringify(rule.action_config),
      sequence: rule.sequence,
      cooldown_minutes: rule.cooldown_minutes,
      dedupe_key_template: rule.dedupe_key_template,
      is_active: rule.is_active,
      company_id: companyId,
      updated_at: new Date(),
    };

    if (existing) {
      await db('automation_rules').where({ id: existing.id }).update(ruleValues);
      rulesUpdated++;
    } else {
      await db('automation_rules').insert({
        ...ruleValues,
        created_at: new Date(),
      });
      rulesInserted++;
    }
  }

  return { triggersInserted, triggersUpdated, rulesInserted, rulesUpdated };
}

export async function seed(ctx: { db: Knex; companyId?: number }): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
}> {
  const result = await seedAutomationCore(ctx);
  const totalInserted = result.triggersInserted + result.rulesInserted;
  const totalUpdated = result.triggersUpdated + result.rulesUpdated;
  const totalRows = TRIGGER_SEEDS.length + RULE_SEEDS.length;
  const skipped = Math.max(0, totalRows - totalInserted - totalUpdated);
  return { inserted: totalInserted, updated: totalUpdated, skipped };
}
