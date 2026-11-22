import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import knex from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseAddon } from '@moonwitness/orm-base';
import { manifest, whatsappManifest } from '../src/index.js';

describe('@moonwitness/orm-whatsapp addon manifest', () => {
  it('installs all 13 WhatsApp models cleanly onto SQLite without errors', async () => {
    assert.strictEqual(manifest, whatsappManifest);
    assert.equal(manifest.name, 'orm-whatsapp');
    assert.equal(manifest.models.length, 13);

    const db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    try {
      await installAddons(db, [baseAddon, manifest]);
      const tableExists = await db.schema.hasTable('whatsapp_accounts');
      assert.equal(tableExists, true);
      const labelCount = await db('whatsapp_labels').count({ count: '*' }).first();
      assert.equal(Number(labelCount?.count), 5);
    } finally {
      await db.destroy();
    }
  });
});
