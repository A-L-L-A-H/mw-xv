import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'packages/assets');
const target = path.join(root, 'apps/board/public');
const publicAssetDirectories = [
  'brand',
  'illustrations',
  'materials',
  'sounds',
  'animation',
  'environments',
  'scenes',
];
for (const directory of publicAssetDirectories) {
  const sourceDirectory = path.join(source, directory);
  if (!existsSync(sourceDirectory)) continue;
  await mkdir(path.join(target, directory), { recursive: true });
  await cp(sourceDirectory, path.join(target, directory), {
    recursive: true,
    force: true,
    filter: (sourcePath) => !sourcePath.includes(`${path.sep}source${path.sep}`),
  });
}
const faviconSource = path.join(source, 'brand/favicon.svg');
const faviconTarget = path.join(target, 'favicon.svg');
const faviconContents = await readFile(faviconSource);
let existingFavicon = null;
try {
  existingFavicon = await readFile(faviconTarget);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

if (!existingFavicon?.equals(faviconContents)) {
  try {
    await copyFile(faviconSource, faviconTarget);
  } catch (error) {
    // Some Windows-mounted workspaces report an unclassified copyfile error;
    // writing the already-read bytes avoids the platform's native copy path.
    if (process.platform !== 'win32' || error?.code !== 'UNKNOWN') throw error;
    await writeFile(faviconTarget, faviconContents);
  }
}
