import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { validateSceneBundle } from '../scripts/scene-schema.mjs';
import { validateAssetManifest, validateSourceProvenance } from '../scripts/asset-schema.mjs';
import { validateSvg } from '../scripts/validate.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(packageRoot, 'manifest.json'), 'utf8'));
const licenses = JSON.parse(await readFile(resolve(packageRoot, 'licenses.json'), 'utf8'));
const byPath = new Map(manifest.assets.map((asset) => [asset.path, asset]));

const EXPRESSIONS = [
  'happy', 'excited', 'laughing', 'angry', 'confused', 'thinking', 'surprised', 'sad',
  'crying', 'sleepy', 'curious', 'celebrating', 'embarrassed', 'determined', 'victory', 'disappointed',
];
const POSES = [
  'standing', 'sitting', 'walking', 'running', 'jumping', 'waving',
  'pointing', 'reading', 'gaming', 'working', 'holding-objects', 'celebrating',
];
const STATES = [
  'empty-dashboard', 'no-search-results', 'no-notifications', 'empty-collection',
  'no-favorites', 'no-messages', 'no-activity', 'first-time',
  'loading', 'success', 'error', 'offline', 'network-disconnected',
  'maintenance', 'access-denied', 'not-found', 'unexpected-failure',
  'welcome', 'onboarding', 'discover', 'explore', 'profile', 'achievement', 'completion', 'celebration',
];
const BACKGROUNDS = [
  'riot-street-alley', 'riot-arcade-workbench', 'halftone-paper-light', 'halftone-ink-dark',
];
const STICKERS = [
  'speech-bubble-shout', 'speech-bubble-thought', 'comic-boom', 'lightning-bolt',
  'riot-star', 'street-flame', 'pixel-heart', 'hand-arrow',
  'paint-splash', 'motion-burst', 'torn-tape-x', 'graffiti-crown',
];
const GAME_ASSETS = [
  'avatar-kuro', 'avatar-vesper', 'avatar-frame-riot',
  'badge-signal-scout', 'badge-archive-keeper', 'badge-story-architect', 'badge-zero-drift',
  'rank-rookie', 'rank-vanguard', 'rank-legend',
  'quest-banner', 'reward-crate', 'level-up-burst',
];
const CLIPS = ['idle', 'blink', 'wave', 'celebrate', 'think', 'loading', 'success', 'error'];

async function assertAlphaCutout(relPath, expectedWidth, expectedHeight) {
  const fullPath = resolve(packageRoot, relPath);
  const { data, info } = await sharp(fullPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, expectedWidth, `${relPath} width`);
  assert.equal(info.height, expectedHeight, `${relPath} height`);
  const corners = [
    0,
    (info.width - 1) * 4,
    ((info.height - 1) * info.width) * 4,
    ((info.height - 1) * info.width + (info.width - 1)) * 4,
  ];
  for (const offset of corners) {
    assert.equal(data[offset + 3], 0, `${relPath} corner alpha must be 0`);
  }
  const cx = Math.floor(info.width / 2);
  const cy = Math.floor(info.height / 2);
  const centerOffset = (cy * info.width + cx) * 4;
  assert.equal(data[centerOffset + 3], 255, `${relPath} center interior pixel must stay opaque (255)`);
}

test('riot-universe manifest and source provenance validate cleanly', () => {
  validateAssetManifest(manifest);
  validateSourceProvenance(manifest, licenses);
  const riotSources = manifest.assets.filter((a) => a.kind === 'source' && a.pack === 'riot-universe');
  assert.equal(riotSources.length, 14, '12 direct AI masters + 2 procedural halftone masters tracked');
  for (const src of riotSources) {
    const prov = licenses.sourceAssets.find((p) => p.path === src.path);
    assert.ok(prov, `missing source provenance for ${src.path}`);
    assert.equal(prov.status, 'approved');
    assert.equal(prov.termsVerified, true);
  }
});

