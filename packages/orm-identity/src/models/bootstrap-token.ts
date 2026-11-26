import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Model, type QueryContext } from 'objection';

export const DEFAULT_BOOTSTRAP_TOKEN_TTL_SECONDS = 15 * 60;
export const MAX_BOOTSTRAP_TOKEN_TTL_SECONDS = 60 * 60;
export const MIN_BOOTSTRAP_TOKEN_BYTES = 32;

export interface BootstrapDatabasePort {
  readonly raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown>;
}

export interface CreateBootstrapTokenInput {
  readonly installationScope?: string;
  readonly ttlSeconds?: number;
  readonly now?: Date;
}

export interface CreatedBootstrapToken {
  readonly installationScope: string;
  readonly expiresAt: string;
  readonly rawToken: string;
  readonly tokenDigest: string;
}

export interface BootstrapTokenCollisionError extends Error {
  code: 'ACTIVE_BOOTSTRAP_TOKEN_EXISTS';
}

export function digestBootstrapToken(token: string): string {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('bootstrap token must be a non-empty string');
  }
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

export function verifyBootstrapToken(token: string, expectedDigest: string): boolean {
  const actual = Buffer.from(digestBootstrapToken(token));
  const expected = Buffer.from(expectedDigest);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateBootstrapToken(byteLength = MIN_BOOTSTRAP_TOKEN_BYTES): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < MIN_BOOTSTRAP_TOKEN_BYTES) {
    throw new Error(`bootstrap token must contain at least ${MIN_BOOTSTRAP_TOKEN_BYTES} random bytes`);
  }
  return randomBytes(byteLength).toString('base64url');
}

function rowsFrom(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

function assertTtl(ttlSeconds: number): void {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_BOOTSTRAP_TOKEN_TTL_SECONDS) {
    throw new Error(
      `ttlSeconds must be between 1 and ${MAX_BOOTSTRAP_TOKEN_TTL_SECONDS}`
    );
  }
}

export function isBootstrapTokenClaimable(
  token: BootstrapToken | undefined,
  now: Date = new Date()
): boolean {
  if (!token || token.consumed_at || token.revoked_at) return false;
  return new Date(token.expires_at).getTime() > now.getTime();
}

export class BootstrapToken extends Model {
  static override readonly tableName = 'identity.bootstrap_token';
  static override readonly idColumn = 'id';

  id!: string;
  installation_scope!: string;
  token_digest!: string;
  created_at!: string;
  expires_at!: string;
  consumed_at?: string | null;
  revoked_at?: string | null;

  override $beforeInsert(_context: QueryContext): void {
    if (!this.id) this.id = randomUUID();
    if (!this.created_at) this.created_at = new Date().toISOString();
  }

  override $formatJson(json: Record<string, unknown>): Record<string, unknown> {
    const formatted = super.$formatJson(json);
    delete formatted.token_digest;
    return formatted;
  }
}

export function createBootstrapTokenRecord(
  rawToken: string,
  input: CreateBootstrapTokenInput = {}
): BootstrapToken {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_BOOTSTRAP_TOKEN_TTL_SECONDS;
  assertTtl(ttlSeconds);

  const token = BootstrapToken.fromJson({
    installation_scope: input.installationScope ?? 'installation',
    token_digest: digestBootstrapToken(rawToken),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  });
  token.$beforeInsert({} as QueryContext);
  return token;
}

/** Atomic insert relies on the partial unique index for one active token per scope. */
export async function insertBootstrapToken(
  token: BootstrapToken,
  database: BootstrapDatabasePort
): Promise<BootstrapToken> {
  try {
    const rows = rowsFrom(
      await database.raw(
        `INSERT INTO identity.bootstrap_token
           (id, installation_scope, token_digest, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (installation_scope) WHERE consumed_at IS NULL AND revoked_at IS NULL
         DO NOTHING
         RETURNING *`,
        [
          token.id,
          token.installation_scope,
          token.token_digest,
          token.created_at,
          token.expires_at,
        ]
      )
    );
    const inserted = rows[0];
    if (!inserted) {
      const error = new Error('An active bootstrap token already exists') as BootstrapTokenCollisionError;
      error.code = 'ACTIVE_BOOTSTRAP_TOKEN_EXISTS';
      throw error;
    }
    return BootstrapToken.fromJson(inserted);
  } catch (error) {
    if ((error as BootstrapTokenCollisionError).code === 'ACTIVE_BOOTSTRAP_TOKEN_EXISTS') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|duplicate|conflict/i.test(message)) {
      const collision = new Error(
        'An active bootstrap token already exists'
      ) as BootstrapTokenCollisionError;
      collision.code = 'ACTIVE_BOOTSTRAP_TOKEN_EXISTS';
      throw collision;
    }
    throw error;
  }
}

/** Used by later claim/bootstrap services to consume the token atomically. */
export async function consumeBootstrapToken(
  tokenDigest: string,
  options: {
    readonly database: BootstrapDatabasePort;
    readonly now?: Date;
    readonly installationScope?: string;
  }
): Promise<BootstrapToken | undefined> {
  const now = (options.now ?? new Date()).toISOString();
  const rows = rowsFrom(
    await options.database.raw(
      `UPDATE identity.bootstrap_token
       SET consumed_at = ?
       WHERE token_digest = ?
         AND installation_scope = ?
         AND consumed_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > ?
       RETURNING *`,
      [now, tokenDigest, options.installationScope ?? 'installation', now]
    )
  );
  return rows[0] ? BootstrapToken.fromJson(rows[0]) : undefined;
}
