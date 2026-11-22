import { defineModel, fields } from '@moonwitness/orm';
import { validateDomain, type Domain } from '@moonwitness/types';
import { Company } from './company.js';
import { User } from './user.js';

/** Parses and validates a saved filter's JSON domain string. */
export function validateSavedFilterDomainJson(domainJson: string): Domain {
  let parsed: unknown;
  try {
    parsed = JSON.parse(domainJson);
  } catch {
    throw new Error('SavedFilter domain_json must be valid JSON');
  }
  return validateDomain(parsed);
}

/**
 * Checks whether an actor is allowed to create/update/delete a saved filter:
 * - Regular users may only mutate their own non-shared filters.
 * - Shared filters (`is_shared: true`) require `system` or `superadmin` role.
 */
export function canMutateSavedFilter(
  actor: { userId?: number | null; role?: string | null },
  filter: { user_id?: number | null; is_shared?: boolean | null }
): boolean {
  const isAdmin = actor.role === 'system' || actor.role === 'superadmin';
  if (filter.is_shared) {
    return isAdmin;
  }
  if (isAdmin) return true;
  return (
    typeof actor.userId === 'number' &&
    typeof filter.user_id === 'number' &&
    actor.userId === filter.user_id
  );
}

/** User or shared saved search filter, sort order, and groupBy per model & company. */
export const SavedFilter = defineModel('base.saved_filter', {
  table: 'base_saved_filters',
  order: 'model_name asc, name asc',
  fields: {
    model_name: fields.string({
      required: true,
      index: true,
      pattern: '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$',
      label: 'Model',
    }),
    name: fields.string({ required: true, label: 'Filter Name' }),
    domain_json: fields.text({ required: true, default: '[]', label: 'Domain JSON' }),
    order: fields.string({ label: 'Sort Order' }),
    group_by: fields.string({ label: 'Group By' }),
    is_default: fields.boolean({ required: true, default: false, label: 'Default Filter' }),
    is_shared: fields.boolean({ required: true, default: false, label: 'Shared Filter' }),
    user: fields.belongsTo(User, { index: true, label: 'Owner' }),
    company: fields.belongsTo(Company, { index: true, label: 'Company' }),
  },
});
