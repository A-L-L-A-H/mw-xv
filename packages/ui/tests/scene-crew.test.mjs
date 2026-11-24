import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const assetsRoot = resolve(repositoryRoot, 'packages/assets');

// Canonical asset paths in the bundles are relative to the assets package root.
function resolveAsset(asset) {
  return resolve(repositoryRoot, 'packages/assets', asset);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), 'utf8'));
}

// Accessibility labels are frame metadata, not artwork; strip them so the
// comparison covers the drawing itself and catches reused poses.
function readArtworkBody(asset) {
  const svgPath = resolveAsset(asset);
  assert.ok(existsSync(svgPath), `missing crew-01 frame asset: ${asset}`);
  return readFileSync(svgPath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => !line.includes('<title') && !line.includes('aria-label'))
    .join('\n')
    .replace(/\s+/gu, ' ')
    .trim();
}

test('canonical Moon City scene declares a four-frame crew-01-idle clip with existing SVG assets', () => {
  const sceneBundle = readJson('packages/assets/scenes/moon-city-scene.json');
  const clip = sceneBundle.clips.find((entry) => entry.id === 'crew-01-idle');

  assert.ok(clip, 'canonical scene manifest must declare the crew-01-idle clip');
  assert.equal(clip.frames.length, 4);

  for (const frame of clip.frames) {
    assert.match(frame.asset, /\.svg$/u, `crew-01-idle frame must be an SVG: ${frame.asset}`);
    const assetPath = resolveAsset(frame.asset);
    assert.ok(existsSync(assetPath), `missing crew-01-idle frame asset: ${frame.asset}`);
    const svg = readFileSync(assetPath, 'utf8');
    assert.match(svg, /<svg[\s>]/u, `crew-01-idle frame is not an SVG: ${frame.asset}`);
    assert.ok(
      Number.isFinite(frame.durationMs) && frame.durationMs > 0,
      `crew-01-idle frame duration must be positive: ${frame.asset}`
    );
  }

  assert.equal(
    new Set(clip.frames.map((frame) => frame.asset)).size,
    4,
    'crew-01-idle must reference four distinct frame assets'
  );
});

test('every crew-01 animation clip declares four distinct frames with existing SVG assets', () => {
  const clipFiles = [];

  function collectClipFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        collectClipFiles(absolutePath);
      } else if (entry.name.startsWith('crew-01-') && entry.name.includes('clip')) {
        clipFiles.push(absolutePath);
      }
    }
  }

  collectClipFiles(join(assetsRoot, 'animation'));
  assert.ok(clipFiles.length > 0, 'expected canonical crew-01 clip definitions');

  for (const clipFile of clipFiles) {
    assert.match(clipFile, /\.json$/u, `clip definition must be a .json file: ${clipFile}`);

    const clipBundle = JSON.parse(readFileSync(clipFile, 'utf8'));
    const clip = clipBundle.clip ?? clipBundle;
    assert.equal(clip.frames.length, 4, `${clipFile} must declare exactly four frames`);

    const artworkBodies = new Set();
    for (const frame of clip.frames) {
      assert.match(frame.asset, /\.svg$/u, `${clipFile} frame must be an SVG: ${frame.asset}`);
      const body = readArtworkBody(frame.asset);
      assert.ok(body.length > 0, `${clipFile} frame artwork is empty: ${frame.asset}`);
      assert.ok(
        !artworkBodies.has(body),
        `${clipFile} reuses an artwork body (pose) across frames: ${frame.asset}`
      );
      artworkBodies.add(body);
    }
    assert.equal(artworkBodies.size, 4, `${clipFile} must contain four unique frame drawings`);
  }
});
