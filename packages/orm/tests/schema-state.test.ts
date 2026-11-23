import { describe, expect, it } from 'vitest';
import { defineAddon } from '../src/addon.js';
import { defineModel, fields } from '../src/model-definition.js';
import { computeDesiredSchemaState, compareSchemaStates } from '../src/schema-state.js';

const User = defineModel('schema-state.user', {
  table: 'schema_state_users',
  fields: { email: fields.string({ required: true, unique: true }) },
});

const Account = defineModel('schema-state.account', {
  table: 'schema_state_accounts',
  fields: { name: fields.string({ required: true }) },
});

const users = defineAddon({
  name: 'schema-state-users',
  version: '1.0.0',
  models: [User],
});

const accounts = defineAddon({
  name: 'schema-state-accounts',
  version: '2.0.0',
  models: [Account],
});

describe('desired schema state', () => {
  it('computes the same state regardless of addon order', () => {
    const first = computeDesiredSchemaState([users, accounts], 3);
    const second = computeDesiredSchemaState([accounts, users], 3);

    expect(first).toEqual(second);
    expect(first.version).toBe(3);
    expect(first.addons).toEqual([
      { name: 'schema-state-accounts', version: '2.0.0', digest: expect.any(String) },
      { name: 'schema-state-users', version: '1.0.0', digest: expect.any(String) },
    ]);
    expect(first.digest).toMatch(/^[a-f0-9]{16}$/u);
  });

  it('classifies uninitialized, outdated, current, drifted, and ahead states', () => {
    const desired = computeDesiredSchemaState([users, accounts], 3);

    expect(compareSchemaStates(desired, null)).toEqual({
      kind: 'outdated',
      reason: 'uninitialized',
      requiresMigration: true,
      canServeTraffic: false,
    });

    expect(compareSchemaStates(desired, { version: 2, digest: '0000000000000000' })).toEqual({
      kind: 'outdated',
      reason: 'version_behind',
      requiresMigration: true,
      canServeTraffic: false,
    });

    expect(compareSchemaStates(desired, { version: 3, digest: desired.digest })).toEqual({
      kind: 'current',
      reason: 'matched',
      requiresMigration: false,
      canServeTraffic: true,
    });

    expect(compareSchemaStates(desired, { version: 3, digest: 'ffffffffffffffff' })).toEqual({
      kind: 'drifted',
      reason: 'digest_mismatch',
      requiresMigration: true,
      canServeTraffic: false,
    });

    expect(compareSchemaStates(desired, { version: 4, digest: 'ffffffffffffffff' })).toEqual({
      kind: 'ahead',
      reason: 'version_ahead',
      requiresMigration: false,
      canServeTraffic: false,
    });
  });
});
