#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const distSrcDir = path.join(desktopDir, 'dist');
const resourcesDir = path.join(desktopDir, 'src-tauri', 'resources');
const sidecarDir = path.join(resourcesDir, 'sidecar');
const sidecarDistDir = path.join(sidecarDir, 'dist');
const sidecarNodeModulesDir = path.join(sidecarDir, 'node_modules');

const DEV_ONLY_SKIP = new Set([
  'typescript',
  'vite',
  'vitest',
  'esbuild',
  'rollup',
  'tailwindcss',
  '@tailwindcss/postcss',
  '@vitejs/plugin-react',
  'react',
  'react-dom',
  'motion',
  'radix-ui',
  'cmdk',
  '@tanstack/react-query',
  'playwright',
  '@playwright/test',
  'electron',
]);

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.github',
  'test',
  'tests',
  '__tests__',
  'docs',
  'doc',
  'example',
  'examples',
  'coverage',
  '.turbo',
]);

function shouldCopyFile(srcPath) {
  const base = path.basename(srcPath);
  if (SKIP_DIR_NAMES.has(base)) {
    return false;
  }
  if (base.endsWith('.d.ts') || base.endsWith('.d.ts.map') || base.endsWith('.js.map') || base.endsWith('.tsbuildinfo')) {
    return false;
  }
  return true;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findPackageDir(pkgName, searchFromDir) {
  let current = searchFromDir;
  while (true) {
    const candidate = path.join(current, 'node_modules', ...pkgName.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return fs.realpathSync(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function copyDirFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    if (!shouldCopyFile(srcPath)) {
      continue;
    }
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(srcPath);
      const stat = fs.statSync(real);
      if (stat.isDirectory()) {
        copyDirFiltered(real, destPath);
      } else {
        fs.copyFileSync(real, destPath);
      }
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function measureDirBytes(dirPath) {
  let total = 0;
  let files = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
        files += 1;
      }
    }
  }
  return { total, files };
}

function main() {
  if (!fs.existsSync(path.join(distSrcDir, 'cli.js'))) {
    throw new Error(`Missing ${path.join(distSrcDir, 'cli.js')}. Run bun --filter @moonwitness/desktop build first.`);
  }

  fs.rmSync(sidecarDir, { recursive: true, force: true });
  fs.mkdirSync(sidecarNodeModulesDir, { recursive: true });

  // 1. Copy node binary
  const nodeBinName = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodeDest = path.join(sidecarDir, nodeBinName);
  fs.copyFileSync(process.execPath, nodeDest);

  // 2. Copy compiled dist/
  copyDirFiltered(distSrcDir, sidecarDistDir);

  // 3. Minimal package.json for ESM resolution
  const desktopPkg = readJson(path.join(desktopDir, 'package.json'));
  fs.writeFileSync(
    path.join(sidecarDir, 'package.json'),
    JSON.stringify(
      {
        name: '@moonwitness/desktop-sidecar',
        version: desktopPkg.version || '1.0.0',
        private: true,
        type: 'module',
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // 4. BFS copy runtime dependencies (and transitive runtime dependencies)
  const visitedRealPaths = new Set();
  const stagedNames = new Map();
  const queue = [];

  for (const depName of Object.keys(desktopPkg.dependencies || {})) {
    if (!DEV_ONLY_SKIP.has(depName)) {
      queue.push({ name: depName, fromDir: desktopDir });
    }
  }

  while (queue.length > 0) {
    const { name, fromDir } = queue.shift();
    if (DEV_ONLY_SKIP.has(name) || name.startsWith('@types/')) {
      continue;
    }

    const resolvedDir = findPackageDir(name, fromDir) || findPackageDir(name, repoRoot);
    if (!resolvedDir) {
      continue;
    }

    const realKey = `${name}::${resolvedDir}`;
    if (visitedRealPaths.has(realKey)) {
      continue;
    }
    visitedRealPaths.add(realKey);

    const pkgJsonPath = path.join(resolvedDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      continue;
    }
    const pkgJson = readJson(pkgJsonPath);

    if (!stagedNames.has(name)) {
      const targetDir = path.join(sidecarNodeModulesDir, ...name.split('/'));
      copyDirFiltered(resolvedDir, targetDir);
      stagedNames.set(name, resolvedDir);
    }

    const nextDeps = {
      ...(pkgJson.dependencies || {}),
      ...(pkgJson.optionalDependencies || {}),
    };
    for (const subDep of Object.keys(nextDeps)) {
      if (!DEV_ONLY_SKIP.has(subDep) && !subDep.startsWith('@types/')) {
        queue.push({ name: subDep, fromDir: resolvedDir });
      }
    }
  }

  // 5. Optional EasyTier binary staging (non-fatal if absent so CI stays fast & green)
  const easytierBinName = process.platform === 'win32' ? 'easytier-core.exe' : 'easytier-core';
  function resolveEasyTierBinarySource() {
    const envBin = process.env.MW_EASYTIER_BIN?.trim();
    if (envBin && fs.existsSync(envBin) && fs.statSync(envBin).isFile()) {
      return { source: envBin, origin: 'MW_EASYTIER_BIN' };
    }
    const homeBin = path.join(os.homedir(), '.moonwitness', 'bin', easytierBinName);
    if (fs.existsSync(homeBin) && fs.statSync(homeBin).isFile()) {
      return { source: homeBin, origin: 'desktop_home' };
    }
    const pathEnv = process.env.PATH || '';
    for (const dir of pathEnv.split(path.delimiter)) {
      const trimmedDir = dir.trim();
      if (!trimmedDir) continue;
      const candidate = path.join(trimmedDir, easytierBinName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { source: candidate, origin: 'PATH' };
      }
    }
    return null;
  }

  const easytierMatch = resolveEasyTierBinarySource();
  let easytierStaged = false;
  let easytierRelativePath = null;
  if (easytierMatch) {
    const sidecarBinDir = path.join(sidecarDir, 'bin');
    fs.mkdirSync(sidecarBinDir, { recursive: true });
    fs.copyFileSync(easytierMatch.source, path.join(sidecarBinDir, easytierBinName));
    easytierStaged = true;
    easytierRelativePath = path.posix.join('bin', easytierBinName);
  }

  const { total, files } = measureDirBytes(sidecarDir);
  const mb = (total / (1024 * 1024)).toFixed(2);

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeBinary: nodeBinName,
    entryScript: 'dist/cli.js',
    easytier: {
      available: easytierStaged,
      binaryName: easytierBinName,
      relativePath: easytierRelativePath,
      origin: easytierMatch?.origin ?? null,
    },
    stagedPackages: stagedNames.size,
    files: files + 1,
    totalMB: Number(mb),
  };
  const manifestPath = path.join(sidecarDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(
    JSON.stringify({
      status: 'ok',
      sidecarDir,
      manifestPath,
      nodeBinary: nodeDest,
      entryScript: path.join(sidecarDistDir, 'cli.js'),
      easytierStaged,
      easytierOrigin: easytierMatch?.origin ?? null,
      stagedPackages: stagedNames.size,
      files: manifest.files,
      totalMB: Number(mb),
    }),
  );
}

main();
