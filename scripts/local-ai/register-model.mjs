import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultRegistryPath = path.join(repositoryRoot, 'packages/local-ai/model-registry.json');

function parseCliArgs(argv) {
  const options = {
    version: '1.0.0',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    reviewRef: 'local-operator-review',
    minRam: 8,
    minVram: null,
    activate: false,
    dryRun: false,
    registry: defaultRegistryPath,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--activate') {
      options.activate = true;
      continue;
    }
    if (flag === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!flag.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for flag ${flag}`);
    i += 1;
    if (flag === '--file') options.file = path.resolve(value);
    else if (flag === '--id') options.id = value;
    else if (flag === '--version') options.version = value;
    else if (flag === '--source-url') options.sourceUrl = value;
    else if (flag === '--license') options.license = value;
    else if (flag === '--license-url') options.licenseUrl = value;
    else if (flag === '--review-ref') options.reviewRef = value;
    else if (flag === '--storage-root') options.storageRoot = path.resolve(value);
    else if (flag === '--registry') options.registry = path.resolve(value);
    else if (flag === '--min-ram') options.minRam = Number(value);
    else if (flag === '--min-vram') options.minVram = value === 'null' ? null : Number(value);
  }
  return options;
}

async function computeFileDigest(filePath) {
  const hash = createHash('sha256');
  let byteLength = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    byteLength += buffer.byteLength;
  }
  return { sha256: hash.digest('hex'), byteLength };
}

/**
 * Registers or previews a local GGUF artifact inside packages/local-ai/model-registry.json
 * while validating offline registry and outside-worktree storage invariants.
 */
export async function registerLocalModel(options) {
  if (!options.file || !options.id) {
    throw new Error('Required flags: --file <path> and --id <model-id>');
  }
  const fileStat = await lstat(options.file);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error('Model artifact must be a regular non-symlink file');
  }
  const storageRoot = options.storageRoot ?? path.dirname(options.file);
  const resolvedRoot = await realpath(storageRoot);
  const resolvedFile = await realpath(options.file);
  const relFile = path.relative(resolvedRoot, resolvedFile).replaceAll('\\', '/');
  if (!relFile || relFile.startsWith('..') || path.isAbsolute(relFile)) {
    throw new Error('Model file must reside inside --storage-root');
  }

  const digest = await computeFileDigest(resolvedFile);
  const localAi = await import(
    pathToFileURL(path.join(repositoryRoot, 'packages/local-ai/dist/index.js')).href
  );

  const existingText = await readFile(options.registry, 'utf8');
  const existing = JSON.parse(existingText);
  if (!localAi.isLocalModelRegistry(existing)) {
    throw new Error('Existing model registry failed schema validation');
  }

  const entry = {
    id: options.id,
    version: options.version,
    sourceUrl: options.sourceUrl,
    license: {
      identifier: options.license,
      referenceUrl: options.licenseUrl,
      reviewed: true,
      reviewedAt: new Date().toISOString(),
      reviewRef: options.reviewRef,
    },
    file: {
      path: relFile,
      sha256: digest.sha256,
      byteLength: digest.byteLength,
    },
    requirements: {
      minimumRamGiB: options.minRam,
      minimumVramGiB: options.minVram,
    },
  };

  const verification = await localAi.verifyLocalModelArtifact(repositoryRoot, resolvedRoot, entry);
  if (!verification.valid) {
    throw new Error(`Model verification failed: ${verification.reason}`);
  }

  const filtered = existing.artifacts.filter((artifact) => artifact.id !== entry.id);
  const nextRegistry = {
    format: 'moonwitness-local-model-registry/v1',
    activeArtifactId: options.activate ? entry.id : existing.activeArtifactId,
    artifacts: [...filtered, entry],
  };

  if (!localAi.isLocalModelRegistry(nextRegistry)) {
    throw new Error('Updated model registry failed schema validation');
  }

  if (!options.dryRun) {
    await writeFile(options.registry, `${JSON.stringify(nextRegistry, null, 2)}\n`, 'utf8');
  }

  return { registry: nextRegistry, verification, dryRun: options.dryRun };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parseCliArgs(process.argv.slice(2));
  const outcome = await registerLocalModel(parsed);
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
}
