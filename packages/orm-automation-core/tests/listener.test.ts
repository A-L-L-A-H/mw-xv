import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import knexFactory from 'knex';
import { fireTrigger, renderDedupeKey, AUTOMATION_RULE_CODE_PATTERN } from '../src/index.js';

let db: Knex;

beforeAll(async () => {
  db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  await db.schema.createTable('automation_triggers', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable();
    t.string('kind').notNullable();
    t.string('ref').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await db.schema.createTable('automation_rules', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable();
    t.integer('trigger_id').nullable();
    t.string('condition').nullable();
    t.string('action_kind').notNullable();
    t.string('action_config').nullable();
    t.integer('sequence').notNullable().defaultTo(10);
    t.integer('cooldown_minutes').notNullable().defaultTo(0);
    t.string('dedupe_key_template').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  await db.schema.createTable('automation_runs', (t) => {
    t.increments('id').primary();
    t.integer('rule_id').notNullable();
    t.string('trigger_ref').notNullable();
    t.string('dedupe_key').nullable();
    t.string('input').nullable();
    t.string('output').nullable();
    t.string('status').notNullable();
    t.string('error').nullable();
    t.string('started_at').nullable();
    t.string('finished_at').nullable();
    t.integer('company_id').notNullable();
    t.string('created_at').notNullable().defaultTo(new Date().toISOString());
  });

  await db.schema.createTable('outbox_events', (t) => {
    t.increments('id').primary();
    t.integer('company_id').notNullable();
    t.string('event_type').notNullable();
    t.string('aggregate_model').nullable();
    t.integer('aggregate_id').nullable();
    t.string('payload').nullable();
    t.string('status').notNullable();
    t.string('available_at').nullable();
  });
});

afterAll(async () => {
  await db.destroy();
});

async function seedTrigger(ref: string): Promise<number> {
  const [id] = await db('automation_triggers')
    .insert({ kind: 'signal.scored', ref, is_active: true, company_id: 7 })
    .returning('id');
  return Number((id as { id?: number }).id ?? id);
}

describe('renderDedupeKey', () => {
  it('substitutes trigger and payload tokens', () => {
    const key = renderDedupeKey('score:{payload.score}:{trigger.ref}:{trigger.kind}', {
      payload: { score: 87 },
      triggerKind: 'signal.scored',
      triggerRef: 'lead-1',
    });
    expect(key).toBe('score:87:lead-1:signal.scored');
  });

  it('renders unresolvable tokens as empty strings', () => {
    expect(
      renderDedupeKey('x:{payload.missing.deep}', {
        payload: {},
        triggerKind: 'manual',
        triggerRef: 'r',
      })
    ).toBe('x:');
    expect(
      renderDedupeKey('p:{payload}', {
        payload: { a: 1 },
        triggerKind: 'manual',
        triggerRef: 'r',
      })
    ).toBe('p:{"a":1}');
  });

  it('preserves unmatched braces, empty tokens, and nested opening braces', () => {
    const ctx = { payload: { score: 87 }, triggerKind: 'manual', triggerRef: 'r' };
    expect(renderDedupeKey('{payload.score', ctx)).toBe('{payload.score');
    expect(renderDedupeKey('}:{payload.score}', ctx)).toBe('}:87');
    expect(renderDedupeKey('{}{payload.score}', ctx)).toBe('{}87');
    expect(renderDedupeKey('{{payload.score}:{payload.score}', ctx)).toBe(':87');
    expect(renderDedupeKey('{ payload.score }', ctx)).toBe('87');
  });

  it('handles adversarially long unmatched brace runs', () => {
    const template = `prefix:${'{'.repeat(50_000)}`;
    expect(
      renderDedupeKey(template, {
        payload: {},
        triggerKind: 'manual',
        triggerRef: 'r',
      })
    ).toBe(template);
  });
});

describe('AUTOMATION_RULE_CODE_PATTERN', () => {
  it('accepts dotted lowercase codes and rejects others', () => {
    expect(AUTOMATION_RULE_CODE_PATTERN.test('lead.hot.notify')).toBe(true);
    expect(AUTOMATION_RULE_CODE_PATTERN.test('lead_hot')).toBe(true);
    expect(AUTOMATION_RULE_CODE_PATTERN.test('1lead')).toBe(false);
    expect(AUTOMATION_RULE_CODE_PATTERN.test('Lead.Hot')).toBe(false);
    expect(AUTOMATION_RULE_CODE_PATTERN.test('lead..hot')).toBe(false);
  });
});

describe('fireTrigger', () => {
  it('returns an empty report when no trigger matches', async () => {
    const report = await fireTrigger('cron', 'nope', {}, { db, companyId: 7 });
    expect(report).toEqual({
      triggerKind: 'cron',
      triggerRef: 'nope',
      matchedRules: 0,
      outcomes: [],
    });
  });

  it('runs matching rules and records success runs', async () => {
    const triggerId = await seedTrigger('lead-scored');
    await db('automation_rules').insert({
      company_id: 7,
      trigger_id: triggerId,
      condition: JSON.stringify({
        all: [
          { op: 'gte', path: 'score', value: 80 },
          { op: 'eq', path: 'tier', value: 'hot' },
        ],
      }),
      action_kind: 'notify',
      action_config: JSON.stringify({ templateCode: 'lead.hot' }),
      is_active: true,
      cooldown_minutes: 0,
    });

    const report = await fireTrigger(
      'signal.scored',
      'lead-scored',
      { score: 92, tier: 'hot', recipientId: 3 },
      { db, companyId: 7 }
    );

    expect(report.matchedRules).toBe(1);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]?.status).toBe('success');
    expect(report.outcomes[0]?.result).toMatchObject({
      ok: true,
      detail: { recipientId: 3, templateCode: 'lead.hot' },
    });

    const run = await db('automation_runs').orderBy('id', 'desc').first();
    expect(run).toMatchObject({ status: 'success', rule_id: report.outcomes[0]?.runId });
    expect(JSON.parse(String(run?.output))).toMatchObject({ recipientId: 3 });

    const event = await db('outbox_events').orderBy('id', 'desc').first();
    expect(event).toMatchObject({ event_type: 'notification.deliver', company_id: 7 });
  });

  it('records skipped runs for non-matching conditions', async () => {
    const triggerId = await seedTrigger('cold-only');
    await db('automation_rules').insert({
      company_id: 7,
      trigger_id: triggerId,
      condition: JSON.stringify({ op: 'lt', path: 'score', value: 50 }),
      action_kind: 'notify',
      action_config: JSON.stringify({ templateCode: 'lead.cold' }),
      is_active: true,
    });

    const report = await fireTrigger(
      'signal.scored',
      'cold-only',
      { score: 90, recipientId: 3 },
      { db, companyId: 7 }
    );

    expect(report.outcomes[0]?.status).toBe('skipped');
    expect(report.outcomes[0]?.error).toContain('condition not matched');
    const run = await db('automation_runs').orderBy('id', 'desc').first();
    expect(run).toMatchObject({ status: 'skipped' });
  });

  it('skips rules whose condition DSL is invalid without throwing', async () => {
    const triggerId = await seedTrigger('broken-dsl');
    await db('automation_rules').insert({
      company_id: 7,
      trigger_id: triggerId,
      condition: JSON.stringify({ op: 'wat', path: 'score' }),
      action_kind: 'notify',
      action_config: JSON.stringify({ templateCode: 'x' }),
      is_active: true,
    });

    const report = await fireTrigger(
      'signal.scored',
      'broken-dsl',
      { score: 1 },
      { db, companyId: 7 }
    );
    expect(report.outcomes[0]?.status).toBe('skipped');
    expect(report.outcomes[0]?.error).toContain('Unknown DSL op');
  });

  it('enforces cooldown via dedupe_key_template', async () => {
    const triggerId = await seedTrigger('cooldown');
    await db('automation_rules').insert({
      company_id: 7,
      trigger_id: triggerId,
      condition: null,
      action_kind: 'notify',
      action_config: JSON.stringify({ templateCode: 'lead.hot' }),
      is_active: true,
      cooldown_minutes: 60,
      dedupe_key_template: 'hot:{trigger.ref}',
    });

    const payload = { recipientId: 3 };
    const first = await fireTrigger('signal.scored', 'cooldown', payload, { db, companyId: 7 });
    expect(first.outcomes[0]?.status).toBe('success');

    const second = await fireTrigger('signal.scored', 'cooldown', payload, { db, companyId: 7 });
    expect(second.outcomes[0]?.status).toBe('skipped');
    expect(second.outcomes[0]?.error).toContain('dedupe');

    const third = await fireTrigger('signal.scored', 'cooldown', payload, {
      db,
      companyId: 7,
      limit: 5,
    });
    expect(third.outcomes[0]?.status).toBe('skipped');
  });

  it('marks failed runs for unknown action kinds and action errors', async () => {
    const triggerId = await seedTrigger('unknown-action');
    await db('automation_rules').insert({
      company_id: 7,
      trigger_id: triggerId,
      condition: null,
      action_kind: 'teleport',
      action_config: null,
      is_active: true,
    });

    const report = await fireTrigger('signal.scored', 'unknown-action', {}, { db, companyId: 7 });
    expect(report.outcomes[0]?.status).toBe('failed');
    expect(report.outcomes[0]?.error).toContain('unknown action kind');

    const run = await db('automation_runs').orderBy('id', 'desc').first();
    expect(run).toMatchObject({ status: 'failed' });
  });

  it('ignores rules from other companies and inactive rules', async () => {
    const triggerId = await seedTrigger('tenant-scope');
    await db('automation_rules').insert([
      {
        company_id: 8,
        trigger_id: triggerId,
        condition: null,
        action_kind: 'notify',
        action_config: JSON.stringify({ templateCode: 'x' }),
        is_active: true,
      },
      {
        company_id: 7,
        trigger_id: triggerId,
        condition: null,
        action_kind: 'notify',
        action_config: JSON.stringify({ templateCode: 'x' }),
        is_active: false,
      },
    ]);

    const report = await fireTrigger(
      'signal.scored',
      'tenant-scope',
      { recipientId: 3 },
      { db, companyId: 7 }
    );
    expect(report.matchedRules).toBe(0);
  });
});
