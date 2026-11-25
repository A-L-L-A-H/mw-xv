/**
 * Shared numeric and ordering helpers used across the ai-runtime modules.
 * Keep the implementations byte-for-byte identical to the previous per-module
 * private copies so downstream digests and sort orders remain stable.
 */

/** Clamp a basis-point value into [0, 10_000], rounding to the nearest integer; non-finite values become 0. */
export function clampBps(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

/** Deterministic ASCII-betical comparator for strings (usable as an Array#sort callback). */
export function compareAscii(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
