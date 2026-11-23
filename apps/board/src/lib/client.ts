import { MoonWitnessClient } from '@moonwitness/client';

function resolveApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const desktopApiUrl = (window as Window & { __MW_DESKTOP_API_URL__?: string })
      .__MW_DESKTOP_API_URL__;
    if (desktopApiUrl && desktopApiUrl.trim().length > 0) {
      return desktopApiUrl.trim();
    }
  }
  const envApiUrl = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_API_URL : undefined;
  return envApiUrl ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
}

/**
 * Single SDK instance. Next rewrites keep browser requests on this app's origin.
 */
export const client = new MoonWitnessClient({
  baseUrl: resolveApiBaseUrl(),
  storageKey: 'mw-board-session',
});
