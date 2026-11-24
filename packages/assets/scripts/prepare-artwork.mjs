import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { replaceGeneratedAssets } from './manifest-ownership.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = [
  {
    source: 'source/artwork/home-hero-master.png',
    path: 'illustrations/home-hero-desktop.webp',
    variant: 'desktop',
    width: 1800,
    height: 900,
    quality: 78,
    focalPoint:
      'center-right (character foreground & moon on right; negative space on left for copy)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/home-hero-master.png',
    path: 'illustrations/home-hero-mobile.webp',
    variant: 'mobile',
    width: 920,
    height: 1150,
    quality: 52,
    focalPoint: 'center-top (character face & moon centered above mobile copy)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/board-masthead-master.png',
    path: 'illustrations/board-masthead.webp',
    variant: 'masthead',
    width: 1600,
    height: 440,
    quality: 76,
    focalPoint: 'right (city skyline & night mood behind left masthead heading)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/story-workbench-masthead-master.png',
    path: 'illustrations/story-workbench-masthead.webp',
    variant: 'story-workbench-masthead',
    width: 1200,
    height: 600,
    quality: 57,
    focalPoint: 'right (character & moon kept clear of left copy rail)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/home-editorial-triptych-master.png',
    extract: { left: 0, top: 390, width: 500, height: 281 },
    path: 'illustrations/editorial-people.webp',
    variant: 'homepage-people-card',
    width: 800,
    height: 450,
    quality: 77,
    focalPoint: 'center (red corridor scene for People & Records editorial panel)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/home-editorial-triptych-master.png',
    extract: { left: 515, top: 275, width: 500, height: 281 },
    path: 'illustrations/editorial-knowledge.webp',
    variant: 'homepage-knowledge-card',
    width: 800,
    height: 450,
    quality: 77,
    focalPoint: 'center (cyan rooftop scene for Knowledge editorial panel)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/home-editorial-triptych-master.png',
    extract: { left: 1035, top: 390, width: 500, height: 281 },
    path: 'illustrations/editorial-stories.webp',
    variant: 'homepage-stories-card',
    width: 800,
    height: 450,
    quality: 77,
    focalPoint: 'center (monochrome shadow figure for Story Workbench editorial panel)',
    alt: '',
    decorative: true,
  },
];
generated.push(
  {
    source: 'source/artwork/auth-login-shadow-master.png',
    extract: { left: 512, top: 0, width: 1024, height: 1024 },
    path: 'illustrations/auth-login-desktop.webp',
    variant: 'auth-login-desktop',
    width: 1200,
    height: 1200,
    quality: 76,
    focalPoint: 'center-right (hooded figure & moon clear of left auth form)',
    alt: 'A hooded person looking over a neon city beneath a full moon.',
    decorative: false,
  },
  {
    source: 'source/artwork/auth-login-shadow-master.png',
    extract: { left: 536, top: 0, width: 1000, height: 600 },
    path: 'illustrations/auth-login-mobile.webp',
    variant: 'auth-login-mobile',
    width: 1000,
    height: 600,
    quality: 72,
    focalPoint: 'center (hooded figure & moon above mobile login panel)',
    alt: 'A hooded person looking over a neon city beneath a full moon.',
    decorative: false,
  }
);
/* Additional editorial variants. These reuse distinct MoonWitness master
   illustrations so the homepage filmstrip and orbit band do not repeat the
   hero and the three feature cards verbatim. */
generated.push(
  {
    source: 'source/artwork/editorial-signal-source.png',
    path: 'illustrations/editorial-signal.webp',
    variant: 'homepage-signal-card',
    width: 800,
    height: 450,
    quality: 76,
    focalPoint: 'center (two crew workers beneath the blue moon for the Connect step)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/editorial-archive-source.png',
    extract: { left: 520, top: 0, width: 980, height: 551 },
    path: 'illustrations/editorial-archive.webp',
    variant: 'homepage-archive-card',
    width: 800,
    height: 450,
    quality: 76,
    focalPoint: 'right (hooded archivist and moon kept clear of the left copy rail)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/editorial-rain-source.png',
    path: 'illustrations/editorial-rain.webp',
    variant: 'homepage-rain-card',
    width: 800,
    height: 450,
    quality: 72,
    focalPoint: 'center (rooftop antenna array beneath the moon for the Shape step)',
    alt: '',
    decorative: true,
  },
  {
    source: 'source/artwork/moon-city-orbit-source.png',
    path: 'illustrations/moon-city-orbit.webp',
    variant: 'homepage-orbit-band',
    width: 1600,
    height: 900,
    quality: 74,
    focalPoint: 'center (three crew seen from behind under the moon for the orbit band)',
    alt: '',
    decorative: true,
  }
);
const assets = [];

