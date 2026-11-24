import { createHash } from 'node:crypto';

/**
 * SHA-256 hex digest of a string or Uint8Array.
 * Node-only helper (uses node:crypto). Not available in browser bundles.
 */
export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}