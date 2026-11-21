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
export { WorktreeSandbox, type WorktreeSandboxOptions } from './worktree-sandbox.js';
export {
  DESKTOP_ADDONS,
  LocalSidecarController,
  acquireSingleWriterLock,
  buildArtifactDigest,
  computeEnvelopeSha256,
  isProcessAlive,
  releaseSingleWriterLock,
  resolveDesktopDatabasePath,
  resolveDesktopHomeDir,
  type LocalSidecarControllerOptions,
} from './local-sidecar.js';
export {
  DesktopUpstreamSyncClient,
  type DesktopUpstreamSyncClientOptions,
  type QuarantinedEnvelopeRecord,
} from './sync-client.js';
export { LocalMcpHostRegistry, type LocalMcpHostOptions } from './mcp-host.js';
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
