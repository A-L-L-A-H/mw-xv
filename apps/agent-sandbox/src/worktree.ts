import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  WorkspaceInfo,
  WorkspaceResourceLimits,
  WorkspaceSnapshotInfo,
} from './contract.js';
import { forbidden, invalid, notFound } from './errors.js';
import {
  copyBoundedTree,
  isWithinRoot,
  readBoundedMetadata,
  removeBoundedTree,
  writeMetadata,
} from './workspace-fs.js';
import { validateBaseCommit, validateRunId, validateSnapshotId } from './validation.js';

export const SNAPSHOT_METADATA_FILE = 'snapshot.json';
export const WORKSPACE_PREFIX = 'run-';
export const WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface SandboxPaths {
  readonly dataDir: string;
  readonly snapshotsRoot: string;
  readonly workspacesRoot: string;
  readonly metadataRoot: string;
}

export interface SnapshotMetadata {
  readonly snapshotId: string;
  readonly baseCommit: string;
  readonly files: number;
  readonly sizeBytes: number;
  readonly treeSha256: string;
  readonly createdAt: string;
}

export interface WorkspaceRecord {
  readonly info: WorkspaceInfo;
  readonly containerId?: string;
  readonly snapshotId: string;
  readonly imageRef: string;
  readonly limits: WorkspaceResourceLimits;
  readonly manifestSha256: string;
  readonly headCommit: string;
}

export async function resolveSandboxPaths(dataDir: string): Promise<SandboxPaths> {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) {
    invalid('Sandbox data directory must be an absolute path');
  }
  const root = path.resolve(dataDir);
  const paths: SandboxPaths = {
    dataDir: root,
    snapshotsRoot: path.join(root, 'snapshots'),
    workspacesRoot: path.join(root, 'workspaces'),
    metadataRoot: path.join(root, 'metadata'),
  };
  for (const directory of [
    paths.snapshotsRoot,
    paths.workspacesRoot,
    paths.metadataRoot,
  ]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  return paths;
}

export function newWorkspaceId(): string {
  return randomUUID();
}

export function validateWorkspaceId(value: string): string {
  if (typeof value !== 'string' || !WORKSPACE_ID_PATTERN.test(value)) {
    invalid('workspaceId must be a UUID');
  }
  return value;
}

export function workspaceDirectory(paths: SandboxPaths, workspaceId: string): string {
  const directory = path.join(paths.workspacesRoot, `${WORKSPACE_PREFIX}${validateWorkspaceId(workspaceId)}`);
  if (!isWithinRoot(paths.workspacesRoot, directory)) forbidden('Workspace path escapes its private root');
  return directory;
}

export function snapshotDirectory(paths: SandboxPaths, snapshotId: string): string {
  const directory = path.join(paths.snapshotsRoot, validateSnapshotId(snapshotId));
  if (!isWithinRoot(paths.snapshotsRoot, directory)) forbidden('Snapshot path escapes its private root');
  return directory;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(`Snapshot metadata field ${field} is invalid`);
  }
  return value;
}

function countField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalid(`Snapshot metadata field ${field} is invalid`);
  }
  return value;
}

export async function readSnapshotMetadata(
  paths: SandboxPaths,
  snapshotId: string
): Promise<SnapshotMetadata> {
  const directory = snapshotDirectory(paths, snapshotId);
  const raw = await readBoundedMetadata(directory, SNAPSHOT_METADATA_FILE);
  const metadata: SnapshotMetadata = {
    snapshotId: stringField(raw.snapshotId, 'snapshotId'),
    baseCommit: validateBaseCommit(raw.baseCommit),
    files: countField(raw.files, 'files'),
    sizeBytes: countField(raw.sizeBytes, 'sizeBytes'),
    treeSha256: stringField(raw.treeSha256, 'treeSha256'),
    createdAt: stringField(raw.createdAt, 'createdAt'),
  };
  if (metadata.snapshotId !== snapshotId) {
    forbidden('Snapshot metadata identity does not match its directory');
  }
  if (!/^[a-f0-9]{64}$/u.test(metadata.treeSha256)) {
    invalid('Snapshot tree hash is invalid');
  }
  return metadata;
}

/** Copy an approved immutable snapshot into a fresh per-run worktree. */
export async function materializeWorkspace(
  paths: SandboxPaths,
  params: {
    readonly workspaceId: string;
    readonly snapshotId: string;
    readonly baseCommit: string;
    readonly signal?: AbortSignal;
  }
): Promise<{ readonly directory: string; readonly treeSha256: string; readonly files: number }> {
  const directory = workspaceDirectory(paths, params.workspaceId);
  const source = snapshotDirectory(paths, params.snapshotId);
  const metadata = await readSnapshotMetadata(paths, params.snapshotId);
  if (metadata.baseCommit !== params.baseCommit) {
    forbidden('Snapshot base commit does not match the requested execution fingerprint');
  }
  // Removing an existing tree makes base-snapshot rollback safe and keeps
  // materialization idempotent for a freshly allocated workspace id.
  await removeBoundedTree(paths.workspacesRoot, directory);
  const result = await copyBoundedTree(source, directory, {
    rejectSensitive: true,
    excludeScratch: true,
    excludeRootMetadata: true,
    signal: params.signal,
  });
  if (result.files === 0) invalid('Approved snapshot contains no files');
  return { directory, treeSha256: result.treeSha256, files: result.files };
}