async function atomicWrite(filePath, content) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content);
  await rename(temporaryPath, filePath);
}

for (const item of generated) {
  const outputPath = resolve(packageRoot, item.path);
  await mkdir(dirname(outputPath), { recursive: true });
  let image = sharp(resolve(packageRoot, item.source));
  if (item.extract) image = image.extract(item.extract);
  await image
    .resize(item.width, item.height, {
      fit: 'cover',
      position: sharp.strategy.attention,
      withoutEnlargement: false,
    })
    .webp({ quality: item.quality, effort: 6, smartSubsample: true })
    .toFile(outputPath);
  assets.push({
    path: item.path,
    source: item.source,
    kind: 'artwork',
    variant: item.variant,
    format: 'webp',
    width: item.width,
    height: item.height,
    license: 'OpenAI Terms of Use (Output owned by user, subject to applicable law)',
  });
}

const sourceAssets = [];
for (const sourcePath of new Set(generated.map(({ source }) => source))) {
  const sourceFile = resolve(packageRoot, sourcePath);
  const metadata = await sharp(sourceFile).metadata();
  sourceAssets.push({
    path: sourcePath,
    kind: 'source',
    variant: 'original-ai-artwork',
    format: 'png',
    width: metadata.width,
    height: metadata.height,
    license: 'OpenAI Terms of Use (Output owned by user, subject to applicable law)',
  });
}

const manifestPath = resolve(packageRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const ownedPaths = new Set([
  ...generated.map(({ path }) => path),
  ...sourceAssets.map(({ path }) => path),
]);
manifest.assets = replaceGeneratedAssets(manifest.assets, [...assets, ...sourceAssets], ownedPaths);
await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const licensesPath = resolve(packageRoot, 'licenses.json');
const licenses = JSON.parse(await readFile(licensesPath, 'utf8'));
const DERIVED_ILLUSTRATIONS = new Set([
  'illustrations/editorial-signal.webp',
  'illustrations/editorial-archive.webp',
  'illustrations/editorial-rain.webp',
  'illustrations/moon-city-orbit.webp',
]);
const artworkProvenance = generated.map(({ path, source, focalPoint, alt, decorative }) => {
  if (DERIVED_ILLUSTRATIONS.has(path)) {
    return {
      path,
      sourceFile: source,
      creator: 'MoonWitness contributors',
      source: 'Derivative of existing raw_arts/art illustration in this repository',
      terms:
        'Repository-local derivative; rights inherit from the original raw_arts master (distribution review required).',
      generatedOn: '2026-11-24',
      focalPoint,
      alt,
      decorative,
      notes:
        'Cropped, resized and re-encoded from an existing MoonWitness raw artwork master to add a distinct editorial variant. No new external image generation was used.',
    };
  }
  return {
    path,
    sourceFile: source,
    creator: 'OpenAI image generation, commissioned by MoonWitness contributors',
    source: 'Codex image_gen using the user-provided MoonWitness visual references',
    terms: 'https://openai.com/policies/terms-of-use/',
    generatedOn: path.includes('auth-login-') ? '2026-10-24' : '2026-10-23',
    focalPoint,
    alt,
    decorative,
    notes:
      'Original illustration generated without embedded typography or UI. The user-provided reference was used for art direction; no screenshot was used as artwork.',
  };
});
licenses.artwork = [
  ...(licenses.artwork ?? []).filter(({ path }) => !ownedPaths.has(path)),
  ...artworkProvenance,
].sort((left, right) => left.path.localeCompare(right.path));
await atomicWrite(licensesPath, `${JSON.stringify(licenses, null, 2)}\n`);

for (const item of generated) {
  const stats = await stat(resolve(packageRoot, item.path));
  stdout.write(`${item.path}: ${item.width}x${item.height}, ${Math.round(stats.size / 1024)} KB\n`);
}
