import { sha256Hex } from '@moonwitness/types/node';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  SandboxCommandResult,
  SandboxContainerSpec,
  SandboxExecutor,
  WorkspaceCheckKind,
  WorkspaceCheckResult,
  WorkspaceCancellationResult,
  WorkspaceCommitLocalResult,
  WorkspaceDiffResult,
  WorkspaceDestroyResult,
  WorkspaceApplyPatchResult,
  WorkspaceInfo,
  WorkspaceListResult,
  WorkspaceOperations,
  WorkspaceReadResult,
  WorkspaceReconcileResult,
  WorkspaceSnapshotInfo,
} from './contract.js';
import { WORKSPACE_CONTRACT_VERSION } from './contract.js';
import { cancelled, conflict, forbidden, notFound, outputLimit } from './errors.js';
import { buildWorkspaceManifest } from './manifest.js';
import {
  assertPathAllowed,
  normalizeWorkspacePath,
  validatePatchParams,
  validateCommitParams,
  validateCreateParams,
  validateDiffParams,
  validateExecuteParams,
  validateListParams,
  validateReadParams,
  validateReconcileParams,
  validateRollbackParams,
  validateRunParams,
  validateSnapshotParams,
} from './validation.js';
import {
  captureWorkspaceSnapshot,
  deleteWorkspaceRecord,
  findRecordByRunId,
  listWorkspaceRecords,
  materializeWorkspace,
  newWorkspaceId,
  readSnapshotMetadata,
  resolveSandboxPaths,
  restoreWorkspaceSnapshot,
  workspaceDirectory,
  writeWorkspaceRecord,
  type SandboxPaths,
  type WorkspaceRecord,
} from './worktree.js';
import { assertNoSymlinkPath } from './workspace-fs.js';

/** Fixed command templates only. RPC callers select a check, never a command. */
const CHECK_COMMANDS: Readonly<Record<WorkspaceCheckKind, readonly string[]>> = {
  'node-test': ['node', '--test'],
  'bun-test': ['bun', 'test'],
  'bun-typecheck': ['bun', 'typecheck'],
  'bun-lint': ['bun', 'lint'],
  'bun-build': ['bun', 'build'],
  'vitest-run': ['bun', 'exec', 'vitest', 'run'],
  'tsc-noemit': ['bun', 'exec', 'tsc', '--noEmit'],
};

const MAX_DIFF_FILES = 1_000;
const WORKSPACE_READ_LIMITS = Object.freeze({
  maxFiles: 1_000,
  maxBytes: 1_048_576,
  maxFileBytes: 16 * 1024 * 1024,
});

export interface WorkspaceServiceOptions {
  readonly dataDir: string;
  readonly executor: SandboxExecutor;
  readonly now?: () => Date;
}

/** Typed workspace operations. No ORM, model call, policy engine or business authorization. */
export class WorkspaceService implements WorkspaceOperations {
  private readonly pathsPromise: Promise<SandboxPaths>;
  private readonly executor: SandboxExecutor;
  private readonly now: () => Date;

  constructor(options: WorkspaceServiceOptions) {
    this.executor = options.executor;
    this.now = options.now ?? (() => new Date());
    this.pathsPromise = resolveSandboxPaths(options.dataDir);
  }

