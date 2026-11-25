import type { TokenStorage } from '@moonwitness/client';

const SESSION_ENDPOINT = '/api/session';

/**
 * TokenStorage backed by a same-origin BFF route. The access and refresh
 * tokens live in an HttpOnly cookie, so a DOM XSS cannot read or exfiltrate
 * them. Used for the browser Board; the desktop sidecar keeps its own storage.
 */
export class CookieTokenStorage implements TokenStorage {
  async getItem(): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    const response = await fetch(SESSION_ENDPOINT, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { token?: unknown };
    return typeof payload.token === 'string' ? payload.token : null;
  }

  async setItem(_key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    await fetch(SESSION_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: value }),
    });
  }

  async removeItem(): Promise<void> {
    if (typeof window === 'undefined') return;
    await fetch(SESSION_ENDPOINT, { method: 'DELETE', credentials: 'same-origin' });
  }
}
