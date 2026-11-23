import { describe, expect, it } from 'vitest';
import {
  addA2aBusinessMinutes,
  buildA2aCapabilitySeed,
  computeA2aReputationScore,
  createA2aCapabilityRegistry,
  delegateA2aCapability,
  evaluateA2aDelegation,
  findA2aCapabilityCandidates,
  registerA2aCapabilityClaim,
  recordA2aReputationEvent,
  resolveA2aCapability,
  type A2aCapabilityClaimSeed,
  type A2aCapabilityRegistry,
  type A2aDelegationRequest,
  type A2aReputationEventInput,
} from '../src/index.js';

function makeClaim(overrides: Partial<A2aCapabilityClaimSeed> = {}): A2aCapabilityClaimSeed {
  return {
    claimId: 'a2a-claim-new-001',
    nodeId: 'idn-jkt-core-01',
    agentId: 'jkt-notifier',
    capabilityCode: 'notification.dispatch',
    status: 'active',
    confidence: 88,
    verifiedAt: '2026-11-22T04:00:00.000Z',
    ...overrides,
  };
}

function makeDelegation(overrides: Partial<A2aDelegationRequest> = {}): A2aDelegationRequest {
  return {
    contractId: 'a2a-sla-new-001',
    delegatorNodeId: 'idn-jkt-core-01',
    delegatorAgentId: 'jkt-orchestrator',
    executorNodeId: 'idn-sby-edge-02',
    executorAgentId: 'sby-triage',
    capabilityCode: 'whatsapp.triage',
    responseWindowMinutes: 5,
    resolutionWindowMinutes: 30,
    calendar: '24x7',
    riskClass: 'standard',
    maxDelegationDepth: 1,
    signedAt: '2026-11-22T00:00:00.000Z',
    expiresAt: '2026-12-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('A2A capability seed', () => {
  it('is deterministic and clone-isolated', () => {
    const first = buildA2aCapabilitySeed();
    const second = buildA2aCapabilitySeed();

    expect(first).toEqual(second);
    expect(first.nodes).toHaveLength(3);
    expect(first.agents).toHaveLength(6);
    expect(first.capabilityClaims).toHaveLength(10);
    expect(first.slaContracts).toHaveLength(5);
    expect(first.reputationLedger).toHaveLength(8);

    first.nodes.push({ ...first.nodes[0]!, nodeId: 'mutated-node' });
    expect(second.nodes.some((node) => node.nodeId === 'mutated-node')).toBe(false);
  });
});

