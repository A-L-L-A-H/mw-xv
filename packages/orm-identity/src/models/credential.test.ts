import { describe, expect, it } from 'vitest';

import { IdentityCredential } from './credential.js';

describe('identity.credential model', () => {
  it('stores algorithm/version metadata without password plaintext', () => {
    const credential = IdentityCredential.fromJson({
      account_id: 'acct-1',
      algorithm: 'scrypt',
      version: 1,
      verifier: 'scrypt$131072$8$1$0123456789abcdef0123456789abcdef$' + 'a'.repeat(128),
    });
    credential.$beforeInsert({} as never);
    const json = credential.toJSON() as Record<string, unknown>;
    expect(json.account_id).toBe('acct-1');
    expect(json.algorithm).toBe('scrypt');
    expect(json.version).toBe(1);
    expect(json).not.toHaveProperty('password');
  });
});