  async createWorkspace(rawParams: unknown): Promise<WorkspaceInfo> {
    const params = validateCreateParams(rawParams);
    const paths = await this.pathsPromise;
    await readSnapshotMetadata(paths, params.snapshotId);

    const workspaceId = newWorkspaceId();
    await materializeWorkspace(paths, {
      workspaceId,
      snapshotId: params.snapshotId,
      baseCommit: params.baseCommit,
    });
    const manifest = buildWorkspaceManifest({
      runId: params.runId,
      imageRef: params.imageRef,
      cpuCores: params.cpuCores,
      memoryMb: params.memoryMb,
      timeoutMs: params.timeoutMs,
    });
    const spec = this.containerSpec(
      paths,
      workspaceId,
      params.runId,
      params.imageRef,
      params.pidsLimit,
      params
    );
    const containerId = await this.executor.ensureContainer(spec);
    const timestamp = this.now().toISOString();
    const info: WorkspaceInfo = {
      contractVersion: WORKSPACE_CONTRACT_VERSION,
      runId: params.runId,
      workspaceId,
      snapshotId: params.snapshotId,
      baseCommit: params.baseCommit,
      imageRef: params.imageRef,
      engine: 'rootless-docker',
      status: 'active',
      allowedPaths: params.allowedPaths,
      limits: {
        cpuCores: params.cpuCores,
        memoryMb: params.memoryMb,
        pidsLimit: params.pidsLimit,
        timeoutMs: params.timeoutMs,
        maxOutputBytes: params.maxOutputBytes,
      },
      manifestSha256: manifest.manifestSha256,
      headCommit: params.baseCommit,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await writeWorkspaceRecord(paths, {
      info,
      containerId,
      snapshotId: params.snapshotId,
      imageRef: params.imageRef,
      limits: info.limits,
      manifestSha256: manifest.manifestSha256,
      headCommit: params.baseCommit,
    });
    return info;
  }

  async snapshotWorkspace(rawParams: unknown): Promise<WorkspaceSnapshotInfo> {
    const params = validateSnapshotParams(rawParams);
    const paths = await this.pathsPromise;
    const record = await this.requireActiveRecord(paths, params.runId);
    return captureWorkspaceSnapshot(paths, {
      runId: params.runId,
      workspaceId: record.info.workspaceId,
      ...(params.label === undefined ? {} : { label: params.label }),
      baseCommit: record.info.baseCommit,
    });
  }

  async executeCheck(rawParams: unknown, signal?: AbortSignal): Promise<WorkspaceCheckResult> {
    const params = validateExecuteParams(rawParams);
    const paths = await this.pathsPromise;
    const record = await this.requireActiveRecord(paths, params.runId);
    const cwd = params.cwd === undefined ? undefined : normalizeWorkspacePath(params.cwd, 'cwd');
    if (cwd !== undefined) assertPathAllowed(cwd, record.info.allowedPaths);
    const command = CHECK_COMMANDS[params.check];
    const result = await this.runCommand(record, command, {
      ...(cwd === undefined ? {} : { cwd }),
      timeoutMs: params.timeoutMs,
      maxOutputBytes: params.maxOutputBytes,
      signal,
    });
    return {
      runId: params.runId,
      check: params.check,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      truncated: result.truncated,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutBytes: Buffer.byteLength(result.stdout, 'utf8'),
      stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
      totalOutputBytes:
        Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8'),
    };
  }

  async listWorkspace(rawParams: unknown): Promise<WorkspaceListResult> {
    const params = validateListParams(rawParams);
    const { record, directory } = await this.activeWorkspace(params.runId);
    const relative = params.path ?? '.';
    assertPathAllowed(relative, record.info.allowedPaths);
    const target = await assertNoSymlinkPath(directory, relative);
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(target, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const child = relative === '.' ? entry.name : `${relative}/${entry.name}`;
      assertPathAllowed(child, record.info.allowedPaths);
      await assertNoSymlinkPath(directory, child);
      results.push(child);
      if (results.length >= WORKSPACE_READ_LIMITS.maxFiles) break;
    }
    return { runId: params.runId, paths: results.sort(), truncated: false };
  }

  async readWorkspaceFile(rawParams: unknown): Promise<WorkspaceReadResult> {
    const params = validateReadParams(rawParams);
    const { record, directory } = await this.activeWorkspace(params.runId);
    assertPathAllowed(params.path, record.info.allowedPaths);
    const absolute = await assertNoSymlinkPath(directory, params.path);
    const { open } = await import('node:fs/promises');
    const handle = await open(absolute, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > WORKSPACE_READ_LIMITS.maxFileBytes) {
        outputLimit('Requested workspace file is not a bounded regular file');
      }
      const offset = params.offset ?? 0;
      const maxBytes = params.maxBytes ?? WORKSPACE_READ_LIMITS.maxBytes;
      const length = Math.min(maxBytes, stat.size - offset);
      if (length <= 0) {
        return { runId: params.runId, path: params.path, content: '', sizeBytes: stat.size, truncated: false };
      }
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return {
        runId: params.runId,
        path: params.path,
        content: buffer.subarray(0, bytesRead).toString('utf8'),
        sizeBytes: stat.size,
        truncated: bytesRead < stat.size - offset,
      };
    } finally {
      await handle.close();
    }
  }

