import { describe, expect, it, vi } from 'vitest';

import {
  claimBootstrap,
  CLAIM_FAILURE,
  ClaimBootstrapError,
  digestClaimToken,
  MAX_CLAIM_FIELD_LENGTH,
  MIN_CLAIM_PASSWORD_LENGTH,
  redactClaimForLog,
} from './claim-bootstrap.js';
import { FIRST_OWNER_GENERIC_FAILURE } from './create-first-owner.js';
import type { CreateFirstOwnerInput, OwnerDatabasePort } from './create-first-owner.js';

const DATABASE = { raw: vi.fn(), transaction: vi.fn() } as unknown as OwnerDatabasePort;
const TOKEN = 'raw-bootstrap-token-0123456789abcdef';
const PASSWORD = 'generated-valid-password';

function input(overrides: Partial<Parameters<typeof claimBootstrap>[0]> = {}) {
  return {
    transactionDatabase: DATABASE,
    setupToken: TOKEN,
    identifierType: 'email' as const,
    identifierValue: 'Owner@Example.com',
    password: PASSWORD,
    isSecure: true,
    ...overrides,
  };
}

describe('claim bootstrap service', () => {
  it('hashes the submitted token before delegating atomic owner creation', async () => {
    const createAccount = vi.fn(async (_input: CreateFirstOwnerInput) => ({
      accountSubject: 'subject-1',
      bootstrapCompleted: true as const,
    }));
    const result = await claimBootstrap(input({ createAccount }));

    expect(result).toEqual({
      complete: true,
      nextStep: 'Sign in with your identity provider account',
    });
    expect(createAccount).toHaveBeenCalledTimes(1);
    const call = createAccount.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.bootstrapTokenDigest).toBe(digestClaimToken(TOKEN));
    expect(call.bootstrapTokenDigest).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });

  it('fails closed on invalid, expired, reused and concurrent claims', async () => {
    for (const reason of [
      FIRST_OWNER_GENERIC_FAILURE,
      'token expired',
      'token already consumed',
      'concurrent claim',
    ]) {
      const createAccount = vi.fn(async () => {
        throw new Error(reason);
      });
      await expect(claimBootstrap(input({ createAccount }))).rejects.toThrow(ClaimBootstrapError);
      await expect(claimBootstrap(input({ createAccount }))).rejects.toThrow(CLAIM_FAILURE);
    }
  });

  it('rejects insecure transport, oversized fields and weak passwords', async () => {
    const createAccount = vi.fn(async () => ({
      accountSubject: 'subject-1',
      bootstrapCompleted: true as const,
    }));
    const invalid = [
      input({ createAccount, isSecure: false }),
      input({ createAccount, setupToken: 'x'.repeat(MAX_CLAIM_FIELD_LENGTH + 1) }),
      input({ createAccount, identifierValue: '' }),
      input({ createAccount, password: 'short' }),
      input({ createAccount, password: PASSWORD, identifierType: 'invalid' as never }),
    ];
    expect(MIN_CLAIM_PASSWORD_LENGTH).toBe(12);

    for (const value of invalid) {
      await expect(claimBootstrap(value)).rejects.toThrow(CLAIM_FAILURE);
    }
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('redacts every submitted field from logs', () => {
    const redacted = redactClaimForLog({
      setupToken: TOKEN,
      identifierValue: 'owner@example.com',
      password: PASSWORD,
    });

    expect(JSON.stringify(redacted)).toBe(
      '{"identifierValue":"[REDACTED]","password":"[REDACTED]","setupToken":"[REDACTED]"}'
    );
    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
    expect(JSON.stringify(redacted)).not.toContain(PASSWORD);
  });
});
