import { expect, test } from '@playwright/test';

const FILMSTRIP_NAME = 'How MoonWitness connects people, knowledge, and story work';

test('homepage filmstrip supports backward and boundary navigation without losing focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const filmstrip = page.getByRole('region', { name: FILMSTRIP_NAME });
  await expect(filmstrip).toBeVisible();
  await expect(filmstrip).toHaveAttribute('tabindex', '0');

  const scrollMetrics = await filmstrip.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);

  await filmstrip.focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => filmstrip.evaluate((element) => element.scrollLeft))
    .toBe(scrollMetrics.scrollWidth - scrollMetrics.clientWidth);
  await expect(filmstrip).toBeFocused();

  const endPosition = await filmstrip.evaluate((element) => element.scrollLeft);
  expect(endPosition).toBeGreaterThan(0);

  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => filmstrip.evaluate((element) => element.scrollLeft))
    .toBeLessThan(endPosition);
  await expect(filmstrip).toBeFocused();

  await page.keyboard.press('Home');
  await expect.poll(() => filmstrip.evaluate((element) => element.scrollLeft)).toBeLessThan(10);
  await expect(filmstrip).toBeFocused();
});
