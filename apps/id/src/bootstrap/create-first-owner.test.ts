import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import {
  createFirstOwner,
  FIRST_OWNER_GENERIC_FAILURE,
  FirstOwnerError,
  normalizeOwnerIdentifier,
  type OwnerDatabasePort,
} from './create-first-owner.js';
function digestBootstrapToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

const TOKEN = 'test-bootstrap-token-with-at-least-32-bytes-entropy';
const NOW = new Date('2026-01-01T00:00:00.000Z');

function transactionHarness(options: {
  ownerExists?: boolean;
  tokenClaimable?: boolean;
  failAt?: string;
} = {}) {
  const statements: string[] = [];
  let committed = false;
  const raw = vi.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes('FROM identity.account_capability')) {
      return { rows: options.ownerExists ? [{ present: 1 }] : [] };
    }
    if (sql.includes('UPDATE identity.bootstrap_token')) {
      return { rows: options.tokenClaimable === false ? [] : [{ id: 'token-1' }] };
    }
    if (options.failAt && sql.includes(options.failAt)) {
      throw new Error('simulated write failure');
    }
    return { rows: [] };
  });
  const transactionDatabase: OwnerDatabasePort = {
    raw,
    transaction: async <T>(work: (transaction: OwnerDatabasePort) => Promise<T>): Promise<T> => {
      try {
        const result = await work(transactionDatabase);
        committed = true;
        return result;
      } catch (error) {
        throw error;
      }
    },
  };
  return { transactionDatabase, raw, statements, isCommitted: () => committed };
}

const hasher = {
  hash: vi.fn(async () => ({
    algorithm: 'scrypt' as const,
    version: 1 as const,
    verifier: 'scrypt$generated$verifier',
  })),
  verify: vi.fn(async () => true),
  needsUpgrade: vi.fn(() => false),
};

function baseInput(transactionDatabase: OwnerDatabasePort) {
  return {
    transactionDatabase,
    bootstrapTokenDigest: digestBootstrapToken(TOKEN),
    identifierType: 'email' as const,
    identifierValue: '  Owner@Example.COM ',
    password: 'generated-test-password',
    passwordHasher: hasher,
    now: NOW,
  };
}

describe('create first Platform Owner', () => {
  it('normalizes identifiers and hashes passwords through the maintained adapter', () => {
    expect(normalizeOwnerIdentifier('email', ' Owner@Example.COM ')).toBe('owner@example.com');
    expect(normalizeOwnerIdentifier('username', ' Owner ')).toBe('Owner');
  });

  it('creates account, identifier, credential and capability atomically', async () => {
    const harness = transactionHarness();
    const result = await createFirstOwner(baseInput(harness.transactionDatabase));

    expect(result.bootstrapCompleted).toBe(true);
    expect(result.accountSubject).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(result)).toEqual(['accountSubject', 'bootstrapCompleted']);
    expect(JSON.stringify(result)).not.toContain('scrypt$');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(harness.statements.some((sql) => sql.includes('INSERT INTO identity.account '))).toBe(true);
    expect(harness.statements.some((sql) => sql.includes('INSERT INTO identity.identifier'))).toBe(true);
    expect(harness.statements.some((sql) => sql.includes('INSERT INTO identity.credential'))).toBe(true);
    expect(harness.statements.some((sql) => sql.includes('INSERT INTO identity.account_capability'))).toBe(true);
    expect(harness.isCommitted()).toBe(true);
  });

  it('rejects a second owner without revealing account or token details', async () => {
    const harness = transactionHarness({ ownerExists: true });
    let captured: unknown;
    try {
      await createFirstOwner(baseInput(harness.transactionDatabase));
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(FirstOwnerError);
    expect((captured as Error).message).toBe(FIRST_OWNER_GENERIC_FAILURE);
    expect(harness.raw.mock.calls.length).toBe(1);
  });

  it('does not create records when the bootstrap token is unavailable', async () => {
    const harness = transactionHarness({ tokenClaimable: false });
    await expect(createFirstOwner(baseInput(harness.transactionDatabase))).rejects.toThrow(
      FIRST_OWNER_GENERIC_FAILURE
    );
    expect(harness.statements.some((sql) => sql.startsWith('INSERT INTO'))).toBe(false);
    expect(harness.isCommitted()).toBe(false);
  });

  it('rolls back all writes when a later insert fails', async () => {
    const harness = transactionHarness({ failAt: 'INSERT INTO identity.account_capability' });
    await expect(createFirstOwner(baseInput(harness.transactionDatabase))).rejects.toThrow(
      FirstOwnerError
    );
    expect(harness.statements.some((sql) => sql.includes('INSERT INTO identity.account '))).toBe(true);
    expect(harness.isCommitted()).toBe(false);
  });

  it('does not leak the password hash in thrown errors', async () => {
    const harness = transactionHarness({ failAt: 'INSERT INTO identity.identifier' });
    let message = '';
    try {
      await createFirstOwner(baseInput(harness.transactionDatabase));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(FIRST_OWNER_GENERIC_FAILURE);
    expect(message).not.toContain('scrypt$');
  });
});
