import { describe, expect, it, vi } from 'vitest';

const { knexFactory } = vi.hoisted(() => ({
  knexFactory: vi.fn((..._args: unknown[]) => {
    throw new Error('orm-identity must not open a database connection on import');
  }),
}));

vi.mock('knex', () => {
  const knex = (...args: unknown[]) => knexFactory(...args);
  return { default: knex, knex };
});

import {
  IDENTITY_MODELS,
  IDENTITY_PACKAGE_NAME,
  findIdentityModel,
  type IdentityModelEntry,
} from '../src/index.js';

describe('@moonwitness/orm-identity smoke', () => {
  it('exposes the stable package name', () => {
    expect(IDENTITY_PACKAGE_NAME).toBe('@moonwitness/orm-identity');
  });

  it('exposes an empty, frozen identity model registry', () => {
    expect(Array.isArray(IDENTITY_MODELS)).toBe(true);
    expect(IDENTITY_MODELS).toHaveLength(0);
    expect(Object.isFrozen(IDENTITY_MODELS)).toBe(true);
  });

  it('looks up models without a database connection', () => {
    expect(findIdentityModel('identity.account')).toBeUndefined();
    expect(findIdentityModel('identity.session')).toBeUndefined();
  });

  it('does not open a database connection during module import', () => {
    expect(knexFactory).not.toHaveBeenCalled();
  });

  it('keeps the registry entry shape model-only', () => {
    const entry: IdentityModelEntry = { name: 'identity.example', tableName: 'identity.example' };
    expect(entry).toEqual({ name: 'identity.example', tableName: 'identity.example' });
  });
});