  async applyWorkspacePatch(rawParams: unknown): Promise<WorkspaceApplyPatchResult> {
    const params = validatePatchParams(rawParams);
    const { record, directory } = await this.activeWorkspace(params.runId);
    const touched: string[] = [];
    const { open, mkdir } = await import('node:fs/promises');
    for (const operation of params.operations) {
      assertPathAllowed(operation.path, record.info.allowedPaths);
      const absolute = await assertNoSymlinkPath(directory, operation.path);
      await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
      const handle = await open(absolute, operation.type === 'append' ? 'a' : 'w', 0o600);
      try {
        await handle.writeFile(operation.content, 'utf8');
      } finally {
        await handle.close();
      }
      touched.push(operation.path);
    }
    return { runId: params.runId, files: touched };
  }

  async diffWorkspace(rawParams: unknown): Promise<WorkspaceDiffResult> {
    const params = validateDiffParams(rawParams);
    const paths = await this.pathsPromise;
    const record = await this.requireActiveRecord(paths, params.runId);
    const maxOutputBytes = params.maxOutputBytes ?? record.limits.maxOutputBytes;
    const status = await this.runCommand(record, ['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      maxOutputBytes,
    });
    const diff = await this.runCommand(
      record,
      ['git', 'diff', '--no-color', '--no-ext-diff', 'HEAD', '--'],
      { maxOutputBytes }
    );
    if (status.truncated || diff.truncated) outputLimit('Workspace diff exceeded its output bound');

    const files: { path: string; status: string }[] = [];
    const workspaceDir = workspaceDirectory(paths, record.info.workspaceId);
    for (const entry of status.stdout.split('\0')) {
      if (entry.length < 4) continue;
      const state = entry.slice(0, 2);
      const rawPath = entry.slice(3).split('\t')[0].replace(/ -> .*$/u, '');
      const relativePath = await this.validateChangedPath(paths, workspaceDir, record, rawPath);
      if (files.length >= MAX_DIFF_FILES) outputLimit('Workspace diff exceeded its file bound');
      files.push({ path: relativePath, status: state.trim() || 'M' });
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    const unifiedDiff = diff.stdout;
    const sizeBytes = Buffer.byteLength(unifiedDiff, 'utf8');
    if (sizeBytes > maxOutputBytes) outputLimit('Workspace diff exceeded its byte bound');
    return {
      runId: params.runId,
      headCommit: record.headCommit,
      clean: files.length === 0 && unifiedDiff.trim() === '',
      scopeClean: true,
      files,
      unifiedDiff,
      diffSha256: sha256Hex(unifiedDiff),
      sizeBytes,
      truncated: false,
    };
  }

  async commitLocal(rawParams: unknown): Promise<WorkspaceCommitLocalResult> {
    const params = validateCommitParams(rawParams);
    const paths = await this.pathsPromise;
    const record = await this.requireActiveRecord(paths, params.runId);
    const stage = await this.runCommand(record, ['git', 'add', '--all', '--'], {
      maxOutputBytes: record.limits.maxOutputBytes,
    });
    if (stage.truncated) outputLimit('Workspace staging output exceeded its bound');
    const commit = await this.runCommand(record, ['git', 'commit', '--no-verify', '-m', params.message], {
      maxOutputBytes: record.limits.maxOutputBytes,
    });
    if (commit.truncated) outputLimit('Workspace commit output exceeded its bound');
    if (commit.exitCode !== 0) forbidden('Local commit failed inside the sandbox');
    const head = await this.runCommand(record, ['git', 'rev-parse', 'HEAD'], {
      maxOutputBytes: 4096,
    });
    const commitSha = head.stdout.trim();
    if (!/^[a-f0-9]{40,64}$/u.test(commitSha)) forbidden('Sandbox returned an invalid commit SHA');
    const diff = await this.diffWorkspace({ runId: params.runId });
    await writeWorkspaceRecord(paths, {
      ...record,
      headCommit: commitSha,
      info: { ...record.info, headCommit: commitSha, updatedAt: this.now().toISOString() },
    });
    return {
      runId: params.runId,
      commitSha,
      branch: 'local-work',
      files: diff.files.map((file) => file.path),
      message: params.message,
      pushed: false,
    };
  }

  async rollbackWorkspace(rawParams: unknown): Promise<WorkspaceInfo> {
    const params = validateRollbackParams(rawParams);
    const paths = await this.pathsPromise;
    const record = await this.requireActiveRecord(paths, params.runId);
    if (params.snapshotId === undefined) {
      await materializeWorkspace(paths, {
        workspaceId: record.info.workspaceId,
        snapshotId: record.snapshotId,
        baseCommit: record.info.baseCommit,
      });
    } else {
      await restoreWorkspaceSnapshot(paths, {
        workspaceId: record.info.workspaceId,
        snapshotId: params.snapshotId,
      });
    }
    const updated: WorkspaceInfo = {
      ...record.info,
      headCommit: record.info.baseCommit,
      updatedAt: this.now().toISOString(),
    };
    await writeWorkspaceRecord(paths, { ...record, headCommit: updated.headCommit, info: updated });
    return updated;
  }

  async cancelWorkspace(rawParams: unknown): Promise<WorkspaceCancellationResult> {
    const params = validateRunParams(rawParams);
    const paths = await this.pathsPromise;
    const found = await findRecordByRunId(paths, params.runId);
    if (!found) notFound('No workspace exists for this run');
    const record = found;
    if (record.info.status === 'destroyed') conflict('Workspace is already destroyed');
    if (record.info.status === 'cancelled') {
      return {
        runId: params.runId,
        status: 'cancelled',
        cancelledAt: record.info.cancelledAt ?? record.info.updatedAt,
      };
    }
    await this.removeContainer(record.containerId);
    const cancelledAt = this.now().toISOString();
    await writeWorkspaceRecord(paths, {
      ...record,
      containerId: undefined,
      info: { ...record.info, status: 'cancelled', cancelledAt, updatedAt: cancelledAt },
    });
    return { runId: params.runId, status: 'cancelled', cancelledAt };
  }

  async destroyWorkspace(rawParams: unknown): Promise<WorkspaceDestroyResult> {
    const params = validateRunParams(rawParams);
    const paths = await this.pathsPromise;
    const found = await findRecordByRunId(paths, params.runId);
    if (!found) notFound('No workspace exists for this run');
    const record = found;
    if (record.info.status === 'destroyed') {
      return {
        runId: params.runId,
        status: 'destroyed',
        destroyedAt: record.info.destroyedAt ?? record.info.updatedAt,
      };
    }
    await this.removeContainer(record.containerId);
    const { rm } = await import('node:fs/promises');
    await rm(workspaceDirectory(paths, record.info.workspaceId), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
    const destroyedAt = this.now().toISOString();
    await writeWorkspaceRecord(paths, {
      ...record,
      containerId: undefined,
      info: { ...record.info, status: 'destroyed', destroyedAt, updatedAt: destroyedAt },
    });
    return { runId: params.runId, status: 'destroyed', destroyedAt };
  }

  async getWorkspace(rawParams: unknown): Promise<WorkspaceInfo> {
    const params = validateRunParams(rawParams);
    const paths = await this.pathsPromise;
    const record = await findRecordByRunId(paths, params.runId);
    if (!record) notFound('No workspace exists for this run');
    return record.info;
  }

  async reconcileWorkspaces(rawParams: unknown): Promise<WorkspaceReconcileResult> {
    const params = validateReconcileParams(rawParams);
    const paths = await this.pathsPromise;
    const removedContainerIds = await this.executor.reconcile(paths.workspacesRoot);
    const records = await listWorkspaceRecords(paths);
    const threshold = params.olderThanMs ?? 0;
    const nowMs = this.now().getTime();
    const removedWorkspaceIds: string[] = [];
    const retainedWorkspaceIds: string[] = [];
    for (const record of records) {
      const age = nowMs - Date.parse(record.info.updatedAt);
      const terminal = record.info.status !== 'active';
      if (terminal && Number.isFinite(age) && age >= threshold) {
        await deleteWorkspaceRecord(paths, record.info.workspaceId);
        removedWorkspaceIds.push(record.info.workspaceId);
      } else {
        retainedWorkspaceIds.push(record.info.workspaceId);
      }
    }
    return { removedWorkspaceIds, removedContainerIds, retainedWorkspaceIds };
  }

  async cancelAll(): Promise<void> {
    const paths = await this.pathsPromise;
    for (const record of await listWorkspaceRecords(paths)) {
      if (record.info.status !== 'active') continue;
      try {
        await this.cancelWorkspace({ runId: record.info.runId });
      } catch {
        // Best effort: cancellation must continue for the remaining workspaces.
      }
    }
  }

  async close(): Promise<void> {
    await this.cancelAll();
  }

  private async activeWorkspace(
    runId: string
  ): Promise<{ readonly paths: SandboxPaths; readonly record: WorkspaceRecord; readonly directory: string }> {
    const paths = await this.pathsPromise;
    const record = await this.requireActiveRecord(paths, runId);
    return { paths, record, directory: workspaceDirectory(paths, record.info.workspaceId) };
  }

  private async requireActiveRecord(
    paths: SandboxPaths,
    runId: string
  ): Promise<WorkspaceRecord> {
    const record = await findRecordByRunId(paths, runId);
    if (!record) notFound('No workspace exists for this run');
    if (record.info.status === 'destroyed') conflict('Workspace is already destroyed');
    if (record.info.status === 'cancelled') cancelled();
    return record;
  }

  private async validateChangedPath(
    paths: SandboxPaths,
    workspaceDir: string,
    record: WorkspaceRecord,
    rawPath: string
  ): Promise<string> {
    const normalized = normalizeWorkspacePath(rawPath, 'diff path');
    assertPathAllowed(normalized, record.info.allowedPaths);
    await assertNoSymlinkPath(workspaceDir, normalized);
    if (normalized !== '.' && (await this.pathExists(workspaceDir, normalized)) === false) {
      // A deleted file is still a legitimate diff entry; scope has been checked.
      return normalized;
    }
    return normalized;
  }

  private async pathExists(root: string, relativePath: string): Promise<boolean> {
    try {
      const { realpath } = await import('node:fs/promises');
      await realpath(`${root}/${relativePath}`);
      return true;
    } catch {
      return false;
    }
  }

  private async runCommand(
    record: WorkspaceRecord,
    command: readonly string[],
    options: {
      readonly cwd?: string;
      readonly timeoutMs?: number;
      readonly maxOutputBytes?: number;
      readonly signal?: AbortSignal;
    } = {}
  ): Promise<SandboxCommandResult> {
    const paths = await this.pathsPromise;
    let containerId = record.containerId;
    if (containerId === undefined) {
      const spec = await this.containerSpecForRecord(paths, record);
      containerId = await this.executor.ensureContainer(spec, options.signal);
      await writeWorkspaceRecord(paths, { ...record, containerId });
    }
    return this.executor.execute(containerId, command, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      timeoutMs: options.timeoutMs ?? record.limits.timeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? record.limits.maxOutputBytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  private async containerSpecForRecord(
    paths: SandboxPaths,
    record: WorkspaceRecord
  ): Promise<SandboxContainerSpec> {
    return {
      runId: record.info.runId,
      workspaceId: record.info.workspaceId,
      workspaceHostPath: workspaceDirectory(paths, record.info.workspaceId),
      imageRef: record.imageRef,
      manifest: buildWorkspaceManifest({
        runId: record.info.runId,
        imageRef: record.imageRef,
        cpuCores: record.limits.cpuCores,
        memoryMb: record.limits.memoryMb,
        timeoutMs: record.limits.timeoutMs,
      }),
      pidsLimit: record.limits.pidsLimit,
    };
  }

  private containerSpec(
    paths: SandboxPaths,
    workspaceId: string,
    runId: string,
    imageRef: string,
    pidsLimit: number,
    limits: { readonly cpuCores: number; readonly memoryMb: number; readonly timeoutMs: number; readonly maxOutputBytes: number }
  ): SandboxContainerSpec {
    return {
      runId,
      workspaceId,
      workspaceHostPath: workspaceDirectory(paths, workspaceId),
      imageRef,
      manifest: buildWorkspaceManifest({
        runId,
        imageRef,
        cpuCores: limits.cpuCores,
        memoryMb: limits.memoryMb,
        timeoutMs: limits.timeoutMs,
      }),
      pidsLimit,
    };
  }

  private async removeContainer(containerId: string | undefined): Promise<void> {
    if (containerId === undefined) return;
    await this.executor.removeContainer(containerId);
  }
}

/** Exported for host-side verification that a workspace directory exists. */
export async function workspaceDirectoryExists(paths: SandboxPaths, workspaceId: string): Promise<boolean> {
  try {
    return (await stat(workspaceDirectory(paths, workspaceId))).isDirectory();
  } catch {
    return false;
  }
}
