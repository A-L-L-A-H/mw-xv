import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type SectionRegistryEntry = {
  id: string;
  label: string;
  title: string;
  description: string;
  loading: 'eager' | 'lazy';
  order: number;
};

type ViteManifestChunk = {
  file: string;
  src?: string;
  isDynamicEntry?: boolean;
};

const viteManifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../dist/.vite/manifest.json'), 'utf8')
) as Record<string, ViteManifestChunk>;

const heavySections = [
  { id: 'assets', source: 'src/AssetBrowser.tsx', testId: 'asset-browser' },
  { id: 'asset-diagnostics', source: 'src/AssetDiagnostics.tsx', testId: 'asset-diagnostics' },
  { id: 'scene-environment-inspector', source: 'src/SceneLab.tsx', testId: 'scene-lab' },
  { id: 'fx-lab', source: 'src/FXLab.tsx', testId: 'fx-lab' },
] as const;

function dynamicChunk(source: string): string {
  const matches = Object.values(viteManifest).filter(
    (chunk) => chunk.isDynamicEntry === true && chunk.src === source
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one dynamic Vite chunk for ${source}, found ${matches.length}.`);
  }
  return matches[0].file;
}

async function readSectionRegistry(page: Page): Promise<SectionRegistryEntry[]> {
  const source = await page.locator('#catalog-section-registry').textContent();
  if (!source) throw new Error('Catalog section registry JSON is missing.');
  return JSON.parse(source) as SectionRegistryEntry[];
}

async function expectNoAccessibilityViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
    })),
    `${label} accessibility violations`
  ).toEqual([]);
}

test('section registry drives navigation, documentation, rendering order, and every direct hash', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('./');
  const registry = await readSectionRegistry(page);
  expect(registry.length).toBeGreaterThan(0);
  expect(new Set(registry.map((section) => section.id)).size).toBe(registry.length);
  expect(registry.map((section) => section.order)).toEqual(
    registry.map((_section, index) => index)
  );

  const navigation = page.getByRole('navigation', { name: 'Component sections' });
  const documentation = page.getByTestId('section-documentation');
  await expect(navigation.getByRole('link')).toHaveCount(registry.length);
  await expect(documentation.locator('li')).toHaveCount(registry.length);
  for (const section of registry) {
    await expect(
      navigation.getByRole('link', { name: section.label, exact: true })
    ).toHaveAttribute('href', `#${section.id}`);
    const documented = documentation.locator(`li[data-section-id="${section.id}"]`);
    await expect(documented).toHaveAttribute('data-loading', section.loading);
    await expect(documented.locator('a')).toHaveAttribute('href', `#${section.id}`);
  }

  const eagerIds = registry
    .filter((section) => section.loading === 'eager')
    .map((section) => section.id);
  expect(
    await page
      .locator('.catalog-section')
      .evaluateAll((sections) => sections.map((section) => section.id))
  ).toEqual(eagerIds);

  for (const section of registry) {
    await page.goto(`./#${section.id}`);
    const rendered = page.locator(`#${section.id}`);
    await expect(rendered).toBeVisible();
    await expect(rendered.getByRole('heading', { name: section.title, exact: true })).toBeVisible();
    await expect(rendered.locator('.catalog-section-heading > p:last-child')).toHaveText(
      section.description
    );
    await expect(
      navigation.getByRole('link', { name: section.label, exact: true })
    ).toHaveAttribute('aria-current', 'location');
  }
});

test('unknown hashes fail closed without mounting heavy sections', async ({ page }) => {
  await page.goto('./#not-a-catalog-section');
  await expect(
    page.getByRole('heading', { name: 'One system. Every screen.', exact: true })
  ).toBeVisible();
  for (const section of heavySections) {
    await expect(page.getByTestId(section.testId)).toHaveCount(0);
  }
});

