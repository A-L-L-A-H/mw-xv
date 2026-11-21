import { AccessDeniedError, ValidationError, type Domain } from '@moonwitness/types';
import { LocalSidecarController } from './local-sidecar.js';
import { LocalMcpHostRegistry } from './mcp-host.js';
import { DesktopRiskGate, NativeHumanApprovalIssuer, isLoopbackEndpointUrl } from './risk-gate.js';
import type {
  AcquireWorktreeOptions,
  BoundedPtyCommandRequest,
  DesktopActionAuthContext,
  DesktopBridgeHostSurface,
  DesktopBridgeSnapshot,
  DesktopCapabilityBridge,
  DesktopHarnessConfig,
  DesktopKeychainSecretStore,
  EnqueuePcwEnvelopeInput,
  GitWorktreeLease,
  LocalMcpServerConfig,
  LocalMcpToolHandler,
  LocalMcpToolInvocationRequest,
  RiskEvaluationRequest,
  UpstreamPcwSyncTransport,
} from './types.js';
import { WorktreeSandbox } from './worktree-sandbox.js';

const SECRET_REF_REGEX = /^MW_AI_(?:C[1-9][0-9]*_)?[A-Z0-9_]{1,100}$/u;

export const DEFAULT_ALLOWED_IPC_ORIGINS: readonly string[] = Object.freeze([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'http://ipc.localhost',
]);

export interface CreateDesktopHarnessBridgeOptions {
  readonly surface?: DesktopBridgeHostSurface;
  readonly autoAttach?: boolean;
  readonly mcpHandlers?: Readonly<Record<string, LocalMcpToolHandler>>;
  readonly keychainStore?: DesktopKeychainSecretStore;
  readonly approvalIssuer?: NativeHumanApprovalIssuer;
}

/**
 * Host-side keychain secret-reference store (DSK-1.10).
 * Accepts only `MW_AI_*` secret reference names and keeps secret values inside the native host.
 */
export class InMemoryKeychainSecretStore implements DesktopKeychainSecretStore {
  private readonly secrets = new Map<string, string>();

  setSecret(secretRef: string, secretValue: string): void {
    if (!SECRET_REF_REGEX.test(secretRef)) {
      throw new ValidationError(
        `Invalid secret reference '${secretRef}'; only MW_AI_* identifiers are permitted`
      );
    }
    if (!secretValue || !secretValue.trim()) {
      throw new ValidationError('Secret value must be non-empty');
    }
    this.secrets.set(secretRef, secretValue);
  }

  resolveSecret(secretRef: string): string | null {
    if (!SECRET_REF_REGEX.test(secretRef)) {
      return null;
    }
    return this.secrets.get(secretRef) ?? null;
  }

  deleteSecret(secretRef: string): boolean {
    return this.secrets.delete(secretRef);
  }

  listSecretRefs(): readonly string[] {
    return [...this.secrets.keys()].sort();
  }
}

