import { describe, expect, it } from 'vitest';
import {
  evaluateMeshFailoverPlan,
  isPrivateMeshIp,
  type ActiveTenantDeployment,
  type MeshVpsNode,
} from '../src/mesh-ha.js';

describe('isPrivateMeshIp', () => {
  it('accepts RFC1918 and EasyTier CGNAT private mesh IPs and rejects public IPs', () => {
    expect(isPrivateMeshIp('10.144.0.1')).toBe(true);
    expect(isPrivateMeshIp('100.64.12.8')).toBe(true);
    expect(isPrivateMeshIp('172.16.4.2')).toBe(true);
    expect(isPrivateMeshIp('192.168.10.20')).toBe(true);

    expect(isPrivateMeshIp('8.8.8.8')).toBe(false);
    expect(isPrivateMeshIp('127.0.0.1')).toBe(false);
    expect(isPrivateMeshIp('172.32.0.1')).toBe(false);
    expect(isPrivateMeshIp('100.128.0.1')).toBe(false);
    expect(isPrivateMeshIp('not-an-ip')).toBe(false);
  });
});

describe('evaluateMeshFailoverPlan', () => {
  it('keeps healthy primary deployments in place with zero actions and zero alerts', () => {
    const nodes: MeshVpsNode[] = [
      {
        nodeId: 'vps-sg-1',
        meshIp: '10.144.0.1',
        region: 'ap-southeast-1',
        healthy: true,
        dockerStatus: 'running',
        availableRamMb: 4096,
        cpuLoadPercent: 25,
      },
    ];
    const deployments: ActiveTenantDeployment[] = [
      {
        deploymentId: 'dep-1',
        tenantId: 'tenant-a',
        appSlug: 'api-core',
        primaryNodeId: 'vps-sg-1',
        requiredRamMb: 512,
        domain: 'api.example.com',
        port: 3000,
      },
    ];

    const plan = evaluateMeshFailoverPlan({ nodes, deployments });
    expect(plan.healthyDeployments).toEqual(['dep-1']);
    expect(plan.degradedPrimaryNodeIds).toEqual([]);
    expect(plan.actions).toEqual([]);
    expect(plan.alerts).toEqual([]);
    expect(plan.failClosed).toBe(false);
    expect(plan.planSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('emits failover_deploy, caddy_reroute, and drain_primary onto a healthy private-mesh standby', () => {
    const nodes: MeshVpsNode[] = [
      {
        nodeId: 'vps-sg-1',
        meshIp: '10.144.0.1',
        region: 'ap-southeast-1',
        healthy: false,
        dockerStatus: 'offline',
        availableRamMb: 4096,
        cpuLoadPercent: 0,
      },
      {
        nodeId: 'vps-public-bad',
        meshIp: '203.0.113.10',
        region: 'ap-southeast-1',
        healthy: true,
        dockerStatus: 'running',
        availableRamMb: 8192,
        cpuLoadPercent: 10,
        priority: 1,
      },
      {
        nodeId: 'vps-jp-2',
        meshIp: '100.64.0.22',
        region: 'ap-northeast-1',
        healthy: true,
        dockerStatus: 'running',
        availableRamMb: 2048,
        cpuLoadPercent: 30,
        priority: 10,
      },
    ];
    const deployments: ActiveTenantDeployment[] = [
      {
        deploymentId: 'dep-42',
        tenantId: 'tenant-z',
        appSlug: 'mw-tenant',
        primaryNodeId: 'vps-sg-1',
        requiredRamMb: 512,
        domain: 'z.moonwitness.io',
        port: 8080,
      },
    ];

    const plan = evaluateMeshFailoverPlan({ nodes, deployments });
    expect(plan.failClosed).toBe(false);
    expect(plan.degradedPrimaryNodeIds).toEqual(['vps-sg-1']);
    expect(plan.actions.map((a) => a.kind)).toEqual([
      'failover_deploy',
      'caddy_reroute',
      'drain_primary',
    ]);
    for (const action of plan.actions) {
      expect(action.toNodeId).toBe('vps-jp-2');
      expect(action.targetMeshIp).toBe('100.64.0.22');
      expect(action.fromNodeId).toBe('vps-sg-1');
    }
  });

  it('enforces standby RAM headroom and emits no_healthy_standby fail-closed alert when exhausted', () => {
    const nodes: MeshVpsNode[] = [
      {
        nodeId: 'vps-primary',
        meshIp: '10.144.0.1',
        region: 'eu-central-1',
        healthy: true,
        dockerStatus: 'degraded',
        availableRamMb: 4096,
        cpuLoadPercent: 95,
      },
      {
        nodeId: 'vps-standby-small',
        meshIp: '10.144.0.2',
        region: 'eu-west-1',
        healthy: true,
        dockerStatus: 'running',
        availableRamMb: 1024,
        cpuLoadPercent: 20,
      },
    ];
    const deployments: ActiveTenantDeployment[] = [
      {
        deploymentId: 'dep-a',
        tenantId: 't1',
        appSlug: 'pg-16',
        primaryNodeId: 'vps-primary',
        requiredRamMb: 768,
      },
      {
        deploymentId: 'dep-b',
        tenantId: 't2',
        appSlug: 'redis-7',
        primaryNodeId: 'vps-primary',
        requiredRamMb: 512,
      },
    ];

    const plan = evaluateMeshFailoverPlan({
      nodes,
      deployments,
      minStandbyHeadroomMb: 128,
    });

    // dep-a fits (768 + 128 = 896 <= 1024), leaving 256MB; dep-b requires 512 + 128 = 640 > 256
    expect(plan.actions).toHaveLength(3);
    expect(plan.actions[0]?.deploymentId).toBe('dep-a');
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0]?.code).toBe('no_healthy_standby');
    expect(plan.alerts[0]?.deploymentId).toBe('dep-b');
    expect(plan.failClosed).toBe(true);
  });

  it('produces identical planSha256 regardless of input array ordering', () => {
    const nodeA: MeshVpsNode = {
      nodeId: 'node-a',
      meshIp: '10.10.0.1',
      region: 'us-east-1',
      healthy: false,
      dockerStatus: 'stopped',
      availableRamMb: 2048,
      cpuLoadPercent: 10,
    };
    const nodeB: MeshVpsNode = {
      nodeId: 'node-b',
      meshIp: '10.10.0.2',
      region: 'us-west-2',
      healthy: true,
      dockerStatus: 'running',
      availableRamMb: 4096,
      cpuLoadPercent: 20,
    };
    const dep1: ActiveTenantDeployment = {
      deploymentId: 'dep-1',
      tenantId: 't1',
      appSlug: 'app-1',
      primaryNodeId: 'node-a',
      requiredRamMb: 256,
    };
    const dep2: ActiveTenantDeployment = {
      deploymentId: 'dep-2',
      tenantId: 't2',
      appSlug: 'app-2',
      primaryNodeId: 'node-b',
      requiredRamMb: 256,
    };

    const plan1 = evaluateMeshFailoverPlan({
      nodes: [nodeA, nodeB],
      deployments: [dep1, dep2],
    });
    const plan2 = evaluateMeshFailoverPlan({
      nodes: [nodeB, nodeA],
      deployments: [dep2, dep1],
    });

    expect(plan1.planSha256).toBe(plan2.planSha256);
    expect(plan1.actions).toEqual(plan2.actions);
  });
});
