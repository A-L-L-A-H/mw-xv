import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import {
  checkClaimRateLimit,
  checkLoginRateLimit,
  constantTimeVerify,
  hashKey,
} from './login-rate-limit.js';

type SqliteKnex = Knex & { destroy(): Promise<void> };

function identityPort(db: SqliteKnex) {
  return {
    raw: (sql: string, bindings: readonly unknown[]) =>
      db.raw(sql.replaceAll('identity.login_attempt', 'login_attempt'), bindings as Parameters<typeof db.raw>[1]),
  };
}

async function createDb(): Promise<SqliteKnex> {
  const knexFactory = (await import('knex')).default;
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }) as SqliteKnex;
  await knex.schema.createTable('login_attempt', (table) => {
    table.increments('id').primary();
    table.string('identifier_hash').notNullable();
    table.datetime('created_at').notNullable();
  });
  return knex;
}

describe('privacy-preserving keys', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('produces keyed HMAC-SHA256 using configured salt', () => {
    process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT = 'test-salt';
    const expected = createHmac('sha256', 'test-salt').update('1.2.3.4').digest('hex');
    expect(hashKey('1.2.3.4')).toBe(expected);
  });

  it('differs per IP', () => {
    process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT = 'test-salt';
    expect(hashKey('10.0.0.1')).not.toBe(hashKey('10.0.0.2'));
  });
});

describe('checkLoginRateLimit', () => {
  let db: SqliteKnex;

  beforeEach(async () => {
    db = await createDb();
    delete process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT;
    delete process.env.IDENTITY_INTERNAL_SECRET;
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function insertAttempt(identifierHash: string, minutesAgo: number): Promise<void> {
    await db('login_attempt').insert({
      identifier_hash: identifierHash,
      created_at: new Date(new Date('2026-01-01T00:00:00.000Z').getTime() - minutesAgo * 60_000),
    });
  }

  it('allows below limit within window', async () => {
    const result = await checkLoginRateLimit(
      { database: identityPort(db), now: () => new Date('2026-01-01T00:00:00.000Z') },
      { headers: {}, ip: '1.1.1.1' }
    );
    expect(result.allowed).toBe(true);
  });

  it('blocks at limit within window and returns retry-after', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const clientKey = '1.1.1.1';
    process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT = 'test-salt';
    const identifierHash = createHmac('sha256', 'test-salt').update(clientKey).digest('hex');

    for (let i = 0; i < 10; i++) {
      await insertAttempt(identifierHash, 0);
    }
    const result = await checkLoginRateLimit(
      { database: identityPort(db), now: () => now },
      { headers: {}, ip: clientKey }
    );
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('ignores usage older than the window', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const clientKey = '1.1.1.1';
    process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT = 'test-salt';
    const identifierHash = createHmac('sha256', 'test-salt').update(clientKey).digest('hex');

    await insertAttempt(identifierHash, 20);
    await insertAttempt(identifierHash, 30);
    const result = await checkLoginRateLimit(
      { database: identityPort(db), now: () => now },
      { headers: {}, ip: clientKey }
    );
    expect(result.allowed).toBe(true);
  });

  it('uses trusted proxy x-forwarded-for when enabled', async () => {
    const result = await checkLoginRateLimit(
      { database: identityPort(db), trustedProxy: true, now: () => new Date('2026-01-01T00:00:00.000Z') },
      { headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' } }
    );
    expect(result.allowed).toBe(true);
  });

  it('ignores x-forwarded-for when trusted proxy is disabled', async () => {
    const result = await checkLoginRateLimit(
      { database: identityPort(db), trustedProxy: false, now: () => new Date('2026-01-01T00:00:00.000Z') },
      { headers: { 'x-forwarded-for': '203.0.113.195' }, ip: '1.1.1.1' }
    );
    expect(result.allowed).toBe(true);
  });

  it('fails closed in production without salt', async () => {
    delete process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT;
    delete process.env.IDENTITY_INTERNAL_SECRET;
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    await expect(
      checkLoginRateLimit(
        { database: identityPort(db), now: () => new Date('2026-01-01T00:00:00.000Z') },
        { headers: {}, ip: '1.1.1.1' }
      )
    ).rejects.toThrow(/production/);
  });
});

describe('checkClaimRateLimit', () => {
  let db: SqliteKnex;

  beforeEach(async () => {
    db = await createDb();
    delete process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT;
    delete process.env.IDENTITY_INTERNAL_SECRET;
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('allows below claim limit within window', async () => {
    const result = await checkClaimRateLimit(
      { database: identityPort(db), now: () => new Date('2026-01-01T00:00:00.000Z') },
      { headers: {}, ip: '1.1.1.1' }
    );
    expect(result.allowed).toBe(true);
  });

  it('blocks at claim limit within window', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const clientKey = '1.1.1.1';
    process.env.IDENTITY_LOGIN_RATE_LIMIT_SALT = 'test-salt';
    const identifierHash = createHmac('sha256', 'test-salt').update(clientKey).digest('hex');

    for (let i = 0; i < 5; i++) {
      await db('login_attempt').insert({
        identifier_hash: identifierHash,
        created_at: now,
      });
    }
    const result = await checkClaimRateLimit(
      { database: identityPort(db), now: () => now },
      { headers: {}, ip: clientKey }
    );
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('constantTimeVerify', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeVerify('same', 'same')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(constantTimeVerify('same', 'diff')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(constantTimeVerify('short', 'longer')).toBe(false);
  });
});


