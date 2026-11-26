import { describe, expect, it } from 'vitest';

import { createRepositoryPasswordHasher, PasswordHashError } from './password-hasher.js';

describe('Identity password hasher adapter', () => {
  const hasher = createRepositoryPasswordHasher();
  const password = 'correct-horse-battery-staple';

  it('verifies the correct password against the stored verifier', async () => {
    const record = await hasher.hash(password);
    expect(record.algorithm).toBe('scrypt');
    expect(record.version).toBe(1);
    expect(await hasher.verify(password, record)).toBe(true);
  });

  it('rejects the wrong password without revealing the verifier', async () => {
    const record = await hasher.hash(password);
    expect(await hasher.verify('wrong-password', record)).toBe(false);
  });

  it('rejects malformed stored hashes and never echoes their contents', () => {
    const malformed = {
      algorithm: 'scrypt' as const,
      version: 1 as const,
      verifier: 'scrypt$not-a-real-hash',
    };
    expect(hasher.needsUpgrade(malformed)).toBe(false);
    expect(() => hasher.needsUpgrade({ ...malformed, version: 2 as never })).toThrowError(PasswordHashError);
    try {
      hasher.needsUpgrade({ ...malformed, algorithm: 'md5' as never });
      throw new Error('Expected PasswordHashError');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(malformed.verifier);
      expect(message).not.toContain(password);
    }
  });
});
