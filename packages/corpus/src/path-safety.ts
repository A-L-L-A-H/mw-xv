import path from 'node:path';

function validateSafeRelativePath(
  value: unknown
): { relativePath: string } | { reason: 'posix' | 'segments' } {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    path.isAbsolute(value) ||
    /^[a-zA-Z]:/u.test(value) ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    return { reason: 'posix' };
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return { reason: 'segments' };
  }
  return { relativePath: segments.join(path.sep) };
}

/** Validate and normalize a relative POSIX path, returning null when invalid. */
export function trySafeRelativePath(value: unknown): string | null {
  const result = validateSafeRelativePath(value);
  return 'relativePath' in result ? result.relativePath : null;
}

/** Validate and normalize a relative POSIX path, throwing a descriptive TypeError when invalid. */
export function safeRelativePath(value: unknown, label: string): string {
  const result = validateSafeRelativePath(value);
  if ('relativePath' in result) return result.relativePath;
  if (result.reason === 'posix') {
    throw new TypeError(`${label} must be a safe relative POSIX path`);
  }
  throw new TypeError(`${label} must not contain empty, dot, or parent segments`);
}
