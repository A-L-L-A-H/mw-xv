import { AccessDeniedError, ValidationError } from '@moonwitness/types';
import { LocalSidecarController } from './local-sidecar.js';
import { LocalMcpHostRegistry } from './mcp-host.js';
import { DesktopRiskGate, isLoopbackEndpointUrl } from './risk-gate.js';
import type {
  DesktopBridgeHostSurface,
  DesktopBridgeSnapshot,
  DesktopCapabilityBridge,
  DesktopHarnessConfig,
  LocalMcpToolHandler,
} from './types.js';
import { WorktreeSandbox } from './worktree-sandbox.js';

export interface CreateDesktopHarnessBridgeOptions {
  readonly surface?: DesktopBridgeHostSurface;
  readonly autoAttach?: boolean;
  readonly mcpHandlers?: Readonly<Record<string, LocalMcpToolHandler>>;
}

function validateApiBaseUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError(`Invalid apiBaseUrl: '${rawUrl}'`);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new AccessDeniedError(`Unsafe apiBaseUrl rejected: '${rawUrl}'`);
  }
}

function resolveDefaultSurface(): DesktopBridgeHostSurface | undefined {
  const host = globalThis as { readonly window?: DesktopBridgeHostSurface };
  return host.window;
}

export function attachDesktopBridgeToSurface(
  bridge: DesktopCapabilityBridge,
  surface: DesktopBridgeHostSurface | undefined = resolveDefaultSurface()
): boolean {
  if (!surface) return false;
  surface.__MW_DESKTOP__ = bridge;
  return true;
}

export function detachDesktopBridgeFromSurface(
  surface: DesktopBridgeHostSurface | undefined = resolveDefaultSurface()
): boolean {
  if (!surface || !Object.hasOwn(surface, '__MW_DESKTOP__')) return false;
  delete surface.__MW_DESKTOP__;
  return true;
}

export function createDesktopHarnessBridge(
  config: DesktopHarnessConfig,
  options?: CreateDesktopHarnessBridgeOptions
): DesktopCapabilityBridge {
  if (!isLoopbackEndpointUrl(config.boardOrigin)) {
    throw new AccessDeniedError(
      `Desktop boardOrigin must target loopback IPC/origin (received '${config.boardOrigin}')`
    );
  }
  validateApiBaseUrl(config.apiBaseUrl);
  if (config.localAiEndpoint !== undefined && !isLoopbackEndpointUrl(config.localAiEndpoint)) {
    throw new AccessDeniedError(
      `Desktop localAiEndpoint must target loopback only (received '${config.localAiEndpoint}')`
    );
  }

  let disposed = false;
  const sidecar = new LocalSidecarController({
    sqlitePath: config.sqlitePath,
    offlineMode: config.offlineMode,
    knownSecrets: config.knownSecrets,
  });

  const riskGate = new DesktopRiskGate({
    onAudit: (entry) => {
      if (!disposed) {
        sidecar.recordRiskAudit(entry);
      }
    },
  });

  const sandbox = new WorktreeSandbox({
    repoRoot: config.repoRoot,
    worktreeBaseDir: config.worktreeBaseDir,
    allowedPathPrefixes: config.allowedPathPrefixes,
    allowedCommands: config.allowedCommands,
    defaultTimeoutMs: config.defaultTimeoutMs,
    maxOutputBytes: config.maxOutputBytes,
    knownSecrets: config.knownSecrets,
    riskGate,
  });

  const mcpHost = new LocalMcpHostRegistry({
    riskGate,
    knownSecrets: config.knownSecrets,
    initialServers: config.mcpServers,
  });

  if (options?.mcpHandlers) {
    for (const [serverId, handler] of Object.entries(options.mcpHandlers)) {
      mcpHost.registerHandler(serverId, handler);
    }
  }

  const bridge: DesktopCapabilityBridge = {
    protocolVersion: '1.0',
    hostSurface: 'apps/board',
    async getStatus(): Promise<DesktopBridgeSnapshot> {
      return {
        protocolVersion: '1.0',
        hostSurface: 'apps/board',
        boardOrigin: config.boardOrigin,
        apiBaseUrl: config.apiBaseUrl,
        localAiEndpoint: config.localAiEndpoint ?? null,
        activeLeases: sandbox.listLeases().filter((lease) => lease.status === 'active'),
        sidecar: sidecar.getState(),
        mcpServers: mcpHost.listServers(),
      };
    },
    worktree: {
      acquire: (acquireOpts) => sandbox.acquire(acquireOpts),
      listLeases: async () => sandbox.listLeases(),
      readFile: (runId, relativePath) => sandbox.readFile(runId, relativePath),
      writeFile: (runId, relativePath, content, auth) =>
        sandbox.writeFile(runId, relativePath, content, auth),
      diff: (runId) => sandbox.inspectDiff(runId),
      commit: (runId, message, auth) => sandbox.commit(runId, message, auth),
      release: (runId) => sandbox.release(runId),
    },
    pty: {
      execute: (request, auth) => sandbox.executeBoundedCommand(request, auth),
    },
    risk: {
      evaluate: (request) => riskGate.evaluate(request),
      getAuditLog: (limit) => riskGate.getAuditLog(limit),
    },
    sidecar: {
      getState: () => sidecar.getState(),
      setOfflineMode: (offline) => sidecar.setOfflineMode(offline),
      enqueuePcwEnvelope: (input) => sidecar.enqueuePcwEnvelope(input),
      listEnvelopes: (domain) => sidecar.listEnvelopes(domain),
      syncPending: (transport) => sidecar.syncPending(transport),
    },
    mcp: {
      registerServer: (serverConfig) => mcpHost.registerServer(serverConfig),
      registerHandler: (serverId, handler) => mcpHost.registerHandler(serverId, handler),
      listServers: () => mcpHost.listServers(),
      invoke: (request) => mcpHost.invoke(request),
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (options?.surface) {
        detachDesktopBridgeFromSurface(options.surface);
      }
      sidecar.close();
    },
  };

  if (options?.surface || options?.autoAttach !== false) {
    attachDesktopBridgeToSurface(bridge, options?.surface);
  }

  return bridge;
}
