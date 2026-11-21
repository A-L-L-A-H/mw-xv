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
  readonly boardOrigin: string;
  readonly apiBaseUrl: string;
  readonly localAiEndpoint?: string;
  readonly allowedPathPrefixes?: readonly string[];
  readonly allowedCommands?: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly offlineMode?: boolean;
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

export interface WorktreeFileContent {
  readonly runId: string;
  readonly relativePath: string;
  readonly content: string;
  readonly sha256: string;
  readonly sizeBytes: number;
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
  readonly patch: string;
  readonly patchSha256: string;
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
}

export interface LocalMcpToolInvocationResult {
  readonly serverId: string;
  readonly toolName: string;
  readonly output: JsonValue;
  readonly outputSha256: string;
  readonly redacted: boolean;
  readonly callCountForRun: number;
  readonly durationMs: number;
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

export interface DesktopCapabilityBridge {
  readonly protocolVersion: '1.0';
  readonly hostSurface: 'apps/board';
  getStatus(): Promise<DesktopBridgeSnapshot>;
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
    enqueuePcwEnvelope(input: EnqueuePcwEnvelopeInput): PcwSyncEnvelope;
    listEnvelopes(domain?: Domain): readonly PcwSyncEnvelope[];
    syncPending(transport: UpstreamPcwSyncTransport): Promise<PcwSyncBatchResult>;
  };
  readonly mcp: {
    registerServer(config: LocalMcpServerConfig): LocalMcpServerConfig;
    registerHandler(serverId: string, handler: LocalMcpToolHandler): void;
    listServers(): readonly LocalMcpServerConfig[];
    invoke(request: LocalMcpToolInvocationRequest): Promise<LocalMcpToolInvocationResult>;
  };
  dispose(): void;
}

declare global {
  interface Window {
    __MW_DESKTOP__?: DesktopCapabilityBridge;
  }
}
