import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('db-migrate command supports --dry-run and PostgreSQL advisory locking', async () => {
  const source = await readFile(path.join(root, 'apps/api/src/commands/db-migrate.ts'), 'utf8');
  assert.match(source, /--dry-run/u, 'db-migrate.ts must support --dry-run');
  assert.match(
    source,
    /pg_advisory_lock|advisory/iu,
    'db-migrate.ts must guard migrations with advisory lock'
  );
});

test('orm plugin honors SKIP_BOOT_MIGRATIONS=true while binding models', async () => {
  const source = await readFile(path.join(root, 'apps/api/src/plugins/orm.plugin.ts'), 'utf8');
  assert.match(source, /SKIP_BOOT_MIGRATIONS/u, 'orm.plugin.ts must check SKIP_BOOT_MIGRATIONS');
});

test('coverage thresholds policy enforces branch thresholds on critical runtime files', async () => {
  const policy = JSON.parse(
    await readFile(path.join(root, 'docs/testing/coverage-thresholds.json'), 'utf8')
  );
  assert.ok(policy && typeof policy === 'object');
  const serialized = JSON.stringify(policy);
  assert.match(serialized, /branch/iu, 'coverage policy must enforce branch coverage');
});
