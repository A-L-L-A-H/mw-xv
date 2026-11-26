import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  createRepositoryPasswordHasher,
  type PasswordHasher,
  type PasswordHashRecord,
} from '../security/password-hasher.js';

export type LoginIdentifierType = 'email' | 'username';
export const LOGIN_FAILURE = 'Invalid credentials or unavailable account';
export const DEFAULT_LOGIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const MAX_LOGIN_CLIENT_ID_LENGTH = 128;
export const MAX_LOGIN_DEVICE_LENGTH = 256;

export interface LoginDatabasePort {
  readonly raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
}

export interface LoginInput {
  readonly database: LoginDatabasePort;
  readonly identifierType: LoginIdentifierType;
  readonly identifierValue: string;
  readonly password: string;
  readonly clientId: string;
  readonly device?: string;
  readonly userAgent?: string;
  readonly sessionTtlSeconds?: number;
  readonly passwordHasher?: PasswordHasher;
  readonly now?: Date;
}

export interface LoginSession {
  readonly sessionId: string;
  readonly accountSubject: string;
  readonly clientId: string;
  readonly expiresAt: string;
  readonly metadata: {
    readonly device?: string;
    readonly userAgent?: string;
  };
}

export class LoginError extends Error {
  override readonly name = 'LoginError';
}

interface AccountRow {
  readonly id: string;
  readonly subject: string;
  readonly status: string;
  readonly verifier: string;
  readonly algorithm: string;
  readonly version: number;
}

function rowsFrom(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

function fail(cause?: unknown): LoginError {
  return new LoginError(LOGIN_FAILURE, cause === undefined ? undefined : { cause });
}

export function normalizeLoginIdentifier(
  type: LoginIdentifierType,
  value: string
): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return type === 'email' ? trimmed.toLocaleLowerCase('en-US') : trimmed;
}

export function digestSessionSecret(secret: string): string {
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`;
}

export function verifySessionSecret(secret: string, digest: string): boolean {
  const actual = Buffer.from(digestSessionSecret(secret));
  const expected = Buffer.from(digest);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeMetadata(device: string | undefined, userAgent: string | undefined) {
  const clean = (value: string | undefined, maximum: number) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().slice(0, maximum);
    return trimmed || undefined;
  };
  const normalizedDevice = clean(device, MAX_LOGIN_DEVICE_LENGTH);
  const normalizedUserAgent = clean(userAgent, MAX_LOGIN_DEVICE_LENGTH);
  return {
    ...(normalizedDevice ? { device: normalizedDevice } : {}),
    ...(normalizedUserAgent ? { userAgent: normalizedUserAgent } : {}),
  };
}

function assertInput(input: LoginInput): void {
  if (
    input.identifierType !== 'email' &&
    input.identifierType !== 'username'
  ) throw fail('invalid identifier type');
  if (
    typeof input.password !== 'string' ||
    input.password.length === 0
  ) throw fail('missing password');
  if (
    typeof input.clientId !== 'string' ||
    input.clientId.trim() === '' ||
    input.clientId.length > MAX_LOGIN_CLIENT_ID_LENGTH
  ) throw fail('invalid client');
  if (!normalizeLoginIdentifier(input.identifierType, input.identifierValue)) {
    throw fail('missing identifier');
  }
}

async function resolveAccount(input: LoginInput): Promise<AccountRow | undefined> {
  const normalized = normalizeLoginIdentifier(input.identifierType, input.identifierValue);
  const rows = rowsFrom(
    await input.database.raw(
      `SELECT account.id, account.subject, account.status,
              credential.verifier, credential.algorithm, credential.version
       FROM identity.identifier
       JOIN identity.account ON identity.account.id = identity.identifier.account_id
       JOIN identity.credential ON identity.credential.account_id = identity.account.id
       WHERE identity.identifier.type = ? AND identity.identifier.value = ?
       LIMIT 1`,
      [input.identifierType, normalized]
    )
  );
  const row = rows[0];
  return row ? (row as unknown as AccountRow) : undefined;
}

export async function login(input: LoginInput): Promise<LoginSession> {
  assertInput(input);
  const account = await resolveAccount(input).catch((error) => {
    throw fail(error);
  });
  if (!account || account.status !== 'active') throw fail('account unavailable');

  const hasher = input.passwordHasher ?? createRepositoryPasswordHasher();
  if (
    account.algorithm !== 'scrypt' ||
    Number(account.version) !== 1 ||
    typeof account.verifier !== 'string' ||
    !account.verifier.startsWith('scrypt$')
  ) {
    throw fail('malformed credential');
  }
  const record: PasswordHashRecord = {
    algorithm: 'scrypt',
    version: 1,
    verifier: String(account.verifier),
  };
  const verified = await hasher
    .verify(input.password, record)
    .catch(() => false);
  if (!verified) throw fail('password mismatch');

  const ttlSeconds = input.sessionTtlSeconds ?? DEFAULT_LOGIN_SESSION_TTL_SECONDS;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) throw fail('invalid session TTL');
  const now = input.now ?? new Date();
  const sessionSecret = randomBytes(48).toString('base64url');
  const sessionId = randomUUID();
  const metadata = normalizeMetadata(input.device, input.userAgent);

  try {
    await input.database.raw(
      `INSERT INTO identity.session
         (id, account_id, account_subject, client_id, secret_digest, metadata,
          created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        account.id,
        account.subject,
        input.clientId.trim(),
        digestSessionSecret(sessionSecret),
        JSON.stringify(metadata),
        now.toISOString(),
        now.toISOString(),
        new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      ]
    );
  } catch (error) {
    throw fail(error);
  }

  return Object.freeze({
    sessionId,
    accountSubject: account.subject,
    clientId: input.clientId.trim(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    metadata: Object.freeze(metadata),
  });
}
