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
