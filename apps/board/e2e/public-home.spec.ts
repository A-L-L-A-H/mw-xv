import AxeBuilder from '@axe-core/playwright';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const retryableFsErrorCodes = new Set(['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN']);

async function writeStableLocatorScreenshot(locator: Locator, outputPath: string) {
  await mkdir(dirname(outputPath), { recursive: true });
  const pngBuffer = await locator.screenshot({ animations: 'disabled' });
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let moved = false;
  try {
    await writeFile(tempPath, pngBuffer);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(tempPath, outputPath);
        moved = true;
        return;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : '';
        if (attempt >= 7 || (code !== '' && !retryableFsErrorCodes.has(code))) {
          throw error;
        }
        await delay(150 * (attempt + 1));
      }
    }
  } finally {
    if (!moved) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

async function analyzePageAccessibility(page: Page) {
  await page.evaluate(() => {
    for (const prop of [
      'ariaLabelledByElements',
      'ariaDescribedByElements',
      'ariaControlsElements',
      'ariaDetailsElements',
      'ariaFlowToElements',
      'ariaOwnsElements',
      'ariaActiveDescendantElement',
      'ariaErrorMessageElements',
    ]) {
      if (prop in Element.prototype) {
        Object.defineProperty(Element.prototype, prop, {
          get() {
            return undefined;
          },
          configurable: true,
        });
      }
    }
  });
  return new AxeBuilder({ page }).analyze();
}

test('public homepage renders its message, canonical metadata, and workspace action', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Real people\. Unfiltered worlds\./u);
  await expect(page.getByRole('heading', { level: 1, name: 'MoonWitness' })).toBeVisible();
  const mainNavigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(mainNavigation).toBeVisible();
  await expect(mainNavigation.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '#home');
  await expect(mainNavigation.getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'location'
  );
  for (const link of await mainNavigation.getByRole('link').all()) {
    const target = (await link.getAttribute('href'))!.slice(1);
    await expect(page.locator(`#${target}`), `navigation target #${target}`).toHaveCount(1);
  }
  await page.locator('#about').evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await expect(mainNavigation.getByRole('link', { name: 'About' })).toHaveAttribute(
    'aria-current',
    'location'
  );
  await expect(page.getByRole('link', { name: /Sign in to your workspace/u })).toHaveAttribute(
    'href',
    '/login'
  );

  const origin = new URL(page.url()).origin;
  const canonical = new URL(
    (await page.locator('link[rel="canonical"]').getAttribute('href'))!,
    origin
  );
  expect(canonical.origin).toBe(origin);
  expect(canonical.pathname).toBe('/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    `${origin}/brand/social-card.png`
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    'content',
    'summary_large_image'
  );
  const socialCard = await page.request.get(`${origin}/brand/social-card.png`);
  expect(socialCard.ok()).toBe(true);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index/u);

  const homepageCopy = await page.locator('main').innerText();
  expect(homepageCopy).not.toMatch(/\b\d[\d,]*\s+(?:crew members|countries|signals)\b/iu);
  await expect(
    page.locator('.home-join-band').getByRole('link', { name: /Join MoonWitness/u })
  ).toHaveAttribute('href', '/register');
  await expect(page.locator('.home-footer').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/login'
  );
  await expect(
    page.locator('.home-footer').getByRole('link', { name: 'Create an account' })
  ).toHaveAttribute('href', '/register');
  await expect(page.locator('main video')).toHaveCount(0);
  await expect(page.locator('main form')).toHaveCount(0);

  const accessibility = await analyzePageAccessibility(page);
  expect(accessibility.violations).toEqual([]);
});

