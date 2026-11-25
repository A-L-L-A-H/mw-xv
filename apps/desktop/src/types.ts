import type {
  CompiledExecutionPacket,
  ExecutionPacketContractInput,
  ExecutionPacketPolicyLimits,
  ExecutionPacketSkillRef,
  ExistingPlanTaskRef,
  OverlapReport,
  OverlapRequirementInput,
  RepoSnapshot,
} from '@moonwitness/ai-runtime';
import type { Domain, JsonObject, JsonValue } from '@moonwitness/types';

export type RiskTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export type DataClassification = 'local_only' | 'cloud_eligible' | 'restricted';

export type DesktopActionKind =
  | 'repo.read'
  | 'repo.search'
  | 'git.status'
  | 'git.diff'
  | 'sidecar.read'
  | 'mcp.read'
  | 'worktree.create'
  | 'worktree.write'
  | 'worktree.test'
  | 'pty.exec_local'
  | 'mcp.local_write'
  | 'git.commit_local'
  | 'sidecar.sync_local'
  | 'service.local_start'
  | 'git.push_remote'
  | 'network.egress'
  | 'cloud.provider_call'
  | 'upstream.sync_push'
  | 'secret.read'
  | 'system.destructive'
  | 'worktree.escape'
  | 'privilege.escalate';

export interface DesktopCapabilityGrant {
  readonly grantId: string;
  readonly companyId: number;
  readonly agentId: number;
  readonly workContractId?: number | null;
  readonly capability: string;
  readonly policyVersion: number;
  readonly allowedRiskTier: RiskTier;
  readonly allowedClassification: DataClassification;
  readonly maxCallsPerRun: number;
  readonly expiresAt: string;
  readonly revokedAt?: string | null;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly allowedPaths?: readonly string[];
}

export interface HumanApprovalToken {
  readonly tokenId: string;
  readonly approvedByUserId: number;
  readonly action: DesktopActionKind;
  readonly runId: string;
  readonly scopeHash?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly singleUse?: boolean;
  readonly nonce?: string;
  readonly signature?: string;
}

export interface NativeHumanApprovalRequest {
  readonly approvedByUserId: number;
  readonly action: DesktopActionKind;
  readonly runId: string;
  readonly scopeHash?: string;
  readonly ttlMs?: number;
  readonly singleUse?: boolean;
}

export interface DesktopKeychainSecretStore {
  setSecret(secretRef: string, secretValue: string): void;
  resolveSecret(secretRef: string): string | null;
  deleteSecret(secretRef: string): boolean;
  listSecretRefs(): readonly string[];
}

export interface SingleWriterLockMetadata {
  readonly pid: number;
  readonly startedAt: string;
  readonly startTimeMs: number;
  readonly host: string;
  readonly sqlitePath: string;
  readonly lockPath: string;
}

export interface DesktopActionAuthContext {
  readonly companyId: number;
  readonly agentId: number;
  readonly workContractId?: number;
  readonly expectedPolicyVersion: number;
  readonly dataClassification: DataClassification;
  readonly grant: DesktopCapabilityGrant;
  readonly humanApproval?: HumanApprovalToken;
}

export interface LocalMcpServerConfig {
  readonly serverId: string;
  readonly name: string;
  readonly transport: 'stdio' | 'loopback_http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly endpointUrl?: string;
  readonly requiredCapability: string;
  readonly maxRiskTier: RiskTier;
  readonly allowedDataClassifications: readonly DataClassification[];
  readonly maxCallsPerRun: number;
  readonly timeoutMs?: number;
  readonly enabled: boolean;
}

export interface DesktopHarnessConfig {
  readonly repoRoot: string;
  readonly worktreeBaseDir?: string;
  readonly sqlitePath: string;
  readonly desktopHomeDir?: string;
  readonly boardOrigin: string;
  readonly apiBaseUrl: string;
  readonly localAiEndpoint?: string;
  readonly allowedIpcOrigins?: readonly string[];
  readonly allowedPathPrefixes?: readonly string[];
  readonly allowedCommands?: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly offlineMode?: boolean;
  readonly activeCompanyId?: number | null;
  readonly requireSignedApprovals?: boolean;
  readonly knownSecrets?: readonly string[];
  readonly mcpServers?: readonly LocalMcpServerConfig[];
}

