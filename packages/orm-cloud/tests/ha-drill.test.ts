import { describe, expect, it } from 'vitest';
import {
  HA_DRILL_RUNBOOK,
  runDeterministicHaDrill,
  runMeshHaFailoverDrill,
  type HaDrillScenario,
} from '../src/ha-drill.js';
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

describe('CF-010 deterministic failure-injection drills', () => {
  const EXPECTED: Readonly<Record<HaDrillScenario, string>> = {
    provider_outage: 'full',
    partial_failover: 'partial',
    stale_node_recovery: 'full',
    health_probe_timeout: 'full',
    failed_rollback: 'operator_retry',
  };

  function drill(scenario: HaDrillScenario, overrides: Record<string, unknown> = {}) {
    return runDeterministicHaDrill({
      drillId: `drill-${scenario}`,
      scenario,
      environment: 'test',
      nodes: CLUSTER_NODES,
      deployments: DEPLOYMENTS,
      targetPrimaryNodeId: 'vps-primary-01',
      ownerGeneration: 3,
      providerEndpoints: ['http://10.144.0.1:3003'],
      executedAt: '2026-11-24T00:00:00.000Z',
      ...overrides,
    });
  }

  it('runs setup, injected fault, safety, recovery and cleanup for every scenario deterministically', () => {
    for (const scenario of Object.keys(EXPECTED) as HaDrillScenario[]) {
      const first = drill(scenario);
      const second = drill(scenario);

      expect(first.steps.map((step) => step.phase)).toEqual([
        'setup',
        'inject_fault',
        'assert_safety',
        'assert_recovery',
        'cleanup',
      ]);
      expect(first.steps.every((step) => step.passed)).toBe(true);
      expect(first.safetyInvariants.every((invariant) => invariant.passed)).toBe(true);
      expect(first.recoveryOutcome.expected).toBe(EXPECTED[scenario]);
      expect(first.recoveryOutcome.achieved).toBe(true);
      expect(first.passed).toBe(true);
      expect(first.evidenceSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(second.evidenceSha256).toBe(first.evidenceSha256);
    }
  });

  it('fences the recovered old node as standby and preserves diagnostics for failed rollback', () => {
    const recovery = drill('stale_node_recovery');
    expect(recovery.fencing).toMatchObject({
      beforeGeneration: 3,
      staleHeartbeatRejected: true,
      recoveredNodeRole: 'standby',
    });
    expect(recovery.fencing.afterGeneration).toBeGreaterThan(recovery.fencing.beforeGeneration);

    const rollback = drill('failed_rollback');
    expect(rollback.pendingOperatorCleanup).toEqual(['rollback:vps-primary-01']);
    expect(rollback.recoveryOutcome.actual).toBe('operator_retry');
  });

  it('refuses to target production environments or public provider endpoints', () => {
    const prodEnv = drill('provider_outage', { environment: 'production' });
    expect(prodEnv.safetyInvariants.find((i) => i.name === 'production_isolation')?.passed).toBe(
      false
    );
    expect(prodEnv.passed).toBe(false);

    const publicEndpoint = drill('provider_outage', {
      providerEndpoints: ['https://8.8.8.8:3003'],
    });
    expect(
      publicEndpoint.safetyInvariants.find((i) => i.name === 'production_isolation')?.passed
    ).toBe(false);
    expect(publicEndpoint.passed).toBe(false);
  });

  it('redacts secrets from preserved diagnostic evidence', () => {
    const secret = 'drill-top-secret-token';
    const evidence = drill('failed_rollback', {
      secrets: [secret],
      providerEndpoints: ['http://10.144.0.1:3003?token=' + secret],
    });

    expect(evidence.diagnostics).not.toContain(secret);
    expect(evidence.diagnostics).toContain('[REDACTED]');
    expect(evidence.safetyInvariants.find((i) => i.name === 'diagnostics_redacted')?.passed).toBe(
      true
    );
  });

  it('ships a runbook covering every scenario and result interpretation', () => {
    for (const scenario of Object.keys(EXPECTED) as HaDrillScenario[]) {
      expect(HA_DRILL_RUNBOOK).toContain(scenario);
    }
    expect(HA_DRILL_RUNBOOK).toContain('evidenceSha256');
  });
});