test('homepage keeps cold-load fonts within budget, excludes Board assets, and reflows at 200% zoom', async ({
  page,
}) => {
  const requestedAssets: Array<{ url: string; contentType: string; size: number }> = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (
      url.includes('/fonts/') ||
      url.includes('.woff2') ||
      url.includes('/illustrations/') ||
      url.includes('/brand/')
    ) {
      const body = await response.body().catch(() => Buffer.alloc(0));
      requestedAssets.push({
        url,
        contentType: response.headers()['content-type'] ?? '',
        size: body.byteLength,
      });
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const fontRequests = requestedAssets.filter(
    (asset) => asset.url.includes('/fonts/') || asset.url.includes('.woff2')
  );
  const uniqueFontBytesByUrl = new Map<string, number>();
  for (const asset of fontRequests) {
    if (asset.size > 0 && !uniqueFontBytesByUrl.has(asset.url)) {
      uniqueFontBytesByUrl.set(asset.url, asset.size);
    }
  }
  const totalFontBytes = Array.from(uniqueFontBytesByUrl.values()).reduce(
    (sum, size) => sum + size,
    0
  );
  expect(totalFontBytes).toBeGreaterThan(0);
  expect(totalFontBytes).toBeLessThanOrEqual(165 * 1024);

  const boardOnlyAssets = requestedAssets.filter(
    (asset) =>
      asset.url.includes('board-masthead') ||
      asset.url.includes('story-workbench-masthead') ||
      asset.url.includes('auth-login')
  );
  expect(boardOnlyAssets).toEqual([]);

  await page.setViewportSize({ width: 720, height: 500 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await page.goto('/login');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test('homepage keeps its message and actions visible if hero artwork fails', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-scene-id="moon-city-hero"]')).toBeVisible();
  await page.locator('.home-hero-art-image').evaluate((image: HTMLImageElement) => {
    image.src = '/missing-home-hero-art.webp';
  });

  await expect(page.getByTestId('home-hero-fallback')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'MoonWitness' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Explore MoonWitness/u })).toBeVisible();
  const accessibility = await analyzePageAccessibility(page);
  expect(accessibility.violations).toEqual([]);
});

test('homepage respects Save-Data without hiding its static scene or copy', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    });
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('.home-hero-art-image')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'MoonWitness' })).toBeVisible();
  await expect(page.getByTestId('home-hero-crew')).toBeVisible();
  await expect(page.locator('[data-scene-id="moon-city-hero"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="home-hero-crew"] [data-sprite-state="playing"]')).toHaveCount(0);
});

test('homepage hero reveal is one-shot without layout shift and respects reduced motion', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const heroCopy = page.locator('.home-hero-copy');
  const heroNote = page.locator('.home-hero-note');
  const heroHeight = await page.locator('.home-hero').evaluate((element) => element.clientHeight);
  await expect(page.getByRole('heading', { level: 1, name: 'MoonWitness' })).toBeAttached();
  await expect(heroCopy).toBeVisible();
  await expect(heroNote).toBeVisible();
  await expect
    .poll(() => heroCopy.evaluate((element) => getComputedStyle(element).animationName))
    .toBe('mw-home-hero-reveal');
  expect(await heroCopy.evaluate((element) => getComputedStyle(element).animationDuration)).toBe(
    '0.22s'
  );
  expect(
    await heroCopy.evaluate((element) => getComputedStyle(element).animationIterationCount)
  ).toBe('1');
  await expect
    .poll(() =>
      heroCopy.evaluate((element) =>
        element.getAnimations().every((animation) => animation.playState === 'finished')
      )
    )
    .toBe(true);
  await expect
    .poll(() =>
      heroNote.evaluate((element) =>
        element.getAnimations().every((animation) => animation.playState === 'finished')
      )
    )
    .toBe(true);
  expect(await heroCopy.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect(await heroNote.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect(await page.locator('.home-hero').evaluate((element) => element.clientHeight)).toBe(
    heroHeight
  );
  if (testInfo.project.name === 'chromium') {
    await writeStableLocatorScreenshot(
      page.locator('.home-hero'),
      resolve(
        import.meta.dirname,
        '../../../docs/design/ui-catalog/homepage-reveal-desktop-1672.png'
      )
    );
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'MoonWitness' })).toBeVisible();
  expect(await heroCopy.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'none'
  );
  expect(await heroCopy.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect(await heroNote.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'MoonWitness' })).toBeVisible();
  await expect
    .poll(() => heroCopy.evaluate((element) => getComputedStyle(element).animationName))
    .toBe('mw-home-hero-reveal');
  await expect
    .poll(() =>
      heroCopy.evaluate((element) =>
        element.getAnimations().every((animation) => animation.playState === 'finished')
      )
    )
    .toBe(true);
  await expect
    .poll(() =>
      heroNote.evaluate((element) =>
        element.getAnimations().every((animation) => animation.playState === 'finished')
      )
    )
    .toBe(true);
  expect(await heroNote.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  if (testInfo.project.name === 'chromium') {
    await writeStableLocatorScreenshot(
      page.locator('.home-hero'),
      resolve(
        import.meta.dirname,
        '../../../docs/design/ui-catalog/homepage-reveal-mobile-390.png'
      )
    );
  }
});

