import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LOGIN_SESSION_TTL_SECONDS,
  digestSessionSecret,
  LOGIN_FAILURE,
  LoginError,
  login,
  normalizeLoginIdentifier,
  verifySessionSecret,
  type LoginDatabasePort,
} from './login-service.js';
import type { PasswordHasher } from '../security/password-hasher.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const PASSWORD = 'generated-valid-password';
const VERIFIER = 'scrypt$generated$verifier';

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acct-1',
    subject: 'opaque-subject-1',
    status: 'active',
    algorithm: 'scrypt',
    version: 1,
    verifier: VERIFIER,
    ...overrides,
  };
}

function database(row: Record<string, unknown> | null = accountRow()) {
  const raw = vi.fn(async (sql: string, _bindings?: readonly unknown[]) => ({
    rows: sql.includes('FROM identity.identifier') && row !== null ? [row] : [],
  }));
  return { port: { raw } satisfies LoginDatabasePort, raw };
}

const hasher: PasswordHasher = {
  hash: vi.fn(async () => ({ algorithm: 'scrypt' as const, version: 1 as const, verifier: VERIFIER })),
  verify: vi.fn(async (password: string) => password === PASSWORD),
  needsUpgrade: vi.fn(() => false),
};

function input(databasePort: LoginDatabasePort) {
  return {
    database: databasePort,
    identifierType: 'email' as const,
    identifierValue: ' Owner@Example.COM ',
    password: PASSWORD,
    clientId: 'board',
    device: '  Browser/1.0  ',
    userAgent: 'x'.repeat(500),
    passwordHasher: hasher,
    now: NOW,
  };
}

describe('identity login service', () => {
  it('normalizes identifiers and session metadata', () => {
    expect(normalizeLoginIdentifier('email', ' Owner@Example.COM ')).toBe('owner@example.com');
    expect(normalizeLoginIdentifier('username', ' Owner ')).toBe('Owner');
  });

  it('stores only a one-way session digest and returns safe session data', async () => {
    const { port, raw } = database();
    const result = await login(input(port));
    const insert = raw.mock.calls[1];
    const bindings = (insert?.[1] ?? []) as unknown[];

    expect(result.accountSubject).toBe('opaque-subject-1');
    expect(result.clientId).toBe('board');
    expect(result.expiresAt).toBe('2026-01-01T08:00:00.000Z');
    expect(Object.keys(result.metadata)).toEqual(['device', 'userAgent']);
    expect(result.metadata.device).toBe('Browser/1.0');
    expect(result.metadata.userAgent).toHaveLength(256);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain(VERIFIER);
    expect(String(bindings[4])).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(verifySessionSecret('unknown-secret', String(bindings[4]))).toBe(false);
    expect(DEFAULT_LOGIN_SESSION_TTL_SECONDS).toBe(28800);
  });

  it('creates no session for unknown, wrong-password, disabled or malformed cases', async () => {
    const cases = [
      { row: null, password: PASSWORD },
      { row: accountRow(), password: 'wrong-password-value' },
      { row: accountRow({ status: 'disabled' }), password: PASSWORD },
      { row: accountRow({ verifier: 'malformed' }), password: PASSWORD },
    ];

    for (const testCase of cases) {
      const { port, raw } = database(testCase.row);
      let message = '';
      try {
        await login({ ...input(port), password: testCase.password });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe(LOGIN_FAILURE);
      expect(raw.mock.calls.length).toBe(1);
    }
  });

  it('fails closed on database errors without leaking details', async () => {
    const port: LoginDatabasePort = {
      raw: vi.fn(async () => {
        throw new Error('postgresql://user:secret@db/identity');
      }),
    };
    let message = '';
    try {
      await login(input(port));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(LOGIN_FAILURE);
    expect(message).not.toContain('secret');
  });

  it('rejects invalid client and session TTL inputs', async () => {
    const { port } = database();
    await expect(login({ ...input(port), clientId: '' })).rejects.toBeInstanceOf(LoginError);
    await expect(login({ ...input(port), sessionTtlSeconds: 0 })).rejects.toThrow(LOGIN_FAILURE);
  });
});
