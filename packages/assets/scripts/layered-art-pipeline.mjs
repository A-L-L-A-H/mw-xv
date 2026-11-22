import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const LAYER_STACK_WIDTH = 2048;
export const LAYER_STACK_HEIGHT = 1152;

export const MOON_CITY_LAYERS = Object.freeze([
  {
    id: 'sky',
    path: 'source/artwork/moon-city-sky-layer.svg',
    format: 'svg',
    zIndex: 0,
    requiresAlpha: true,
    pivot: { x: 0.5, y: 0.5 },
    focalPoint: { x: 0.5, y: 0.35 },
  },
  {
    id: 'moon',
    path: 'source/artwork/moon-city-moon-layer.png',
    format: 'png',
    zIndex: 1,
    requiresAlpha: true,
    pivot: { x: 0.72, y: 0.28 },
    focalPoint: { x: 0.72, y: 0.28 },
  },
  {
    id: 'cloud',
    path: 'source/artwork/moon-city-cloud-layer.svg',
    format: 'svg',
    zIndex: 2,
    requiresAlpha: true,
    pivot: { x: 0.5, y: 0.42 },
    focalPoint: { x: 0.5, y: 0.42 },
  },
  {
    id: 'skyline',
    path: 'source/artwork/moon-city-skyline-layer.png',
    format: 'png',
    zIndex: 3,
    requiresAlpha: true,
    pivot: { x: 0.5, y: 0.78 },
    focalPoint: { x: 0.55, y: 0.7 },
  },
  {
    id: 'midground',
    path: 'source/artwork/moon-city-midground-layer-2.png',
    format: 'png',
    zIndex: 4,
    requiresAlpha: false,
    pivot: { x: 0.5, y: 0.8 },
    focalPoint: { x: 0.5, y: 0.75 },
  },
  {
    id: 'foreground',
    path: 'source/artwork/moon-city-foreground-layer.svg',
    format: 'svg',
    zIndex: 5,
    requiresAlpha: true,
    pivot: { x: 0.5, y: 0.9 },
    focalPoint: { x: 0.5, y: 0.85 },
  },
]);

function isNormalizedPoint(point) {
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

/** Validate separated runtime artwork layers preserve z-order, dimensions, alpha, and pivots. */
export async function validateLayeredArtStack(root = packageRoot, layers = MOON_CITY_LAYERS) {
  const seenPaths = new Set();
  let previousZ = -1;
  const inspected = [];

  for (const layer of layers) {
    if (!Number.isInteger(layer.zIndex) || layer.zIndex <= previousZ) {
      throw new Error(`Layer "${layer.id}" zIndex ${layer.zIndex} must strictly increase.`);
    }
    previousZ = layer.zIndex;

    if (seenPaths.has(layer.path)) {
      throw new Error(`Layer "${layer.id}" flattens or duplicates ${layer.path}.`);
    }
    seenPaths.add(layer.path);

    if (!isNormalizedPoint(layer.pivot) || !isNormalizedPoint(layer.focalPoint)) {
      throw new Error(`Layer "${layer.id}" has out-of-bounds pivot or focalPoint.`);
    }

    const fullPath = resolve(root, layer.path);
    if (layer.format === 'svg') {
      const svg = await readFile(fullPath, 'utf8');
      const expectedViewBox = `0 0 ${LAYER_STACK_WIDTH} ${LAYER_STACK_HEIGHT}`;
      const match = /viewBox=["']([^"']+)["']/u.exec(svg);
      if (!match || match[1] !== expectedViewBox) {
        throw new Error(
          `SVG layer ${layer.path} viewBox "${match?.[1] ?? 'missing'}" != "${expectedViewBox}".`
        );
      }
      inspected.push({
        id: layer.id,
        path: layer.path,
        format: layer.format,
        zIndex: layer.zIndex,
        width: LAYER_STACK_WIDTH,
        height: LAYER_STACK_HEIGHT,
        hasAlpha: true,
      });
    } else {
      const meta = await sharp(fullPath).metadata();
      if (meta.width !== LAYER_STACK_WIDTH || meta.height !== LAYER_STACK_HEIGHT) {
        throw new Error(
          `Raster layer ${layer.path} dimensions ${meta.width}x${meta.height} != ${LAYER_STACK_WIDTH}x${LAYER_STACK_HEIGHT}.`
        );
      }
      if (layer.requiresAlpha && !meta.hasAlpha) {
        throw new Error(`Transparent raster layer ${layer.path} lost its alpha channel.`);
      }
      inspected.push({
        id: layer.id,
        path: layer.path,
        format: layer.format,
        zIndex: layer.zIndex,
        width: meta.width,
        height: meta.height,
        hasAlpha: Boolean(meta.hasAlpha),
      });
    }
  }

  return {
    layerCount: inspected.length,
    width: LAYER_STACK_WIDTH,
    height: LAYER_STACK_HEIGHT,
    layers: inspected,
  };
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await validateLayeredArtStack();
  stdout.write(`${JSON.stringify({ ok: true, ...report }, null, 2)}\n`);
}
