export * from './types.js';
export {
  DesktopRiskGate,
  isLoopbackEndpointUrl,
  isLoopbackHostname,
  isSecretOrSensitivePath,
  redactSensitiveText,
  redactSensitiveValue,
  resolveRiskTierForAction,
} from './risk-gate.js';
export { WorktreeSandbox, type WorktreeSandboxOptions } from './worktree-sandbox.js';
export {
  LocalSidecarController,
  buildArtifactDigest,
  computeEnvelopeSha256,
  type LocalSidecarControllerOptions,
} from './local-sidecar.js';
export { LocalMcpHostRegistry, type LocalMcpHostOptions } from './mcp-host.js';
export {
  attachDesktopBridgeToSurface,
  createDesktopHarnessBridge,
  detachDesktopBridgeFromSurface,
  type CreateDesktopHarnessBridgeOptions,
} from './bridge.js';
