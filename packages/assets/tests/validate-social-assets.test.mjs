/**
 * Tests for validate-social-assets.mjs (SM-005)
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';
import {
  extractBrandColorsFromTokensCss,
  extractSvgHexColors,
  validateSocialSvgSource,
  validateSocialAssets,
  validateRenderedPng,
} from '../scripts/validate-social-assets.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('extractBrandColorsFromTokensCss', () => {
  it('extracts lowercase hex colors from tokens.css', async () => {
    const colors = await extractBrandColorsFromTokensCss();
    assert.ok(colors.has('f3efe4'));
    assert.ok(colors.has('0d0d0d'));
    assert.ok(colors.has('ffe031'));
    assert.ok(colors.has('00b8f0'));
    assert.ok(colors.has('ff2e88'));
    // all colors should be lowercase
    for (const color of colors) {
      assert.equal(color, color.toLowerCase());
    }
    assert.ok(colors.size > 0);
  });
});

describe('extractSvgHexColors', () => {
  it('extracts 6-digit hex colors from SVG', () => {
    const svg = `
      <svg>
        <rect fill="#f3efe4"/>
        <path stroke="#0d0d0d"/>
        <circle fill="#FFE031"/>
        <rect fill="#not-a-color"/>
      </svg>
    `;
    const colors = extractSvgHexColors(svg);
    assert.ok(colors.has('f3efe4'));
    assert.ok(colors.has('0d0d0d'));
    assert.ok(colors.has('ffe031'));
    assert.equal(colors.size, 3);
  });

  it('returns empty set for SVG without hex colors', () => {
    const svg = `<svg><rect fill="red"/></svg>`;
    const colors = extractSvgHexColors(svg);
    assert.equal(colors.size, 0);
  });
});

describe('validateSocialSvgSource', () => {
  it('validates a file-backed SVG with approved colors', () => {
    // youtube-banner uses only approved colors
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2560 1440" width="2560" height="1440" role="img" aria-label="test"><title>test</title><rect id="mw-brand-moonwitness-youtube-banner-rect" fill="#f3efe4"/></svg>`;
    const result = validateSocialSvgSource(svg, 'brand/moonwitness-youtube-banner.svg');
    assert.equal(result.colorCompliant, true);
    assert.equal(result.nonCompliantColors.length, 0);
    assert.equal(result.viewBox, '0 0 2560 1440');
  });

  it('rejects SVG with non-compliant colors', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="test"><title>test</title><rect id="mw-brand-test-rect" fill="#ff0000"/></svg>`;
    const result = validateSocialSvgSource(svg, 'brand/test.svg', new Set(['f3efe4', '0d0d0d']));
    assert.equal(result.colorCompliant, false);
    assert.ok(result.nonCompliantColors.includes('ff0000'));
  });

  it('throws on invalid SVG structure', () => {
    const svg = `<svg><rect fill="#f3efe4"/></svg>`; // missing xmlns, viewBox, role, aria-label
    assert.throws(() => validateSocialSvgSource(svg, 'brand/test.svg'), /SVG namespace is required/);
  });
});

describe('validateRenderedPng', () => {
  it('rejects missing file', async () => {
    const result = await validateRenderedPng(resolve(packageRoot, 'brand/does-not-exist.png'));
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('missing or unreadable'));
  });

  it('rejects non-PNG file', async () => {
    const tmpPath = resolve(packageRoot, 'brand/not-a-png.txt');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(tmpPath, 'not a png');
    try {
      const result = await validateRenderedPng(tmpPath);
      assert.equal(result.valid, false);
      assert.ok(result.error.includes('invalid PNG magic header'));
    } finally {
      const { unlink } = await import('node:fs/promises');
      await unlink(tmpPath).catch(() => {});
    }
  });
});

describe('validateSocialAssets (real workspace, requireRendered: false)', () => {
  it('passes all 16 formats x 2 themes', async () => {
    const report = await validateSocialAssets({ requireRendered: false });
    assert.equal(report.passed, true);
    assert.equal(report.formats.length, 16);
    assert.equal(report.summary.totalFormats, 16);
    assert.equal(report.summary.totalThemeVariants, 32);
    assert.equal(report.summary.validSvg, 32);
    assert.equal(report.summary.invalidSvg, 0);
    assert.equal(report.summary.completeFormats, 16);
    assert.equal(report.summary.incompleteFormats, 0);
    // each format should have 2 themes
    for (const format of report.formats) {
      assert.equal(format.themes.length, 2);
      assert.ok(format.themes.every((t) => t.theme === 'light' || t.theme === 'dark'));
      // all themes should pass with requireRendered: false
      assert.ok(format.themes.every((t) => t.passed === true), `${format.id} theme failed`);
    }
  });
});