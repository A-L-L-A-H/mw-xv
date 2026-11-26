import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  SOCIAL_FORMATS,
  SOCIAL_THEMES,
  listSocialFormats,
} from '../scripts/social-formats.config.mjs';
import {
  buildSafeAreaOverlaySvg,
  buildSocialFormatsContactSheetHtml,
  generateContactSheets,
  generateSocialFormatContactSheet,
} from '../scripts/generate-contact-sheets.mjs';

test('buildSafeAreaOverlaySvg renders dashed safe-area rectangle with mask strips for rectangular formats', () => {
  const banner = SOCIAL_FORMATS['youtube-banner'];
  const overlay = buildSafeAreaOverlaySvg(banner);

  assert.match(overlay, /^<svg /);
  assert.ok(overlay.endsWith('</svg>\n'));
  assert.ok(overlay.includes('viewBox="0 0 2560 1440"'));
  assert.ok(overlay.includes('data-safe-area-type="rect"'));
  assert.ok(overlay.includes('data-safe-area-format="youtube-banner"'));
  assert.ok(overlay.includes('stroke="#00b8f0"'));
  assert.ok(overlay.includes('stroke-dasharray="'));
  assert.ok(overlay.includes('SAFE 1546x423'));
  assert.ok(overlay.includes('fill-opacity="0.46"'));
  assert.ok(overlay.includes('monospace'));
  assert.ok(overlay.includes('aria-label'));
  assert.ok(overlay.includes('<title>'));

  const story = SOCIAL_FORMATS['instagram-story'];
  const storyOverlay = buildSafeAreaOverlaySvg('instagram-story');
  assert.ok(storyOverlay.includes('viewBox="0 0 1080 1920"'));
  assert.ok(storyOverlay.includes('data-safe-area-type="rect"'));
  assert.ok(storyOverlay.includes(`SAFE ${story.safeArea.width}x${story.safeArea.height}`));
});

test('buildSafeAreaOverlaySvg renders dashed circle with magenta crop guide and crosshair ticks for circular formats', () => {
  const spec = SOCIAL_FORMATS['youtube-profile'];
  assert.equal(spec.safeArea.type, 'circle');
  const overlay = buildSafeAreaOverlaySvg(spec);

  assert.ok(overlay.includes('viewBox="0 0 800 800"'));
  assert.ok(overlay.includes('data-safe-area-type="circle"'));
  assert.ok(overlay.includes('data-safe-area-format="youtube-profile"'));
  assert.ok(overlay.includes('stroke="#00b8f0"'));
  assert.ok(overlay.includes('stroke="#ff2e88"'));
  assert.ok(overlay.includes('<circle cx="400" cy="400" r="382" fill="none" stroke="#00b8f0"'));
  assert.ok(overlay.includes('SAFE'));
  assert.ok(overlay.includes('font-family'));

  assert.throws(
    () => buildSafeAreaOverlaySvg({ id: 'bogus', width: 'wide' }),
    /valid social format/i
  );
});

test('buildSocialFormatsContactSheetHtml renders all 16 formats with dimensions, safe-area text, and light/dark labels', () => {
  const entries = listSocialFormats().map((spec) => ({
    id: spec.id,
    format: spec,
    label: spec.label,
    platform: spec.platform,
    width: spec.width,
    height: spec.height,
    aspectRatio: spec.aspectRatio,
    safeArea: spec.safeArea,
  }));

  const html = buildSocialFormatsContactSheetHtml(entries);
  for (const spec of listSocialFormats()) {
    assert.ok(html.includes(`data-format-id="${spec.id}"`), `missing format card for ${spec.id}`);
    assert.ok(
      html.includes(`data-dimensions="${spec.width}x${spec.height}"`),
      `missing dimensions for ${spec.id}`
    );
    assert.ok(html.includes(`${spec.width}×${spec.height}`), `missing dimension text for ${spec.id}`);
    assert.ok(html.includes(`data-platform="${spec.platform}"`), `missing platform badge for ${spec.id}`);
  }

  assert.ok(html.includes('data-safe-spec='), 'missing safe area annotation');
  assert.ok(html.includes('SAFE') || html.includes('Full canvas'), 'missing safe area text');
  assert.ok(html.includes('data-theme="light"'), 'missing light theme slot');
  assert.ok(html.includes('data-theme="dark"'), 'missing dark theme slot');
  assert.ok(html.includes('LIGHT') && html.includes('DARK'), 'missing LIGHT/DARK labels');
  assert.ok(html.includes('safe-area-toggle'), 'missing overlay toggle');
  assert.ok(html.includes('safe-overlay'), 'missing overlay layer');
  assert.ok(html.includes('aspect-ratio:'), 'missing true aspect ratio frames');

  const lightOnly = buildSocialFormatsContactSheetHtml(entries, { themes: ['light'] });
  assert.ok(lightOnly.includes('data-theme="light"'));
  assert.ok(!lightOnly.includes('data-theme="dark"'));
});

test('generateSocialFormatContactSheet writes deterministic index without rendering PNGs into the repository', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'social-contact-sheets-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const outputDir = join(tempDir, 'social-formats');
  const { index, indexPath, sheetOutputs } = await generateSocialFormatContactSheet({
    outputDir,
    renderPng: false,
  });

  assert.equal(sheetOutputs.length, 0);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.totalFormats, listSocialFormats().length);
  assert.equal(index.formats.length, 16);
  assert.deepEqual([...index.themes].sort(), [...SOCIAL_THEMES].sort());
  assert.ok(Array.isArray(index.renderedSheets));
  assert.equal(index.renderedSheets.length, 0);
  assert.equal(index.contactSheetPng, null);
  assert.equal(index.sheets.overview, null);

  const ids = index.formats.map((format) => format.id);
  for (const spec of listSocialFormats()) {
    assert.ok(ids.includes(spec.id), `missing format ${spec.id}`);
  }
  for (const format of index.formats) {
    assert.ok(Number.isFinite(format.width) && Number.isFinite(format.height));
    assert.ok(format.safeArea);
    assert.ok(format.sources.light || format.sources.dark);
    assert.ok(format.sourceTypes.light || format.sourceTypes.dark);
  }

  const written = JSON.parse(await readFile(indexPath, 'utf8'));
  assert.deepEqual(written, index);

  const secondRun = await generateSocialFormatContactSheet({
    outputDir: join(tempDir, 'social-formats-again'),
    renderPng: false,
  });
  assert.deepEqual(secondRun.index, index);

  const packRun = await generateContactSheets({
    outputDir: join(tempDir, 'pack-sheets'),
    renderPng: false,
  });
  assert.ok(packRun.index.schemaVersion >= 1);
  assert.ok(packRun.index.totalGroups > 0);
  await rm(packRun.indexPath, { force: true });
});
