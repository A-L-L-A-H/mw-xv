import { Model, type QueryContext } from 'objection';

export class IdentityCredential extends Model {
  static override readonly tableName = 'identity.credential';
  static override readonly idColumn = 'id';

  id!: string;
  account_id!: string;
  algorithm!: string;
  version!: number;
  verifier!: string;
  created_at!: string;
  updated_at!: string;

  override $beforeInsert(_context: QueryContext): void {
    if (!this.algorithm) this.algorithm = 'scrypt';
    if (this.version === undefined) this.version = 1;
    const now = new Date().toISOString();
    if (!this.created_at) this.created_at = now;
    if (!this.updated_at) this.updated_at = now;
  }

  override $beforeUpdate(_options: never, _context: QueryContext): void {
    this.updated_at = new Date().toISOString();
  }
}
