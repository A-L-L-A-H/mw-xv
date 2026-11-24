import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { forbidden, invalid } from './errors.js';
import { isSensitiveWorkspacePath } from './validation.js';

export const SNAPSHOT_LIMITS = Object.freeze({
  maxFiles: 20_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTreeBytes: 512 * 1024 * 1024,
  maxMetadataBytes: 64 * 1024,
});

export interface TreeCopyResult {
  readonly files: number;
  readonly sizeBytes: number;
  readonly treeSha256: string;
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function resolveExistingRoot(root: string): Promise<string> {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    invalid('Sandbox roots must be absolute paths');
  }
  try {
    const real = await realpath(root);
    if (!(await lstat(real)).isDirectory()) invalid('Sandbox root must be a directory');
    return real;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'INVALID_REQUEST') throw error;
    throw invalid('Sandbox root does not exist or cannot be resolved');
  }
}

export async function assertNoSymlinkPath(root: string, relativePath: string): Promise<string> {
  const realRoot = await realpath(root);
  let cursor = realRoot;
  for (const segment of relativePath.split('/')) {
    cursor = path.join(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) forbidden('Symbolic links are not allowed in sandbox paths');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  const candidate = path.resolve(realRoot, relativePath);
  if (!isWithinRoot(realRoot, candidate)) forbidden('Path escapes the workspace root');
  try {
    const realCandidate = await realpath(candidate);
    if (!isWithinRoot(realRoot, realCandidate)) forbidden('Resolved path escapes the workspace root');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return candidate;
}

interface CopyTreeOptions {
  readonly rejectSensitive?: boolean;
  readonly excludeScratch?: boolean;
  readonly excludeRootMetadata?: boolean;
  readonly signal?: AbortSignal;
}

/** Copies regular files into fresh inodes; source links/devices are never followed or recreated. */
export async function copyBoundedTree(
  sourceRoot: string,
  destinationRoot: string,
  options: CopyTreeOptions = {}
): Promise<TreeCopyResult> {
  const realSource = await realpath(sourceRoot);
  // Create first: realpath requires an existing destination, and a fresh
  // per-run worktree deliberately does not exist yet.
  await mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const realDestination = await realpath(destinationRoot);
  if (realSource === realDestination || isWithinRoot(realSource, realDestination)) {
    invalid('Snapshot destination cannot be inside its source');
  }
  const hash = createHash('sha256');
  let files = 0;
  let sizeBytes = 0;

  const visit = async (relativeDir: string): Promise<void> => {
    options.signal?.throwIfAborted();
    const sourceDir = path.join(realSource, relativeDir);
    const destinationDir = path.join(realDestination, relativeDir);
    const entries = await readdir(sourceDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (
        (options.excludeScratch && relative.split('/')[0] === '.mw-sandbox') ||
        (options.excludeRootMetadata && relativeDir === '' && entry.name === 'snapshot.json')
      ) {
        continue;
      }
      if (options.rejectSensitive && isSensitiveWorkspacePath(relative)) {
        forbidden(`Snapshot contains a reserved or sensitive path: ${relative}`);
      }
      const source = path.join(realSource, relative);
      const destination = path.join(realDestination, relative);
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) forbidden(`Snapshot contains a symbolic link: ${relative}`);
      const realSourceEntry = await realpath(source);
      if (!isWithinRoot(realSource, realSourceEntry)) {
        forbidden(`Snapshot path escapes its approved root: ${relative}`);
      }
      if (stat.isDirectory()) {
        await mkdir(destination, { mode: 0o700 });
        await visit(relative);
        continue;
      }
      if (!stat.isFile()) forbidden(`Snapshot contains a non-regular file: ${relative}`);
      files += 1;
      if (files > SNAPSHOT_LIMITS.maxFiles) invalid('Snapshot exceeds the file-count limit');
      if (stat.size > SNAPSHOT_LIMITS.maxFileBytes) {
        invalid(`Snapshot file exceeds the per-file size limit: ${relative}`);
      }
      sizeBytes += stat.size;
      if (sizeBytes > SNAPSHOT_LIMITS.maxTreeBytes) {
        invalid('Snapshot exceeds the total byte limit');
      }
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await input.stat();
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
          forbidden(`Snapshot file changed while being read: ${relative}`);
        }
        const bytes = await input.readFile();
        if (bytes.length > SNAPSHOT_LIMITS.maxFileBytes) {
          invalid(`Snapshot file exceeded its bounded read: ${relative}`);
        }
        const output = await open(destination, 'wx', (stat.mode & 0o111) | 0o600);
        try {
          await output.writeFile(bytes);
        } finally {
          await output.close();
        }
        const pathBytes = Buffer.from(relative, 'utf8');
        hash.update(pathBytes.length.toString(16).padStart(8, '0'));
        hash.update(pathBytes);
        hash.update(Buffer.from((stat.mode & 0o111).toString(8), 'utf8'));
        hash.update(bytes);
      } finally {
        await input.close();
      }
    }
  };

  await mkdir(realDestination, { recursive: true, mode: 0o700 });
  await visit('');
  return { files, sizeBytes, treeSha256: hash.digest('hex') };
}

export async function readBoundedMetadata(
  root: string,
  relativePath: string,
  maxBytes = SNAPSHOT_LIMITS.maxMetadataBytes
): Promise<Record<string, unknown>> {
  const absolute = await assertNoSymlinkPath(root, relativePath);
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) invalid('Metadata file is not a bounded regular file');
    const bytes = await handle.readFile();
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw invalid('Metadata file is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      invalid('Metadata file must contain an object');
    }
    return parsed as Record<string, unknown>;
  } finally {
    await handle.close();
  }
}

export async function writeMetadata(
  root: string,
  relativePath: string,
  value: unknown
): Promise<void> {
  const absolute = path.join(root, relativePath);
  if (!isWithinRoot(root, absolute)) forbidden('Metadata path escapes its private root');
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, absolute);
}

export async function removeBoundedTree(root: string, target: string): Promise<void> {
  const realRoot = await realpath(root);
  const absolute = path.resolve(target);
  if (absolute === realRoot || !isWithinRoot(realRoot, absolute)) {
    forbidden('Refusing to remove a path outside the private sandbox root');
  }
  await rm(absolute, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
