import { createHash, randomUUID } from 'node:crypto';
import { Model, type QueryContext, type Transaction } from 'objection';

export function digestRefreshToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

export function newRefreshFamilyId(): string {
  return `rtf_${randomUUID()}`;
}

export class RefreshTokenFamily extends Model {
  static override readonly tableName = 'identity.refresh_token_family';
  static override readonly idColumn = 'id';

  id!: string;
  account_id!: string;
  session_id!: string;
  family_id!: string;
  parent_id?: string | null;
  token_digest!: string;
  expires_at!: string;
  consumed_at?: string | null;
  revoked_at?: string | null;
  created_at!: string;

  override $beforeInsert(_context: QueryContext): void {
    this.token_digest = digestRefreshToken(this.token_digest);
    if (!this.family_id) this.family_id = newRefreshFamilyId();
    if (!this.created_at) this.created_at = new Date().toISOString();
  }

  $formatJson(json: Record<string, unknown>): Record<string, unknown> {
    const formatted = super.$formatJson(json);
    delete formatted.token_digest;
    return formatted;
  }
}

export interface ConsumeRotationResult {
  readonly status: 'rotated' | 'replayed' | 'expired' | 'revoked' | 'not_found';
  readonly record?: RefreshTokenFamily;
}

/** Atomic single-statement consume; no read-then-write race window. */
export async function consumeAndRotateRefreshToken(
  token: string,
  options: {
    readonly database: { raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown> };
    readonly now?: Date;
    readonly revokeFamily: (familyId: string, sessionId: string) => Promise<void>;
  }
): Promise<ConsumeRotationResult> {
  const digest = digestRefreshToken(token);
  const now = (options.now ?? new Date()).toISOString();
  const rows = (await options.database.raw(
    `UPDATE identity.refresh_token_family
     SET consumed_at = ?
     WHERE token_digest = ?
       AND consumed_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > ?
     RETURNING *`,
    [now, digest, now]
  )) as { rows?: Array<Record<string, unknown>> } | unknown[];
  const record = Array.isArray(rows)
    ? (rows[0] as Record<string, unknown> | undefined)
    : rows.rows?.[0];
  if (record) {
    return { status: 'rotated', record: RefreshTokenFamily.fromJson(record as Record<string, unknown>) };
  }

  const existing = (await options.database.raw(
    `SELECT family_id, session_id, consumed_at, revoked_at, expires_at
     FROM identity.refresh_token_family WHERE token_digest = ?`,
    [digest]
  )) as { rows?: Array<Record<string, unknown>> } | unknown[];
  const prior = Array.isArray(existing)
    ? (existing[0] as Record<string, unknown> | undefined)
    : existing.rows?.[0];
  if (!prior) return { status: 'not_found' };
  if (prior.revoked_at || prior.consumed_at) {
    await options.revokeFamily(String(prior.family_id), String(prior.session_id));
    return { status: 'replayed' };
  }
  return { status: new Date(String(prior.expires_at)).getTime() <= new Date(now).getTime() ? 'expired' : 'revoked' };
}

export async function revokeRefreshFamily(
  familyId: string,
  sessionId: string,
  database: { raw: (sql: string, bindings: readonly unknown[]) => Promise<unknown> }
): Promise<void> {
  const now = new Date().toISOString();
  await database.raw(
    `UPDATE identity.refresh_token_family SET revoked_at = ?
     WHERE family_id = ? AND revoked_at IS NULL`,
    [now, familyId]
  );
  await database.raw(
    `UPDATE identity.session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    [now, sessionId]
  );
}
