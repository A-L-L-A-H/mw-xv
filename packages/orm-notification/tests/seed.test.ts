import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import {
  buildNotificationInitialSeed,
  manifest as notificationManifest,
  NOTIFICATION_SEED_VERSION,
  NotificationTemplate,
  seedNotificationInitialData,
} from '../src/index.js';

function cloneSeed<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('@moonwitness/orm-notification initial seed module', () => {
  let db: Knex;

  beforeEach(() => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  });

  afterEach(async () => db.destroy());

  it('builds a deterministic, schema-valid notification seed bundle', () => {
    const firstBundle = buildNotificationInitialSeed();
    const secondBundle = buildNotificationInitialSeed();

    expect(firstBundle).toEqual(secondBundle);
    expect(firstBundle.version).toBe(NOTIFICATION_SEED_VERSION);
    expect(firstBundle.channels).toHaveLength(4);
    expect(firstBundle.templates).toHaveLength(8);

    const channelCodes = firstBundle.channels.map((channel) => channel.code);
    expect(channelCodes).toEqual(['desktop', 'email', 'whatsapp', 'webhook']);
    expect(new Set(channelCodes).size).toBe(channelCodes.length);

    const templateCodes = firstBundle.templates.map((template) => template.code);
    expect(new Set(templateCodes).size).toBe(templateCodes.length);

    const channelCodeSet = new Set(channelCodes);
    const severities = new Set(['info', 'low', 'medium', 'high', 'critical']);
    for (const channel of firstBundle.channels) {
      expect(channel.label.length).toBeGreaterThan(0);
      expect(channel.description.length).toBeGreaterThan(0);
      expect(channel.enabled).toBe(true);
      expect(typeof channel.supportsDigest).toBe('boolean');
      expect(severities.has(channel.defaultSeverity)).toBe(true);
    }

    for (const template of firstBundle.templates) {
      expect(template.code).toMatch(/^[a-z][a-z0-9_.-]{2,127}$/u);
      expect(template.code.startsWith('seed.notification.')).toBe(true);
      expect(template.channel === 'in_app' || template.channel === 'email').toBe(true);
      expect(template.locale).toMatch(/^[a-z]{2,3}(?:-[A-Z]{2,3})?$/u);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.body.length).toBeGreaterThan(0);
      expect(template.category.length).toBeGreaterThan(0);
      expect(severities.has(template.severity)).toBe(true);
      expect(template.operationalChannels.length).toBeGreaterThan(0);
      expect(template.operationalChannels.every((code) => channelCodeSet.has(code))).toBe(true);

      const declaredVariables = new Set(
        [...template.body.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/gu)].map((match) => match[1]!)
      );
      expect(new Set(template.variables)).toEqual(declaredVariables);
      expect(template.variables.length).toBe(declaredVariables.size);
    }
  });

  it('returns a mutable deep copy so callers cannot mutate subsequent bundles', () => {
    const firstBundle = buildNotificationInitialSeed();
    const untouchedBundle = cloneSeed(firstBundle);
    const mutableBundle = firstBundle as unknown as {
      channels: Array<{ code: string }>;
      templates: Array<{ operationalChannels: string[]; variables: string[] }>;
    };
    mutableBundle.channels[0]!.code = 'mutated_channel';
    mutableBundle.templates[0]!.operationalChannels.push('webhook');
    mutableBundle.templates[0]!.variables.push('mutated_variable');

    expect(buildNotificationInitialSeed()).toEqual(untouchedBundle);
  });

  it('seeds notification templates idempotently after addon installation', async () => {
    await installAddons(db, [baseManifest, jobsManifest, notificationManifest]);

    const baselineCount = Number(
      (
        await db(NotificationTemplate.tableName)
          .count<{ count: number | string }>({ count: '*' })
          .first()
      )?.count ?? 0
    );
    expect(baselineCount).toBe(3);

    const firstRun = await seedNotificationInitialData(db);
    expect(firstRun.channelsTotal).toBe(4);
    expect(firstRun.templatesTotal).toBe(11);
    expect(firstRun.insertedTemplates).toBe(8);

    const secondRun = await seedNotificationInitialData(db);
    expect(secondRun.channelsTotal).toBe(firstRun.channelsTotal);
    expect(secondRun.templatesTotal).toBe(firstRun.templatesTotal);
    expect(secondRun.insertedTemplates).toBe(0);

    const seededRows = await db(NotificationTemplate.tableName)
      .whereIn(
        'code',
        buildNotificationInitialSeed().templates.map((template) => template.code)
      )
      .orderBy('code', 'asc');
    expect(seededRows).toHaveLength(8);
    for (const row of seededRows) {
      expect(row.locale).toMatch(/^[a-z]{2,3}(?:-[A-Z]{2,3})?$/u);
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.body.length).toBeGreaterThan(0);
    }
  });
});
