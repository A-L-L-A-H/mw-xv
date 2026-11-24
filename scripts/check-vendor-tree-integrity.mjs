#!/usr/bin/env node
/** Deterministic integrity pin for the vendored FreeLLMAPI source snapshot. */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = path.join(repositoryRoot, 'vendor/freellmapi');
const upstreamPath = path.join(vendorRoot, 'UPSTREAM.json');

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '__fixtures__',
  '__tests__',
  'build',
  'coverage',
  'dist',
  'fixtures',
  'node_modules',
  'test',
  'tests',
]);

export async function computeVendorTreeDigest(root = vendorRoot) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(absolute);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (relative === 'UPSTREAM.json') continue;
      const content = await readFile(absolute);
      files.push(`${relative}\0${createHash('sha256').update(content).digest('hex')}`);
    }
  }
  await walk(root);
  files.sort();
  return createHash('sha256').update(files.join('\n')).digest('hex');
}

async function main() {
  const record = process.argv.includes('--record');
  const digest = await computeVendorTreeDigest();
  const upstream = JSON.parse(await readFile(upstreamPath, 'utf8'));
  if (record) {
    upstream.treeSha256 = digest;
    await writeFile(upstreamPath, `${JSON.stringify(upstream, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded vendored tree digest ${digest}.\n`);
    return;
  }
  if (upstream.treeSha256 !== digest) {
    process.stderr.write(
      `Vendored tree digest mismatch: expected ${upstream.treeSha256 ?? '(missing)'}, got ${digest}.\n` +
        'Review the upstream revision and localPatches in UPSTREAM.json, then re-record with --record.\n'
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Vendored FreeLLMAPI tree integrity verified (${digest}).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