describe('A2A capability registry', () => {
  it('sorts candidates by confidence and filters by node', () => {
    const registry = createA2aCapabilityRegistry();

    const candidates = findA2aCapabilityCandidates(registry, 'knowledge.query');
    expect(candidates.map((claim) => claim.claimId)).toEqual(['a2a-claim-006', 'a2a-claim-005']);

    const excluded = findA2aCapabilityCandidates(registry, 'knowledge.query', {
      excludeNodeIds: ['idn-sby-edge-02'],
    });
    expect(excluded).toEqual([]);

    const standby = findA2aCapabilityCandidates(registry, 'knowledge.query', {
      includeStandby: true,
    });
    expect(standby.map((claim) => claim.claimId)).toEqual([
      'a2a-claim-006',
      'a2a-claim-002',
      'a2a-claim-005',
    ]);

    expect(resolveA2aCapability(registry, 'knowledge.query')?.claimId).toBe('a2a-claim-006');
  });

  it('registers claims with strict identity and confidence validation', () => {
    const registry = createA2aCapabilityRegistry();

    expect(() => registerA2aCapabilityClaim(registry, makeClaim({ agentId: 'jkt-ghost' }))).toThrow(
      'is not registered'
    );
    expect(() =>
      registerA2aCapabilityClaim(registry, makeClaim({ claimId: 'a2a-claim-001' }))
    ).toThrow('already registered');
    expect(() =>
      registerA2aCapabilityClaim(
        registry,
        makeClaim({ capabilityCode: 'notification.dispatch', claimId: 'a2a-claim-011' })
      )
    ).toThrow('already claims capability');
    expect(() =>
      registerA2aCapabilityClaim(registry, makeClaim({ confidence: 101, claimId: 'a2a-claim-012' }))
    ).toThrow('confidence must be an integer from 0 to 100');

    const updated = registerA2aCapabilityClaim(
      registry,
      makeClaim({
        claimId: 'a2a-claim-013',
        capabilityCode: 'notification.escalation',
      })
    );
    expect(registry.capabilityClaims).toHaveLength(10);
    expect(updated.capabilityClaims).toHaveLength(11);
    expect(updated.capabilityClaims.at(-1)?.claimId).toBe('a2a-claim-013');
  });

  it('delegates only across active nodes with an active executor claim', () => {
    const registry = createA2aCapabilityRegistry();

    expect(() =>
      delegateA2aCapability(registry, makeDelegation({ contractId: 'a2a-sla-001' }))
    ).toThrow('already exists');
    expect(() =>
      delegateA2aCapability(
        registry,
        makeDelegation({
          executorNodeId: 'idn-jkt-core-01',
          executorAgentId: 'jkt-notifier',
          capabilityCode: 'notification.dispatch',
        })
      )
    ).toThrow('cross a node boundary');
    expect(() =>
      delegateA2aCapability(registry, makeDelegation({ executorAgentId: 'sby-knowledge' }))
    ).toThrow('has no active claim');
    expect(() =>
      delegateA2aCapability(
        registry,
        makeDelegation({ responseWindowMinutes: 40, resolutionWindowMinutes: 30 })
      )
    ).toThrow('resolutionWindowMinutes must exceed');
    expect(() =>
      delegateA2aCapability(registry, makeDelegation({ maxDelegationDepth: 4 }))
    ).toThrow('maxDelegationDepth must be an integer');
    expect(() =>
      delegateA2aCapability(registry, makeDelegation({ expiresAt: '2026-11-22T00:00:00.000Z' }))
    ).toThrow('expiresAt must be later');

    const updated = delegateA2aCapability(registry, makeDelegation());
    expect(registry.slaContracts).toHaveLength(5);
    expect(updated.slaContracts.at(-1)).toMatchObject({
      contractId: 'a2a-sla-new-001',
      status: 'active',
    });
  });

  it('evaluates SLA state and calendar-aware deadlines', () => {
    const registry: A2aCapabilityRegistry = createA2aCapabilityRegistry();

    expect(
      evaluateA2aDelegation(registry, 'a2a-sla-001', '2026-11-21T02:04:00.000Z')
    ).toMatchObject({
      status: 'active',
      responseDueAt: '2026-11-21T02:05:00.000Z',
      resolutionDueAt: '2026-11-21T02:30:00.000Z',
      responseOverdue: false,
      resolutionOverdue: false,
    });
    expect(
      evaluateA2aDelegation(registry, 'a2a-sla-001', '2026-11-21T02:31:00.000Z')
    ).toMatchObject({
      responseOverdue: true,
      resolutionOverdue: true,
    });
    expect(evaluateA2aDelegation(registry, 'a2a-sla-005', '2026-11-21T00:00:00.000Z').status).toBe(
      'renewal_due'
    );
    expect(evaluateA2aDelegation(registry, 'a2a-sla-001', '2026-12-21T02:00:00.000Z').status).toBe(
      'expired'
    );

    const registryWithRetired = {
      ...registry,
      slaContracts: registry.slaContracts.map((contract) =>
        contract.contractId === 'a2a-sla-001'
          ? { ...contract, status: 'retired' as const }
          : contract
      ),
    };
    expect(
      evaluateA2aDelegation(registryWithRetired, 'a2a-sla-001', '2026-11-21T00:00:00.000Z').status
    ).toBe('retired');
  });

  it('computes business minutes across workday end and weekend', () => {
    const registry = buildA2aCapabilitySeed();

    expect(addA2aBusinessMinutes('2026-11-20T02:00:00.000Z', 60, registry)).toBe(
      '2026-11-20T03:00:00.000Z'
    );
    expect(addA2aBusinessMinutes('2026-11-20T08:00:00.000Z', 60, registry)).toBe(
      '2026-11-20T09:00:00.000Z'
    );
    expect(addA2aBusinessMinutes('2026-11-20T10:30:00.000Z', 60, registry)).toBe(
      '2026-11-23T03:00:00.000Z'
    );
    expect(addA2aBusinessMinutes('2026-11-21T23:00:00.000Z', 30, registry)).toBe(
      '2026-11-23T02:30:00.000Z'
    );
    expect(addA2aBusinessMinutes('2026-11-20T08:00:00.000Z', 0, registry)).toBe(
      '2026-11-20T08:00:00.000Z'
    );
  });

  it('records reputation events and clamps scores', () => {
    const registry = createA2aCapabilityRegistry();
    expect(computeA2aReputationScore(registry, 'sby-triage')).toBe(100);

    const event: A2aReputationEventInput = {
      eventId: 'a2a-rep-new-001',
      agentId: 'sby-triage',
      counterpartyAgentId: 'jkt-orchestrator',
      contractId: 'a2a-sla-001',
      outcome: 'fulfilled',
      delta: 50,
      reason: 'Accepted delegated triage inside the acknowledgement window',
      recordedAt: '2026-11-22T05:00:00.000Z',
    };

    expect(() => recordA2aReputationEvent(registry, { ...event, delta: -50 })).toThrow(
      'fulfilled reputation events require a positive delta'
    );
    expect(() =>
      recordA2aReputationEvent(registry, { ...event, counterpartyAgentId: 'sby-triage' })
    ).toThrow('counterparty must be a different agent');

    const updated = recordA2aReputationEvent(registry, event);
    expect(registry.reputationLedger).toHaveLength(8);
    expect(updated.reputationLedger).toHaveLength(9);
    expect(computeA2aReputationScore(updated, 'sby-triage')).toBe(150);
    expect(() => recordA2aReputationEvent(updated, event)).toThrow('already recorded');

    const lowScore = {
      ...registry,
      reputationLedger: [
        {
          ...event,
          eventId: 'a2a-rep-new-002',
          outcome: 'breached' as const,
          delta: -50,
          reason: 'Delegated triage missed the acknowledgement window',
        },
      ],
    };
    expect(computeA2aReputationScore(lowScore, 'sby-triage')).toBe(50);
  });
});
