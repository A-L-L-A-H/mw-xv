import knex from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest, ecommerceSyncSeedManifest } from './src/index.js';

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
});
await installAddons(db, [baseManifest, manifest]);
const rows = await db('marketplace_connections').select('*');
console.log('connections after install:', JSON.stringify(rows, null, 2));
const r1 = await ecommerceSyncSeedManifest.seed({ db, companyId: 1 });
console.log('seed result 1:', r1);
const r2 = await ecommerceSyncSeedManifest.seed({ db, companyId: 1 });
console.log('seed result 2:', r2);
const grants = await db('model_access')
  .join('access_groups', 'model_access.group_id', 'access_groups.id')
  .where('access_groups.code', 'user')
  .select('model_access.model_name');
console.log('grants:', grants);
const groups = await db('access_groups').select('code');
console.log('groups:', groups);
await db.destroy();