for (const section of heavySections) {
  test(`${section.id} loads its JS only on activation and unmounts when inactive`, async ({
    page,
  }) => {
    const requestedScripts: string[] = [];
    const requestedAssetData: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') requestedScripts.push(request.url());
      if (/\/(?:manifest|licenses)(?:-[^/]+)?\.json$/u.test(new URL(request.url()).pathname)) {
        requestedAssetData.push(request.url());
      }
    });
    const wasRequested = (file: string) =>
      requestedScripts.some((url) => new URL(url).pathname.endsWith(`/${file}`));

    await page.goto('./');
    await expect(
      page.getByRole('heading', { name: 'One system. Every screen.', exact: true })
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    for (const heavy of heavySections) {
      expect(
        wasRequested(dynamicChunk(heavy.source)),
        `${heavy.id} loaded on the initial page`
      ).toBe(false);
      await expect(page.getByTestId(heavy.testId)).toHaveCount(0);
    }
    expect(requestedAssetData).toEqual([]);

    const registry = await readSectionRegistry(page);
    const entry = registry.find((candidate) => candidate.id === section.id);
    if (!entry) throw new Error(`Registry is missing ${section.id}.`);
    await page
      .getByRole('navigation', { name: 'Component sections' })
      .getByRole('link', { name: entry.label, exact: true })
      .click();
    await expect(page.getByTestId(section.testId)).toBeVisible();
    await expect.poll(() => wasRequested(dynamicChunk(section.source))).toBe(true);
    for (const heavy of heavySections.filter((candidate) => candidate.id !== section.id)) {
      expect(
        wasRequested(dynamicChunk(heavy.source)),
        `${heavy.id} loaded with ${section.id}`
      ).toBe(false);
    }
    if (section.id === 'assets') expect(requestedAssetData.length).toBe(2);

    await page
      .getByRole('navigation', { name: 'Component sections' })
      .getByRole('link', {
        name: 'Charts',
        exact: true,
      })
      .click();
    await expect(page.getByTestId(section.testId)).toHaveCount(0);
  });
}

test('public KanbanBoard and FilterFacetBar specimens expose their interaction contracts', async ({
  page,
}) => {
  await page.goto('./#data-display');
  const kanban = page.getByTestId('kanban-specimen');
  await expect(kanban.getByRole('region', { name: 'Draft' })).toBeVisible();
  await expect(kanban.getByRole('region', { name: 'In review' })).toContainText('1');
  await expect(kanban.getByRole('region', { name: 'Approved' })).toContainText(
    'No sample stories approved'
  );
  const card = kanban.getByRole('button', { name: /Opening scene/u });
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(kanban.getByRole('status')).toContainText(
    'Selected sample card: opening-scene · draft'
  );

  await page.goto('./#forms');
  const facets = page.getByTestId('filter-facet-specimen');
  await expect(facets.getByRole('status')).toHaveText('2 active sample filters');
  await facets.getByRole('button', { name: 'Remove Owner: Editorial' }).click();
  await expect(facets.getByRole('status')).toHaveText('1 active sample filter');
  await facets.getByRole('button', { name: 'Reset sample filters' }).click();
  await expect(facets.getByRole('status')).toHaveText('2 active sample filters');
});

test('AssetBrowser and SceneLab use shared controls with one labeled native range exception', async ({
  page,
}) => {
  await page.goto('./#assets');
  const browser = page.getByTestId('asset-browser');
  await expect(browser.getByRole('searchbox', { name: 'Find an asset' })).toHaveAttribute(
    'data-slot',
    'input'
  );
  await expect(browser.locator('select:not([data-slot="select"])')).toHaveCount(0);
  await expect(browser.locator('input:not([data-slot="input"])')).toHaveCount(0);

  await page.goto('./#scene-environment-inspector');
  const scene = page.getByTestId('scene-lab');
  await expect(scene.locator('input[type="checkbox"]:not([data-slot="checkbox"])')).toHaveCount(0);
  await expect(scene.locator('input[type="range"]')).toHaveCount(1);
  const timeline = scene.getByRole('slider', { name: 'Timeline position' });
  await expect(timeline).toHaveAttribute('aria-valuetext', /\d+ milliseconds/u);
});

test('Tailwind scans both UI package source and built dist files', () => {
  const stylesheet = readFileSync(resolve(import.meta.dirname, '../src/styles.css'), 'utf8');
  expect(stylesheet).toContain("@source '../../../packages/ui/src';");
  expect(stylesheet).toContain("@source '../../../packages/ui/dist';");
});

