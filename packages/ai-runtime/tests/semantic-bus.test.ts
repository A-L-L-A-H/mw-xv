import { describe, expect, it } from 'vitest';
import {
  matchTaskToMeshAgentsByResonance,
  type MeshNodeCapability,
  type SemanticTaskIntent,
} from '../src/semantic-bus.js';

describe('semantic-bus', () => {
  const baseTask: SemanticTaskIntent = {
    taskId: 'task-mesh-001',
    companyId: 42,
    dataClassification: 'local_only',
    maxCostMicros: 50_000,
    summary: 'Verify Rust build and TypeScript invariants',
    capabilityVector: [1, 0, 0],
    tags: ['typescript', 'vitest', 'security'],
  };

  it('ranks eligible private-mesh nodes by cosine similarity and lexical tag overlap', () => {
    const nodes: MeshNodeCapability[] = [
      {
        nodeId: 'node-b',
        agentId: 'agent-b',
        endpoint: 'http://100.64.10.2:8080',
        companyId: 42,
        allowedClassifications: ['local_only', 'cloud_eligible'],
        estimatedCostMicros: 20_000,
        capabilityVector: [0.6, 0.8, 0],
        tags: ['typescript'],
      },
      {
        nodeId: 'node-a',
        agentId: 'agent-a',
        endpoint: 'http://10.10.0.5:9000',
        companyId: 42,
        allowedClassifications: ['local_only'],
        estimatedCostMicros: 30_000,
        capabilityVector: [1, 0, 0],
        tags: ['typescript', 'vitest', 'security'],
      },
    ];

    const result = matchTaskToMeshAgentsByResonance(baseTask, nodes);

    expect(result.automatedSelfAccept).toBe(false);
    expect(result.dispatchSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.rejectedNodes).toHaveLength(0);
    expect(result.rankedMatches).toHaveLength(2);
    expect(result.selectedNode?.nodeId).toBe('node-a');
    expect(result.selectedNode?.cosineSimilarity).toBe(1);
    expect(result.selectedNode?.lexicalTagOverlap).toBe(1);
    expect(result.selectedNode?.resonanceScore).toBe(1);
    expect(result.rankedMatches[1]?.nodeId).toBe('node-b');
    expect(result.rankedMatches[1]?.resonanceScore).toBeLessThan(1);
  });

  it('fail-closed filters public endpoints, cross-company nodes, classification violations, and over-budget nodes', () => {
    const nodes: MeshNodeCapability[] = [
      {
        nodeId: 'public-node',
        agentId: 'agent-pub',
        endpoint: 'https://api.example.com/a2a',
        companyId: 42,
        allowedClassifications: ['local_only'],
        estimatedCostMicros: 1_000,
        capabilityVector: [1, 0, 0],
        tags: ['typescript'],
      },
      {
        nodeId: 'wrong-company-node',
        agentId: 'agent-other',
        endpoint: 'http://192.168.1.50:8080',
        companyId: 99,
        allowedClassifications: ['local_only'],
        estimatedCostMicros: 1_000,
        capabilityVector: [1, 0, 0],
        tags: ['typescript'],
      },
      {
        nodeId: 'wrong-classification-node',
        agentId: 'agent-cloud',
        endpoint: 'http://172.16.0.10:8080',
        companyId: 42,
        allowedClassifications: ['cloud_eligible'],
        estimatedCostMicros: 1_000,
        capabilityVector: [1, 0, 0],
        tags: ['typescript'],
      },
      {
        nodeId: 'expensive-node',
        agentId: 'agent-pricey',
        endpoint: 'http://[fd00::42]:8080',
        companyId: 42,
        allowedClassifications: ['local_only'],
        estimatedCostMicros: 99_999,
        capabilityVector: [1, 0, 0],
        tags: ['typescript'],
      },
      {
        nodeId: 'bad-vector-node',
        agentId: 'agent-vec',
        endpoint: 'http://10.0.0.9:8080',
        companyId: 42,
        allowedClassifications: ['local_only'],
        estimatedCostMicros: 5_000,
        capabilityVector: [1, 0],
        tags: ['typescript'],
      },
    ];

    const result = matchTaskToMeshAgentsByResonance(baseTask, nodes);

    expect(result.selectedNode).toBeNull();
    expect(result.rankedMatches).toHaveLength(0);
    expect(result.rejectedNodes).toHaveLength(5);
    expect(result.rejectedNodes.map((entry) => entry.reasonCode)).toEqual([
      'PUBLIC_ENDPOINT_FORBIDDEN',
      'COMPANY_ISOLATION_VIOLATION',
      'CLASSIFICATION_VIOLATION',
      'COST_BUDGET_EXCEEDED',
      'INVALID_CAPABILITY_VECTOR',
    ]);
    expect(result.automatedSelfAccept).toBe(false);
    expect(result.dispatchSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('breaks ties deterministically by lower cost then nodeId and produces stable dispatchSha256', () => {
    const nodes: MeshNodeCapability[] = [
      {
        nodeId: 'node-z',
        agentId: 'agent-z',
        endpoint: 'http://10.0.0.2:8080',
        companyId: 42,
        allowedClassifications: ['local_only'],
        estimatedCostMicros: 10_000,
        capabilityVector: [1, 0, 0],
        tags: ['typescript', 'vitest', 'security'],
      },
      {
        nodeId: 'node-a',
        agentId: 'agent-a',
        endpoint: 'http://10.0.0.3:8080',
        companyId: 42,
        allowedClassifications: ['local_only'],
        estimatedCostMicros: 10_000,
        capabilityVector: [1, 0, 0],
        tags: ['typescript', 'vitest', 'security'],
      },
      {
        nodeId: 'node-cheap',
        agentId: 'agent-cheap',
        endpoint: 'http://10.0.0.4:8080',
        companyId: 42,
        allowedClassifications: ['local_only'],
        estimatedCostMicros: 5_000,
        capabilityVector: [1, 0, 0],
        tags: ['typescript', 'vitest', 'security'],
      },
    ];

    const first = matchTaskToMeshAgentsByResonance(baseTask, nodes);
    const second = matchTaskToMeshAgentsByResonance(baseTask, nodes);

    expect(first.rankedMatches.map((m) => m.nodeId)).toEqual(['node-cheap', 'node-a', 'node-z']);
    expect(first.dispatchSha256).toBe(second.dispatchSha256);
  });
});
