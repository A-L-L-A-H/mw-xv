/**
 * Local copy of the cross-package workspace contract types.
 *
 * The sidecar is built from its own Docker context and must not depend on
 * source files from other workspace packages at build or runtime. These types
 * are structurally identical to `@moonwitness/ai-runtime`'s
 * `src/workspace-contract.ts`; tests assert assignability in both directions.
 */

export const WORKSPACE_CONTRACT_VERSION = 1 as const;

export type WorkspaceEngine = 'rootless-docker';
export type WorkspaceStatus = 'active' | 'cancelled' | 'destroyed';
export type WorkspaceCheckKind =
  | 'node-test'
  | 'bun-test'
  | 'bun-typecheck'
  | 'bun-lint'
  | 'bun-build'
  | 'vitest-run'
  | 'tsc-noemit';

export interface EphemeralSandboxManifest {
  readonly runId: string;
  readonly engine: 'docker' | 'microvm';
  readonly imageRef: string;
  readonly command: readonly string[];
  readonly networkDisabled: true;
  readonly readOnlyRootFs: true;
  readonly secretsInjected: false;
  readonly droppedCapabilities: readonly ['ALL'];
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly timeoutMs: number;
  readonly cliArgs: readonly string[];
  readonly sanitizedEnvKeys: readonly string[];
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly manifestSha256: string;
}

export interface WorkspaceResourceLimits {
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly pidsLimit: number;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface WorkspaceCreateParams extends WorkspaceResourceLimits {
  readonly runId: string;
  readonly snapshotId: string;
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

export type WorkspaceRpcMethod =
  | 'workspace.create'
  | 'workspace.snapshot'
  | 'workspace.execute-check'
  | 'workspace.list'
  | 'workspace.read'
  | 'workspace.apply-patch'
  | 'workspace.diff'
  | 'workspace.commit-local'
  | 'workspace.rollback'
  | 'workspace.cancel'
  | 'workspace.destroy'
  | 'workspace.get'
  | 'workspace.reconcile';

export interface WorkspaceRpcRequest {
  readonly id: string;
  readonly method: WorkspaceRpcMethod;
  readonly params: unknown;
}

export interface WorkspaceRpcResponse {
  readonly id: string;
  readonly ok: true;
  readonly result: unknown;
}

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

export interface WorkspaceRpcFailure {
  readonly id: string;
  readonly ok: false;
  readonly error: {
    readonly code: WorkspaceRpcErrorCode;
    readonly message: string;
    readonly retryable: boolean;
  };
}
