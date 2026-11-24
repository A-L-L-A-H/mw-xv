import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCurrentScopeQueryKey,
  profileContactKey,
  scopeMarker,
  scopedQueryKey,
  settingsConfigParametersKey,
  settingsDesktopAiModelsKey,
  settingsDesktopBackupsKey,
  settingsFeatureFlagsKey,
  settingsLanguagesKey,
  settingsUserKey,
} from '../src/lib/query-scope-keys.ts';

const scopeA = { userId: 7, companyId: 11, metadataGeneration: 2 };
const scopeB = { userId: 7, companyId: 12, metadataGeneration: 2 };

test('scopedQueryKey appends identity, company and metadata generation in a fixed order', () => {
  assert.deepEqual(scopedQueryKey(['settings', 'user', 7], scopeA), [
    'settings',
    'user',
    7,
    scopeMarker,
    7,
    11,
    2,
  ]);
  assert.deepEqual(scopedQueryKey(['settings', 'user', 7], scopeB), [
    'settings',
    'user',
    7,
    scopeMarker,
    7,
    12,
    2,
  ]);
});

test('keys from different tenants and metadata generations never collide', () => {
  const keys = [
    scopedQueryKey(['x'], scopeA),
    scopedQueryKey(['x'], scopeB),
    scopedQueryKey(['x'], { ...scopeA, userId: 8 }),
    scopedQueryKey(['x'], { ...scopeA, metadataGeneration: 3 }),
  ];
  assert.equal(new Set(keys.map((key) => JSON.stringify(key))).size, keys.length);
});

test('isCurrentScopeQueryKey rejects stale company, identity and generation scopes', () => {
  const key = settingsLanguagesKey(scopeA);
  assert.equal(isCurrentScopeQueryKey(key, scopeA), true);
  assert.equal(isCurrentScopeQueryKey(key, scopeB), false);
  assert.equal(isCurrentScopeQueryKey(key, { ...scopeA, userId: 8 }), false);
  assert.equal(isCurrentScopeQueryKey(key, { ...scopeA, metadataGeneration: 3 }), false);
  assert.equal(isCurrentScopeQueryKey(['settings', 'languages'], scopeA), false);
  assert.equal(isCurrentScopeQueryKey([...key, 'extra'], scopeA), false);
});

test('settings and profile factories keep their unscoped base paths', () => {
  assert.deepEqual(settingsUserKey(undefined, scopeA).slice(0, 3), ['settings', 'user', null]);
  assert.deepEqual(settingsLanguagesKey(scopeA).slice(0, 2), ['settings', 'languages']);
  assert.deepEqual(settingsConfigParametersKey(scopeA).slice(0, 2), [
    'settings',
    'config_parameters',
  ]);
  assert.deepEqual(settingsFeatureFlagsKey(scopeA).slice(0, 2), ['settings', 'feature_flags']);
  assert.deepEqual(settingsDesktopAiModelsKey(scopeA).slice(0, 3), ['desktop', 'ai', 'models']);
  assert.deepEqual(settingsDesktopBackupsKey(scopeA).slice(0, 2), ['desktop', 'backups']);
  assert.deepEqual(profileContactKey(7, scopeA).slice(0, 2), ['profile', 7]);
});
