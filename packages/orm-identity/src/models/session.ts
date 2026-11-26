import { Model, type QueryContext } from 'objection';

export const MAX_SESSION_METADATA_LENGTH = 256;

export interface IdentitySessionMetadata {
  readonly device?: string;
  readonly userAgent?: string;
}

export function normalizeSessionMetadata(
  metadata: IdentitySessionMetadata = {}
): IdentitySessionMetadata {
  const clean = (value: string | undefined): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().slice(0, MAX_SESSION_METADATA_LENGTH);
    return trimmed || undefined;
  };
  return {
    ...(clean(metadata.device) ? { device: clean(metadata.device) } : {}),
    ...(clean(metadata.userAgent) ? { userAgent: clean(metadata.userAgent) } : {}),
  };
}

export class IdentitySession extends Model {
  static override readonly tableName = 'identity.session';
  static override readonly idColumn = 'id';

  id!: string;
  account_id!: string;
  account_subject!: string;
  client_id!: string;
  secret_digest!: string;
  metadata!: IdentitySessionMetadata;
  created_at!: string;
  last_seen_at!: string;
  expires_at!: string;
  revoked_at?: string | null;

  override $beforeInsert(_context: QueryContext): void {
    const now = new Date().toISOString();
    if (!this.created_at) this.created_at = now;
    if (!this.last_seen_at) this.last_seen_at = now;
    this.metadata = normalizeSessionMetadata(this.metadata);
  }

  isActive(now: Date = new Date()): boolean {
    return !this.revoked_at && new Date(this.expires_at).getTime() > now.getTime();
  }
}

export function activeSessionsOnly<T extends IdentitySession>(sessions: readonly T[], now = new Date()): T[] {
  return sessions.filter((session) => session.isActive(now));
}
