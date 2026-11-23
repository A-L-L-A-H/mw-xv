export * from './types.js';
export type {
  CompiledExecutionPacket,
  ExecutionPacketInput,
  ExistingPlanTaskRef,
  OverlapFinding,
  OverlapReport,
  OverlapRequirementInput,
  RepoGitRevision,
  RepoSnapshot,
} from '@moonwitness/ai-runtime';
export {
  DesktopRiskGate,
  NativeHumanApprovalIssuer,
  isLoopbackEndpointUrl,
  isLoopbackHostname,
  isSecretOrSensitivePath,
  redactSensitiveText,
  redactSensitiveValue,
  resolveRiskTierForAction,
} from './risk-gate.js';
export {
  WorktreeSandbox,
  terminateProcessTree,
  type WorktreeSandboxOptions,
} from './worktree-sandbox.js';
export {
  DESKTOP_ADDONS,
  LocalSidecarController,
  acquireSingleWriterLock,
  buildArtifactDigest,
  computeEnvelopeSha256,
  isProcessAlive,
  releaseSingleWriterLock,
  resolveDesktopBackupsDir,
  resolveDesktopDatabasePath,
  resolveDesktopHomeDir,
  type DesktopDatabaseBackupResult,
  type LocalSidecarControllerOptions,
} from './local-sidecar.js';
export {
  DEFAULT_LOG_MAX_BYTES_PER_FILE,
  DEFAULT_LOG_MAX_FILES,
  RotatingLocalLogSink,
  createDesktopLogger,
  resolveDesktopLogsDir,
  type DesktopLoggerHandle,
  type DesktopLoggerOptions,
} from './logger.js';
export {
  DesktopUpstreamSyncClient,
  type DesktopUpstreamSyncClientOptions,
  type QuarantinedEnvelopeRecord,
} from './sync-client.js';
export {
  DEFAULT_MAX_MCP_FRAME_BYTES,
  LocalMcpHostRegistry,
  decodeJsonRpcStdioFrame,
  encodeJsonRpcStdioFrame,
  frameUntrustedMcpOutput,
  type LocalMcpHostOptions,
  type LocalMcpToolSchemaSpec,
} from './mcp-host.js';
export {
  DESKTOP_AGENT_RUN_JOB_TYPE,
  DesktopAgentRunner,
  createDesktopAgentRunJobHandler,
  createLocalOpenAiRouteTarget,
  type DesktopAgentBudgetPolicy,
  type DesktopAgentJobContext,
  type DesktopAgentJobPayload,
  type DesktopAgentRunOutcome,
  type DesktopAgentRunRequest,
  type DesktopAgentRunnerOptions,
} from './agent-runner.js';
export {
  DEFAULT_ALLOWED_IPC_ORIGINS,
  InMemoryKeychainSecretStore,
  assertAllowedIpcSender,
  attachDesktopBridgeToSurface,
  createDesktopHarnessBridge,
  detachDesktopBridgeFromSurface,
  normalizeOriginString,
  type CreateDesktopHarnessBridgeOptions,
} from './bridge.js';
export {
  parseDesktopCliArgs,
  startDesktopSidecarDaemon,
  type DesktopCliOptions,
  type DesktopCliSubcommand,
  type DesktopSidecarDaemonHandle,
} from './cli.js';
export {
  ensureLocalWorkspaceBootstrap,
  startLocalApiServer,
  type LocalApiServerHandle,
  type LocalApiServerOptions,
  type LocalAuthContext,
  type LocalWorkspaceBootstrapResult,
} from './local-api-server.js';
export {
  DesktopSyncEngine,
  computeCanonicalSha256,
  resolveSyncConflict,
  type RecordLocalMutationInput,
  type SyncBatchPlan,
  type SyncConflictRecord,
  type SyncConflictResolution,
  type SyncEngineStatus,
  type SyncOperation,
  type SyncOutboxEntry,
  type SyncRecordVersion,
} from './sync-engine.js';
export {
  searchLocalRagDocuments,
  type LocalRagDocument,
  type LocalRagDocumentKind,
  type LocalRagSearchHit,
  type LocalRagSearchOptions,
  type LocalRagSearchResult,
} from './local-rag.js';
export {
  runDesktopDoctor,
  runDesktopDoctorRepair,
  type DesktopDoctorOptions,
  type DesktopDoctorRepairResult,
  type DesktopDoctorReport,
  type DoctorCheckResult,
  type DoctorCheckStatus,
} from './doctor.js';
export {
  importDesktopTasks,
  type DesktopImportOptions,
  type DesktopImportSummary,
} from './importer.js';
export {
  executeProjectTaskInSandbox,
  type AutonomousTaskExecutionOptions,
  type AutonomousTaskExecutionResult,
} from './project-loop.js';