test('editorial card feedback stays subtle, keyboard-visible, and absent on touch or reduced motion', async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const card = page.locator('.home-editorial-card.crop-people');
  const image = card.locator('.home-card-art img');
  const marker = card.locator('.home-card-mark');
  await expect(image).toBeVisible();
  await card.hover();
  await expect
    .poll(() => card.evaluate((element) => getComputedStyle(element).borderTopColor))
    .toBe('rgb(255, 46, 136)');
  await expect
    .poll(() => image.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe('none');
  await expect
    .poll(() => marker.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe('none');
  await page.evaluate(() => document.querySelector('nextjs-portal')?.remove());
  if (testInfo.project.name === 'chromium') {
    await writeStableLocatorScreenshot(
      card,
      resolve(
        import.meta.dirname,
        '../../../docs/design/ui-catalog/home-editorial-card-hover-desktop.png'
      )
    );
  }

  const cardLink = card.getByRole('link');
  await cardLink.focus();
  await expect
    .poll(() => card.evaluate((element) => getComputedStyle(element).borderTopColor))
    .toBe('rgb(255, 46, 136)');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(0, 0);
  await card.hover();
  expect(await image.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  expect(await marker.evaluate((element) => getComputedStyle(element).transform)).toBe('none');

  const touchContext = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto('/');
  expect(await touchPage.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
  const touchCard = touchPage.locator('.home-editorial-card.crop-people');
  const touchImage = touchCard.locator('.home-card-art img');
  await touchCard.hover();
  expect(await touchImage.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  expect(await touchImage.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
    '0s'
  );
  await touchContext.close();
});

test('legacy Board routes redirect to canonical paths and preserve query strings', async ({
  request,
}) => {
  const cases = [
    ['/profile', '/board/profile'],
    ['/settings', '/board/settings'],
    ['/stories/workbench', '/board/stories/workbench'],
    ['/m/base.partner', '/board/m/base.partner'],
    ['/m/base.partner/123', '/board/m/base.partner/123'],
  ];

  for (const [source, destination] of cases) {
    const response = await request.get(`${source}?view=compact`, { maxRedirects: 0 });
    expect(response.status(), source).toBe(308);
    const location = response.headers().location;
    expect(location, `${source} redirect location`).toBe(`${destination}?view=compact`);
  }

  const publicKnowledgeResponse = await request.get('/knowledge', { maxRedirects: 0 });
  expect(publicKnowledgeResponse.status(), '/knowledge').toBe(200);
});

test('auth pages stay out of search and external login return paths are discarded', async ({
  page,
}) => {
  await page.goto('/login?returnTo=https%3A%2F%2Fevil.example%2F');

  await expect(page).toHaveTitle(/Enter the Shadow/u);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/u);
  const register = new URL(
    (await page.getByRole('link', { name: 'Create an account' }).getAttribute('href'))!,
    page.url()
  );
  expect(register.searchParams.get('returnTo')).toBe('/board');
});

test('homepage adapts to a narrow mobile viewport without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'MoonWitness' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
  const menuTrigger = page.getByRole('button', { name: 'Open site navigation' });
  await expect(menuTrigger).toBeVisible();
  await menuTrigger.focus();
  await page.keyboard.press('Enter');
  const mobileNav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNav).toBeVisible();
  const sheetPanel = page.locator('[data-slot="sheet-content"]');
  const panelBounds = await sheetPanel.evaluate((element) =>
    element.getBoundingClientRect().toJSON()
  );
  expect(panelBounds.top).toBeGreaterThanOrEqual(0);
  expect(panelBounds.bottom).toBeLessThanOrEqual(844);
  expect(panelBounds.right).toBeGreaterThanOrEqual(389);
  const overlayColor = await page
    .locator('[data-slot="sheet-overlay"]')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(overlayColor).not.toBe('rgba(0, 0, 0, 0)');
  await expect(mobileNav.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '#home');
  await expect(mobileNav.getByRole('link', { name: 'People' })).toHaveAttribute('href', '#people');
  await expect(mobileNav.getByRole('link', { name: 'Knowledge' })).toHaveAttribute(
    'href',
    '#knowledge'
  );
  for (let tabPress = 0; tabPress < 8; tabPress += 1) {
    await page.keyboard.press('Tab');
    expect(await sheetPanel.evaluate((element) => element.contains(document.activeElement))).toBe(
      true
    );
  }
  await page.keyboard.press('Escape');
  await expect(mobileNav).toBeHidden();
  await expect(menuTrigger).toBeFocused();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);

  const filmstrip = page.getByRole('region', {
    name: 'How MoonWitness connects people, knowledge, and story work',
  });
  await expect(filmstrip).toHaveAttribute('tabindex', '0');
  await expect(page.locator('.home-step-card')).toHaveCount(4);
  await expect(page.getByRole('heading', { name: 'Share with care' })).toBeVisible();
  const instructionsId = await filmstrip.getAttribute('aria-describedby');
  expect(instructionsId).toBeTruthy();
  await expect(page.locator(`[id="${instructionsId}"]`)).toHaveText(
    /left and right arrow keys.*Home and End/iu
  );
  await filmstrip.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await filmstrip.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => filmstrip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  await expect.poll(() => filmstrip.evaluate((element) => element.scrollLeft)).toBeLessThan(10);
  await menuTrigger.click();
  const mobileDialog = page.getByRole('dialog', { name: 'Explore MoonWitness' });
  await expect(mobileDialog).toBeVisible();
  await mobileDialog.getByRole('link', { name: 'Enter the board' }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(mobileDialog).toBeHidden();
});
