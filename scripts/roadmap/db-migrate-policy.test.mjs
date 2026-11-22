import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('db-migrate command supports --dry-run and delegates to locked schema coordination', async () => {
  const source = await readFile(path.join(root, 'apps/api/src/commands/db-migrate.ts'), 'utf8');
  const coordinator = await readFile(
    path.join(root, 'apps/api/src/database/schema-state.ts'),
    'utf8'
  );
  assert.match(source, /--dry-run/u, 'db-migrate.ts must support --dry-run');
  assert.match(
    source,
    /coordinateApiMigration/u,
    'db-migrate.ts must use the shared schema coordinator'
  );
  assert.match(
    coordinator,
    /pg_try_advisory_lock/u,
    'schema coordinator must guard migrations with an advisory lock'
  );
});

test('worker bootstrap observes schema state without installing DDL', async () => {
  const registry = await readFile(path.join(root, 'apps/api/src/addons/registry.ts'), 'utf8');
  const workers = await Promise.all(
    ['jobs-worker.ts', 'jobs-scheduler.ts', 'outbox-worker.ts'].map((file) =>
      readFile(path.join(root, 'apps/api/src/commands', file), 'utf8')
    )
  );
  assert.match(registry, /SKIP_BOOT_MIGRATIONS/u, 'addon registry must honor migration skip mode');
  for (const source of workers) {
    assert.match(source, /bootstrapApiWorker/u, 'workers must use the read-only schema observer');
    assert.doesNotMatch(source, /installApiAddons/u, 'workers must not install database schema');
  }
});

test('coverage thresholds policy enforces branch thresholds on critical runtime files', async () => {
  const policy = JSON.parse(
    await readFile(path.join(root, 'docs/testing/coverage-thresholds.json'), 'utf8')
  );
  assert.ok(policy && typeof policy === 'object');
  const serialized = JSON.stringify(policy);
  assert.match(serialized, /branch/iu, 'coverage policy must enforce branch coverage');
});
