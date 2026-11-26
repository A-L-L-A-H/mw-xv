import type { TokenStorage } from '@moonwitness/client';

const SESSION_ENDPOINT = '/api/session';
/** localStorage key mirrored from the HttpOnly cookie so same-tab readers and
 *  MoonWitnessClient.hydrate() can observe a complete AuthTokens document. */
const LOCAL_STORAGE_KEY = 'mw-board-session';

/**
 * TokenStorage backed by a same-origin BFF route. The full AuthTokens JSON
 * document lives in an HttpOnly cookie (same-origin), so a DOM XSS cannot read
 * or exfiltrate it, and the cookie remains the authoritative source of truth
 * (cross-tab logout is still detected). The same document is mirrored into
 * localStorage under `mw-board-session` so the SDK hydration path
 * (`MoonWitnessClient.hydrate()`, which JSON.parses the stored value) and
 * same-tab readers observe a consistent session.
 * Used for the browser Board; the desktop sidecar keeps its own storage.
 */
export class CookieTokenStorage implements TokenStorage {
  async getItem(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    try {
      const response = await fetch(SESSION_ENDPOINT, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.ok) {
        const payload = (await response.json()) as { token?: unknown };
        if (typeof payload.token === 'string') return payload.token;
      }
    } catch {
      /* fall through to the localStorage mirror */
    }
    try {
      return localStorage.getItem(LOCAL_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  async setItem(_key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, value);
    } catch {
      /* localStorage unavailable; cookie endpoint remains authoritative */
    }
    await fetch(SESSION_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: value }),
    });
  }

  async removeItem(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch {
      /* fall through to the cookie endpoint */
    }
    await fetch(SESSION_ENDPOINT, { method: 'DELETE', credentials: 'same-origin' });
  }
}
