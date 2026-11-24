import { createHash } from 'node:crypto';
import { selectHealthyDeploymentTarget, type HaTargetCandidate } from './ha.js';

export type MeshDockerStatus = 'running' | 'degraded' | 'stopped' | 'offline';

export interface MeshVpsNode {
  readonly nodeId: string;
  readonly meshIp: string;
  readonly region: string;
  readonly healthy: boolean;
  readonly dockerStatus: MeshDockerStatus;
  readonly availableRamMb: number;
  readonly cpuLoadPercent: number;
  readonly priority?: number;
}

export interface ActiveTenantDeployment {
  readonly deploymentId: string;
  readonly tenantId: string;
  readonly appSlug: string;
  readonly primaryNodeId: string;
  readonly requiredRamMb: number;
  readonly domain?: string;
  readonly port?: number;
}

export type MeshFailoverActionKind = 'failover_deploy' | 'caddy_reroute' | 'drain_primary';

export interface MeshFailoverAction {
  readonly kind: MeshFailoverActionKind;
  readonly deploymentId: string;
  readonly tenantId: string;
  readonly appSlug: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly targetMeshIp: string;
  readonly domain?: string;
  readonly port?: number;
  readonly reason: string;
}

export interface MeshFailoverAlert {
  readonly code: 'no_healthy_standby';
  readonly deploymentId: string;
  readonly tenantId: string;
  readonly appSlug: string;
  readonly primaryNodeId: string;
  readonly requiredRamMb: number;
  readonly reason: string;
}

export interface MeshFailoverPlanInput {
  readonly nodes: readonly MeshVpsNode[];
  readonly deployments: readonly ActiveTenantDeployment[];
  readonly minStandbyHeadroomMb?: number;
  readonly maxCpuLoadPercent?: number;
}

export interface MeshFailoverPlan {
  readonly healthyDeployments: readonly string[];
  readonly degradedPrimaryNodeIds: readonly string[];
  readonly actions: readonly MeshFailoverAction[];
  readonly alerts: readonly MeshFailoverAlert[];
  readonly failClosed: boolean;
  readonly planSha256: string;
}

interface MeshHaCandidate extends HaTargetCandidate {
  readonly node: MeshVpsNode;
}

const DEFAULT_MIN_STANDBY_HEADROOM_MB = 128;
const DEFAULT_MAX_CPU_LOAD_PERCENT = 90;

/**
 * Canonical private-mesh ranges mirrored from `@moonwitness/ai-runtime`'s
 * `PRIVATE_MESH_CIDRS` / `isPrivateMeshHost` (`a2a-protocol.ts`). OMN-A2A owns
 * that export; until it is published and declared as a workspace dependency
 * this local copy keeps the API surface identical so the later swap is a
 * one-line re-export. It intentionally includes IPv6 `fd00::/8` (ULA), which
 * the former IPv4-only mesh-ha helper silently omitted.
 */
export const PRIVATE_MESH_CIDRS: readonly string[] = Object.freeze([
  '10.0.0.0/8',
  '100.64.0.0/10',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fd00::/8',
]);

function parseStrictIpv4(host: string): readonly [number, number, number, number] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(part)) return undefined;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return undefined;
    octets.push(value);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function isIpv6UlaFd00(rawHost: string): boolean {
  const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  if (!host.includes(':') || host.includes('%') || host.includes('.')) return false;
  const doubleColonParts = host.split('::');
  if (doubleColonParts.length > 2) return false;
  const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
  const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
  const groups = [...left, ...right];
  if (doubleColonParts.length === 1 ? groups.length !== 8 : groups.length >= 8) return false;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) return false;
  }
  const firstGroup = left[0];
  if (!firstGroup) return false;
  const firstValue = Number.parseInt(firstGroup, 16);
  return firstValue >= 0xfd00 && firstValue <= 0xfdff;
}

function extractMeshHost(hostOrUrl: string): string | undefined {
  const trimmed = hostOrUrl.trim();
  if (!trimmed) return undefined;
  if (!trimmed.includes('://')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.hostname;
  } catch {
    return undefined;
  }
}

/** Mirrors canonical `isPrivateMeshHost` from @moonwitness/ai-runtime. */
export function isPrivateMeshHost(hostOrUrl: string): boolean {
  const host = extractMeshHost(hostOrUrl);
  if (!host) return false;
  const ipv4 = parseStrictIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    return false;
  }
  return isIpv6UlaFd00(host); // fd00::/8
}

/** Backwards-compatible IP-only surface, now at parity with the canonical host check. */
export function isPrivateMeshIp(ip: string): boolean {
  const host = ip.trim();
  if (!host || host.includes('/') || host.includes('://') || /\s/u.test(host)) return false;
  return isPrivateMeshHost(host);
}

function isNodeHealthyForServing(node: MeshVpsNode | undefined): boolean {
  if (!node) return false;
  return node.healthy && node.dockerStatus === 'running' && isPrivateMeshIp(node.meshIp);
}

