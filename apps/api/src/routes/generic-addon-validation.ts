import type { Transaction } from 'objection';
import { isValidOrganizationMutation } from '@moonwitness/orm-organization';
import { isValidProjectMutation } from '@moonwitness/orm-project';

type MutationRecord = Readonly<Record<string, unknown>>;

/** Run registered domain-addon mutation validators for generic API writes. */
export async function isValidAddonMutation(
  modelName: string,
  values: MutationRecord,
  current?: MutationRecord,
  trx?: Transaction
): Promise<boolean> {
  if (!(await isValidOrganizationMutation(modelName, values, current, trx))) return false;
  return isValidProjectMutation(modelName, values, current, trx);
}
