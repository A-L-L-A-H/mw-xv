import { randomUUID } from 'node:crypto';
import { Model, type QueryContext } from 'objection';

export const PLATFORM_CAPABILITIES = ['platform_owner'] as const;
export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

export const PLATFORM_OWNER_CAPABILITY: PlatformCapability = 'platform_owner';

export function isPlatformCapability(value: string): value is PlatformCapability {
  return PLATFORM_CAPABILITIES.includes(value as PlatformCapability);
}

export class AccountCapability extends Model {
  static override readonly tableName = 'identity.account_capability';
  static override readonly idColumn = 'id';

  id!: string;
  account_id!: string;
  capability!: PlatformCapability;
  created_at!: string;

  override $beforeInsert(_context: QueryContext): void {
    if (!this.id) this.id = randomUUID();
    if (!this.created_at) this.created_at = new Date().toISOString();
    if (!isPlatformCapability(this.capability)) {
      throw new Error('Unsupported platform capability');
    }
  }
}
