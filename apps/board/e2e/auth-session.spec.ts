import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  createE2eSuffix,
  E2E_JWT_SECRET,
  E2E_SUPERADMIN_PASSWORD,
  loginPageUrl,
  readSession,
  authCookie,
} from './constants.js';

interface E2EUser {
  id: number;
  login: string;
  role: 'system' | 'superadmin' | 'user';
  partner_id?: number;
}

interface PersistedSession {
  access_token: string;
  refresh_token: string;
  user: E2EUser;
}

function expiredAccessToken(user: E2EUser): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: String(user.id),
      role: user.role,
      iss: 'moonwitness',
      iat: now - 120,
      exp: now - 60,
    })
  ).toString('base64url');
  const content = `${header}.${payload}`;
  const signature = createHmac('sha256', E2E_JWT_SECRET).update(content).digest('base64url');
  return `${content}.${signature}`;
}

async function loginSuperadmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email or Username').fill('superadmin');
  await page.getByLabel('Password', { exact: true }).fill(E2E_SUPERADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Enter the Shadow' }).click();
  await expect(page).toHaveURL(/\/board$/u);
  await expect(page.getByRole('heading', { name: 'Command center', exact: false })).toBeVisible();
}

test('reload restores session via cookie, concurrent requests share expired-token refresh, and logout revokes it', async ({
  page,
}) => {
  await loginSuperadmin(page);
  const original = await readSession<PersistedSession>(page);
  expect(original).not.toBeNull();

  await page.reload();
  await expect(page).toHaveURL(/\/board$/u);
  await expect(page.getByRole('heading', { name: 'Command center', exact: false })).toBeVisible();

  // Inject an expired access token via the HttpOnly session cookie
  const expiredSessionJson = JSON.stringify({
    ...original!,
    access_token: expiredAccessToken(original!.user),
  });
  await page.context().addCookies(authCookie(expiredSessionJson, '127.0.0.1'));

  let refreshRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/refresh')) refreshRequests++;
  });

  await page.reload();
  await expect(page).toHaveURL(/\/board$/u);
  await expect(page.getByRole('heading', { name: 'Command center', exact: false })).toBeVisible();
  const rotated = await readSession<PersistedSession>(page);
  expect(rotated).not.toBeNull();
  expect(rotated!.access_token).not.toBe(expiredAccessToken(original!.user));
  expect(rotated!.refresh_token).not.toBe(original!.refresh_token);
  expect(refreshRequests).toBe(1);

  await page.getByRole('button', { name: 'superadmin' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
  const revoked = await readSession<PersistedSession>(page);
  expect(revoked).toBeNull();
});