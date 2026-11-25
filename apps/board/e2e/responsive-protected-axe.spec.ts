import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { E2E_SUPERADMIN_PASSWORD } from './constants.js';

const views = [
  { name: 'dashboard', path: '/board', heading: 'Command center' },
  { name: 'list', path: '/board/m/base.partner', heading: 'Partners' },
  { name: 'form', path: '/board/m/base.partner/new', heading: 'New Partner' },
  { name: 'profile', path: '/board/profile', heading: 'Profile' },
  { name: 'settings', path: '/board/settings', heading: 'Settings' },
] as const;

test('protected Board screens have no WCAG 2.1 A/AA Axe violations at tablet size', async ({
  page,
}) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/login');
  await page.getByLabel('Email or Username').fill('superadmin');
  await page.getByLabel('Password', { exact: true }).fill(E2E_SUPERADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Enter the Shadow' }).click();
  await expect(page).toHaveURL(/\/board$/u);
  await expect(page.getByRole('heading', { name: 'Command center', exact: false })).toBeVisible();

  for (const theme of ['light', 'dark'] as const) {
    await expectTheme(page, theme);

    for (const view of views) {
      await page.goto(view.path);
      await expect(page.getByRole('heading', { name: view.heading, exact: false })).toBeVisible();
      if (view.name === 'dashboard') {
        await expect(
          page.getByRole('img', { name: 'Background job status distribution' })
        ).toBeVisible();
      }
      await expectTheme(page, theme);
      await expectNoA11yViolations(page, `${view.name}/tablet-768/${theme}`);
    }
  }
});

async function expectTheme(page: Page, theme: 'light' | 'dark') {
  const isDark = await page
    .locator('html')
    .evaluate((element) => element.classList.contains('dark'));
  if (isDark !== (theme === 'dark')) {
    await page.getByRole('button', { name: 'Toggle theme' }).click();
  }
  await expect
    .poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
    .toBe(theme === 'dark');
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Axe must sample settled colors rather than an intermediate theme transition.
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined))
    );
  });
}

async function expectNoA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
    `${label} has WCAG 2.1 A/AA accessibility violations`
  ).toEqual([]);
}
