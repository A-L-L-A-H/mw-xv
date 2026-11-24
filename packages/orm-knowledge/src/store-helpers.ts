import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import type { AuthenticatedResearchReviewer } from './research-review.js';

/** Throw a `TypeError` for invalid store inputs, integrity failures, or unavailable contexts. */
export function fail(message: string): never {
  throw new TypeError(message);
}

/** Compute the lowercase hex SHA-256 digest of a UTF-8 string. */
export function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Validate that an authenticated reviewer carries positive safe-integer IDs and an allowed role. */
export function validActor(actor: AuthenticatedResearchReviewer): boolean {
  return (
    Number.isSafeInteger(actor.userId) &&
    actor.userId > 0 &&
    Number.isSafeInteger(actor.companyId) &&
    actor.companyId > 0 &&
    (actor.role === 'user' || actor.role === 'superadmin')
  );
}

/** Assert inside a transaction that the actor, company, and membership are active and locked. */
export async function assertActiveCompanyActor(
  trx: Knex.Transaction,
  actor: AuthenticatedResearchReviewer,
  unavailableMessage: string
): Promise<void> {
  // Keep authorization stable through the enclosing transaction's commit.
  const user = await trx('users')
    .where({ id: actor.userId, role: actor.role, active: true })
    .forUpdate()
    .first('id');
  const company = await trx('companies')
    .where({ id: actor.companyId, active: true })
    .forUpdate()
    .first('id');
  const membership = await trx('company_memberships')
    .where({ user_id: actor.userId, company_id: actor.companyId, active: true })
    .forUpdate()
    .first('id');
  if (!user || !company || !membership) {
    fail(unavailableMessage);
  }
}
