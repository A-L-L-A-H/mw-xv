import type { FetchLike } from './types.js';
import {
  verifySandboxExecutionOutput,
  type EphemeralSandboxManifest,
  type SandboxExecutionOutput,
  type SandboxVerificationResult,
} from './sandbox-runner.js';

/** Stage 4 wire contract. Authorization and model/ORM concerns deliberately live elsewhere. */
export const WORKSPACE_CONTRACT_VERSION = 1 as const;

export const WORKSPACE_LIMITS = Object.freeze({
  cpuCores: { min: 0.25, max: 4 },
  memoryMb: { min: 128, max: 4096 },
  pidsLimit: { min: 16, max: 256 },
  timeoutMs: { min: 1_000, max: 120_000 },
  outputBytes: { min: 1_024, max: 1_048_576 },
  allowedPaths: 128,
  commitMessageBytes: 512,
});

export type WorkspaceEngine = 'rootless-docker';
export type WorkspaceStatus = 'active' | 'cancelled' | 'destroyed';
export type WorkspaceCheckKind =
  | 'node-test'
  | 'pnpm-test'
  | 'pnpm-typecheck'
  | 'pnpm-lint'
  | 'pnpm-build'
  | 'vitest-run'
  | 'tsc-noemit';

export interface WorkspaceResourceLimits {
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly pidsLimit: number;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface WorkspaceCreateParams extends WorkspaceResourceLimits {
  readonly runId: string;
  /** Identifier of an operator-mounted, immutable snapshot beneath snapshotRoot. */
  readonly snapshotId: string;
  /** Registry references must be pinned to a sha256 digest. */
  readonly imageRef: string;
  readonly baseCommit: string;
  readonly allowedPaths: readonly string[];
}

export interface WorkspaceSnapshotParams {
  readonly runId: string;
  readonly label?: string;
}

export interface WorkspaceExecuteCheckParams {
  readonly runId: string;
  readonly check: WorkspaceCheckKind;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface WorkspaceListParams {
  readonly runId: string;
  readonly path?: string;
}

export interface WorkspaceListResult {
  readonly runId: string;
  readonly paths: readonly string[];
  readonly truncated: false;
}

export interface WorkspaceReadParams {
  readonly runId: string;
  readonly path: string;
  readonly offset?: number;
  readonly maxBytes?: number;
}

export interface WorkspaceReadResult {
  readonly runId: string;
  readonly path: string;
  readonly content: string;
  readonly sizeBytes: number;
  readonly truncated: boolean;
}

export interface WorkspacePatchOperation {
  readonly type: 'write' | 'append';
  readonly path: string;
  readonly content: string;
}

export interface WorkspaceApplyPatchParams {
  readonly runId: string;
  readonly operations: readonly WorkspacePatchOperation[];
}

export interface WorkspaceApplyPatchResult {
  readonly runId: string;
  readonly files: readonly string[];
}

export interface WorkspaceDiffParams {
  readonly runId: string;
  readonly maxOutputBytes?: number;
}

export interface WorkspaceCommitLocalParams {
  readonly runId: string;
  readonly message: string;
}

export interface WorkspaceRollbackParams {
  readonly runId: string;
  /** Omit to restore the immutable base snapshot. */
  readonly snapshotId?: string;
}

export interface WorkspaceRunParams {
  readonly runId: string;
}

export interface WorkspaceReconcileParams {
  readonly olderThanMs?: number;
}

export interface WorkspaceInfo {
  readonly contractVersion: typeof WORKSPACE_CONTRACT_VERSION;
  readonly runId: string;
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly baseCommit: string;
  readonly imageRef: string;
  readonly engine: WorkspaceEngine;
  readonly status: WorkspaceStatus;
  readonly allowedPaths: readonly string[];
  readonly limits: WorkspaceResourceLimits;
  readonly manifestSha256: string;
  readonly headCommit: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cancelledAt?: string;
  readonly destroyedAt?: string;
}

export interface WorkspaceSnapshotInfo {
  readonly runId: string;
  readonly snapshotId: string;
  readonly label?: string;
  readonly base: boolean;
  readonly treeSha256: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface WorkspaceDiffFile {
  readonly path: string;
  readonly status: string;
}

export interface WorkspaceDiffResult {
  readonly runId: string;
  readonly headCommit: string;
  readonly clean: boolean;
  readonly scopeClean: true;
  readonly files: readonly WorkspaceDiffFile[];
  readonly unifiedDiff: string;
  readonly diffSha256: string;
  readonly sizeBytes: number;
  readonly truncated: false;
}

export interface WorkspaceCommitLocalResult {
  readonly runId: string;
  readonly commitSha: string;
  readonly branch: string;
  readonly files: readonly string[];
  readonly message: string;
  readonly pushed: false;
}

export interface WorkspaceCheckResult {
  readonly runId: string;
  readonly check: WorkspaceCheckKind;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly totalOutputBytes: number;
}

export interface WorkspaceCancellationResult {
  readonly runId: string;
  readonly status: 'cancelled';
  readonly cancelledAt: string;
}

export interface WorkspaceDestroyResult {
  readonly runId: string;
  readonly status: 'destroyed';
  readonly destroyedAt: string;
}

export interface WorkspaceReconcileResult {
  readonly removedWorkspaceIds: readonly string[];
  readonly removedContainerIds: readonly string[];
  readonly retainedWorkspaceIds: readonly string[];
}

/** Result of a fixed command executed by the isolation backend, never a host process. */
export interface SandboxCommandResult {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SandboxContainerSpec {
  readonly runId: string;
  readonly workspaceId: string;
  readonly workspaceHostPath: string;
  readonly imageRef: string;
  readonly manifest: EphemeralSandboxManifest;
  readonly pidsLimit: number;
}

export interface SandboxExecOptions {
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

/**
 * Backend port. Commands passed here are trusted, fixed templates composed by the
 * workspace service; RPC callers can only select a WorkspaceCheckKind.
 */
export interface SandboxExecutor {
  readonly engine: WorkspaceEngine;
  initialize(signal?: AbortSignal): Promise<void>;
  ensureContainer(spec: SandboxContainerSpec, signal?: AbortSignal): Promise<string>;
  execute(
    containerId: string,
    command: readonly string[],
    options: SandboxExecOptions
  ): Promise<SandboxCommandResult>;
  removeContainer(containerId: string, signal?: AbortSignal): Promise<void>;
  reconcile(workspaceRoot: string, signal?: AbortSignal): Promise<readonly string[]>;
}

export interface WorkspaceOperations {
  createWorkspace(params: WorkspaceCreateParams): Promise<WorkspaceInfo>;
  snapshotWorkspace(params: WorkspaceSnapshotParams): Promise<WorkspaceSnapshotInfo>;
  executeCheck(
    params: WorkspaceExecuteCheckParams,
    signal?: AbortSignal
  ): Promise<WorkspaceCheckResult>;
  listWorkspace(params: WorkspaceListParams): Promise<WorkspaceListResult>;
  readWorkspaceFile(params: WorkspaceReadParams): Promise<WorkspaceReadResult>;
  applyWorkspacePatch(params: WorkspaceApplyPatchParams): Promise<WorkspaceApplyPatchResult>;
  diffWorkspace(params: WorkspaceDiffParams): Promise<WorkspaceDiffResult>;
  commitLocal(params: WorkspaceCommitLocalParams): Promise<WorkspaceCommitLocalResult>;
  rollbackWorkspace(params: WorkspaceRollbackParams): Promise<WorkspaceInfo>;
  cancelWorkspace(params: WorkspaceRunParams): Promise<WorkspaceCancellationResult>;
  destroyWorkspace(params: WorkspaceRunParams): Promise<WorkspaceDestroyResult>;
  getWorkspace(params: WorkspaceRunParams): Promise<WorkspaceInfo>;
  reconcileWorkspaces(params: WorkspaceReconcileParams): Promise<WorkspaceReconcileResult>;
  cancelAll(): Promise<void>;
  close(): Promise<void>;
}

export interface WorkspaceRpcMethods {
  'workspace.create': {
    params: WorkspaceCreateParams;
    result: WorkspaceInfo;
  };
  'workspace.snapshot': {
    params: WorkspaceSnapshotParams;
    result: WorkspaceSnapshotInfo;
  };
  'workspace.execute-check': {
    params: WorkspaceExecuteCheckParams;
    result: WorkspaceCheckResult;
  };
  'workspace.list': { params: WorkspaceListParams; result: WorkspaceListResult };
  'workspace.read': { params: WorkspaceReadParams; result: WorkspaceReadResult };
  'workspace.apply-patch': {
    params: WorkspaceApplyPatchParams;
    result: WorkspaceApplyPatchResult;
  };
  'workspace.diff': {
    params: WorkspaceDiffParams;
    result: WorkspaceDiffResult;
  };
  'workspace.commit-local': {
    params: WorkspaceCommitLocalParams;
    result: WorkspaceCommitLocalResult;
  };
  'workspace.rollback': {
    params: WorkspaceRollbackParams;
    result: WorkspaceInfo;
  };
  'workspace.cancel': {
    params: WorkspaceRunParams;
    result: WorkspaceCancellationResult;
  };
  'workspace.destroy': {
    params: WorkspaceRunParams;
    result: WorkspaceDestroyResult;
  };
  'workspace.get': {
    params: WorkspaceRunParams;
    result: WorkspaceInfo;
  };
  'workspace.reconcile': {
    params: WorkspaceReconcileParams;
    result: WorkspaceReconcileResult;
  };
}

export type WorkspaceRpcMethod = keyof WorkspaceRpcMethods;
export type WorkspaceRpcRequest = {
  [Method in WorkspaceRpcMethod]: {
    readonly id: string;
    readonly method: Method;
    readonly params: WorkspaceRpcMethods[Method]['params'];
  };
}[WorkspaceRpcMethod];

export type WorkspaceRpcResponse = {
  [Method in WorkspaceRpcMethod]: {
    readonly id: string;
    readonly ok: true;
    readonly result: WorkspaceRpcMethods[Method]['result'];
  };
}[WorkspaceRpcMethod];

export type WorkspaceRpcErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'OUTPUT_LIMIT'
  | 'EXECUTOR_UNAVAILABLE'
  | 'INTERNAL';

export interface WorkspaceRpcError {
  readonly code: WorkspaceRpcErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type WorkspaceRpcFailure = {
  readonly id: string;
  readonly ok: false;
  readonly error: WorkspaceRpcError;
};

/** Adapter for jobs-worker; it does not grant business authorization or call models. */
export interface WorkspaceSandboxClient {
  createWorkspace(params: WorkspaceCreateParams): Promise<WorkspaceInfo>;
  snapshotWorkspace(params: WorkspaceSnapshotParams): Promise<WorkspaceSnapshotInfo>;
  executeCheck(
    params: WorkspaceExecuteCheckParams,
    signal?: AbortSignal
  ): Promise<WorkspaceCheckResult>;
  listWorkspace(params: WorkspaceListParams): Promise<WorkspaceListResult>;
  readWorkspaceFile(params: WorkspaceReadParams): Promise<WorkspaceReadResult>;
  applyWorkspacePatch(params: WorkspaceApplyPatchParams): Promise<WorkspaceApplyPatchResult>;
  diffWorkspace(params: WorkspaceDiffParams): Promise<WorkspaceDiffResult>;
  commitLocal(params: WorkspaceCommitLocalParams): Promise<WorkspaceCommitLocalResult>;
  rollbackWorkspace(params: WorkspaceRollbackParams): Promise<WorkspaceInfo>;
  cancelWorkspace(params: WorkspaceRunParams): Promise<WorkspaceCancellationResult>;
  destroyWorkspace(params: WorkspaceRunParams): Promise<WorkspaceDestroyResult>;
  getWorkspace(params: WorkspaceRunParams): Promise<WorkspaceInfo>;
  reconcileWorkspaces(params: WorkspaceReconcileParams): Promise<WorkspaceReconcileResult>;
}

/**
 * Typed client for jobs-worker. The bearer token is supplied by the caller
 * from a company-scoped secret reference; it is never stored in ORM, queue
 * payloads, artifacts, or Board DTOs.
 */
export function createWorkspaceHttpClient(options: {
  readonly origin: string;
  readonly token: string;
  readonly fetch?: FetchLike;
  readonly maxResponseBytes?: number;
}): WorkspaceSandboxClient {
  if (typeof options.token !== 'string' || options.token.length === 0) {
    throw new Error('agent-sandbox credential is required');
  }
  let url: URL;
  try {
    url = new URL(options.origin);
  } catch {
    throw new Error('Invalid agent-sandbox origin');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new Error(
      'agent-sandbox origin must be an exact origin without path, query or credentials'
    );
  }
  const rpcUrl = new URL('/rpc', url).toString();
  const fetchFn = options.fetch ?? globalThis.fetch;
  const maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
  let sequence = 0;

  const call = async <T>(method: WorkspaceRpcMethod, params: unknown): Promise<T> => {
    if (typeof options.token !== 'string' || options.token.length === 0) {
      throw new Error('agent-sandbox credential is required');
    }
    sequence += 1;
    const body = JSON.stringify({ id: `ws-${Date.now()}-${sequence}`, method, params });
    const response = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(130_000),
    } as Parameters<FetchLike>[1]);
    const raw = await readBoundedRpcBody(
      response as unknown as { body?: unknown },
      maxResponseBytes
    );
    let decoded: { ok?: unknown; result?: unknown; error?: WorkspaceRpcError };
    try {
      decoded = JSON.parse(raw) as typeof decoded;
    } catch {
      throw new Error('agent-sandbox returned an invalid RPC response');
    }
    if (decoded.ok !== true) {
      const error = decoded.error ?? {
        code: 'INTERNAL' as const,
        message: 'agent-sandbox returned a failure',
        retryable: false,
      };
      const failure = new Error(error.message) as Error & {
        code: WorkspaceRpcErrorCode;
        retryable: boolean;
      };
      failure.code = error.code;
      failure.retryable = error.retryable;
      throw failure;
    }
    return decoded.result as T;
  };