test('all 16 Kuro expressions, 12 poses, and Vesper portrait exist with flood-fill transparent alpha', async () => {
  for (const expr of EXPRESSIONS) {
    for (const ext of ['png', 'webp']) {
      const rel = `illustrations/riot-universe/characters/kuro-signal-expression-${expr}.${ext}`;
      assert.ok(byPath.has(rel), `${rel} registered`);
      await assertAlphaCutout(rel, 512, 512);
    }
  }
  for (const pose of POSES) {
    for (const ext of ['png', 'webp']) {
      const rel = `illustrations/riot-universe/characters/kuro-signal-pose-${pose}.${ext}`;
      assert.ok(byPath.has(rel), `${rel} registered`);
      await assertAlphaCutout(rel, 512, 768);
    }
  }
  for (const ext of ['png', 'webp']) {
    const rel = `illustrations/riot-universe/characters/vesper-ink-portrait.${ext}`;
    assert.ok(byPath.has(rel), `${rel} registered`);
    await assertAlphaCutout(rel, 512, 512);
  }
});

test('all 25 UI states, 4 backgrounds, 12 stickers, and 13 game badges exist and validate', async () => {
  for (const slug of STATES) {
    const rel = `illustrations/riot-universe/states/state-${slug}.webp`;
    assert.ok(byPath.has(rel), `${rel} registered`);
    const meta = await sharp(resolve(packageRoot, rel)).metadata();
    assert.equal(meta.width, 640);
    assert.equal(meta.height, 480);
  }
  for (const slug of BACKGROUNDS) {
    const rel = `illustrations/riot-universe/backgrounds/bg-${slug}.webp`;
    assert.ok(byPath.has(rel), `${rel} registered`);
    const meta = await sharp(resolve(packageRoot, rel)).metadata();
    assert.equal(meta.width, 1376);
    assert.equal(meta.height, 768);
  }
  for (const slug of STICKERS) {
    const svgRel = `illustrations/riot-universe/stickers/sticker-${slug}.svg`;
    const pngRel = `illustrations/riot-universe/stickers/sticker-${slug}.png`;
    assert.ok(byPath.has(svgRel) && byPath.has(pngRel), `${slug} sticker pair registered`);
    validateSvg(await readFile(resolve(packageRoot, svgRel), 'utf8'), svgRel);
    await assertAlphaCutout(pngRel, 256, 256);
  }
  for (const slug of GAME_ASSETS) {
    const svgRel = `illustrations/riot-universe/game/${slug}.svg`;
    const pngRel = `illustrations/riot-universe/game/${slug}.png`;
    assert.ok(byPath.has(svgRel) && byPath.has(pngRel), `${slug} game asset pair registered`);
    validateSvg(await readFile(resolve(packageRoot, svgRel), 'utf8'), svgRel);
    const info = await stat(resolve(packageRoot, pngRel));
    assert.ok(info.size > 0);
  }
});

test('all 8 Kuro animation clips include 4 transparent frames, 1024x1024 atlas, and valid spriteSheet metadata', async () => {
  for (const clipId of CLIPS) {
    const base = `animation/kuro-signal-${clipId}/kuro-signal-${clipId}`;
    const clipEntry = byPath.get(`${base}-clip.json`);
    assert.ok(clipEntry?.spriteSheet, `${base}-clip.json has spriteSheet metadata`);
    assert.equal(clipEntry.spriteSheet.atlas, `${base}-sheet.png`);
    const sheetMeta = await sharp(resolve(packageRoot, `${base}-sheet.png`)).metadata();
    assert.equal(sheetMeta.width, 1024);
    assert.equal(sheetMeta.height, 1024);
    assert.equal(sheetMeta.hasAlpha, true);
    for (let n = 1; n <= 4; n += 1) {
      await assertAlphaCutout(`${base}-frame-0${n}.png`, 512, 512);
    }
  }
});

test('5-layer riot-alley-scene.json and SVG layers validate against scene-schema', async () => {
  for (const layer of ['bg', 'mid', 'fg', 'decor']) {
    const svgRel = `environments/riot-alley-${layer}.svg`;
    assert.ok(byPath.has(svgRel), `${svgRel} registered`);
    validateSvg(await readFile(resolve(packageRoot, svgRel), 'utf8'), svgRel);
  }
  const bundle = JSON.parse(await readFile(resolve(packageRoot, 'scenes/riot-alley-scene.json'), 'utf8'));
  const result = validateSceneBundle(bundle, manifest, 'packages/assets/scenes/riot-alley-scene.json');
  assert.equal(result.sceneCount, 1);
  assert.equal(result.clipCount, 2);
  assert.equal(bundle.scenes[0].layers.length, 5);
});
