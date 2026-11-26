// The protected-route guard preserves the requested page as a safe returnTo,
// including when a session ends, so login URLs can carry that query string.
export const loginPageUrl = /\/login(?:\?returnTo=[^#]*)?$/u;
import { randomUUID } from 'node:crypto';

import { E2E_JWT_SECRET, E2E_SUPERADMIN_PASSWORD } from '@moonwitness/types/node';

export { E2E_JWT_SECRET, E2E_SUPERADMIN_PASSWORD };

export function createE2eSuffix(): string {
  return randomUUID();
}

import type { Page } from '@playwright/test';

export interface BoardSessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  sameSite: 'Lax' | 'Strict';
}

/**
 * HttpOnly session cookie (`mw_board_session`) the Board BFF hydrates from via
 * GET /api/session, which returns the raw cookie value as `{ token }`. The BFF
 * stores the serialized session JSON (`{ access_token, refresh_token, user, ... }`)
 * in the cookie, so `accessToken` is that JSON string, not a bare JWT.
 */
export function authCookie(accessToken: string, domain = '127.0.0.1'): BoardSessionCookie[] {
  return [
    {
      name: 'mw_board_session',
      value: accessToken,
      domain,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ];
}

/** Reads the cookie-backed session through the /api/session BFF route. */
export async function readSession<T>(page: Page): Promise<T | null> {
  return page.evaluate(async () => {
    const payload = (await fetch('/api/session', { credentials: 'include' }).then((response) =>
      response.json()
    )) as { token?: string | null };
    return payload.token ? (JSON.parse(payload.token) as T) : null;
  });
}
