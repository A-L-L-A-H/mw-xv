import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isRecord } from '@moonwitness/types';

export interface LocalDbBackupManifest {
  version: 1;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  sourceFileName: string;
}

export interface LocalDbBackupEntry {
  fileName: string;
  filePath: string;
  manifestPath: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  verified: boolean;
}

export interface RestoreLocalDbBackupResult {
  restoredFrom: string;
  restoredTo: string;
  sha256: string;
  sizeBytes: number;
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

function assertNoTraversalTokens(rawPath: string): void {
  if (rawPath.includes('\0')) {
    throw new Error('Invalid path: null byte detected');
  }
  const segments = rawPath.split(/[\\/]+/u);
  if (segments.includes('..')) {
    throw new Error(`Path traversal rejected: ${rawPath}`);
  }
}

export function resolveConfinedBackupPath(backupsDir: string, targetPath: string): string {
  if (typeof backupsDir !== 'string' || backupsDir.trim().length === 0) {
    throw new Error('backupsDir must be a non-empty string');
  }
  if (typeof targetPath !== 'string' || targetPath.trim().length === 0) {
    throw new Error('targetPath must be a non-empty string');
  }
  if (backupsDir.includes('\0') || targetPath.includes('\0')) {
    throw new Error('Invalid path: null byte detected');
  }

  const resolvedRoot = path.resolve(backupsDir);
  const resolvedTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(resolvedRoot, targetPath);

  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (
    relative.length === 0 ||
    relative === '.' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    relative.startsWith('../') ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Backup path escapes backupsDir: ${targetPath}`);
  }

  return resolvedTarget;
}

export async function computeFileSha256(filePath: string): Promise<string> {
  const contents = await fs.readFile(filePath);
  return createHash('sha256').update(contents).digest('hex');
}

function getManifestPath(backupFilePath: string): string {
  return `${backupFilePath}.sha256.json`;
}

function parseManifest(raw: unknown): LocalDbBackupManifest | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (
    raw.version !== 1 ||
    typeof raw.fileName !== 'string' ||
    typeof raw.sha256 !== 'string' ||
    !SHA256_HEX_PATTERN.test(raw.sha256) ||
    typeof raw.sizeBytes !== 'number' ||
    !Number.isInteger(raw.sizeBytes) ||
    raw.sizeBytes < 0 ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.sourceFileName !== 'string'
  ) {
    return null;
  }
  return {
    version: 1,
    fileName: raw.fileName,
    sha256: raw.sha256,
    sizeBytes: raw.sizeBytes,
    createdAt: raw.createdAt,
    sourceFileName: raw.sourceFileName,
  };
}

function formatBackupTimestamp(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    '-',
    pad(date.getUTCMilliseconds(), 3),
  ].join('');
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore cleanup errors for non-existent temp files.
  }
}

export async function createLocalDbBackup(
  sqlitePath: string,
  backupsDir: string
): Promise<LocalDbBackupEntry> {
  const resolvedSource = path.resolve(sqlitePath);
  const sourceStat = await fs.stat(resolvedSource);
  if (!sourceStat.isFile()) {
    throw new Error(`SQLite source is not a file: ${resolvedSource}`);
  }

  const resolvedBackupsDir = path.resolve(backupsDir);
  await fs.mkdir(resolvedBackupsDir, { recursive: true });

  const now = new Date();
  const nonce = randomBytes(4).toString('hex');
  const fileName = `moonwitness-backup-${formatBackupTimestamp(now)}-${nonce}.sqlite`;
  const backupFilePath = resolveConfinedBackupPath(resolvedBackupsDir, fileName);
  const manifestPath = resolveConfinedBackupPath(resolvedBackupsDir, `${fileName}.sha256.json`);

  const tempBackupPath = resolveConfinedBackupPath(resolvedBackupsDir, `${fileName}.tmp.${nonce}`);
  const tempManifestPath = resolveConfinedBackupPath(
    resolvedBackupsDir,
    `${fileName}.sha256.json.tmp.${nonce}`
  );

  try {
    await fs.copyFile(resolvedSource, tempBackupPath);
    const [tempStat, sha256] = await Promise.all([
      fs.stat(tempBackupPath),
      computeFileSha256(tempBackupPath),
    ]);

    const manifest: LocalDbBackupManifest = {
      version: 1,
      fileName,
      sha256,
      sizeBytes: tempStat.size,
      createdAt: now.toISOString(),
      sourceFileName: path.basename(resolvedSource),
    };

    await fs.writeFile(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.rename(tempBackupPath, backupFilePath);
    await fs.rename(tempManifestPath, manifestPath);

    return {
      fileName,
      filePath: backupFilePath,
      manifestPath,
      sha256,
      sizeBytes: tempStat.size,
      createdAt: manifest.createdAt,
      verified: true,
    };
  } catch (err: unknown) {
    await Promise.all([safeUnlink(tempBackupPath), safeUnlink(tempManifestPath)]);
    throw err;
  }
}

export async function listLocalDbBackups(backupsDir: string): Promise<LocalDbBackupEntry[]> {
  const resolvedBackupsDir = path.resolve(backupsDir);
  let dirEntries: string[];
  try {
    dirEntries = await fs.readdir(resolvedBackupsDir);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const sqliteFiles = dirEntries.filter(
    (name) => name.endsWith('.sqlite') && !name.includes('.tmp.')
  );

  const entries: LocalDbBackupEntry[] = [];
  for (const fileName of sqliteFiles) {
    const filePath = resolveConfinedBackupPath(resolvedBackupsDir, fileName);
    const manifestPath = resolveConfinedBackupPath(resolvedBackupsDir, `${fileName}.sha256.json`);

    const fileStat = await fs.stat(filePath);
    if (!fileStat.isFile()) {
      continue;
    }

    const actualSha256 = await computeFileSha256(filePath);
    let manifest: LocalDbBackupManifest | null;
    try {
      const rawManifest = await fs.readFile(manifestPath, 'utf8');
      manifest = parseManifest(JSON.parse(rawManifest));
    } catch {
      manifest = null;
    }

    const verified =
      manifest !== null &&
      manifest.fileName === fileName &&
      manifest.sha256 === actualSha256 &&
      manifest.sizeBytes === fileStat.size;

    entries.push({
      fileName,
      filePath,
      manifestPath,
      sha256: manifest?.sha256 ?? actualSha256,
      sizeBytes: fileStat.size,
      createdAt: manifest?.createdAt ?? fileStat.mtime.toISOString(),
      verified,
    });
  }

  entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return entries;
}

export async function restoreLocalDbBackup(
  backupFilePath: string,
  sqlitePath: string,
  backupsDir?: string
): Promise<RestoreLocalDbBackupResult> {
  assertNoTraversalTokens(backupFilePath);
  const resolvedBackupPath =
    backupsDir !== undefined
      ? resolveConfinedBackupPath(backupsDir, backupFilePath)
      : path.resolve(backupFilePath);

  const manifestPath = getManifestPath(resolvedBackupPath);
  if (backupsDir !== undefined) {
    resolveConfinedBackupPath(backupsDir, manifestPath);
  }

  let manifest: LocalDbBackupManifest | null;
  try {
    const rawManifest = await fs.readFile(manifestPath, 'utf8');
    manifest = parseManifest(JSON.parse(rawManifest));
  } catch {
    throw new Error(`Missing or invalid backup checksum manifest: ${manifestPath}`);
  }

  if (!manifest) {
    throw new Error(`Invalid backup checksum manifest schema: ${manifestPath}`);
  }

  const backupStat = await fs.stat(resolvedBackupPath);
  if (!backupStat.isFile()) {
    throw new Error(`Backup path is not a file: ${resolvedBackupPath}`);
  }

  const actualSha256 = await computeFileSha256(resolvedBackupPath);
  if (actualSha256 !== manifest.sha256 || backupStat.size !== manifest.sizeBytes) {
    throw new Error(
      `Backup checksum mismatch for ${path.basename(resolvedBackupPath)}: expected ${manifest.sha256}, got ${actualSha256}`
    );
  }

  const resolvedSqlitePath = path.resolve(sqlitePath);
  const targetDir = path.dirname(resolvedSqlitePath);
  await fs.mkdir(targetDir, { recursive: true });

  const nonce = randomBytes(4).toString('hex');
  const tempRestorePath = path.join(
    targetDir,
    `${path.basename(resolvedSqlitePath)}.restore.tmp.${nonce}`
  );

  try {
    await fs.copyFile(resolvedBackupPath, tempRestorePath);
    const copiedSha256 = await computeFileSha256(tempRestorePath);
    if (copiedSha256 !== manifest.sha256) {
      throw new Error('Restored temp copy failed SHA-256 verification');
    }
    await fs.rename(tempRestorePath, resolvedSqlitePath);
  } catch (err: unknown) {
    await safeUnlink(tempRestorePath);
    throw err;
  }

  return {
    restoredFrom: resolvedBackupPath,
    restoredTo: resolvedSqlitePath,
    sha256: manifest.sha256,
    sizeBytes: backupStat.size,
  };
}
