import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import {
  createIdentityDatabase,
  IdentityDatabaseError,
  type IdentityDatabaseOptions,
} from './identity-database.js';

const IDENTITY_URL = 'postgresql://identity_user:secret@identity-db.internal:5432/identity_db';

function environment(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { IDENTITY_DATABASE_URL: IDENTITY_URL, ...overrides };
}

function connectionSpy(options: IdentityDatabaseOptions = {}) {
  const destroy = vi.fn(async () => undefined);
  const raw = vi.fn(async () => [{ ok: true }]) as unknown as Knex['raw'];
  const createConnection = vi.fn(() => ({ raw, destroy }));
  return {
    createConnection,
    destroy,
    raw,
    database: createIdentityDatabase({
      environment: environment(),
      createConnection,
      ...options,
    }),
  };
}

describe('Identity database connection', () => {
  it('uses only IDENTITY_DATABASE_URL with PostgreSQL and injectable pool settings', () => {
    const { createConnection } = connectionSpy({
      pool: { min: 0, max: 2, acquireTimeoutMs: 1500 },
    });
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        client: 'pg',
        connection: IDENTITY_URL,
        pool: { min: 0, max: 2, acquireTimeoutMillis: 1500 },
      })
    );
  });

  it('fails clearly when IDENTITY_DATABASE_URL is absent and never uses DATABASE_URL', () => {
    expect(() =>
      createIdentityDatabase({
        environment: environment({ IDENTITY_DATABASE_URL: undefined }),
      })
    ).toThrowError('Missing required environment variable: IDENTITY_DATABASE_URL');
  });

  it('rejects the business database URL explicitly', () => {
    expect(() =>
      createIdentityDatabase({ environment: environment({ DATABASE_URL: IDENTITY_URL }) })
    ).toThrowError('IDENTITY_DATABASE_URL must not equal DATABASE_URL');
  });

  it('closes exactly once without requiring a live server', async () => {
    const { database, destroy, raw } = connectionSpy();
    await database.raw('SELECT 1');
    expect(raw).toHaveBeenCalledWith('SELECT 1');
    await database.close();
    await database.close();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
