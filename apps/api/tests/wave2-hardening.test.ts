import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import Fastify from 'fastify';
import { defineAddon, defineModel, fields, Registry } from '@moonwitness/orm';
import { LocalFileAttachmentStorage } from '@moonwitness/orm-storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PostgresRateLimitStore,
  createPostgresRateLimitStoreCtor,
  parseTimeWindowMs,
} from '../src/plugins/rate-limit-store.js';
import { runPreDeployMigrations } from '../src/commands/db-migrate.js';
import { installApiAddons, registerApiAddonRoutes } from '../src/addons/registry.js';
import { createProcessShutdownController } from '../src/lifecycle/process-shutdown.js';

describe('Wave 2 API multi-replica and addon-first v2 contracts', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    vi.useRealTimers();
    Registry.clear();
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  it(
    'PostgresRateLimitStore increments atomically within window',
    { timeout: 15_000 },
    async () => {
      const db: Knex = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      cleanups.push(() => db.destroy());

      const Store = createPostgresRateLimitStoreCtor(db);
      const store = new Store({ timeWindow: 60_000 });
      assert.ok(store instanceof PostgresRateLimitStore);

      const hit1 = await new Promise<{ current: number; ttl: number }>((resolve, reject) => {
        void store.incr('ip:127.0.0.1', (err, res) => (err ? reject(err) : resolve(res!)));
      });
      const hit2 = await new Promise<{ current: number; ttl: number }>((resolve, reject) => {
        void store.incr('ip:127.0.0.1', (err, res) => (err ? reject(err) : resolve(res!)));
      });
      assert.equal(hit1.current, 1);
      assert.equal(hit2.current, 2);
      assert.ok(hit2.ttl > 0 && hit2.ttl <= 60_000);
    }
  );

  it(
    'PostgresRateLimitStore parses string timeWindow, supports child() overrides, counts down TTL, and resets after expiry',
    { timeout: 15_000 },
    async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-23T00:00:00.000Z'));

      assert.equal(parseTimeWindowMs('15 minutes', 60_000), 900_000);
      assert.equal(parseTimeWindowMs('30s', 60_000), 30_000);
      assert.equal(parseTimeWindowMs('500ms', 60_000), 500);
      assert.equal(parseTimeWindowMs('2 hours', 60_000), 7_200_000);
      assert.equal(parseTimeWindowMs('1 day', 60_000), 86_400_000);
      assert.equal(parseTimeWindowMs('5000', 60_000), 5_000);
      assert.equal(parseTimeWindowMs('invalid', 60_000), 60_000);

      const db: Knex = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      cleanups.push(() => db.destroy());

      const Store = createPostgresRateLimitStoreCtor(db);
      const rootStore = new Store({ timeWindow: '1 minute' });
      assert.equal(rootStore.getTimeWindowMs(), 60_000);

      const routeChild = rootStore.child({ timeWindow: '10 seconds' });
      assert.equal(routeChild.getTimeWindowMs(), 10_000);

      const incr = (store: PostgresRateLimitStore, key: string, timeWindow?: number | string) =>
        new Promise<{ current: number; ttl: number }>((resolve, reject) => {
          void store.incr(key, (err, res) => (err ? reject(err) : resolve(res!)), timeWindow);
        });

      const hit1 = await incr(routeChild, 'route:login:1.2.3.4');
      assert.equal(hit1.current, 1);
      assert.equal(hit1.ttl, 10_000);

      // Advance 4 seconds: TTL must count down without resetting the window
      vi.advanceTimersByTime(4_000);
      const hit2 = await incr(routeChild, 'route:login:1.2.3.4');
      assert.equal(hit2.current, 2);
      assert.equal(hit2.ttl, 6_000);

      // Advance 6 more seconds (window expired): counter resets to 1 with fresh 10_000ms TTL
      vi.advanceTimersByTime(6_000);
      const hit3 = await incr(routeChild, 'route:login:1.2.3.4');
      assert.equal(hit3.current, 1);
      assert.equal(hit3.ttl, 10_000);

      // Expired rows are pruned cleanly
      vi.advanceTimersByTime(10_000);
      const pruned = await rootStore.pruneExpired();
      assert.equal(pruned, 1);
    }
  );

  it(
    'runPreDeployMigrations installs tables and SKIP_BOOT_MIGRATIONS registers models without running DDL',
    { timeout: 15_000 },
    async () => {
      const db: Knex = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      cleanups.push(() => db.destroy());

      await runPreDeployMigrations(db, undefined);
      assert.equal(await db.schema.hasTable('whatsapp_accounts'), true);
      const schemaState = await db('_orm_schema_state').where({ id: 'global' }).first();
      assert.equal(schemaState.status, 'applied');
      assert.equal(schemaState.applied_version, 1);
      assert.match(schemaState.applied_digest, /^[a-f0-9]{16}$/u);

      Registry.clear();
      const secondDb: Knex = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      cleanups.push(() => secondDb.destroy());

      await installApiAddons(secondDb, undefined, undefined, { skipBootMigrations: true });
      assert.equal(Registry.has('whatsapp.account'), true);
      assert.equal(await secondDb.schema.hasTable('whatsapp_accounts'), false);
    }
  );

  it(
    'registerApiAddonRoutes mounts manifest.httpPlugins declaratively',
    { timeout: 15_000 },
    async () => {
      const TempModel = defineModel('temp.wave2_probe', {
        table: 'temp_wave2_probes',
        fields: { label: fields.string() },
      });
      const addon = defineAddon({
        name: 'temp-wave2-http',
        version: '1.0.0',
        models: [TempModel],
        httpPlugins: [
          async (fastifyApp) => {
            const typed = fastifyApp as ReturnType<typeof Fastify>;
            typed.get('/_wave2_probe', async () => ({ ok: true }));
          },
        ],
      });
      const storageDir = await mkdtemp(path.join(tmpdir(), 'mw-wave2-'));
      cleanups.push(() => rm(storageDir, { recursive: true, force: true }));
      const app = Fastify({ logger: false });
      cleanups.push(() => app.close());

      await registerApiAddonRoutes(
        app,
        {
          jwtSecret: 'test-secret-that-is-at-least-32-characters',
          accessTtlSeconds: 900,
          refreshTtlSeconds: 3600,
          loginRateMax: 10,
          attachmentStorage: new LocalFileAttachmentStorage(storageDir),
        },
        [{ name: 'temp-wave2-http', manifest: addon }]
      );

      const response = await app.inject({ method: 'GET', url: '/_wave2_probe' });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { ok: true });
    }
  );

  it('createProcessShutdownController cleans up fatal error listeners cleanly on dispose', () => {
    const beforeRejectionCount = process.listenerCount('unhandledRejection');
    const beforeExceptionCount = process.listenerCount('uncaughtException');
    const controller = createProcessShutdownController();
    assert.equal(process.listenerCount('unhandledRejection'), beforeRejectionCount + 1);
    assert.equal(process.listenerCount('uncaughtException'), beforeExceptionCount + 1);
    controller.dispose();
    assert.equal(process.listenerCount('unhandledRejection'), beforeRejectionCount);
    assert.equal(process.listenerCount('uncaughtException'), beforeExceptionCount);
  });
});
