'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export type DesktopRiskTier = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export type DesktopDataClassification = 'local_only' | 'cloud_eligible' | 'restricted';

export interface DesktopGitWorktreeLease {
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

export interface DesktopWorktreeDiffFile {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface DesktopWorktreeDiffSummary {
  readonly runId: string;
  readonly leaseId: string;
  readonly branchName: string;
  readonly headCommit: string;
  readonly clean: boolean;
  readonly files: readonly DesktopWorktreeDiffFile[];
  readonly patch: string;
  readonly patchSha256: string;
}

export interface DesktopRiskAuditRecord {
  readonly auditId: string;
  readonly runId: string;
  readonly action: string;
  readonly requestedTier: DesktopRiskTier;
  readonly resolvedTier: DesktopRiskTier;
  readonly allowed: boolean;
  readonly reasonCode: string;
  readonly reason: string;
  readonly companyId: number;
  readonly agentId: number;
  readonly grantId: string;
  readonly timestamp: string;
}

export interface DesktopLocalSidecarState {
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

export interface DesktopPcwArtifactDigest {
  readonly storageKey: string;
  readonly artifactKind: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly dataClassification: DesktopDataClassification;
  readonly sourceSha?: string;
  readonly relativePath?: string;
}

export interface DesktopPcwSyncEnvelope {
  readonly envelopeId: string;
  readonly companyId: number;
  readonly workContractId: number;
  readonly agentRunId: string;
  readonly agentId: number;
  readonly correlationId: string;
  readonly modelName: string;
  readonly fencingToken: number;
  readonly runStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly artifacts: readonly DesktopPcwArtifactDigest[];
  readonly envelopeSha256: string;
  readonly syncStatus: 'pending' | 'processing' | 'synced' | 'failed' | 'conflict';
  readonly attempts: number;
  readonly createdAt: string;
  readonly syncedAt: string | null;
  readonly upstreamRecordId: number | null;
  readonly lastError: string | null;
}

export interface DesktopLocalMcpServerConfig {
  readonly serverId: string;
  readonly name: string;
  readonly transport: 'stdio' | 'loopback_http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly endpointUrl?: string;
  readonly requiredCapability: string;
  readonly maxRiskTier: DesktopRiskTier;
  readonly allowedDataClassifications: readonly DesktopDataClassification[];
  readonly maxCallsPerRun: number;
  readonly timeoutMs?: number;
  readonly enabled: boolean;
}

export interface DesktopBridgeSnapshot {
  readonly protocolVersion: '1.0';
  readonly hostSurface: 'apps/board';
  readonly boardOrigin: string;
  readonly apiBaseUrl: string;
  readonly localAiEndpoint: string | null;
  readonly activeLeases: readonly DesktopGitWorktreeLease[];
  readonly sidecar: DesktopLocalSidecarState;
  readonly mcpServers: readonly DesktopLocalMcpServerConfig[];
}

export interface DesktopCapabilityBridge {
  readonly protocolVersion: '1.0';
  readonly hostSurface: 'apps/board';
  getStatus(): Promise<DesktopBridgeSnapshot>;
  readonly worktree: {
    listLeases(): Promise<readonly DesktopGitWorktreeLease[]>;
    diff(runId: string): Promise<DesktopWorktreeDiffSummary>;
    readFile?(runId: string, relativePath: string): Promise<string>;
    release(runId: string): Promise<DesktopGitWorktreeLease>;
  };
  readonly pty?: {
    stop?(runId: string): Promise<void> | void;
  };
  readonly risk: {
    getAuditLog(limit?: number): readonly DesktopRiskAuditRecord[];
  };
  readonly sidecar: {
    getState(): DesktopLocalSidecarState;
    setOfflineMode(offline: boolean): DesktopLocalSidecarState;
    listEnvelopes(): readonly DesktopPcwSyncEnvelope[];
  };
  readonly mcp: {
    listServers(): readonly DesktopLocalMcpServerConfig[];
  };
  dispose(): void;
}

declare global {
  interface Window {
    __MW_DESKTOP__?: DesktopCapabilityBridge;
  }
}

function isValidDesktopBridge(candidate: unknown): candidate is DesktopCapabilityBridge {
  if (!candidate || typeof candidate !== 'object') return false;
  const record = candidate as Partial<DesktopCapabilityBridge>;
  return (
    record.protocolVersion === '1.0' &&
    record.hostSurface === 'apps/board' &&
    typeof record.getStatus === 'function' &&
    typeof record.worktree === 'object' &&
    record.worktree !== null &&
    typeof record.sidecar === 'object' &&
    record.sidecar !== null &&
    typeof record.mcp === 'object' &&
    record.mcp !== null
  );
}

/**
 * Progressive-enhancement detector for `window.__MW_DESKTOP__`.
 * Cleanly returns `null` during SSR or when `apps/board` runs in standard web mode.
 */
export function getDesktopBridge(): DesktopCapabilityBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = window.__MW_DESKTOP__;
  return isValidDesktopBridge(candidate) ? candidate : null;
}

export function isDesktopHarnessActive(): boolean {
  return getDesktopBridge() !== null;
}

const subscribeNoop = () => () => {};
const getServerBridgeSnapshot = (): DesktopCapabilityBridge | null => null;

const EMPTY_AUDIT_LOG: readonly DesktopRiskAuditRecord[] = [];
const EMPTY_ENVELOPES: readonly DesktopPcwSyncEnvelope[] = [];

export interface DesktopBridgeHookResult {
  readonly isDesktop: boolean;
  readonly bridge: DesktopCapabilityBridge | null;
  readonly snapshot: DesktopBridgeSnapshot | null;
  readonly auditLog: readonly DesktopRiskAuditRecord[];
  readonly envelopes: readonly DesktopPcwSyncEnvelope[];
  readonly refreshSnapshot: () => Promise<void>;
}

export function useDesktopBridge(): DesktopBridgeHookResult {
  const queryClient = useQueryClient();
  const bridge = useSyncExternalStore(subscribeNoop, getDesktopBridge, getServerBridgeSnapshot);

  const statusQuery = useQuery({
    queryKey: ['desktop-bridge-status', Boolean(bridge)],
    queryFn: async () => {
      const activeBridge = getDesktopBridge();
      if (!activeBridge) return null;
      const snapshot = await activeBridge.getStatus();
      const auditLog = activeBridge.risk?.getAuditLog?.(20) ?? EMPTY_AUDIT_LOG;
      const envelopes = activeBridge.sidecar?.listEnvelopes?.() ?? EMPTY_ENVELOPES;
      return { snapshot, auditLog, envelopes };
    },
    enabled: bridge !== null,
  });

  const refreshSnapshot = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['desktop-bridge-status'] });
  }, [queryClient]);

  return {
    isDesktop: bridge !== null,
    bridge,
    snapshot: statusQuery.data?.snapshot ?? null,
    auditLog: statusQuery.data?.auditLog ?? EMPTY_AUDIT_LOG,
    envelopes: statusQuery.data?.envelopes ?? EMPTY_ENVELOPES,
    refreshSnapshot,
  };
}
