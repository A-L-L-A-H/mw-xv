/**
 * Canonical Indonesia timezone constants shared across seed bundles and apps.
 * Issue #195: single source of truth for 'Asia/Jakarta' and UTC+07:00 offset.
 */
export const DEFAULT_TIMEZONE = 'Asia/Jakarta' as const;

/** WIB offset in minutes east of UTC (UTC+07:00). */
export const DEFAULT_UTC_OFFSET_MINUTES = 420 as const;

export type DefaultTimezone = typeof DEFAULT_TIMEZONE;