  return {
    createWorkspace: (params) => call('workspace.create', params),
    snapshotWorkspace: (params) => call('workspace.snapshot', params),
    executeCheck: (params) => call('workspace.execute-check', params),
    listWorkspace: (params) => call('workspace.list', params),
    readWorkspaceFile: (params) => call('workspace.read', params),
    applyWorkspacePatch: (params) => call('workspace.apply-patch', params),
    diffWorkspace: (params) => call('workspace.diff', params),
    commitLocal: (params) => call('workspace.commit-local', params),
    rollbackWorkspace: (params) => call('workspace.rollback', params),
    cancelWorkspace: (params) => call('workspace.cancel', params),
    destroyWorkspace: (params) => call('workspace.destroy', params),
    getWorkspace: (params) => call('workspace.get', params),
    reconcileWorkspaces: (params) => call('workspace.reconcile', params),
  };
}

async function readBoundedRpcBody(
  response: { body?: unknown },
  maxResponseBytes: number
): Promise<string> {
  const body = response.body;
  if (body && typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > maxResponseBytes)
        throw new Error('agent-sandbox RPC response exceeded its byte limit');
      if (value) chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  }
  // Fail closed for non-standard fetch shims rather than guessing at their body shape.
  throw new Error('agent-sandbox fetch implementation must return a streaming response');
}

/** Reuse ai-runtime's existing bounded output verifier once a diff has been collected. */
export function verifyWorkspaceCheck(
  manifest: EphemeralSandboxManifest,
  check: WorkspaceCheckResult,
  unifiedDiff: string,
  baselineScoreBps = 5_000,
  candidateScoreBps = 5_000
): SandboxVerificationResult {
  const output: SandboxExecutionOutput = {
    runId: check.runId,
    exitCode: check.cancelled ? 130 : check.timedOut ? 124 : check.exitCode,
    durationMs: check.durationMs,
    stdout: check.stdout,
    stderr: check.stderr,
    unifiedDiff,
  };
  const result = verifySandboxExecutionOutput(
    manifest,
    output,
    baselineScoreBps,
    candidateScoreBps
  );
  return check.cancelled || check.truncated ? { ...result, passed: false } : result;
}
