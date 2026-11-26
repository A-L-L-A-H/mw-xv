import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { compareAssetInventory, listInventoryMedia } from './asset-inventory.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const RUNTIME_BUDGET_BYTES = {
  icon: 12 * 1024,
  material: 40 * 1024,
  illustration: 48 * 1024,
  pattern: 48 * 1024,
  artwork: 375 * 1024,
  sound: 25 * 1024,
  animation: 40 * 1024,
  'animation-frame': 96 * 1024,
  'animation-sheet': 280 * 1024,
  'animation-clip': 24 * 1024,
  'character-sprite': 160 * 1024,
  'state-illustration': 160 * 1024,
  background: 220 * 1024,
  sticker: 64 * 1024,
  'game-asset': 120 * 1024,
  environment: 64 * 1024,
  scene: 48 * 1024,
  brand: 96 * 1024,
  symbol: 48 * 1024,
  wordmark: 96 * 1024,
  lockup: 96 * 1024,
  favicon: 24 * 1024,
  'readme-banner': 120 * 1024,
  'social-card': 450 * 1024,
  'app-icon': 80 * 1024,
  font: 150 * 1024,
};

export const SPECIFIC_PATH_BUDGETS = {
  'illustrations/home-hero-mobile.webp': 220 * 1024,
  'illustrations/story-workbench-masthead.webp': 180 * 1024,
};

export const DOCUMENTED_DUPLICATE_EXCEPTIONS = new Map([
  [
    'brand/moonwitness-symbol-dark.svg',
    'Symmetric theme export: crown symbol uses identical #FFE031 fill on light and dark surfaces.',
  ],
  [
    'brand/moonwitness-symbol-light.svg',
    'Symmetric theme export: crown symbol uses identical #FFE031 fill on light and dark surfaces.',
  ],
  [
    'brand/moonwitness-wordmark-light.svg',
    'Symmetric variant export: light wordmark is pure ink #0D0D0D, matching mono-light.',
  ],
  [
    'brand/moonwitness-wordmark-mono-light.svg',
    'Symmetric variant export: mono-light matches pure ink light wordmark.',
  ],
]);

const EXPECTED_DIR_BY_KIND = {
  icon: ['icons/'],
  material: ['materials/'],
  sound: ['sounds/'],
  font: ['fonts/'],
  artwork: ['illustrations/'],
  illustration: ['illustrations/'],
  pattern: ['illustrations/', 'materials/'],
  'app-icon': ['brand/'],
  'social-card': ['brand/'],
  'readme-banner': ['brand/'],
  favicon: ['brand/'],
  symbol: ['brand/'],
  wordmark: ['brand/'],
  lockup: ['brand/'],
  environment: ['environments/'],
  scene: ['scenes/'],
  'character-sprite': ['illustrations/'],
  'state-illustration': ['illustrations/'],
  background: ['illustrations/'],
  sticker: ['illustrations/'],
  'game-asset': ['illustrations/'],
  'animation-frame': ['animation/'],
  'animation-sheet': ['animation/'],
  'animation-clip': ['animation/'],
};

const INVENTORY_DIRECTORIES = [
  'brand',
  'fonts',
  'icons',
  'illustrations',
  'materials',
  'sounds',
  'source',
  'animation',
  'environments',
  'scenes',
];

const INVENTORY_EXCLUDE_DIRS = [];

