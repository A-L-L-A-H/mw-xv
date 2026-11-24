import { expect, test, type Page } from '@playwright/test';

const sidecarUrl = 'http://127.0.0.1:4187';
const session = {
  access_token: 'desktop-test-access',
  refresh_token: 'desktop-test-refresh',
  token_type: 'Bearer',
  expires_in: 3600,
  user: {
    id: 1,
    login: 'local',
    role: 'superadmin',
    company_id: 1,
  },
};

async function mockSidecar(page: Page, loginStatus = 200): Promise<void> {
  await page.route(`${sidecarUrl}/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/auth/login') {
      await route.fulfill({
        status: loginStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          loginStatus === 200
            ? { data: session }
            : { success: false, error: 'Local API is warming up' }
        ),
      });
      return;
    }
    if (pathname === '/api/models') {
      await route.fulfill({ json: { models: [] } });
      return;
    }
    if (pathname === '/notifications/inbox') {
      await route.fulfill({
        json: { success: true, data: { notifications: [], unreadCount: 0 } },
      });
      return;
    }
    await route.fulfill({
      json: { success: true, data: [], records: [], total: 0, models: [] },
    });
  });
}

async function configureDesktop(
  page: Page,
  options: { authenticated?: boolean; loginStatus?: number } = {}
): Promise<void> {
  await mockSidecar(page, options.loginStatus);
  await page.addInitScript(
    ({ sidecar, authenticated, storedSession }) => {
      (window as Window & { __MW_DESKTOP_API_URL__?: string }).__MW_DESKTOP_API_URL__ = sidecar;
      if (authenticated) {
        localStorage.setItem('mw-board-session', JSON.stringify(storedSession));
        localStorage.setItem(
          'mw-board-preferences',
          JSON.stringify({
            skin: 'moonwitness-high-contrast',
            theme: 'dark',
            density: 'compact',
            language: 'en-US',
            timezone: 'UTC',
          })
        );
      }
    },
    { sidecar: sidecarUrl, authenticated: options.authenticated ?? false, storedSession: session }
  );
}

test('bootstrap failure is visible and retry recovers the local session', async ({ page }) => {
  let attempts = 0;
  await page.unroute(`${sidecarUrl}/**`);
  await page.route(`${sidecarUrl}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/auth/login') {
      attempts += 1;
      await route.fulfill({
        status: attempts === 1 ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          attempts === 1 ? { success: false, error: 'Local API is warming up' } : { data: session }
        ),
      });
      return;
    }
    if (pathname === '/notifications/inbox') {
      await route.fulfill({
        json: { success: true, data: { notifications: [], unreadCount: 0 } },
      });
      return;
    }
    await route.fulfill({
      json: { success: true, data: [], records: [], total: 0, models: [] },
    });
  });
  await page.addInitScript((sidecar) => {
    (window as Window & { __MW_DESKTOP_API_URL__?: string }).__MW_DESKTOP_API_URL__ = sidecar;
  }, sidecarUrl);

  await page.goto('/board');
  await expect(page.getByRole('heading', { name: 'Local workspace unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: /Command center/i })).toBeVisible();
  expect(attempts).toBe(2);
});

test('Studio, NotFound, and browser history work for deep links', async ({ page }) => {
  await configureDesktop(page, { authenticated: true });
  await page.goto('/board/studio');
  await expect(
    page.getByRole('heading', { name: 'Editorial & Asmaul Husna Studio' })
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'moonwitness-high-contrast');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.goto('/board');
  await expect(page.getByRole('heading', { name: /Command center/i })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Editorial & Asmaul Husna Studio' })
  ).toBeVisible();

  await page.goto('/board/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('manual login rejects an external returnTo target', async ({ page }) => {
  await configureDesktop(page);
  await page.goto('/login?returnTo=https%3A%2F%2Fevil.example%2Fsteal');
  await expect(page.getByRole('heading', { name: /Enter the Shadow/i })).toBeVisible();
  await page.locator('#login').fill('local');
  await page.locator('#password').fill('local-offline-session');
  await page.locator('#auth-submit').click();
  await expect(page).toHaveURL(/\/board$/u);
  await expect(page.getByRole('heading', { name: /Command center/i })).toBeVisible();
});

test('manual login preserves an internal returnTo query and hash', async ({ page }) => {
  await configureDesktop(page);
  await page.goto(`/login?returnTo=${encodeURIComponent('/board/studio?section=asmaul#preview')}`);
  await page.locator('#login').fill('local');
  await page.locator('#password').fill('local-offline-session');
  await page.locator('#auth-submit').click();
  await expect(page).toHaveURL(/\/board\/studio\?section=asmaul#preview$/u);
  await expect(
    page.getByRole('heading', { name: 'Editorial & Asmaul Husna Studio' })
  ).toBeVisible();
});
