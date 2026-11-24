import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAssetQa } from '../../../packages/assets/scripts/asset-qa.mjs';
import { validateSceneBundle } from '../../../packages/assets/scripts/scene-schema.mjs';

const catalogRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsRoot = resolve(catalogRoot, '../../packages/assets');
const manifest = JSON.parse(await readFile(resolve(assetsRoot, 'manifest.json'), 'utf8'));
const assetQa = await runAssetQa(assetsRoot, { manifest });
const scenes = manifest.assets.filter((asset) => asset.kind === 'scene');
const sceneErrors = [];

for (const scene of scenes) {
  const scenePath = resolve(assetsRoot, scene.path);
  const descriptor = JSON.parse(await readFile(scenePath, 'utf8'));
  try {
    validateSceneBundle(descriptor, manifest, scene.path);
  } catch (error) {
    sceneErrors.push({
      path: scene.path,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  assetQa: {
    status: assetQa.ok ? 'passed' : 'failed',
    totalManifestAssets: assetQa.summary.totalManifestAssets,
    errorCount: assetQa.summary.errorCount,
    warningCount: assetQa.summary.warningCount,
    errors: assetQa.errors,
    warnings: assetQa.warnings,
  },
  sceneValidation: {
    status: sceneErrors.length === 0 ? 'passed' : 'failed',
    validSceneCount: scenes.length - sceneErrors.length,
    errorCount: sceneErrors.length,
    errors: sceneErrors,
  },
};

const outputPath = resolve(catalogRoot, 'generated/asset-diagnostics.json');
await mkdir(dirname(outputPath), { recursive: true });
const tempPath = `${outputPath}.tmp-${process.pid}`;
await writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`);
await rename(tempPath, outputPath);
if (!assetQa.ok || sceneErrors.length > 0) {
  process.stderr.write(`Asset diagnostics failed; report written to ${outputPath}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Validated ${assetQa.summary.totalManifestAssets} assets and ${scenes.length} scene bundle(s); report: ${outputPath}\n`
  );
}