export async function runAssetQa(rootDir = packageRoot, options = {}) {
  const manifest =
    options.manifest ?? JSON.parse(await readFile(resolve(rootDir, 'manifest.json'), 'utf8'));
  const existingDirs = INVENTORY_DIRECTORIES.filter((dir) => existsSync(resolve(rootDir, dir)));
  const allTrackedFiles = options.trackedFiles ?? (await listInventoryMedia(rootDir, existingDirs));
  const trackedFiles = allTrackedFiles.filter((f) => !INVENTORY_EXCLUDE_DIRS.some((excl) => f.startsWith(excl + '/')));
  const inventoryDiff = compareAssetInventory(
    manifest.assets.map((asset) => asset.path),
    trackedFiles
  );

  const errors = [];
  const warnings = [];
  const sourceMasters = [];
  const runtimeSizes = [];
  const hashesByDigest = new Map();
  const manifestPaths = new Set(manifest.assets.map((asset) => asset.path));

  for (const unlisted of inventoryDiff.unlistedFiles) {
    errors.push({
      code: 'orphan_file',
      path: unlisted,
      message: `Unlisted media file outside manifest: ${unlisted}`,
    });
  }
  for (const missing of inventoryDiff.missingFiles) {
    errors.push({
      code: 'missing_file',
      path: missing,
      message: `Manifest entry missing on disk: ${missing}`,
    });
  }

  for (const asset of manifest.assets) {
    const isSourcePath = asset.path.startsWith('source/') || asset.path.startsWith('brand/source/');
    const isAnimationPath = asset.path.startsWith('animation/');
    const isSourceKind = asset.kind === 'source';
    if (isSourcePath && !isSourceKind) {
      errors.push({
        code: 'wrong_folder_ownership',
        path: asset.path,
        message: `Runtime asset kind '${asset.kind}' must not live in source directory: ${asset.path}`,
      });
    }
    if (!isSourcePath && !isAnimationPath && isSourceKind) {
      errors.push({
        code: 'wrong_folder_ownership',
        path: asset.path,
        message: `Source asset must live under source/ or brand/source/: ${asset.path}`,
      });
    }

    const allowedPrefixes = EXPECTED_DIR_BY_KIND[asset.kind];
    if (allowedPrefixes && !allowedPrefixes.some((prefix) => asset.path.startsWith(prefix))) {
      errors.push({
        code: 'wrong_folder_ownership',
        path: asset.path,
        message: `Asset kind '${asset.kind}' expected under ${allowedPrefixes.join(' or ')}, got ${asset.path}`,
      });
    }

    const looksLikePackageFileRef =
      typeof asset.source === 'string' &&
      /^[a-z0-9_-]+\/[^\s]+\.[a-z0-9]+$/iu.test(asset.source) &&
      !asset.source.startsWith('scripts/') &&
      !asset.source.startsWith('packages/');
    if (looksLikePackageFileRef && !manifestPaths.has(asset.source)) {
      errors.push({
        code: 'broken_source_reference',
        path: asset.path,
        message: `Source reference '${asset.source}' does not resolve to a canonical manifest entry`,
      });
    }

    const fullPath = resolve(rootDir, asset.path);

    let bytes;
    try {
      bytes = await readFile(fullPath);
    } catch {
      continue;
    }
    const fileBytes = bytes.length;

    if (isSourceKind || isSourcePath) {
      if (isSourcePath) {
        sourceMasters.push({
          path: asset.path,
          format: asset.format,
          bytes: fileBytes,
        });
        if (fileBytes > 10 * 1024 * 1024) {
          warnings.push({
            code: 'large_source_master',
            path: asset.path,
            bytes: fileBytes,
            message: `Source master exceeds 10 MB repository tracking review threshold (${fileBytes} bytes)`,
          });
        }
        continue;
      }
    }

    const digest = createHash('sha256').update(bytes).digest('hex');
    const bucket = hashesByDigest.get(digest) ?? [];
    bucket.push(asset.path);
    hashesByDigest.set(digest, bucket);

    const effectiveKind =
      isAnimationPath &&
      !['animation-frame', 'animation-sheet', 'animation-clip'].includes(asset.kind)
        ? 'animation'
        : asset.kind;
    const budget =
      SPECIFIC_PATH_BUDGETS[asset.path] ?? RUNTIME_BUDGET_BYTES[effectiveKind] ?? 250 * 1024;
    runtimeSizes.push({ path: asset.path, kind: asset.kind, bytes: fileBytes, budget });
    if (fileBytes > budget) {
      errors.push({
        code: 'oversized_runtime_asset',
        path: asset.path,
        bytes: fileBytes,
        budget,
        message: `Runtime asset ${asset.path} (${fileBytes} bytes) exceeds budget (${budget} bytes)`,
      });
    }
  }

  const duplicates = [];
  for (const [digest, paths] of hashesByDigest.entries()) {
    if (paths.length <= 1) continue;
    const unexempt = paths.filter((entry) => !DOCUMENTED_DUPLICATE_EXCEPTIONS.has(entry));
    if (unexempt.length > 1) {
      duplicates.push({ sha256: digest, paths: unexempt });
      errors.push({
        code: 'duplicate_runtime_asset',
        paths: unexempt,
        message: `Duplicate runtime asset content detected: ${unexempt.join(', ')}`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    summary: {
      totalManifestAssets: manifest.assets.length,
      runtimeAssetsChecked: runtimeSizes.length,
      sourceMastersTracked: sourceMasters.length,
      sourceMasterTotalBytes: sourceMasters.reduce((sum, entry) => sum + entry.bytes, 0),
      runtimeTotalBytes: runtimeSizes.reduce((sum, entry) => sum + entry.bytes, 0),
      duplicateGroups: duplicates.length,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
    errors,
    warnings,
    sourceMasters: sourceMasters.sort((left, right) => right.bytes - left.bytes),
  };
}

if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runAssetQa(packageRoot);
  if (argv.includes('--json')) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    stdout.write(
      `Asset QA: ${report.summary.runtimeAssetsChecked} runtime assets (${Math.round(report.summary.runtimeTotalBytes / 1024)} KB), ` +
        `${report.summary.sourceMastersTracked} source masters (${Math.round(report.summary.sourceMasterTotalBytes / 1024)} KB), ` +
        `${report.summary.errorCount} error(s), ${report.summary.warningCount} warning(s).\n`
    );
  }
  if (!report.ok) {
    for (const error of report.errors) {
      stdout.write(`ERROR [${error.code}]: ${error.message}\n`);
    }
    process.exitCode = 1;
  }
}
