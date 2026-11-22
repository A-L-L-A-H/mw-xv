import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWorkspaceOrm, redactSecrets } from './orm-inspect.mjs';

test('redactSecrets strips sensitive keys recursively', () => {
  const sanitized = redactSecrets({
    addon: 'base',
    jwtSecret: 'raw-secret',
    nested: { dbPassword: 'pass', token: 'tok', safe: 'ok' },
  });
  assert.equal(sanitized.jwtSecret, '[REDACTED]');
  assert.equal(sanitized.nested.dbPassword, '[REDACTED]');
  assert.equal(sanitized.nested.token, '[REDACTED]');
  assert.equal(sanitized.nested.safe, 'ok');
});

test('inspectWorkspaceOrm discovers workspace ORM addons and models without secrets', async () => {
  const report = await inspectWorkspaceOrm();
  assert.equal(report.format, 'moonwitness-orm-inspect/v1');
  assert.ok(report.addonCount >= 8, `expected >= 8 addons, got ${report.addonCount}`);
  assert.ok(report.modelCount >= 20, `expected >= 20 models, got ${report.modelCount}`);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /JWT_SECRET|DATABASE_URL|WHATSAPP_SESSION_KEY/u);
});

test('inspectWorkspaceOrm filters by --addon cleanly', async () => {
  const report = await inspectWorkspaceOrm({ addonFilter: 'base' });
  assert.equal(report.addonCount, 1);
  assert.equal(report.addons[0].addon, 'base');
});
