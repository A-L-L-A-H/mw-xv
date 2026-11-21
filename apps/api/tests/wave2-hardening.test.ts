import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
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
} from '../src/plugins/rate-limit-store.js';
import { runPreDeployMigrations } from '../src/commands/db-migrate.js';
import { installApiAddons, registerApiAddonRoutes } from '../src/addons/registry.js';
import { createProcessShutdownController } from '../src/lifecycle/process-shutdown.js';

describe('Wave 2 API multi-replica and addon-first v2 contracts', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    Registry.clear();
    while (cleanups.length) {
      await cleanups.pop()?.();
    }
  });

  it('PostgresRateLimitStore increments atomically within window', async () => {
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
  });

  it('runPreDeployMigrations installs tables and SKIP_BOOT_MIGRATIONS registers models without running DDL', async () => {
    const db: Knex = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    cleanups.push(() => db.destroy());

    await runPreDeployMigrations(db, undefined);
    assert.equal(await db.schema.hasTable('whatsapp_accounts'), true);

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
  });

  it('registerApiAddonRoutes mounts manifest.httpPlugins declaratively', async () => {
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
  });

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