export function normalizeOriginString(rawOrigin: string): string | null {
  try {
    const parsed = new URL(rawOrigin);
    if (parsed.username || parsed.password || parsed.hash) return null;
    if (parsed.protocol === 'tauri:') {
      return `tauri://${parsed.hostname.toLowerCase()}`;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const portSuffix = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${portSuffix}`;
  } catch {
    return null;
  }
}

export function assertAllowedIpcSender(
  senderOrigin: string,
  allowedOrigins: ReadonlySet<string>,
  windowLabel = 'main'
): void {
  if (windowLabel !== 'main') {
    throw new AccessDeniedError(`IPC command rejected from non-main window label '${windowLabel}'`);
  }
  const normalized = normalizeOriginString(senderOrigin);
  if (!normalized || !allowedOrigins.has(normalized)) {
    throw new AccessDeniedError(
      `IPC command rejected from untrusted sender origin '${senderOrigin}'`
    );
  }
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

  const normalizedBoardOrigin = normalizeOriginString(config.boardOrigin);
  if (!normalizedBoardOrigin) {
    throw new ValidationError(`Invalid boardOrigin '${config.boardOrigin}'`);
  }
  const allowedOriginSet = new Set<string>([normalizedBoardOrigin, ...DEFAULT_ALLOWED_IPC_ORIGINS]);
  for (const extraOrigin of config.allowedIpcOrigins ?? []) {
    const normalizedExtra = normalizeOriginString(extraOrigin);
    if (!normalizedExtra || !isLoopbackEndpointUrl(extraOrigin)) {
      throw new AccessDeniedError(`Allowed IPC origin must be loopback/tauri: '${extraOrigin}'`);
    }
    allowedOriginSet.add(normalizedExtra);
  }

  const trackedSecrets: string[] = [...(config.knownSecrets ?? [])];
  const keychainStore = options?.keychainStore ?? new InMemoryKeychainSecretStore();
  const approvalIssuer = options?.approvalIssuer ?? new NativeHumanApprovalIssuer();

  let disposed = false;
  const sidecar = new LocalSidecarController({
    sqlitePath: config.sqlitePath,
    desktopHomeDir: config.desktopHomeDir,
    offlineMode: config.offlineMode,
    activeCompanyId: config.activeCompanyId,
    knownSecrets: trackedSecrets,
  });

  const riskGate = new DesktopRiskGate({
    approvalVerifier: (token) => approvalIssuer.verifyToken(token),
    requireSignedApprovals: config.requireSignedApprovals ?? false,
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
    knownSecrets: trackedSecrets,
    riskGate,
  });

  const mcpHost = new LocalMcpHostRegistry({
    riskGate,
    knownSecrets: trackedSecrets,
    initialServers: config.mcpServers,
  });

  if (options?.mcpHandlers) {
    for (const [serverId, handler] of Object.entries(options.mcpHandlers)) {
      mcpHost.registerHandler(serverId, handler);
    }
  }

  const rawBridge: DesktopCapabilityBridge = {
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
    verifySenderOrigin(origin: string, windowLabel = 'main'): boolean {
      assertAllowedIpcSender(origin, allowedOriginSet, windowLabel);
      return true;
    },
    issueNativeApprovalToken(request) {
      return approvalIssuer.issueToken(request);
    },
    keychain: {
      registerSecretRef(secretRef: string, secretValue: string): void {
        keychainStore.setSecret(secretRef, secretValue);
        if (secretValue.trim().length >= 6 && !trackedSecrets.includes(secretValue.trim())) {
          trackedSecrets.push(secretValue.trim());
        }
      },
      hasSecretRef(secretRef: string): boolean {
        return keychainStore.resolveSecret(secretRef) !== null;
      },
      listSecretRefs(): readonly string[] {
        return keychainStore.listSecretRefs();
      },
    },
    worktree: {
      acquire: (acquireOpts: AcquireWorktreeOptions) => sandbox.acquire(acquireOpts),
      listLeases: async (): Promise<readonly GitWorktreeLease[]> => sandbox.listLeases(),
      readFile: (runId: string, relativePath: string) => sandbox.readFile(runId, relativePath),
      writeFile: (
        runId: string,
        relativePath: string,
        content: string,
        auth: DesktopActionAuthContext
      ) => sandbox.writeFile(runId, relativePath, content, auth),
      diff: (runId: string) => sandbox.inspectDiff(runId),
      commit: (runId: string, message: string, auth: DesktopActionAuthContext) =>
        sandbox.commit(runId, message, auth),
      release: (runId: string) => sandbox.release(runId),
    },
    pty: {
      execute: (request: BoundedPtyCommandRequest, auth: DesktopActionAuthContext) =>
        sandbox.executeBoundedCommand(request, auth),
    },
    risk: {
      evaluate: (request: RiskEvaluationRequest) => riskGate.evaluate(request),
      getAuditLog: (limit?: number) => riskGate.getAuditLog(limit),
    },
    sidecar: {
      getState: () => sidecar.getState(),
      setOfflineMode: (offline: boolean) => sidecar.setOfflineMode(offline),
      setActiveCompany: (companyId: number | null) => sidecar.setActiveCompany(companyId),
      getActiveCompany: () => sidecar.getActiveCompany(),
      initializeOrmAddons: () => sidecar.initializeOrmAddons(),
      enqueuePcwEnvelope: (input: EnqueuePcwEnvelopeInput) => sidecar.enqueuePcwEnvelope(input),
      listEnvelopes: (domain?: Domain, listOpts?: { readonly companyId?: number }) =>
        sidecar.listEnvelopes(domain, listOpts),
      syncPending: (transport: UpstreamPcwSyncTransport) => sidecar.syncPending(transport),
    },
    mcp: {
      registerServer: (serverConfig: LocalMcpServerConfig) => mcpHost.registerServer(serverConfig),
      registerHandler: (serverId: string, handler: LocalMcpToolHandler) =>
        mcpHost.registerHandler(serverId, handler),
      listServers: () => mcpHost.listServers(),
      invoke: (request: LocalMcpToolInvocationRequest) => mcpHost.invoke(request),
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

  Object.freeze(rawBridge.keychain);
  Object.freeze(rawBridge.worktree);
  Object.freeze(rawBridge.pty);
  Object.freeze(rawBridge.risk);
  Object.freeze(rawBridge.sidecar);
  Object.freeze(rawBridge.mcp);
  const bridge = Object.freeze(rawBridge);

  if (options?.surface || options?.autoAttach !== false) {
    attachDesktopBridgeToSurface(bridge, options?.surface);
  }

  return bridge;
}
