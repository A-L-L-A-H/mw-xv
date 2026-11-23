import { describe, expect, it } from 'vitest';
import { runMeshHaFailoverDrill } from '../src/ha-drill.js';
import type { ActiveTenantDeployment, MeshVpsNode } from '../src/mesh-ha.js';

const CLUSTER_NODES: readonly MeshVpsNode[] = [
  {
    nodeId: 'vps-primary-01',
    meshIp: '10.144.0.1',
    region: 'sgp',
    healthy: true,
    dockerStatus: 'running',
    availableRamMb: 4096,
    cpuLoadPercent: 25,
    priority: 10,
  },
  {
    nodeId: 'vps-standby-02',
    meshIp: '10.144.0.2',
    region: 'sgp',
    healthy: true,
    dockerStatus: 'running',
    availableRamMb: 4096,
    cpuLoadPercent: 18,
    priority: 20,
  },
];

const DEPLOYMENTS: readonly ActiveTenantDeployment[] = [
  {
    deploymentId: 'dep-api',
    tenantId: 'tenant-alpha',
    appSlug: 'alpha-api',
    primaryNodeId: 'vps-primary-01',
    requiredRamMb: 1024,
    domain: 'api.alpha.example.com',
    port: 4000,
  },
  {
    deploymentId: 'dep-web',
    tenantId: 'tenant-alpha',
    appSlug: 'alpha-web',
    primaryNodeId: 'vps-primary-01',
    requiredRamMb: 512,
    domain: 'web.alpha.example.com',
    port: 3000,
  },
];

describe('ha-drill (Wave C.18)', () => {
  it('runs a full simulated failover drill and verifies zero split-brain + RTO', async () => {
    const evidence = await runMeshHaFailoverDrill({
      drillId: 'drill-2026-11-23-01',
      mode: 'simulated',
      targetPrimaryNodeId: 'vps-primary-01',
      nodes: CLUSTER_NODES,
      deployments: DEPLOYMENTS,
      rtoTargetMs: 15_000,
      executedAt: '2026-11-23T00:00:00.000Z',
    });

    expect(evidence.passed).toBe(true);
    expect(evidence.splitBrainDetected).toBe(false);
    expect(evidence.phases).toHaveLength(5);
    expect(evidence.phases.every((p) => p.passed)).toBe(true);
    expect(evidence.rtoMetrics.rtoMet).toBe(true);
    expect(evidence.caddyCutoverRoutes).toHaveLength(2);
    expect(evidence.caddyCutoverRoutes[0]?.upstream).toBe('10.144.0.2:4000');
    expect(evidence.activePrimaryByDeployment).toEqual({
      'dep-api': 'vps-standby-02',
      'dep-web': 'vps-standby-02',
    });
    expect(evidence.evidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('fails closed when standby lacks RAM headroom for re-placement', async () => {
    const tightNodes: readonly MeshVpsNode[] = [
      CLUSTER_NODES[0]!,
      { ...CLUSTER_NODES[1]!, availableRamMb: 256 },
    ];

    const evidence = await runMeshHaFailoverDrill({
      drillId: 'drill-tight-quota',
      mode: 'simulated',
      targetPrimaryNodeId: 'vps-primary-01',
      nodes: tightNodes,
      deployments: DEPLOYMENTS,
    });

    expect(evidence.passed).toBe(false);
    expect(evidence.failoverPlan.failClosed).toBe(true);
    const replacementPhase = evidence.phases.find((p) => p.phase === 'workload_replacement');
    expect(replacementPhase?.passed).toBe(false);
  });

  it('supports live_probed mode with custom node health probe callback', async () => {
    const probedNodes: string[] = [];
    const evidence = await runMeshHaFailoverDrill({
      drillId: 'drill-live-probe',
      mode: 'live_probed',
      targetPrimaryNodeId: 'vps-primary-01',
      nodes: CLUSTER_NODES,
      deployments: DEPLOYMENTS,
      probeNode: async (node) => {
        probedNodes.push(node.nodeId);
        return true;
      },
    });

    expect(probedNodes).toEqual(['vps-standby-02']);
    expect(evidence.passed).toBe(true);
    expect(evidence.rtoMetrics.detectionMs).toBe(1200);
  });
});