test('shared Dialog and Sheet utilities retain viewport-safe computed positioning', async ({
  page,
}) => {
  await page.goto('./#overlays');
  const dialogTrigger = page.getByRole('button', { name: 'Open dialog' });
  await dialogTrigger.click();
  const dialog = page.getByRole('dialog', { name: 'Confirm workspace change' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  const dialogBounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(viewport!.height);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Open detail sheet' }).click();
  const sheet = page.getByRole('dialog', { name: 'Story metadata' });
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  const sheetBounds = await sheet.boundingBox();
  expect(sheetBounds).not.toBeNull();
  expect(sheetBounds!.x).toBeGreaterThanOrEqual(0);
  expect(sheetBounds!.x + sheetBounds!.width).toBeLessThanOrEqual(viewport!.width);
  await page.keyboard.press('Escape');
});

test('open Dialog passes axe, contains keyboard focus, closes with Escape, and restores focus', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto('./#overlays');
  const trigger = page.getByRole('button', { name: 'Open dialog' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Confirm workspace change' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expectNoAccessibilityViolations(page, 'Open Dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('open Sheet passes axe, contains keyboard focus, closes with Escape, and restores focus', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto('./#overlays');
  const trigger = page.getByRole('button', { name: 'Open detail sheet' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Story metadata' });
  await expect(sheet).toBeVisible();
  await expect
    .poll(() => sheet.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expectNoAccessibilityViolations(page, 'Open Sheet');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('open Popover passes axe, receives keyboard focus, closes with Escape, and restores focus', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto('./#overlays');
  const trigger = page.getByRole('button', { name: 'Open quick info' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const popover = page.locator('[data-slot="popover-content"]');
  await expect(popover).toBeVisible();
  await expect
    .poll(() => popover.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expectNoAccessibilityViolations(page, 'Open Popover');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('open DropdownMenu passes axe, supports arrow navigation and Escape, and restores focus', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto('./#overlays');
  const trigger = page.getByRole('button', { name: /More actions/u });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expectNoAccessibilityViolations(page, 'Open DropdownMenu');
  // Radix focuses the first item on open; ArrowDown advances to the next one.
  await expect(menu.getByRole('menuitem', { name: 'Edit record' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('active Command passes axe and supports keyboard filtering and selection', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.goto('./#overlays');
  const input = page.getByRole('combobox', { name: 'Search commands' });
  await input.focus();
  await page.keyboard.type('Inspect');
  await expect(page.getByRole('option', { name: 'Inspect revision' })).toBeVisible();
  await expectNoAccessibilityViolations(page, 'Active Command');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('selected-command-status')).toContainText('Inspect revision');
  await expect(input).toBeFocused();
});

test('open Toast passes axe and its close action works from the keyboard', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('./#actions');
  const trigger = page.getByRole('button', { name: 'Show success toast' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Settings saved' });
  await expect(toast).toBeVisible();
  await expectNoAccessibilityViolations(page, 'Open Toast');
  const close = toast.getByRole('button', { name: 'Close toast' });
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(toast).toBeHidden();
});

const skins = [
  { id: 'moonwitness-ink', label: 'MoonWitness Ink' },
  { id: 'moonwitness-compact', label: 'MoonWitness Compact' },
  { id: 'moonwitness-high-contrast', label: 'MoonWitness High Contrast' },
] as const;

for (const skin of skins) {
  for (const mode of ['light', 'dark'] as const) {
    for (const density of ['comfortable', 'compact'] as const) {
      test(`axe matrix: ${skin.id} / ${mode} / ${density}`, async ({ page }) => {
        test.setTimeout(45_000);
        await page.goto('./');
        await page.getByRole('combobox', { name: 'Preview skin' }).click();
        await page.getByRole('option', { name: skin.label }).click();
        await expect(page.locator('html')).toHaveAttribute('data-skin', skin.id);

        const isDark = await page
          .locator('html')
          .evaluate((element) => element.classList.contains('dark'));
        if (mode === 'dark' && !isDark) {
          await page.getByRole('button', { name: 'Use dark theme' }).click();
        } else if (mode === 'light' && isDark) {
          await page.getByRole('button', { name: 'Use light theme' }).click();
        }

        const currentDensity = await page.locator('html').getAttribute('data-density');
        if (density === 'compact' && currentDensity !== 'compact') {
          await page.getByRole('button', { name: 'Use compact density' }).click();
        } else if (density === 'comfortable' && currentDensity === 'compact') {
          await page.getByRole('button', { name: 'Use comfortable density' }).click();
        }
        await expect(page.locator('html')).toHaveAttribute('data-density', density);
        await expectNoAccessibilityViolations(page, `${skin.id} / ${mode} / ${density}`);
      });
    }
  }
}
