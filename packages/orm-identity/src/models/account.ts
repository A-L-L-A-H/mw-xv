import { Model, type ModelOptions, type QueryContext } from 'objection';
import { randomUUID } from 'node:crypto';

export const IDENTITY_ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type IdentityAccountStatus = (typeof IDENTITY_ACCOUNT_STATUSES)[number];

export class IdentityAccount extends Model {
  static override readonly tableName = 'identity.account';
  static override readonly idColumn = 'id';

  id!: string;
  subject!: string;
  status!: IdentityAccountStatus;
  created_at!: string;
  updated_at!: string;
  disabled_at?: string | null;

  override $beforeInsert(_context: QueryContext): void {
    if (!this.subject) this.subject = randomUUID();
    if (!this.status) this.status = 'active';
    const now = new Date().toISOString();
    if (!this.created_at) this.created_at = now;
    if (!this.updated_at) this.updated_at = now;
  }

  override $beforeUpdate(_options: ModelOptions, _context: QueryContext): void {
    if (this.status === 'disabled' && !this.disabled_at) this.disabled_at = new Date().toISOString();
    if (this.status === 'active') this.disabled_at = null;
    this.updated_at = new Date().toISOString();
  }

  override $formatDatabaseJson(json: Record<string, unknown>): Record<string, unknown> {
    const formatted = super.$formatDatabaseJson(json);
    if (formatted.subject === undefined && this.subject) formatted.subject = this.subject;
    return formatted;
  }
}