export interface GitWorktreeLease {
  readonly leaseId: string;
  readonly runId: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly baseRef: string;
  readonly headCommit: string;
  readonly fencingToken: number;
  readonly status: 'active' | 'released' | 'pruned';
  readonly createdAt: string;
  readonly releasedAt?: string;
  readonly allowedPaths: readonly string[];
}

export interface AcquireWorktreeOptions {
  readonly runId: string;
  readonly baseRef?: string;
  readonly branchName?: string;
  readonly allowedPaths?: readonly string[];
}

export interface WorktreeReadFileOptions {
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface DesktopRepoSnapshotOptions {
  readonly rootLabel?: string;
  readonly targetPath?: string;
  readonly maxFiles?: number;
  readonly maxManifestBytes?: number;
  readonly maxDocHeadings?: number;
}

export interface DesktopExecutionPacketRequest {
  readonly contract: ExecutionPacketContractInput;
  readonly allowedCapabilities: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly approvedSkills?: readonly ExecutionPacketSkillRef[];
  readonly policyLimits?: ExecutionPacketPolicyLimits;
  readonly targetBranch?: string;
  readonly snapshotOptions?: DesktopRepoSnapshotOptions;
}

export interface DesktopOverlapDetectionRequest {
  readonly requirements: readonly OverlapRequirementInput[];
  readonly existingTasks?: readonly ExistingPlanTaskRef[];
  readonly snapshotOptions?: DesktopRepoSnapshotOptions;
}

export interface WorktreeFileContent {
  readonly runId: string;
  readonly relativePath: string;
  readonly content: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly totalLines?: number;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly redacted?: boolean;
}

export interface WorktreeTreeEntry {
  readonly path: string;
  readonly kind: 'file' | 'dir';
  readonly sizeBytes?: number;
}

export interface WorktreeMergeResult {
  readonly runId: string;
  readonly sourceRef: string;
  readonly merged: boolean;
  readonly conflicted: boolean;
  readonly abortedCleanly: boolean;
  readonly message: string;
}

export interface WorktreeFileWriteResult {
  readonly runId: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface WorktreeDiffFile {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface WorktreeDiffSummary {
  readonly runId: string;
  readonly leaseId: string;
  readonly branchName: string;
  readonly headCommit: string;
  readonly clean: boolean;
  readonly files: readonly WorktreeDiffFile[];
  readonly outOfScopeFiles: readonly string[];
  readonly scopeClean: boolean;
  readonly patch: string;
  readonly patchSha256: string;
  readonly patchStorageKey?: string;
}

export interface WorktreeCommitResult {
  readonly runId: string;
  readonly leaseId: string;
  readonly branchName: string;
  readonly commitSha: string;
  readonly message: string;
  readonly stagedFiles: readonly string[];
}

export interface BoundedPtyCommandRequest {
  readonly runId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwdRelative?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly envOverrides?: Readonly<Record<string, string>>;
  readonly action?: DesktopActionKind;
  readonly signal?: AbortSignal;
}

export interface BoundedPtyCommandResult {
  readonly runId: string;
  readonly leaseId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
  readonly durationMs: number;
}

export interface RiskEvaluationRequest {
  readonly runId: string;
  readonly action: DesktopActionKind;
  readonly companyId: number;
  readonly agentId: number;
  readonly workContractId?: number;
  readonly expectedPolicyVersion: number;
  readonly dataClassification: DataClassification;
  readonly grant: DesktopCapabilityGrant;
  readonly humanApproval?: HumanApprovalToken;
  readonly targetPath?: string;
  readonly targetCommand?: string;
  readonly targetEndpointUrl?: string;
  readonly now?: Date;
}

export interface RiskAuditRecord {
  readonly auditId: string;
  readonly runId: string;
  readonly action: DesktopActionKind;
  readonly requestedTier: RiskTier;
  readonly resolvedTier: RiskTier;
  readonly allowed: boolean;
  readonly reasonCode: string;
  readonly reason: string;
  readonly companyId: number;
  readonly agentId: number;
  readonly grantId: string;
  readonly timestamp: string;
}

export interface RiskEvaluationDecision {
  readonly allowed: boolean;
  readonly resolvedTier: RiskTier;
  readonly reasonCode: string;
  readonly reason: string;
  readonly requiresHumanApproval: boolean;
  readonly remainingQuota: number;
  readonly auditEntry: RiskAuditRecord;
}

export interface LocalSidecarState {
  readonly status: 'stopped' | 'ready' | 'offline' | 'syncing' | 'degraded';
  readonly sqlitePath: string;
  readonly schemaVersion: number;
  readonly offlineMode: boolean;
  readonly activeCompanyId?: number | null;
  readonly installedAddons?: readonly string[];
  readonly lockPath?: string | null;
  readonly storageDir?: string | null;
  readonly registeredOrmModels: readonly string[];
  readonly pendingOutboxCount: number;
  readonly syncedOutboxCount: number;
  readonly failedOutboxCount: number;
  readonly conflictOutboxCount: number;
  readonly activeRunCount: number;
  readonly lastSyncAt: string | null;
  readonly lastSyncError: string | null;
}

export type PcwArtifactKind =
  'report' | 'transcript' | 'tool_output' | 'evidence_bundle' | 'eval_result';

export type PcwOutboxModelName = 'ai.agent_run' | 'ai.artifact_manifest' | 'base.outbox_event';

export type PcwSyncStatus = 'pending' | 'processing' | 'synced' | 'failed' | 'conflict';

export interface PcwArtifactDigest {
  readonly storageKey: string;
  readonly artifactKind: PcwArtifactKind;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly dataClassification: DataClassification;
  readonly sourceSha?: string;
  readonly relativePath?: string;
}

export interface PcwSyncEnvelope {
  readonly envelopeId: string;
  readonly companyId: number;
  readonly workContractId: number;
  readonly agentRunId: string;
  readonly agentId: number;
  readonly correlationId: string;
  readonly modelName: PcwOutboxModelName;
  readonly fencingToken: number;
  readonly runStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly artifacts: readonly PcwArtifactDigest[];
  readonly envelopeSha256: string;
  readonly syncStatus: PcwSyncStatus;
  readonly attempts: number;
  readonly createdAt: string;
  readonly syncedAt: string | null;
  readonly upstreamRecordId: number | null;
  readonly lastError: string | null;
}

export interface EnqueuePcwEnvelopeInput {
  readonly envelopeId?: string;
  readonly companyId: number;
  readonly workContractId: number;
  readonly agentRunId: string;
  readonly agentId: number;
  readonly correlationId: string;
  readonly modelName?: PcwOutboxModelName;
  readonly fencingToken: number;
  readonly runStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly artifacts: readonly PcwArtifactDigest[];
  readonly checkpoint?: JsonObject;
  readonly worktreeLeaseId?: string;
}

export interface UpstreamPcwSyncResult {
  readonly outcome: 'synced' | 'conflict' | 'retryable_error';
  readonly upstreamRecordId?: number;
  readonly message?: string;
}

export interface UpstreamPcwSyncTransport {
  pushEnvelope(envelope: PcwSyncEnvelope): Promise<UpstreamPcwSyncResult>;
}

export interface DesktopLeaseClaimRequest {
  readonly companyId: number;
  readonly workContractId: number;
  readonly hostId: string;
  readonly requestedLeaseSeconds?: number;
}

export interface DesktopLeaseClaimResponse {
  readonly granted: boolean;
  readonly leaseOwner: string;
  readonly fencingToken: number;
  readonly leaseUntil: string;
}

export interface DesktopPullSyncRequest {
  readonly companyId: number;
  readonly sinceCursor?: string;
}

export interface DesktopPullSyncResponse {
  readonly companyId: number;
  readonly nextCursor: string;
  readonly workContracts: readonly JsonObject[];
  readonly capabilityGrants: readonly JsonObject[];
  readonly executionPolicies: readonly JsonObject[];
}

export interface DesktopArtifactUploadRequest {
  readonly companyId: number;
  readonly workContractId: number;
  readonly artifact: PcwArtifactDigest;
  readonly contentBase64: string;
}

export interface DesktopArtifactUploadResponse {
  readonly storageKey: string;
  readonly sha256: string;
  readonly verified: boolean;
}

export interface PcwSyncBatchResult {
  readonly attempted: number;
  readonly synced: number;
  readonly failed: number;
  readonly conflicts: number;
  readonly skippedOffline: boolean;
  readonly results: readonly {
    readonly envelopeId: string;
    readonly outcome: 'synced' | 'conflict' | 'retryable_error';
    readonly upstreamRecordId: number | null;
    readonly error: string | null;
  }[];
}

export interface LocalMcpToolInvocationRequest {
  readonly runId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly arguments: JsonObject;
  readonly auth: DesktopActionAuthContext;
  readonly idempotencyKey?: string;
}

export interface LocalMcpToolInvocationResult {
  readonly serverId: string;
  readonly toolName: string;
  readonly output: JsonValue;
  readonly outputSha256: string;
  readonly redacted: boolean;
  readonly callCountForRun: number;
  readonly durationMs: number;
  readonly deduplicated?: boolean;
  readonly framedPromptContext?: string;
}

export type LocalMcpToolHandler = (
  toolName: string,
  args: JsonObject,
  signal: AbortSignal
) => Promise<JsonValue>;

export interface DesktopBridgeSnapshot {
  readonly protocolVersion: '1.0';
  readonly hostSurface: 'apps/board';
  readonly boardOrigin: string;
  readonly apiBaseUrl: string;
  readonly localAiEndpoint: string | null;
  readonly activeLeases: readonly GitWorktreeLease[];
  readonly sidecar: LocalSidecarState;
  readonly mcpServers: readonly LocalMcpServerConfig[];
}

export interface DesktopBridgeHostSurface {
  __MW_DESKTOP__?: DesktopCapabilityBridge;
}

export type SqliteColumnKind = 'boolean' | 'timestamp' | 'json' | 'integer' | 'text';

export type SqliteRecordSchema = Readonly<Record<string, SqliteColumnKind>>;

export interface OrphanAttachmentGcOptions {
  readonly retentionMs?: number;
  readonly now?: Date;
  readonly dryRun?: boolean;
}

export interface OrphanAttachmentGcResult {
  readonly scannedFiles: number;
  readonly retainedFiles: number;
  readonly deletedFiles: readonly string[];
  readonly freedBytes: number;
  readonly dryRun: boolean;
}

export type DesktopStreamEventKind = 'pty.output' | 'pty.exit' | 'harness.step' | 'sync.progress';

export interface DesktopStreamEvent {
  readonly eventId: string;
  readonly kind: DesktopStreamEventKind;
  readonly runId: string;
  readonly timestamp: string;
  readonly payload: JsonObject;
}

export interface DesktopStreamSubscribeOptions {
  readonly runId?: string;
  readonly kinds?: readonly DesktopStreamEventKind[];
  readonly maxBufferedEvents?: number;
}

export interface DesktopStreamSubscription {
  readonly subscriptionId: string;
  readonly maxBufferedEvents: number;
  getDroppedCount(): number;
  getBufferedCount(): number;
  flush(): readonly DesktopStreamEvent[];
  unsubscribe(): void;
}

export interface DesktopUpdateCheckSummary {
  readonly status: 'up-to-date' | 'available' | 'error';
  readonly currentVersion: string;
  readonly availableVersion?: string;
  readonly releaseUrl?: string;
  readonly errorMessage?: string;
}

export interface DesktopUpdateInstallSummary {
  readonly status: 'ready' | 'up-to-date' | 'error';
  readonly availableVersion?: string;
  readonly errorMessage?: string;
}

export interface DesktopCapabilityBridge {
  readonly protocolVersion: '1.0';
  readonly hostSurface: 'apps/board';
  getStatus(): Promise<DesktopBridgeSnapshot>;
  checkForUpdates?(): Promise<DesktopUpdateCheckSummary>;
  installUpdate?(): Promise<DesktopUpdateInstallSummary>;
  verifySenderOrigin(origin: string, windowLabel?: string): boolean;
  issueNativeApprovalToken(request: NativeHumanApprovalRequest): HumanApprovalToken;
  readonly keychain: {
    registerSecretRef(secretRef: string, secretValue: string): void;
    hasSecretRef(secretRef: string): boolean;
    listSecretRefs(): readonly string[];
  };
  readonly worktree: {
    acquire(options: AcquireWorktreeOptions): Promise<GitWorktreeLease>;
    listLeases(): Promise<readonly GitWorktreeLease[]>;
    readFile(runId: string, relativePath: string): Promise<WorktreeFileContent>;
    writeFile(
      runId: string,
      relativePath: string,
      content: string,
      auth: DesktopActionAuthContext
    ): Promise<WorktreeFileWriteResult>;
    diff(runId: string): Promise<WorktreeDiffSummary>;
    repoSnapshot(
      runId: string,
      auth: DesktopActionAuthContext,
      options?: DesktopRepoSnapshotOptions
    ): Promise<RepoSnapshot>;
    compileExecutionPacket(
      runId: string,
      auth: DesktopActionAuthContext,
      request: DesktopExecutionPacketRequest
    ): Promise<CompiledExecutionPacket>;
    detectOverlap(
      runId: string,
      auth: DesktopActionAuthContext,
      request: DesktopOverlapDetectionRequest
    ): Promise<OverlapReport>;
    commit(
      runId: string,
      message: string,
      auth: DesktopActionAuthContext
    ): Promise<WorktreeCommitResult>;
    release(runId: string): Promise<GitWorktreeLease>;
  };
  readonly pty: {
    execute(
      request: BoundedPtyCommandRequest,
      auth: DesktopActionAuthContext
    ): Promise<BoundedPtyCommandResult>;
  };
  readonly risk: {
    evaluate(request: RiskEvaluationRequest): RiskEvaluationDecision;
    getAuditLog(limit?: number): readonly RiskAuditRecord[];
  };
  readonly sidecar: {
    getState(): LocalSidecarState;
    setOfflineMode(offline: boolean): LocalSidecarState;
    setActiveCompany(companyId: number | null): LocalSidecarState;
    getActiveCompany(): number | null;
    initializeOrmAddons(): Promise<readonly string[]>;
    enqueuePcwEnvelope(input: EnqueuePcwEnvelopeInput): PcwSyncEnvelope;
    listEnvelopes(
      domain?: Domain,
      options?: { readonly companyId?: number }
    ): readonly PcwSyncEnvelope[];
    syncPending(transport: UpstreamPcwSyncTransport): Promise<PcwSyncBatchResult>;
    pruneOrphanAttachmentStorage(options?: OrphanAttachmentGcOptions): OrphanAttachmentGcResult;
  };
  readonly mcp: {
    registerServer(config: LocalMcpServerConfig): LocalMcpServerConfig;
    registerHandler(serverId: string, handler: LocalMcpToolHandler): void;
    listServers(): readonly LocalMcpServerConfig[];
    invoke(request: LocalMcpToolInvocationRequest): Promise<LocalMcpToolInvocationResult>;
  };
  readonly events: {
    subscribe(
      listener: (event: DesktopStreamEvent) => void,
      options?: DesktopStreamSubscribeOptions
    ): DesktopStreamSubscription;
    emit(event: Omit<DesktopStreamEvent, 'eventId' | 'timestamp'>): DesktopStreamEvent;
    getActiveListenerCount(): number;
  };
  dispose(): void;
}

declare global {
  interface Window {
    __MW_DESKTOP__?: DesktopCapabilityBridge;
  }
}
