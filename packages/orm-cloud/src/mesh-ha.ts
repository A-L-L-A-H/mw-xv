import { createHash } from 'node:crypto';
import {
  PRIVATE_MESH_CIDRS,
  isPrivateMeshHost as isSharedPrivateMeshHost,
  isPrivateMeshIp as isSharedPrivateMeshIp,
} from '@moonwitness/types';
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

export { PRIVATE_MESH_CIDRS };

/** Validates that a host string or HTTP(S) URL targets a private mesh IP address. */
export function isPrivateMeshHost(hostOrUrl: string): boolean {
  return isSharedPrivateMeshHost(hostOrUrl);
}

/** Backwards-compatible IP-only surface, excluding loopback addresses. */
export function isPrivateMeshIp(ip: string): boolean {
  return isSharedPrivateMeshIp(ip);
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
