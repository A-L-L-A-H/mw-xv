import { isRecord } from '@moonwitness/types';

/**
 * Shared request helpers for knowledge HTTP plugins.
 */
export function hasValidationError(request: unknown): boolean {
  return (
    typeof request === 'object' &&
    request !== null &&
    'validationError' in request &&
    Boolean((request as { readonly validationError?: unknown }).validationError)
  );
}

/**
 * Narrow an unknown value to a plain non-array record, or return null.
 */
export function toRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
