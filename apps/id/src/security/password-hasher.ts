import { hashIdentityPassword, verifyIdentityPassword } from '@moonwitness/orm-identity';

export interface PasswordHashRecord {
  readonly algorithm: 'scrypt';
  readonly version: 1;
  readonly verifier: string;
}

export class PasswordHashError extends Error {
  override readonly name = 'PasswordHashError';
}

export interface PasswordHasher {
  readonly hash: (password: string) => Promise<PasswordHashRecord>;
  readonly verify: (password: string, record: PasswordHashRecord) => Promise<boolean>;
  readonly needsUpgrade: (record: PasswordHashRecord) => boolean;
}

function assertPassword(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new PasswordHashError('Password is required');
  }
}

function assertRecord(record: PasswordHashRecord): void {
  if (
    !record ||
    record.algorithm !== 'scrypt' ||
    record.version !== 1 ||
    typeof record.verifier !== 'string' ||
    !record.verifier.startsWith('scrypt$')
  ) {
    throw new PasswordHashError('Stored credential verifier is malformed');
  }
}

export function createRepositoryPasswordHasher(): PasswordHasher {
  return {
    hash: async (password) => {
      assertPassword(password);
      try {
        return hashIdentityPassword(password);
      } catch {
        throw new PasswordHashError('Unable to hash password');
      }
    },
    verify: async (password, record) => {
      assertPassword(password);
      assertRecord(record);
      return verifyIdentityPassword(password, record);
    },
    needsUpgrade: (record) => {
      assertRecord(record);
      return record.version < 1;
    },
  };
}
