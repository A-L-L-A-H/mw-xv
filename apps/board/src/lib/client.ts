import { MoonWitnessClient } from '@moonwitness/client';
import { CookieTokenStorage } from './cookie-token-storage';

interface ApiContext {
  baseUrl: string;
  sameOrigin: boolean;
}

function resolveApiContext(): ApiContext {
  if (typeof window !== 'undefined') {
    const desktopApiUrl = (window as Window & { __MW_DESKTOP_API_URL__?: string })
      .__MW_DESKTOP_API_URL__;
    if (desktopApiUrl && desktopApiUrl.trim().length > 0) {
      return { baseUrl: desktopApiUrl.trim(), sameOrigin: false };
    }
  }
  const envApiUrl = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_API_URL : undefined;
  return {
    baseUrl:
      envApiUrl ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin),
    sameOrigin: envApiUrl === undefined,
  };
}

const apiContext = resolveApiContext();

/**
 * Single SDK instance. Browser sessions live in an HttpOnly cookie via the
 * same-origin BFF; the desktop sidecar keeps its own explicit storage key.
 */
export const client = new MoonWitnessClient({
  baseUrl: apiContext.baseUrl,
  ...(apiContext.sameOrigin
    ? { storage: new CookieTokenStorage() }
    : { storageKey: 'mw-board-session' }),
});
