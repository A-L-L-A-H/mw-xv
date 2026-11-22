import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_ICON_NAMES, modelIconName } from '../../apps/board/src/lib/model-icon-registry.mjs';

test('public base model menus use the canonical domain icon exports', () => {
  assert.deepEqual(
    Object.fromEntries(['partner', 'company', 'user', 'activity', 'attachment', 'tag'].map((name) => [
      `base.${name}`,
      MODEL_ICON_NAMES[`base.${name}`],
    ])),
    {
      'base.partner': 'partner',
      'base.company': 'company',
      'base.user': 'users',
      'base.activity': 'activity',
      'base.attachment': 'attachment',
      'base.tag': 'tag',
    }
  );
});

test('non-menu and unknown models retain stable generic fallbacks', () => {
  assert.equal(modelIconName('base.audit_log'), 'model');
  assert.equal(modelIconName('auth.refresh_token'), 'key');
  assert.equal(modelIconName('auth.unknown'), 'security');
});
