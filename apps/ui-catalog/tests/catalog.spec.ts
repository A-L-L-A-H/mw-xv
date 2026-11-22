import AxeBuilder from '@axe-core/playwright';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('static catalog loads under the repository Pages subpath with its shared UI assets', async ({
  page,
}, testInfo) => {
  const failedRequests: string[] = [];
  page.on('requestfailed', (request) => failedRequests.push(request.url()));

  await page.goto('./');

  await expect(
    page.getByRole('heading', { name: 'One system. Every screen.', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Charts' })).toHaveAttribute('href', '#charts');
  await expect(page.locator('.mw-ui-button').first()).toBeVisible();
  await expect(page.locator('.catalog-footer a')).toHaveAttribute(
    'href',
    'https://github.com/bjo163/moonwitness-xi/tree/dev/packages/ui'
  );
  expect(failedRequests).toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/moonwitness-xiv/components/');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: false });
});

test('theme toggle changes the shared token map without hiding readable labels', async ({
  page,
}) => {
  await page.goto('./');
  const initialBackground = await page
    .locator('html')
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--mw-background').trim());

  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/u);
  const darkBackground = await page
    .locator('html')
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--mw-background').trim());

  expect(initialBackground).not.toBe(darkBackground);
  await expect(page.getByText('Success', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/u);
});

test('brand, typography, and homepage proof use canonical assets and correct spelling', async ({
  page,
}, testInfo) => {
  await page.goto('./#brand');
  const logoImages = page.locator('.brand-variant img');
  await expect(logoImages).toHaveCount(3);
  for (const image of await logoImages.all()) {
    await expect(image).toBeVisible();
    expect(
      await image.evaluate(
        (element: HTMLImageElement) => element.complete && element.naturalWidth > 0
      )
    ).toBe(true);
  }

  await expect(page.getByRole('heading', { name: 'Brand system' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Typography' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Materials & effects' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Homepage hero proof' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'MOONWITNESS', exact: true })).toBeVisible();

  const heroImage = page.locator('.catalog-hero-proof picture img');
  await expect(heroImage).toBeVisible();
  expect(
    await heroImage.evaluate(
      (element: HTMLImageElement) => element.complete && element.naturalWidth > 0
    )
  ).toBe(true);

  for (const viewport of [
    { name: 'desktop', width: 1672, height: 941 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('./#editorial-proof');
    await page.locator('.catalog-hero-proof').scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    ).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`editorial-proof-${viewport.name}.png`) });
  }

  const copyViewport = { width: 320, height: 844 };
  await page.setViewportSize(copyViewport);
  await page.goto('./#typography');
  const copyStress = page.getByTestId('typography-copy-stress');
  await expect(copyStress).toContainText('Rp1.234.567');
  await expect(copyStress).toContainText('24/10/2026');
  await expect(copyStress).toContainText('naïve');
  await expect(copyStress.getByText(/pertanggungjawaban/u)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  const bodyCopy = copyStress.locator('p');
  const bodyMetrics = await bodyCopy.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    height: element.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
  }));
  expect(bodyMetrics.scrollWidth).toBeLessThanOrEqual(bodyMetrics.clientWidth);
  expect(bodyMetrics.height).toBeGreaterThan(bodyMetrics.lineHeight * 2);
  await copyStress.screenshot({
    path: resolve(process.cwd(), '../../docs/design/ui-catalog/typography-indonesian-320.png'),
  });
});

test('webfont fallback remains readable while local fonts load without a large layout shift', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => {
    (window as Window & { __fontShiftTotal?: number }).__fontShiftTotal = 0;
    const shifts: Array<{ value: number; sources: string[] }> = [];
    (window as Window & { __fontShifts?: typeof shifts }).__fontShifts = shifts;
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries() as (PerformanceEntry & {
        hadRecentInput: boolean;
        value: number;
        sources?: Array<{ node?: Node | null }>;
      })[]) {
        if (!entry.hadRecentInput) {
          const target = window as Window & { __fontShiftTotal?: number };
          target.__fontShiftTotal = (target.__fontShiftTotal ?? 0) + entry.value;
          shifts.push({
            value: entry.value,
            sources: (entry.sources ?? []).map((s) =>
              s.node instanceof Element
                ? `${s.node.tagName.toLowerCase()}.${s.node.className}`
                : String(s.node)
            ),
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  let releaseFonts!: () => void;
  const fontGate = new Promise<void>((resolveFontGate) => {
    releaseFonts = resolveFontGate;
  });
  let fontRequests = 0;
  await page.route('**/*.woff2', async (route) => {
    fontRequests += 1;
    await fontGate;
    await route.continue();
  });

  await page.goto('./', { waitUntil: 'domcontentloaded' });
  const heading = page.getByRole('heading', { name: 'One system. Every screen.', exact: true });
  await expect(heading).toBeVisible();
  await expect.poll(() => fontRequests).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.fonts.status)).toBe('loading');

  const fallbackBox = await heading.boundingBox();
  expect(fallbackBox).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  releaseFonts();
  await page.evaluate(() => document.fonts.ready);
  const finalBox = await heading.boundingBox();
  const shiftData = await page.evaluate(() => ({
    total: (window as Window & { __fontShiftTotal?: number }).__fontShiftTotal ?? 0,
    shifts: (window as Window & { __fontShifts?: unknown[] }).__fontShifts ?? [],
  }));
  expect(await page.evaluate(() => document.fonts.status)).toBe('loaded');
  expect(shiftData.total, JSON.stringify(shiftData.shifts)).toBeLessThan(0.1);
  expect(finalBox).not.toBeNull();
  expect(finalBox!.height).toBeLessThanOrEqual(fallbackBox!.height + 4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test('failed local fonts keep the Indonesian typography specimen readable on mobile', async ({
  page,
}) => {
  let failedFontRequests = 0;
  await page.route('**/*.woff2', async (route) => {
    failedFontRequests += 1;
    await route.abort();
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./#typography');
  const copyStress = page.getByTestId('typography-copy-stress');
  await expect(copyStress).toContainText('Rp1.234.567');
  await expect(copyStress).toContainText('naïve');
  await expect.poll(() => failedFontRequests).toBeGreaterThan(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  await copyStress.screenshot({
    path: resolve(process.cwd(), '../../docs/design/ui-catalog/font-fallback-320.png'),
  });
});

test('shared animated effects pause offscreen and resume when visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./');
  const speedLines = page.locator('.mw-ui-speed-lines-pulse');
  const progress = page.locator('.mw-ui-loading-progress > span:first-child');
  const spinner = page.locator('.mw-ui-loading-spinner');
  const skeleton = page.locator('.catalog-skeleton');

  await expect
    .poll(() => speedLines.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');
  await expect
    .poll(() => progress.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');
  await expect
    .poll(() => spinner.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');
  await expect
    .poll(() => skeleton.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');

  await page.locator('.catalog-motion-grid').scrollIntoViewIfNeeded();
  await page.locator('.catalog-motion-grid').screenshot({
    path: resolve(process.cwd(), '../../docs/design/ui-catalog/offscreen-animation-visible.png'),
    animations: 'disabled',
  });
  await expect
    .poll(() => speedLines.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('running');
  await expect
    .poll(() => progress.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('running');
  await expect
    .poll(() => spinner.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('running');

  await skeleton.scrollIntoViewIfNeeded();
  await expect
    .poll(() => skeleton.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('running');

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() => speedLines.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');
  await expect
    .poll(() => progress.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');
  await expect
    .poll(() => spinner.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');
  await expect
    .poll(() => skeleton.evaluate((element) => getComputedStyle(element).animationPlayState))
    .toBe('paused');
});

test('canonical icon SVGs match generated React wrappers in a browser contact sheet', async ({
  page,
}, testInfo) => {
  const iconDirectory = resolve(process.cwd(), '../../packages/assets/icons');
  const wrapperDirectory = resolve(process.cwd(), '../../packages/ui/dist/icons');
  const iconFiles = (await readdir(iconDirectory)).filter((file) => file.endsWith('.svg')).sort();
  const cards = await Promise.all(
    iconFiles.map(async (file) => {
      const name = file.slice(0, -4);
      const source = await readFile(resolve(iconDirectory, file), 'utf8');
      const module = await import(pathToFileURL(resolve(wrapperDirectory, `${name}.js`)).href);
      const componentName = `${name.replace(/(^|-)([a-z])/gu, (_match, _dash, letter) => letter.toUpperCase())}Icon`;
      const Wrapper = module[componentName];
      expect(Wrapper, `${name} has a generated React wrapper`).toBeDefined();
      const canonical = source.replace('<svg', '<svg class="icon-render"');
      const generated = renderToStaticMarkup(createElement(Wrapper, { className: 'icon-render' }));
      return `<article class="icon-pair"><h2>${name}</h2><div><figure>${canonical}<figcaption>Canonical SVG</figcaption></figure><figure>${generated}<figcaption>React wrapper</figcaption></figure></div></article>`;
    })
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;padding:20px;background:#f3efe4;color:#0d0d0d;font:12px Arial,sans-serif}
    main{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
    .icon-pair{margin:0;padding:8px;border:1px solid #0d0d0d;background:#fffdf6;min-width:0}
    h2{margin:0 0 6px;font:700 11px Arial,sans-serif;overflow-wrap:anywhere}
    .icon-pair>div{display:grid;grid-template-columns:1fr 1fr;gap:4px}
    figure{margin:0;min-height:64px;display:grid;place-items:center;align-content:center;gap:4px;border:1px solid #d7d0c2}
    .icon-render{width:32px;height:32px;color:#0d0d0d}
    figcaption{font:9px Arial,sans-serif;color:#353535}
    </style></head><body><main>${cards.join('')}</main></body></html>`);
  await expect(page.locator('.icon-pair')).toHaveCount(iconFiles.length);
  await expect(page.locator('.icon-render')).toHaveCount(iconFiles.length * 2);
  for (const icon of await page.locator('.icon-render').all()) {
    const bounds = await icon.boundingBox();
    expect(bounds?.width).toBeGreaterThan(0);
    expect(bounds?.height).toBeGreaterThan(0);
  }
  await page.screenshot({
    path: testInfo.outputPath('canonical-vs-react-icons.png'),
    fullPage: true,
  });
});

test('dashboard proof uses canonical masthead and labels all fixture content as sample data', async ({
  page,
}, testInfo) => {
  await page.goto('./#board-proof');
  await expect(page.getByRole('heading', { name: 'Board dashboard proof' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SHADOW COMMAND CENTER' })).toBeVisible();
  await expect(page.getByText('Contoh desain', { exact: true })).toBeVisible();
  await expect(
    page.getByText('All values are illustrative and do not represent production data.')
  ).toBeVisible();

  for (const label of ['Partners', 'Active users', 'Companies', 'Planned activities']) {
    await expect(
      page.locator('.catalog-board-metrics').getByText(label, { exact: true })
    ).toBeVisible();
  }

  const masthead = page.locator('.catalog-board-masthead > img');
  await expect(masthead).toBeVisible();
  expect(
    await masthead.evaluate(
      (element: HTMLImageElement) => element.complete && element.naturalWidth > 0
    )
  ).toBe(true);

  for (const viewport of [
    { name: 'desktop', width: 1672, height: 941 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('./#board-proof');
    await page.locator('.catalog-board-proof').scrollIntoViewIfNeeded();
    await page.locator('.catalog-board-proof').evaluate((element) => {
      window.scrollBy(0, element.getBoundingClientRect().top - 88);
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    ).toBe(false);
    if (viewport.name === 'mobile') {
      await page.locator('.catalog-topbar').evaluate((element: HTMLElement) => {
        element.style.position = 'static';
      });
    }
    await page
      .locator('.catalog-board-proof')
      .screenshot({ path: testInfo.outputPath(`board-proof-${viewport.name}.png`) });
  }
});

test('dialog and tabs support keyboard interaction and restore focus', async ({ page }) => {
  await page.goto('./#overlays');
  const dialogTrigger = page.getByRole('button', { name: 'Open dialog' });
  await dialogTrigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Confirm workspace change' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(dialogTrigger).toBeFocused();

  const overviewTab = page.getByRole('tab', { name: 'Overview' });
  await overviewTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('tabpanel')).toContainText('Recent events');
});

test('button links preserve navigation and disabled links cannot activate', async ({
  page,
}, testInfo) => {
  await page.goto('./#actions');
  const enabledLink = page.getByRole('link', { name: 'Enabled link action' });
  await expect(enabledLink).toHaveAttribute('href', '#brand');
  await expect(enabledLink).toHaveAttribute('data-slot', 'button');
  await enabledLink.click();
  await expect(page).toHaveURL(/#brand$/u);
  await page.goto('./#actions');

  const disabledLink = page.getByTestId('disabled-button-link');
  await expect(disabledLink).toHaveAttribute('aria-disabled', 'true');
  await expect(disabledLink).toHaveAttribute('tabindex', '-1');
  await expect(disabledLink).toHaveAttribute('href', '#brand');
  await disabledLink.dispatchEvent('click');
  await expect(page).toHaveURL(/#actions$/u);
  await page.locator('.catalog-button-grid').screenshot({
    path: testInfo.outputPath('button-link-states.png'),
  });
});

test('filter input controls sample table and navigation keeps a deep link at the Pages base path', async ({
  page,
}) => {
  await page.goto('./#forms');
  await page.getByRole('textbox', { name: 'Filter records' }).fill('Inventory');
  const sampleTable = page.locator('table.mw-ui-table');
  await expect(sampleTable.getByRole('cell', { name: 'Inventory' })).toBeVisible();
  await expect(sampleTable.getByText('Base')).toHaveCount(0);

  await page.getByRole('link', { name: 'Charts' }).click();
  await expect(page).toHaveURL(/\/moonwitness-xiv\/components\/#charts$/u);
  await expect(page.getByRole('heading', { name: 'Charts', exact: true })).toBeVisible();
});

test('shared controls expose controlled, disabled, validation, and loading states', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('./#actions');

  const disabledButton = page.getByRole('button', { name: 'Disabled', exact: true });
  await expect(disabledButton).toBeDisabled();
  await page.locator('.catalog-button-grid').screenshot({
    path: testInfo.outputPath('disabled-action-state.png'),
  });

  await page.goto('./#forms');
  const filter = page.getByRole('textbox', { name: 'Filter records' });
  await expect(filter).toHaveValue('');
  await filter.fill('Inventory');
  await expect(filter).toHaveValue('Inventory');
  const consent = page.getByRole('checkbox', { name: 'Include archived records' });
  await expect(consent).toBeChecked();
  await consent.uncheck();
  await expect(consent).not.toBeChecked();

  const email = page.getByRole('textbox', { name: 'Work email' });
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAttribute('aria-describedby', 'catalog-email-error');
  await expect(page.locator('#catalog-email-error')).toContainText(
    'Enter a valid work email address.'
  );
  await page.locator('.catalog-form-grid').screenshot({
    path: testInfo.outputPath('form-controlled-validation-states.png'),
  });

  await page.goto('./#data-display');
  await expect(page.getByRole('status', { name: 'Loading a partner record' })).toHaveAttribute(
    'aria-busy',
    'true'
  );
  await page.locator('.catalog-state-stack').screenshot({
    path: testInfo.outputPath('loading-empty-states.png'),
  });
  await page.goto('./#charts');
  await expect(page.getByText('Activity could not be loaded.')).toBeVisible();
  await expect(page.getByText('Loading example', { exact: true })).toBeVisible();
  await page.locator('.catalog-chart-grid').screenshot({
    path: testInfo.outputPath('chart-loading-error-states.png'),
  });
});

test('sound toggle persists preference and cues load only after explicit enabled playback', async ({
  page,
}, testInfo) => {
  let cueRequests = 0;
  await page.route('**/sounds/ui-success.wav', async (route) => {
    cueRequests += 1;
    await route.fulfill({
      path: resolve(process.cwd(), '../../packages/assets/sounds/ui-success.wav'),
      contentType: 'audio/wav',
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./#actions');

  const enableSounds = page.getByRole('button', { name: 'Enable interface sounds' });
  const playCue = page.getByRole('button', { name: 'Play success cue' });
  await expect(enableSounds).toHaveAttribute('aria-pressed', 'false');
  await playCue.click();
  expect(cueRequests).toBe(0);

  await enableSounds.click();
  const muteSounds = page.getByRole('button', { name: 'Mute interface sounds' });
  await expect(muteSounds).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('mw-ui-sound-enabled')))
    .toBe('true');

  await page.reload();
  const restoredToggle = page.getByRole('button', { name: 'Mute interface sounds' });
  await expect(restoredToggle).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Play success cue' }).click();
  await expect.poll(() => cueRequests).toBe(1);
  await page
    .locator('.catalog-inline')
    .filter({ has: restoredToggle })
    .screenshot({
      path: testInfo.outputPath('sound-toggle-enabled-state.png'),
    });
});

test('toast entry and dismissal use shared motion timing and remain immediate with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#actions');
  await page.getByRole('button', { name: 'Show success toast' }).click();

  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Settings saved' });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute('data-mounted', 'true');
  expect(await toast.evaluate((element) => getComputedStyle(element).transitionDuration)).toContain(
    '0.16s'
  );
  await expect(toast.getByText('Your workspace preferences are up to date.')).toBeVisible();
  await toast.screenshot({
    path: resolve(process.cwd(), '../../docs/design/ui-catalog/toast-motion-state.png'),
  });
  await toast.getByRole('button', { name: 'Close toast' }).click();
  await expect(toast).toBeHidden();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Show error toast' }).click();
  const reducedToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Could not save' });
  await expect(reducedToast).toBeVisible();
  expect(
    await reducedToast.evaluate((element) => getComputedStyle(element).transitionDuration)
  ).toContain('0s');
  await expect(reducedToast.getByText('Check the form and try again.')).toBeVisible();
});

test('shared table keeps sort, selection, pagination, and overflow accessible', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#data-display');

  const scrollRegion = page.getByRole('region', {
    name: 'Installed add-ons table horizontal scroll',
  });
  const table = page.getByRole('table', { name: 'Installed add-ons' });
  await expect(scrollRegion).toBeVisible();
  await expect(scrollRegion).toHaveAttribute('tabindex', '0');
  await expect(table.getByRole('row')).toHaveCount(4);
  expect(await scrollRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
  await scrollRegion.focus();
  await expect(scrollRegion).toBeFocused();
  const initialScrollLeft = await scrollRegion.evaluate((element) => element.scrollLeft);
  await page.keyboard.press('ArrowRight');
  const afterArrowRight = await scrollRegion.evaluate((element) => element.scrollLeft);
  expect(afterArrowRight).toBeGreaterThan(initialScrollLeft);
  await page.keyboard.press('End');
  expect(await scrollRegion.evaluate((element) => element.scrollLeft)).toBe(
    await scrollRegion.evaluate((element) => element.scrollWidth - element.clientWidth)
  );
  await page.keyboard.press('Home');
  expect(await scrollRegion.evaluate((element) => element.scrollLeft)).toBe(0);

  const addonHeader = table.getByRole('row').first().getByRole('columnheader').first();
  await addonHeader.getByRole('button', { name: 'Sort by addon' }).focus();
  await page.keyboard.press('Enter');
  await expect(addonHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.getByRole('row').nth(1)).toContainText('Analytics');

  await table.getByRole('checkbox', { name: 'Select all add-ons on this page' }).check();
  for (const name of ['Analytics', 'Base', 'CRM']) {
    await expect(table.getByRole('checkbox', { name: `Select ${name}` })).toBeChecked();
  }

  const pagination = page.getByRole('navigation', { name: 'Pagination' });
  await pagination.getByRole('button', { name: 'Next' }).click();
  await expect(pagination).toContainText('Page 2 of 2');
  await expect(table.getByRole('row').nth(1)).toContainText('Inventory');

  await addonHeader.getByRole('button', { name: 'Sort by addon' }).click();
  await expect(addonHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(pagination).toContainText('Page 1 of 2');
  await expect(table.getByRole('row').nth(1)).toContainText('Timeline');

  await scrollRegion.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await scrollRegion.screenshot({ path: testInfo.outputPath('table-mobile.png') });
});

test('catalog reflows component examples for a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#actions');
  const columns = await page
    .locator('.catalog-example')
    .first()
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns);

  expect(columns.trim().split(/\s+/u)).toHaveLength(1);
  await expect(page.getByRole('navigation', { name: 'Component sections' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Primary action' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: false });
});

test('reduced motion removes decorative animation and keeps loading status visible', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#materials');
  const motionGrid = page.locator('.catalog-motion-grid');
  const speedLines = motionGrid.locator('.mw-ui-speed-lines-pulse');
  const underline = motionGrid.locator('.mw-ui-ink-underline-path');
  const speechBubble = motionGrid.getByText('Story saved');
  const progress = page.getByRole('status', { name: 'Loading preview' });
  const progressBar = progress.locator('span').first();
  const loadingSpinner = motionGrid.locator('.mw-ui-loading-spinner');
  const liveBeacon = motionGrid.locator('.mw-ui-live-indicator-dot');

  for (const element of [
    speedLines,
    underline,
    speechBubble,
    progressBar,
    loadingSpinner,
    liveBeacon,
  ]) {
    await expect
      .poll(() => element.evaluate((node) => getComputedStyle(node).animationName))
      .not.toBe('none');
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const element of [
    speedLines,
    underline,
    speechBubble,
    progressBar,
    loadingSpinner,
    liveBeacon,
  ]) {
    await expect
      .poll(() => element.evaluate((node) => getComputedStyle(node).animationName))
      .toBe('none');
  }
  await expect(progress).toBeVisible();
  await expect(page.getByText('Loading preview…')).toBeVisible();
  await expect(speechBubble).toBeVisible();
  await expect(motionGrid.getByText('ON AIR')).toBeVisible();
  expect(await speechBubble.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
  await motionGrid.screenshot({ path: testInfo.outputPath('reduced-motion-states.png') });
});

test('button hover and pressed motion keeps a stable hit area and visible focus ring', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#actions');
  const button = page.getByRole('button', { name: 'Primary action' });
  const idleBox = await button.boundingBox();
  expect(idleBox).not.toBeNull();
  expect(
    await button.evaluate((element) => getComputedStyle(element).transitionDuration)
  ).toContain('0.12s');

  await button.hover();
  const hoverTransform = await button.evaluate((element) => getComputedStyle(element).transform);
  expect(hoverTransform).not.toBe('none');
  const hoverBox = await button.boundingBox();
  expect(hoverBox?.width).toBeCloseTo(idleBox!.width, 2);
  expect(hoverBox?.height).toBeCloseTo(idleBox!.height, 2);

  await page.mouse.down();
  const pressedTransform = await button.evaluate((element) => getComputedStyle(element).transform);
  expect(pressedTransform).not.toBe(hoverTransform);
  const pressedBox = await button.boundingBox();
  expect(pressedBox?.width).toBeCloseTo(idleBox!.width, 2);
  expect(pressedBox?.height).toBeCloseTo(idleBox!.height, 2);
  await button.screenshot({ path: '../../docs/design/ui-catalog/button-pressed-motion.png' });
  await page.mouse.up();

  await button.focus();
  await expect(button).toBeFocused();
  expect(await button.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('3px');
});

test('representative visual layout and token contract stays stable @visual', async ({ page }) => {
  test.setTimeout(15_000);
  await page.goto('./');
  const desktop = await page.evaluate(() => {
    const root = document.documentElement;
    const sidebar = document.querySelector<HTMLElement>('.catalog-sidebar');
    const topbar = document.querySelector<HTMLElement>('.catalog-topbar');
    const firstExample = document.querySelector<HTMLElement>('.catalog-example');
    const primaryButton = document.querySelector<HTMLElement>('.catalog-button-grid .mw-ui-button');
    if (!sidebar || !topbar || !firstExample || !primaryButton) {
      throw new Error('Visual contract elements are missing from the catalog page');
    }
    const roundedWidth = (element: HTMLElement) =>
      Math.round(element.getBoundingClientRect().width);
    return {
      sidebarWidth: roundedWidth(sidebar),
      topbarHeight: Math.round(topbar.getBoundingClientRect().height),
      exampleWidth: roundedWidth(firstExample),
      exampleColumnCount: getComputedStyle(firstExample).gridTemplateColumns.trim().split(/\s+/u)
        .length,
      primaryButtonMinHeight: getComputedStyle(primaryButton).minHeight,
      lightBackground: getComputedStyle(root).getPropertyValue('--mw-background').trim(),
      lightForeground: getComputedStyle(root).getPropertyValue('--mw-foreground').trim(),
    };
  });

  await page.getByRole('button', { name: 'Use dark theme' }).click();
  const darkTokens = await page.locator('html').evaluate((element) => ({
    background: getComputedStyle(element).getPropertyValue('--mw-background').trim(),
    foreground: getComputedStyle(element).getPropertyValue('--mw-foreground').trim(),
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.locator('.catalog-main').evaluate((element) => getComputedStyle(element).marginLeft)
    )
    .toBe('0px');
  const mobile = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('.catalog-sidebar');
    const main = document.querySelector<HTMLElement>('.catalog-main');
    const example = document.querySelector<HTMLElement>('.catalog-example');
    if (!sidebar || !main || !example) {
      throw new Error('Mobile visual contract elements are missing from the catalog page');
    }
    return {
      sidebarPosition: getComputedStyle(sidebar).position,
      mainMarginLeft: getComputedStyle(main).marginLeft,
      exampleColumnCount: getComputedStyle(example).gridTemplateColumns.trim().split(/\s+/u).length,
    };
  });

  const snapshotText = JSON.stringify({ desktop, darkTokens, mobile }, null, 2);
  await expect(snapshotText).toMatchSnapshot('layout-contract.txt');
});

test('catalog has no WCAG 2.1 A/AA accessibility violations in light or dark themes', async ({
  page,
}) => {
  await page.goto('./');
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Use dark theme' }).click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
      })),
      `${theme} theme accessibility violations`
    ).toEqual([]);
  }
});

test('icons, materials, and decorations contact sheet renders canonical assets at all scales', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto('./#icons-materials');
  const section = page.locator('#icons-materials');
  await expect(
    section.getByRole('heading', { name: 'Icons, Materials & Decorations' })
  ).toBeVisible();

  for (const label of [
    'ArrowLeft',
    'Bookmark',
    'CheckCircle',
    'Clock',
    'FileSpreadsheet',
    'History',
    'Send',
    'SignalOff',
    'Smartphone',
  ]) {
    const row = section.locator('.catalog-icon-scale-row').filter({ hasText: label });
    await expect(row).toBeVisible();
    for (const size of [16, 20, 24, 32]) {
      const svg = row.locator(`svg[width="${size}"][height="${size}"]`);
      await expect(svg).toBeVisible();
    }
  }

  const materialImages = section.locator('.catalog-material-card img');
  await expect(materialImages).toHaveCount(10);
  for (const image of await materialImages.all()) {
    await expect(image).toBeVisible();
    expect(
      await image.evaluate(
        (element: HTMLImageElement) => element.complete && element.naturalWidth > 0
      )
    ).toBe(true);
  }

  await expect(section.locator('.mw-ui-doodle')).toHaveCount(5);
  await expect(section.locator('.mw-ui-decorative-motif')).toHaveCount(6);

  await section.scrollIntoViewIfNeeded();
  await page.locator('.catalog-topbar').evaluate((element: HTMLElement) => {
    element.style.position = 'static';
  });
  await section.screenshot({
    path: resolve(process.cwd(), '../../docs/design/ui-catalog/icons-materials-desktop.png'),
  });
});

test('story workbench proof renders 3-column desktop, stacks on mobile without overflow, and preserves whitespace', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto('./#workbench-proof');

  const grid = page.getByTestId('workbench-proof-grid');
  await expect(grid).toBeVisible();
  const desktopCols = await grid.evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u).length
  );
  expect(desktopCols).toBe(3);

  await expect(grid).toContainText(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  await expect(grid).toContainText('Contoh desain · Synthetic sample');
  await expect(grid.locator('.mw-ui-badge').filter({ hasText: 'INTERNAL' }).first()).toBeVisible();

  const draftInput = grid.getByRole('textbox', { name: 'Draft content' });
  await expect(draftInput).toHaveValue(
    '  Line 01: Night market signal\n    Indented field note\n\tTabbed source cue'
  );
  await draftInput.fill('  Custom line\n    Kept indent');
  await expect(grid.locator('.catalog-workbench-pre')).toHaveText('  Custom line\n    Kept indent');

  await grid.getByRole('button', { name: /02 · Field interview/u }).click();
  await expect(grid.locator('.mw-ui-page-header-title')).toHaveText('Field interview');
  await grid.getByRole('button', { name: /01 · Opening scene/u }).click();

  await grid.scrollIntoViewIfNeeded();
  await page.locator('.catalog-topbar').evaluate((element: HTMLElement) => {
    element.style.position = 'static';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false
  );
  await grid.screenshot({
    path: resolve(process.cwd(), '../../docs/design/ui-catalog/workbench-proof-desktop.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#workbench-proof');
  await page.locator('.catalog-topbar').evaluate((element: HTMLElement) => {
    element.style.position = 'static';
  });
  const mobileCols = await grid.evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/u).length
  );
  expect(mobileCols).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false
  );
  await grid.scrollIntoViewIfNeeded();
  await grid.screenshot({
    path: resolve(process.cwd(), '../../docs/design/ui-catalog/workbench-proof-mobile.png'),
  });
});

test('component matrix covers textarea, switch, indeterminate checkbox, sentinel select, overlays, command, compact table, and chart states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto('./#forms');

  const notes = page.getByRole('textbox', { name: 'Editorial notes' });
  await expect(notes).toHaveValue('  First line\n    Indented detail');
  await notes.fill('  Updated line\n    Two indents');
  await expect(notes).toHaveValue('  Updated line\n    Two indents');

  const publishSwitch = page.getByRole('switch', { name: 'Auto-publish snapshots' });
  await expect(publishSwitch).toHaveAttribute('aria-checked', 'true');
  await publishSwitch.click();
  await expect(publishSwitch).toHaveAttribute('aria-checked', 'false');

  const indeterminateBox = page.getByRole('checkbox', { name: 'Select partial archive batch' });
  await expect(indeterminateBox).toHaveJSProperty('indeterminate', true);
  await expect(indeterminateBox).toHaveAttribute('aria-checked', 'mixed');
  await indeterminateBox.click();
  await expect(indeterminateBox).toHaveJSProperty('indeterminate', false);
  await expect(indeterminateBox).toBeChecked();

  const assignmentTrigger = page.getByRole('combobox', { name: 'Project assignment' });
  await expect(assignmentTrigger).toContainText('Unassigned');
  await assignmentTrigger.click();
  await page.getByRole('option', { name: 'Editorial' }).click();
  await expect(assignmentTrigger).toContainText('Editorial');

  await page.goto('./#overlays');
  const overlaysSection = page.locator('#overlays');
  await overlaysSection.scrollIntoViewIfNeeded();
  await page.locator('.catalog-topbar').evaluate((element: HTMLElement) => {
    element.style.position = 'static';
  });
  await overlaysSection.screenshot({
    path: resolve(process.cwd(), '../../docs/design/ui-catalog/component-matrix-desktop.png'),
  });

  await expect(overlaysSection.locator('.mw-ui-page-header[data-treatment="display"]')).toHaveCount(
    1
  );
  await expect(overlaysSection.locator('.mw-ui-page-header[data-treatment="brush"]')).toHaveCount(
    1
  );

  await overlaysSection.getByRole('button', { name: 'Open quick info' }).click();
  await expect(page.getByText('Revision snapshot', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Revision snapshot', { exact: true })).toHaveCount(0);

  await overlaysSection.getByRole('button', { name: 'Open detail sheet' }).click();
  const sheetDialog = page.getByRole('dialog', { name: 'Story metadata' });
  await expect(sheetDialog).toBeVisible();
  await sheetDialog.getByRole('button', { name: 'Close sheet' }).click();
  await expect(sheetDialog).toHaveCount(0);

  const commandInput = overlaysSection.getByRole('combobox', { name: 'Search commands' });
  await commandInput.fill('Inspect');
  await overlaysSection.getByRole('option', { name: 'Inspect revision' }).click();
  await expect(page.getByTestId('selected-command-status')).toContainText('Inspect revision');
  await commandInput.fill('nonexistent-command');
  await expect(overlaysSection.getByText('No commands found.')).toBeVisible();

  await page.goto('./#data-display');
  const compactTable = page.getByRole('table', { name: 'Compact revision log' });
  await expect(compactTable).toHaveAttribute('data-density', 'compact');

  await page.goto('./#charts');
  await expect(
    page.locator('.mw-ui-chart-title', { hasText: 'Zero values bar example' })
  ).toBeVisible();
  await expect(
    page.locator('.mw-ui-chart-title', { hasText: 'Zero values line example' })
  ).toBeVisible();
  await expect(
    page.locator('.mw-ui-chart-title', { hasText: 'Line loading example' })
  ).toBeVisible();
  await expect(page.getByText('Timeline could not be loaded.')).toBeVisible();
  await expect(page.getByText('No timeline points yet.')).toBeVisible();
});

test('zine polish patterns wrap cleanly at 320px and expose paper/torn/scuffed states', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('./#materials');
  const materialsSection = page.locator('#materials');
  await expect(materialsSection.getByText('ZINE')).toBeVisible();
  await expect(materialsSection.getByText('DOSSIER', { exact: true })).toBeVisible();
  await expect(materialsSection.locator('.mw-ui-metric-tile[data-surface="paper"]')).toBeVisible();
  await expect(materialsSection.locator('.mw-ui-metric-tile[data-accent="violet"]')).toBeVisible();
  await expect(materialsSection.locator('.mw-ui-panel[data-frame="scuffed"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test('skin, color mode, and density switcher supports all built-in combinations without WCAG AA violations', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('./');
  const skins = [
    { id: 'moonwitness-ink', label: 'MoonWitness Ink' },
    { id: 'moonwitness-compact', label: 'MoonWitness Compact' },
    { id: 'moonwitness-high-contrast', label: 'MoonWitness High Contrast' },
  ];

  for (const skin of skins) {
    await page.getByRole('combobox', { name: 'Preview skin' }).click();
    await page.getByRole('option', { name: skin.label }).click();
    await expect(page.locator('html')).toHaveAttribute('data-skin', skin.id);

    for (const mode of ['light', 'dark'] as const) {
      const isDark = await page.locator('html').evaluate((el) => el.classList.contains('dark'));
      if (mode === 'dark' && !isDark) {
        await page.getByRole('button', { name: 'Use dark theme' }).click();
      } else if (mode === 'light' && isDark) {
        await page.getByRole('button', { name: 'Use light theme' }).click();
      }

      for (const density of ['comfortable', 'compact'] as const) {
        const currentDensity = await page.locator('html').getAttribute('data-density');
        if (density === 'compact' && currentDensity !== 'compact') {
          await page.getByRole('button', { name: 'Use compact density' }).click();
        } else if (density === 'comfortable' && currentDensity === 'compact') {
          await page.getByRole('button', { name: 'Use comfortable density' }).click();
        }

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(
          results.violations.map(({ id, impact, nodes }) => ({
            id,
            impact,
            nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
          })),
          `${skin.id} / ${mode} / ${density} accessibility violations`
        ).toEqual([]);
      }
    }
  }
});
