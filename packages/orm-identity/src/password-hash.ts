import { hashPassword, verifyPassword } from '@moonwitness/orm';

export interface IdentityPasswordHash {
  readonly algorithm: 'scrypt';
  readonly version: 1;
  readonly verifier: string;
}

export async function hashIdentityPassword(password: string): Promise<IdentityPasswordHash> {
  return { algorithm: 'scrypt', version: 1, verifier: await hashPassword(password) };
}

export async function verifyIdentityPassword(
  password: string,
  record: IdentityPasswordHash
): Promise<boolean> {
  return verifyPassword(password, record.verifier);
}
