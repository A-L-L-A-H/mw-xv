// The protected-route guard preserves the requested page as a safe returnTo,
// including when a session ends, so login URLs can carry that query string.
export const loginPageUrl = /\/login(?:\?returnTo=[^#]*)?$/u;
import { randomUUID } from 'node:crypto';

import { E2E_JWT_SECRET, E2E_SUPERADMIN_PASSWORD } from '@moonwitness/types/node';

export { E2E_JWT_SECRET, E2E_SUPERADMIN_PASSWORD };

export function createE2eSuffix(): string {
  return randomUUID();
}
