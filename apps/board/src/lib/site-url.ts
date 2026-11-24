import { DEFAULT_LOCALHOST_BOARD_ORIGIN } from '@moonwitness/types';

/**
 * Canonical Board origin used for metadata, robots, and sitemap emission.
 * Falls back to the local Next.js dev port so generated URLs are always absolute.
 */
export const DEFAULT_SITE_URL = DEFAULT_LOCALHOST_BOARD_ORIGIN;

export function resolveSiteUrl(): string {
  const configured = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_SITE_URL?.trim() : '';
  return configured && configured.length > 0 ? configured : DEFAULT_SITE_URL;
}
