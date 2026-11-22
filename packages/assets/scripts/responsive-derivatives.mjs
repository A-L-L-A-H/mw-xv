import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const RESPONSIVE_DERIVATIVE_PRESETS = Object.freeze({
  'hero-desktop': {
    variant: 'desktop',
    width: 1800,
    height: 900,
    format: 'webp',
    quality: 78,
    maxBytes: 400_000,
    allowAvif: false,
    focalPoint: { x: 0.72, y: 0.45 },
  },
  'hero-mobile': {
    variant: 'mobile',
    width: 920,
    height: 1150,
    format: 'webp',
    quality: 52,
    maxBytes: 220_000,
    allowAvif: false,
    focalPoint: { x: 0.5, y: 0.28 },
  },
  masthead: {
    variant: 'masthead',
    width: 1600,
    height: 440,
    format: 'webp',
    quality: 76,
    maxBytes: 200_000,
    allowAvif: false,
    focalPoint: { x: 0.75, y: 0.5 },
  },
  'auth-desktop': {
    variant: 'auth-login-desktop',
    width: 1200,
    height: 1200,
    format: 'webp',
    quality: 76,
    maxBytes: 350_000,
    allowAvif: false,
    focalPoint: { x: 0.68, y: 0.48 },
  },
  'auth-mobile': {
    variant: 'auth-login-mobile',
    width: 1000,
    height: 600,
    format: 'webp',
    quality: 72,
    maxBytes: 180_000,
    allowAvif: false,
    focalPoint: { x: 0.5, y: 0.45 },
  },
  'story-workbench-masthead': {
    variant: 'story-workbench-masthead',
    width: 1200,
    height: 600,
    format: 'webp',
    quality: 57,
    maxBytes: 200_000,
    allowAvif: false,
    focalPoint: { x: 0.76, y: 0.48 },
  },
  'card-preview': {
    variant: 'card-preview',
    width: 800,
    height: 450,
    format: 'webp',
    quality: 77,
    maxBytes: 100_000,
    allowAvif: false,
    focalPoint: { x: 0.5, y: 0.5 },
  },
});

const VARIANT_TO_PRESET = new Map([
  ['desktop', 'hero-desktop'],
  ['mobile', 'hero-mobile'],
  ['masthead', 'masthead'],
  ['auth-login-desktop', 'auth-desktop'],
  ['auth-login-mobile', 'auth-mobile'],
  ['story-workbench-masthead', 'story-workbench-masthead'],
  ['homepage-knowledge-card', 'card-preview'],
  ['homepage-people-card', 'card-preview'],
  ['homepage-stories-card', 'card-preview'],
  ['card-preview', 'card-preview'],
]);

function isValidFocalCoordinate(point) {
  if (typeof point === 'string') return point.trim().length > 0;
  return (
    point &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    point.x >= 0 &&
    point.x <= 1 &&
    Number.isFinite(point.y) &&
    point.y >= 0 &&
    point.y <= 1
  );
}

/** Ensures checked-in master assets (`kind === 'source'`) are never overwritten by derivative targets. */
export function verifyMasterImmutability(manifest) {
  const sourcePaths = new Set(
    (manifest.assets ?? []).filter((asset) => asset.kind === 'source').map((asset) => asset.path)
  );
  const artworkAssets = (manifest.assets ?? []).filter((asset) => asset.kind === 'artwork');
  for (const artwork of artworkAssets) {
    if (sourcePaths.has(artwork.path)) {
      throw new Error(`Derivative output ${artwork.path} collides with source master.`);
    }
    if (!artwork.source || !sourcePaths.has(artwork.source)) {
      throw new Error(`Artwork ${artwork.path} must reference an inventoried master source.`);
    }
  }
  return { sourceCount: sourcePaths.size, artworkCount: artworkAssets.length };
}

/** Plan and validate responsive artwork derivatives against preset dimensions and AVIF policy. */
export function planResponsiveDerivatives(manifest, presets = RESPONSIVE_DERIVATIVE_PRESETS) {
  verifyMasterImmutability(manifest);
  const plans = [];
  for (const asset of (manifest.assets ?? []).filter((entry) => entry.kind === 'artwork')) {
    const presetKey = VARIANT_TO_PRESET.get(asset.variant);
    const preset = presetKey ? presets[presetKey] : undefined;
    if (!preset) {
      throw new Error(`No responsive preset registered for artwork variant "${asset.variant}".`);
    }
    if (asset.format === 'avif' && !preset.allowAvif) {
      throw new Error(
        `Unconditional AVIF derivative ${asset.path} rejected without compatibility evidence.`
      );
    }
    if (asset.width !== preset.width || asset.height !== preset.height) {
      throw new Error(
        `Artwork ${asset.path} dimensions ${asset.width}x${asset.height} do not match preset ${presetKey} (${preset.width}x${preset.height}).`
      );
    }
    if (!isValidFocalCoordinate(preset.focalPoint)) {
      throw new Error(`Preset ${presetKey} has an invalid focal point.`);
    }
    plans.push({
      path: asset.path,
      source: asset.source,
      preset: presetKey,
      width: preset.width,
      height: preset.height,
      format: asset.format,
      quality: preset.quality,
      maxBytes: preset.maxBytes,
      focalPoint: preset.focalPoint,
    });
  }
  return plans;
}

export async function verifyResponsiveDerivatives(root = packageRoot) {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const plans = planResponsiveDerivatives(manifest);
  const measured = [];
  for (const plan of plans) {
    const info = await stat(resolve(root, plan.path));
    if (info.size > plan.maxBytes) {
      throw new Error(
        `Artwork ${plan.path} (${info.size} B) exceeds preset ${plan.preset} budget (${plan.maxBytes} B).`
      );
    }
    measured.push({ ...plan, bytes: info.size });
  }
  return measured;
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyResponsiveDerivatives();
  stdout.write(`${JSON.stringify({ ok: true, derivatives: report }, null, 2)}\n`);
}