export function evaluateMeshFailoverPlan(input: MeshFailoverPlanInput): MeshFailoverPlan {
  const minHeadroomMb = Math.max(0, input.minStandbyHeadroomMb ?? DEFAULT_MIN_STANDBY_HEADROOM_MB);
  const maxCpuLoadPercent = input.maxCpuLoadPercent ?? DEFAULT_MAX_CPU_LOAD_PERCENT;

  const sortedNodes = [...input.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const nodeById = new Map<string, MeshVpsNode>();
  const remainingRamByNodeId = new Map<string, number>();

  for (const node of sortedNodes) {
    nodeById.set(node.nodeId, node);
    remainingRamByNodeId.set(node.nodeId, Math.max(0, node.availableRamMb));
  }

  const sortedDeployments = [...input.deployments].sort((a, b) =>
    a.deploymentId.localeCompare(b.deploymentId)
  );

  const healthyDeployments: string[] = [];
  const degradedPrimarySet = new Set<string>();
  const actions: MeshFailoverAction[] = [];
  const alerts: MeshFailoverAlert[] = [];

  for (const deployment of sortedDeployments) {
    const primaryNode = nodeById.get(deployment.primaryNodeId);
    if (isNodeHealthyForServing(primaryNode)) {
      healthyDeployments.push(deployment.deploymentId);
      continue;
    }

    degradedPrimarySet.add(deployment.primaryNodeId);

    const requiredWithHeadroom = Math.max(0, deployment.requiredRamMb) + minHeadroomMb;
    const candidates: MeshHaCandidate[] = [];

    sortedNodes.forEach((node, index) => {
      if (node.nodeId === deployment.primaryNodeId) return;
      if (!isNodeHealthyForServing(node)) return;
      if (node.cpuLoadPercent > maxCpuLoadPercent) return;

      const availableRam = remainingRamByNodeId.get(node.nodeId) ?? 0;
      if (availableRam < requiredWithHeadroom) return;

      candidates.push({
        id: index + 1,
        name: node.nodeId,
        priority: node.priority ?? Math.round(node.cpuLoadPercent),
        health_status: 'healthy',
        is_active: true,
        node,
      });
    });

    const selected = selectHealthyDeploymentTarget(candidates);

    if (!selected) {
      alerts.push({
        code: 'no_healthy_standby',
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        appSlug: deployment.appSlug,
        primaryNodeId: deployment.primaryNodeId,
        requiredRamMb: deployment.requiredRamMb,
        reason: `No healthy private-mesh standby node with >= ${requiredWithHeadroom}MB RAM and <= ${maxCpuLoadPercent}% CPU`,
      });
      continue;
    }

    const standby = selected.node;
    const prevRam = remainingRamByNodeId.get(standby.nodeId) ?? 0;
    remainingRamByNodeId.set(standby.nodeId, Math.max(0, prevRam - deployment.requiredRamMb));

    const failureReason = !primaryNode
      ? `Primary node ${deployment.primaryNodeId} missing from mesh topology`
      : !primaryNode.healthy || primaryNode.dockerStatus !== 'running'
        ? `Primary node ${deployment.primaryNodeId} degraded (healthy=${String(primaryNode.healthy)}, docker=${primaryNode.dockerStatus})`
        : `Primary node ${deployment.primaryNodeId} has non-private mesh IP ${primaryNode.meshIp}`;

    actions.push(
      {
        kind: 'failover_deploy',
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        appSlug: deployment.appSlug,
        fromNodeId: deployment.primaryNodeId,
        toNodeId: standby.nodeId,
        targetMeshIp: standby.meshIp,
        ...(deployment.domain !== undefined ? { domain: deployment.domain } : {}),
        ...(deployment.port !== undefined ? { port: deployment.port } : {}),
        reason: failureReason,
      },
      {
        kind: 'caddy_reroute',
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        appSlug: deployment.appSlug,
        fromNodeId: deployment.primaryNodeId,
        toNodeId: standby.nodeId,
        targetMeshIp: standby.meshIp,
        ...(deployment.domain !== undefined ? { domain: deployment.domain } : {}),
        ...(deployment.port !== undefined ? { port: deployment.port } : {}),
        reason: `Reroute reverse proxy upstream to private mesh IP ${standby.meshIp}`,
      },
      {
        kind: 'drain_primary',
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        appSlug: deployment.appSlug,
        fromNodeId: deployment.primaryNodeId,
        toNodeId: standby.nodeId,
        targetMeshIp: standby.meshIp,
        ...(deployment.domain !== undefined ? { domain: deployment.domain } : {}),
        ...(deployment.port !== undefined ? { port: deployment.port } : {}),
        reason: `Drain failed primary node ${deployment.primaryNodeId} after cutover to ${standby.nodeId}`,
      }
    );
  }

  const degradedPrimaryNodeIds = [...degradedPrimarySet].sort((a, b) => a.localeCompare(b));
  const failClosed = alerts.length > 0;

  const canonicalPayload = {
    healthyDeployments,
    degradedPrimaryNodeIds,
    actions,
    alerts,
    failClosed,
  };

  const planSha256 = createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');

  return {
    ...canonicalPayload,
    planSha256,
  };
}
