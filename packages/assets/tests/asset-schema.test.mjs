import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderSpriteSheetGuide,
  validateAssetManifest,
  validateSourceProvenance,
} from '../scripts/asset-schema.mjs';

const baseManifest = () => ({
  schemaVersion: 1,
  assets: [
    { path: 'source/moon.png', kind: 'source', format: 'png', width: 1440, height: 720 },
    {
      path: 'illustrations/moon.webp',
      kind: 'artwork',
      format: 'webp',
      sourceAsset: 'source/moon.png',
      variants: ['illustrations/moon-mobile.webp'],
      pack: 'moon-city',
      domain: 'homepage',
      status: 'review',
      focalPoint: { x: 0.78, y: 0.24 },
    },
    { path: 'illustrations/moon-mobile.webp', kind: 'artwork', format: 'webp' },
  ],
});

test('accepts legacy entries and backward-compatible source/generated extensions', () => {
  const manifest = baseManifest();
  assert.deepEqual(validateAssetManifest(manifest), { assetCount: 3 });
  assert.deepEqual(
    validateAssetManifest({ schemaVersion: 1, assets: [{ path: 'icons/legacy.svg' }] }),
    { assetCount: 1 }
  );
});

test('rejects duplicate stable IDs and duplicate manifest paths with field context', () => {
  const duplicatePath = { schemaVersion: 1, assets: [{ path: 'a.svg' }, { path: 'a.svg' }] };
  assert.throws(() => validateAssetManifest(duplicatePath, 'fixtures/duplicate.json'), /fixtures\/duplicate\.json: assets\[1\]\.path duplicates 0/u);

  const duplicateId = { schemaVersion: 1, assets: [{ id: 'same', path: 'a.svg' }, { id: 'same', path: 'b.svg' }] };
  assert.throws(() => validateAssetManifest(duplicateId), /assets\[1\]\.id duplicates a\.svg/u);
});

test('rejects malformed variants and unresolved source or variant references', () => {
  const malformed = { schemaVersion: 1, assets: [{ path: 'a.svg', variants: 'b.svg' }] };
  assert.throws(() => validateAssetManifest(malformed), /assets\[0\]\.variants must be an array/u);

  const missing = { schemaVersion: 1, assets: [{ path: 'a.svg', sourceAsset: 'missing.png' }] };
  assert.throws(() => validateAssetManifest(missing), /assets\[0\]\.sourceAsset references missing asset path missing\.png/u);

  const missingVariant = { schemaVersion: 1, assets: [{ path: 'a.svg', variants: ['missing.svg'] }] };
  assert.throws(() => validateAssetManifest(missingVariant), /assets\[0\]\.variants\[0\] references missing asset path missing\.svg/u);
});

test('rejects invalid extension tags, status, dimensions, and normalized points', () => {
  for (const [field, value, pattern] of [
    ['pack', 'Moon City', /pack must be a lowercase hyphenated identifier/u],
    ['status', 'published', /status must be draft, review, approved, or blocked/u],
    ['width', 0, /width must be a positive integer/u],
    ['pivot', { x: 0.5, y: 2 }, /pivot\.y must be between 0 and 1/u],
  ]) {
    const manifest = { schemaVersion: 1, assets: [{ path: 'a.svg', [field]: value }] };
    assert.throws(() => validateAssetManifest(manifest), pattern);
  }
});

test('source provenance records block unverified rights and cover each tagged source', () => {
  const manifest = {
    schemaVersion: 1,
    assets: [{ path: 'source/moon.png', kind: 'source', pack: 'moon-city' }],
  };
  const blocked = {
    sourceAssets: [{
      path: 'source/moon.png', creator: 'Image tool', source: 'Local image generation',
      license: 'unverified', modifications: 'Original output', status: 'blocked',
      distribution: 'blocked pending terms review',
    }],
  };
  assert.deepEqual(validateSourceProvenance(manifest, blocked), { sourceAssetCount: 1 });
  assert.throws(
    () => validateSourceProvenance(manifest, { sourceAssets: [{ ...blocked.sourceAssets[0], status: 'approved' }] }),
    /unverified rights must be blocked from distribution/u
  );
  assert.throws(
    () => validateSourceProvenance(manifest, { sourceAssets: [] }),
    /is missing provenance for source\/moon\.png/u
  );
});

test('sprite metadata validates atlas bounds and renders a metadata-only frame guide', () => {
  const manifest = {
    schemaVersion: 1,
    assets: [
      { path: 'source/approved-atlas.png', kind: 'source', width: 256, height: 128 },
      {
        path: 'animation/idle.json',
        spriteSheet: {
          atlas: 'source/approved-atlas.png', frameWidth: 64, frameHeight: 64,
          frameCount: 3, frameDurationMs: 120, columns: 4, rows: 2,
          loop: true, direction: 'forward', pivot: { x: 0.5, y: 0.92 },
        },
      },
    ],
  };
  assert.equal(validateAssetManifest(manifest).assetCount, 2);
  const guide = renderSpriteSheetGuide(manifest.assets[1], { label: 'idle <review>' });
  assert.match(guide, /viewBox="0 0 256 128"/u);
  assert.match(guide, /idle &lt;review&gt;/u);
  assert.equal((guide.match(/<rect x=/gu) ?? []).length, 3);

  const outOfBounds = structuredClone(manifest);
  outOfBounds.assets[1].spriteSheet.columns = 5;
  assert.throws(() => validateAssetManifest(outOfBounds), /columns exceeds atlas width/u);
  const missingAtlas = structuredClone(manifest);
  missingAtlas.assets[1].spriteSheet.atlas = 'missing.png';
  assert.throws(() => validateAssetManifest(missingAtlas), /references missing asset path missing\.png/u);
});
