import { createHash } from 'node:crypto';
import { Model, type QueryContext } from 'objection';

export const OAUTH_CLIENT_TYPES = ['public', 'confidential'] as const;
export type OAuthClientType = (typeof OAUTH_CLIENT_TYPES)[number];

export const OAUTH_GRANT_TYPES = ['authorization_code', 'refresh_token', 'client_credentials'] as const;
export type OAuthGrantType = (typeof OAUTH_GRANT_TYPES)[number];

export function digestClientSecret(secret: string): string {
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`;
}

function uniqueSorted(values: readonly string[], label: string): string[] {
  const invalid = values.filter((value) => typeof value !== 'string' || value.trim() === '');
  if (invalid.length > 0) throw new Error(`Invalid ${label}`);
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function assertAbsoluteUri(uri: string): void {
  const parsed = new URL(uri);
  if (!parsed.protocol || !parsed.host) throw new Error('Invalid redirect URI');
  if (/[*?]/.test(uri)) throw new Error('Wildcard redirect URIs are not allowed');
}

export class OAuthClient extends Model {
  static override readonly tableName = 'identity.oauth_client';
  static override readonly idColumn = 'client_id';

  client_id!: string;
  type!: OAuthClientType;
  grant_types!: OAuthGrantType[];
  redirect_uris!: string[];
  scopes!: string[];
  status!: 'active' | 'disabled';
  secret_digest?: string | null;
  created_at!: string;

  override $beforeInsert(_context: QueryContext): void {
    if (!this.type) this.type = 'public';
    if (!this.status) this.status = 'active';
    this.grant_types = uniqueSorted(this.grant_types ?? [], 'grant types') as OAuthGrantType[];
    this.redirect_uris = uniqueSorted(this.redirect_uris ?? [], 'redirect URIs');
    this.redirect_uris.forEach(assertAbsoluteUri);
    this.scopes = uniqueSorted(this.scopes ?? [], 'scopes');
    if (this.type === 'public') {
      if (this.secret_digest) throw new Error('Public clients cannot hold a client secret');
      if (this.grant_types.includes('client_credentials')) {
        throw new Error('Public clients cannot use client credentials');
      }
    }
    if (!this.created_at) this.created_at = new Date().toISOString();
  }

  canAuthorize(grantType: OAuthGrantType, redirectUri: string, scope: string): boolean {
    return (
      this.status === 'active' &&
      this.grant_types.includes(grantType) &&
      this.redirect_uris.includes(redirectUri) &&
      scope.split(/\s+/).filter(Boolean).every((value) => this.scopes.includes(value))
    );
  }

  $formatJson(json: Record<string, unknown>): Record<string, unknown> {
    const formatted = super.$formatJson(json);
    delete formatted.secret_digest;
    return formatted;
  }
}
