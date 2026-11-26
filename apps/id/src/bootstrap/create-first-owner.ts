import { randomUUID } from 'node:crypto';

import { createRepositoryPasswordHasher, type PasswordHasher } from '../security/password-hasher.js';

const PLATFORM_OWNER_CAPABILITY = 'platform_owner';

export interface OwnerDatabasePort {
  readonly raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
  readonly transaction: <T>(work: (transaction: OwnerDatabasePort) => Promise<T>) => Promise<T>;
}

export interface CreateFirstOwnerInput {
  readonly transactionDatabase: OwnerDatabasePort;
  readonly bootstrapTokenDigest: string;
  readonly identifierType: 'email' | 'username';
  readonly identifierValue: string;
  readonly password: string;
  readonly passwordHasher?: PasswordHasher;
  readonly installationScope?: string;
  readonly now?: Date;
}

export interface FirstOwnerResult {
  readonly accountSubject: string;
  readonly bootstrapCompleted: true;
}

export class FirstOwnerError extends Error {
  override readonly name = 'FirstOwnerError';
}

export const FIRST_OWNER_GENERIC_FAILURE = 'Initial setup is no longer available';

function rowsFrom(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

function genericFailure(cause: unknown): FirstOwnerError {
  return new FirstOwnerError(FIRST_OWNER_GENERIC_FAILURE, { cause });
}

export function normalizeOwnerIdentifier(type: 'email' | 'username', value: string): string {
  const trimmed = value.trim();
  const normalized = type === 'email' ? trimmed.toLocaleLowerCase('en-US') : trimmed;
  if (!normalized) throw new FirstOwnerError(FIRST_OWNER_GENERIC_FAILURE);
  return normalized;
}

async function ownerAlreadyExists(transaction: OwnerDatabasePort): Promise<boolean> {
  const rows = rowsFrom(
    await transaction.raw(
      `SELECT 1 AS present FROM identity.account_capability
       WHERE capability = ? LIMIT 1`,
      [PLATFORM_OWNER_CAPABILITY]
    )
  );
  return rows.length > 0;
}

export async function createFirstOwner(
  input: CreateFirstOwnerInput
): Promise<FirstOwnerResult> {
  const hasher = input.passwordHasher ?? createRepositoryPasswordHasher();
  const normalizedIdentifier = normalizeOwnerIdentifier(
    input.identifierType,
    input.identifierValue
  );
  const passwordHash = await hasher.hash(input.password).catch((error) => {
    throw genericFailure(error);
  });
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const accountSubject = randomUUID();
  const accountId = randomUUID();
  const scope = input.installationScope ?? 'installation';

  return input.transactionDatabase.transaction(async (transaction) => {
    try {
      if (await ownerAlreadyExists(transaction)) throw genericFailure('owner exists');

      const consumed = rowsFrom(
        await transaction.raw(
          `UPDATE identity.bootstrap_token
           SET consumed_at = ?
           WHERE token_digest = ?
             AND installation_scope = ?
             AND consumed_at IS NULL
             AND revoked_at IS NULL
             AND expires_at > ?
           RETURNING id`,
          [nowIso, input.bootstrapTokenDigest, scope, nowIso]
        )
      );
      if (consumed.length === 0) throw genericFailure('token unavailable');

      await transaction.raw(
        `INSERT INTO identity.account (id, subject, status, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?)`,
        [accountId, accountSubject, nowIso, nowIso]
      );
      await transaction.raw(
        `INSERT INTO identity.identifier
           (id, account_id, type, value, display_value, verified, primary, created_at)
         VALUES (?, ?, ?, ?, ?, true, true, ?)`,
        [
          randomUUID(),
          accountId,
          input.identifierType,
          normalizedIdentifier,
          input.identifierValue.trim(),
          nowIso,
        ]
      );
      await transaction.raw(
        `INSERT INTO identity.credential
           (id, account_id, algorithm, version, verifier, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          accountId,
          passwordHash.algorithm,
          passwordHash.version,
          passwordHash.verifier,
          nowIso,
          nowIso,
        ]
      );
      await transaction.raw(
        `INSERT INTO identity.account_capability (id, account_id, capability, created_at)
         VALUES (?, ?, ?, ?)`,
        [randomUUID(), accountId, PLATFORM_OWNER_CAPABILITY, nowIso]
      );

      return Object.freeze({ accountSubject, bootstrapCompleted: true as const });
    } catch (error) {
      if (error instanceof FirstOwnerError) throw error;
      throw genericFailure(error);
    }
  });
}
