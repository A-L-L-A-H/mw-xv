import { createHash } from 'node:crypto';

/**
 * SHA-256 hex digest of a string or Uint8Array.
 * Node-only helper (uses node:crypto). Not available in browser bundles.
 */
export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * E2E-only credentials shared by the API visual-audit server, the Board Playwright
 * suite, and the run-e2e script. Never used outside test environments.
 */
export const E2E_JWT_SECRET = 'e2e-only-jwt-secret-that-is-never-used-outside-tests';

export const E2E_SUPERADMIN_PASSWORD =
  process.env.MW_E2E_SUPERADMIN_PASSWORD ?? 'e2e-only-password';
