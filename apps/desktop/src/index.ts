export * from './types.js';
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
  type DesktopSidecarDaemonHandle,
} from './cli.js';