/** Capture the current worktree into an immutable, run-scoped snapshot. */
export async function captureWorkspaceSnapshot(
  paths: SandboxPaths,
  params: {
    readonly runId: string;
    readonly workspaceId: string;
    readonly label?: string;
    readonly baseCommit: string;
    readonly signal?: AbortSignal;
  }
): Promise<WorkspaceSnapshotInfo> {
  const runId = validateRunId(params.runId);
  const source = workspaceDirectory(paths, params.workspaceId);
  const snapshotId = `snap-${randomUUID()}`;
  const destination = snapshotDirectory(paths, snapshotId);
  const createdAt = new Date().toISOString();
  const result = await copyBoundedTree(source, destination, {
    rejectSensitive: true,
    excludeScratch: true,
    excludeRootMetadata: true,
    signal: params.signal,
  });
  await writeMetadata(destination, SNAPSHOT_METADATA_FILE, {
    snapshotId,
    baseCommit: validateBaseCommit(params.baseCommit),
    files: result.files,
    sizeBytes: result.sizeBytes,
    treeSha256: result.treeSha256,
    createdAt,
  });
  return {
    runId,
    snapshotId,
    ...(params.label === undefined ? {} : { label: params.label }),
    base: false,
    treeSha256: result.treeSha256,
    sizeBytes: result.sizeBytes,
    createdAt,
  };
}

/** Replace a worktree's contents with a previously captured snapshot. */
export async function restoreWorkspaceSnapshot(
  paths: SandboxPaths,
  params: {
    readonly workspaceId: string;
    readonly snapshotId: string;
    readonly signal?: AbortSignal;
  }
): Promise<void> {
  const destination = workspaceDirectory(paths, params.workspaceId);
  const source = snapshotDirectory(paths, params.snapshotId);
  await readSnapshotMetadata(paths, params.snapshotId);
  await removeBoundedTree(paths.workspacesRoot, destination);
  const result = await copyBoundedTree(source, destination, {
    rejectSensitive: true,
    excludeScratch: true,
    excludeRootMetadata: true,
    signal: params.signal,
  });
  if (result.files === 0) invalid('Snapshot to restore contains no files');
}

export async function writeWorkspaceRecord(
  paths: SandboxPaths,
  record: WorkspaceRecord
): Promise<void> {
  const target = path.join(paths.metadataRoot, `${record.info.workspaceId}.json`);
  if (!isWithinRoot(paths.metadataRoot, target)) forbidden('Workspace metadata path escapes its root');
  await writeMetadata(paths.metadataRoot, `${record.info.workspaceId}.json`, record);
}

export async function readWorkspaceRecord(
  paths: SandboxPaths,
  workspaceId: string
): Promise<WorkspaceRecord> {
  const target = `${validateWorkspaceId(workspaceId)}.json`;
  const raw = await readBoundedMetadata(paths.metadataRoot, target, 128 * 1024);
  if (!raw || typeof raw !== 'object') notFound('Workspace record is malformed');
  const record = raw as unknown as WorkspaceRecord;
  if (record.info?.workspaceId !== workspaceId) {
    forbidden('Workspace record identity does not match its storage key');
  }
  return record;
}

export async function findRecordByRunId(
  paths: SandboxPaths,
  runId: string
): Promise<WorkspaceRecord | undefined> {
  const validatedRunId = validateRunId(runId);
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(paths.metadataRoot);
  const matches: WorkspaceRecord[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith('.json')) continue;
    const raw = await readBoundedMetadata(paths.metadataRoot, file, 128 * 1024);
    if ((raw as unknown as WorkspaceRecord)?.info?.runId === validatedRunId) {
      matches.push(raw as unknown as WorkspaceRecord);
    }
  }
  if (matches.length > 1) forbidden('Multiple workspaces exist for the same run');
  return matches[0];
}

export async function listWorkspaceRecords(paths: SandboxPaths): Promise<WorkspaceRecord[]> {
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(paths.metadataRoot);
  const records: WorkspaceRecord[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith('.json')) continue;
    const raw = await readBoundedMetadata(paths.metadataRoot, file, 128 * 1024);
    records.push(raw as unknown as WorkspaceRecord);
  }
  return records;
}

export async function deleteWorkspaceRecord(paths: SandboxPaths, workspaceId: string): Promise<void> {
  const target = path.join(paths.metadataRoot, `${validateWorkspaceId(workspaceId)}.json`);
  if (!isWithinRoot(paths.metadataRoot, target)) forbidden('Workspace metadata path escapes its root');
  await removeBoundedTree(paths.metadataRoot, target);
}
