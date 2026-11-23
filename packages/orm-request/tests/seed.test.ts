import { afterEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  manifest,
  PurchaseRequest,
  buildRequestInitialSeed,
  seedRequestInitialData,
} from '../src/index.js';

let db: Knex | undefined;

async function createDatabase(): Promise<Knex> {
  const database = knex({
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
  });
  Model.knex(database);
  await installAddons(database, [
    manifest,
    workflowManifest,
    notificationManifest,
    jobsManifest,
    baseManifest,
  ]);
  return database;
}

afterEach(async () => {
  if (db) await db.destroy();
  db = undefined;
});

describe('request seed bundle', () => {
  it('buildRequestInitialSeed returns a deep-copyable bundle with correct schema shape', () => {
    const bundle = buildRequestInitialSeed();
    expect(bundle.version).toBe('1.0.0');
    expect(bundle.currencies).toHaveLength(1);
    expect(bundle.serviceCatalog).toHaveLength(5);
    expect(bundle.slaPolicies).toHaveLength(5);
    expect(bundle.approvalChains).toHaveLength(5);
    expect(bundle.requests).toHaveLength(5);

    expect(bundle.currencies[0].code).toBe('IDR');
    expect(bundle.serviceCatalog.every((c) => c.currencyCode === 'IDR')).toBe(true);
    expect(bundle.approvalChains.every((c) => c.config.transitions.length >= 3)).toBe(true);
    expect(bundle.requests.every((r) => r.currencyCode === 'IDR')).toBe(true);

    const copy = JSON.parse(JSON.stringify(bundle));
    copy.serviceCatalog[0].name = 'mutated';
    expect(bundle.serviceCatalog[0].name).not.toBe('mutated');
  });
});

describe('seedRequestInitialData idempotency and FK integrity', () => {
  let firstRun: Awaited<ReturnType<typeof seedRequestInitialData>>;
  let secondRun: Awaited<ReturnType<typeof seedRequestInitialData>>;

  it('first run inserts all seed data and returns correct totals', async () => {
    db = await createDatabase();
    firstRun = await seedRequestInitialData(db);

    expect(firstRun.insertedCurrencies).toBe(1);
    expect(firstRun.insertedDefinitions).toBe(5);
    expect(firstRun.insertedRequests).toBe(5);

    expect(firstRun.currenciesTotal).toBe(2);
    expect(firstRun.definitionsTotal).toBe(7);
    expect(firstRun.requestsTotal).toBe(9);
  });

  it('second run on same DB is fully idempotent', async () => {
    db = await createDatabase();
    await seedRequestInitialData(db);
    secondRun = await seedRequestInitialData(db);

    expect(secondRun.insertedCurrencies).toBe(0);
    expect(secondRun.insertedDefinitions).toBe(0);
    expect(secondRun.insertedRequests).toBe(0);

    expect(secondRun.currenciesTotal).toBe(firstRun.currenciesTotal);
    expect(secondRun.definitionsTotal).toBe(firstRun.definitionsTotal);
    expect(secondRun.requestsTotal).toBe(firstRun.requestsTotal);
  });

  it('validates seeded row fields and FK references', async () => {
    db = await createDatabase();
    await seedRequestInitialData(db);

    const currencies = await db('currencies').select('*');
    expect(currencies).toHaveLength(2);
    const idr = currencies.find((c) => c.code === 'IDR');
    expect(idr).toMatchObject({ code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' });

    const definitions = await db('workflow_definitions')
      .where('code', 'like', 'seed.%')
      .select('*');
    expect(definitions).toHaveLength(5);
    for (const def of definitions) {
      expect(Boolean(def.enabled)).toBe(true);
      expect(def.config).toBeDefined();
      const config = JSON.parse(def.config);
      expect(config.startState).toBeDefined();
      expect(config.transitions).toBeInstanceOf(Array);
      expect(config.transitions.length).toBeGreaterThan(0);
      for (const t of config.transitions) {
        expect(t.action).toBeDefined();
        expect(t.from).toBeDefined();
        expect(t.to).toBeDefined();
        expect(t.roles).toBeInstanceOf(Array);
      }
    }

    const requests = await db('purchase_requests').where('title', 'like', '%').select('*');
    expect(requests).toHaveLength(9);
    const seedRequests = requests.filter(
      (r) =>
        r.title.startsWith('Implementasi') ||
        r.title.startsWith('Dukungan') ||
        r.title.startsWith('Pemulihan') ||
        r.title.startsWith('Audit') ||
        r.title.startsWith('Integrasi')
    );
    expect(seedRequests).toHaveLength(5);
    for (const req of seedRequests) {
      expect(req.currency_id).toBe(2);
      expect(req.company_id).toBe(1);
      expect(req.vendor_id).toBeDefined();
      expect(req.amount_minor).toBeGreaterThan(0);
    }
  });
});
