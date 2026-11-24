import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
import {
  BUILTIN_SKINS,
  DEFAULT_SKIN_ID,
  createThemeRegistry,
  themeRegistry,
} from '../dist/themes/index.js';

const css = await readFile(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

function parseBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`));
  return match?.[1] ?? '';
}

function getToken(token, selectors) {
  for (let index = selectors.length - 1; index >= 0; index -= 1) {
    const block = parseBlock(selectors[index]);
    const match = block.match(new RegExp(`--mw-${token}:\\s*([^;]+);`));
    if (match) return match[1].trim();
  }
  return undefined;
}

function resolveToken(token, selectors) {
  const value = getToken(token, selectors);
  assert.ok(value, `Missing --mw-${token} across [${selectors.join(', ')}]`);
  const reference = value.match(/^var\(--mw-([\w-]+)\)$/);
  return reference ? resolveToken(reference[1], selectors) : value;
}

function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i, `Expected 6-digit hex, got ${hex}`);
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('package exports @moonwitness/ui/themes explicitly', () => {
  assert.deepEqual(packageJson.exports['./themes'], {
    types: './dist/themes/index.d.ts',
    import: './dist/themes/index.js',
  });
});

test('default themeRegistry exposes all built-in skins and resolves unknown skins safely', () => {
  assert.equal(themeRegistry.defaultSkinId, DEFAULT_SKIN_ID);
  assert.equal(themeRegistry.list().length, BUILTIN_SKINS.length);
  assert.equal(themeRegistry.has('moonwitness-ink'), true);
  assert.equal(themeRegistry.has('moonwitness-compact'), true);
  assert.equal(themeRegistry.has('moonwitness-high-contrast'), true);
  assert.equal(themeRegistry.has('non-existent'), false);

  assert.equal(themeRegistry.get('moonwitness-compact')?.defaultDensity, 'compact');
  assert.equal(themeRegistry.resolve('unknown-skin').id, DEFAULT_SKIN_ID);
  assert.equal(themeRegistry.resolve(undefined).id, DEFAULT_SKIN_ID);
  assert.equal(themeRegistry.resolve(null).id, DEFAULT_SKIN_ID);
});

test('createThemeRegistry supports custom registration and rejects duplicate or invalid IDs', () => {
  const registry = createThemeRegistry(BUILTIN_SKINS, DEFAULT_SKIN_ID);

  registry.register({
    id: 'editorial-night',
    label: 'Editorial Night',
    description: 'Dark-only editorial skin',
    supportedModes: ['dark'],
    supportedDensities: ['comfortable'],
    defaultMode: 'dark',
    defaultDensity: 'comfortable',
    swatch: {
      background: '#0e0e10',
      surface: '#17171a',
      foreground: '#f3efe4',
      accent: '#ff2e88',
    },
  });

  assert.equal(registry.has('editorial-night'), true);
  assert.equal(registry.isModeSupported('editorial-night', 'dark'), true);
  assert.equal(registry.isModeSupported('editorial-night', 'light'), false);
  assert.equal(registry.isDensitySupported('editorial-night', 'compact'), false);

  assert.deepEqual(
    registry.normalizePreferences({
      skin: 'editorial-night',
      theme_mode: 'light',
      density: 'compact',
    }),
    {
      skin: 'editorial-night',
      theme_mode: 'dark',
      density: 'comfortable',
    }
  );

  assert.throws(
    () =>
      registry.register({
        id: 'moonwitness-ink',
        label: 'Duplicate',
        description: 'Duplicate skin',
        supportedModes: ['light'],
        supportedDensities: ['comfortable'],
        defaultMode: 'light',
        defaultDensity: 'comfortable',
        swatch: { background: '#fff', surface: '#fff', foreground: '#000', accent: '#ff0' },
      }),
    /Duplicate skin id/
  );

  assert.throws(
    () =>
      registry.register({
        id: 'Invalid ID!',
        label: 'Invalid',
        description: 'Bad slug',
        supportedModes: ['light'],
        supportedDensities: ['comfortable'],
        defaultMode: 'light',
        defaultDensity: 'comfortable',
        swatch: { background: '#fff', surface: '#fff', foreground: '#000', accent: '#ff0' },
      }),
    /Invalid skin metadata/
  );
});

test('all built-in skins meet WCAG AA contrast across light and dark modes', () => {
  const textPairs = [
    ['foreground', 'background'],
    ['surface-foreground', 'surface'],
    ['muted-foreground', 'muted'],
    ['primary-foreground', 'primary'],
    ['destructive-foreground', 'destructive'],
    ['on-error', 'error'],
    ['on-success', 'success'],
    ['on-warning', 'warning'],
    ['on-info', 'info'],
  ];

  const readableTokens = [
    'magenta-readable',
    'cyan-readable',
    'yellow-readable',
    'violet-readable',
  ];

  const brushPairs = [
    ['primary-foreground', 'primary'],
    ['on-magenta', 'magenta'],
    ['secondary-foreground', 'secondary'],
    ['surface-foreground', 'surface'],
    ['destructive-foreground', 'destructive'],
  ];

  for (const skin of themeRegistry.list()) {
    for (const mode of skin.supportedModes) {
      const selectors = [':root'];
      if (mode === 'dark') selectors.push('.dark');
      if (skin.id !== 'moonwitness-ink') {
        selectors.push(`[data-skin='${skin.id}']`);
        if (mode === 'dark') selectors.push(`[data-skin='${skin.id}'].dark`);
      }

      for (const [fgName, bgName] of textPairs) {
        const fg = resolveToken(fgName, selectors);
        const bg = resolveToken(bgName, selectors);
        assert.ok(
          contrast(fg, bg) >= 4.5,
          `${skin.id} (${mode}): ${fgName} (${fg}) on ${bgName} (${bg}) is below 4.5:1`
        );
      }

      for (const [fgName, bgName] of brushPairs) {
        const fg = resolveToken(fgName, selectors);
        const bg = resolveToken(bgName, selectors);
        assert.ok(
          contrast(fg, bg) >= 4.5,
          `${skin.id} (${mode}): brush ${fgName} (${fg}) on ${bgName} (${bg}) is below 4.5:1`
        );
      }

      for (const token of readableTokens) {
        const fg = resolveToken(token, selectors);
        const bg = resolveToken('surface', selectors);
        assert.ok(
          contrast(fg, bg) >= 4.5,
          `${skin.id} (${mode}): ${token} (${fg}) on surface (${bg}) is below 4.5:1`
        );
      }

      assert.ok(
        contrast(resolveToken('border', selectors), resolveToken('surface', selectors)) >= 3,
        `${skin.id} (${mode}): border against surface is below 3:1`
      );
      assert.ok(
        contrast(resolveToken('focus', selectors), resolveToken('background', selectors)) >= 3,
        `${skin.id} (${mode}): focus against background is below 3:1`
      );
    }
  }
});

test('compact density selector defines tightened spacing tokens', () => {
  const compactBlock = parseBlock("[data-density='compact']");
  assert.ok(compactBlock.includes('--mw-space-4:'), 'Missing --mw-space-4 in compact density');
  assert.ok(
    compactBlock.includes('--mw-panel-padding-comfortable:'),
    'Missing --mw-panel-padding-comfortable in compact density'
  );
});
