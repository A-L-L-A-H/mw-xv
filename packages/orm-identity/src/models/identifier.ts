import { Model, type QueryContext } from 'objection';

export const IDENTITY_IDENTIFIER_TYPES = ['email', 'username'] as const;
export type IdentityIdentifierType = (typeof IDENTITY_IDENTIFIER_TYPES)[number];

export function normalizeIdentityIdentifier(
  type: IdentityIdentifierType,
  value: string
): string {
  const trimmed = value.trim();
  return type === 'email' ? trimmed.toLocaleLowerCase('en-US') : trimmed;
}

export class IdentityIdentifier extends Model {
  static override readonly tableName = 'identity.identifier';
  static override readonly idColumn = 'id';

  id!: string;
  account_id!: string;
  type!: IdentityIdentifierType;
  value!: string;
  display_value!: string;
  verified!: boolean;
  primary!: boolean;
  created_at!: string;

  override $beforeInsert(_context: QueryContext): void {
    if (!this.display_value) this.display_value = this.value.trim();
    this.value = normalizeIdentityIdentifier(this.type, this.value);
    if (this.verified === undefined) this.verified = false;
    if (this.primary === undefined) this.primary = false;
    if (!this.created_at) this.created_at = new Date().toISOString();
  }

  override $beforeUpdate(_options: never, _context: QueryContext): void {
    if (this.value !== undefined) {
      this.value = normalizeIdentityIdentifier(this.type, this.value);
    }
  }
}
