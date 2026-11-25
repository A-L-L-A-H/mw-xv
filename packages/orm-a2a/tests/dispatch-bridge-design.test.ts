import { describe, expect, it } from 'vitest';
import * as a2a from '../src/index.js';
import { A2A_DISPATCH_BRIDGE_DESIGN } from '../src/index.js';

describe('CF-020 dispatch bridge design (design only)', () => {
  it('is explicitly feature-flagged off and performs no dispatch', () => {
    expect(A2A_DISPATCH_BRIDGE_DESIGN).toMatchObject({
      issue: 74,
      stableTaskId: 'CF-020',
      status: 'design_only',
      featureFlag: 'MW_A2A_INBOX_DISPATCH_BRIDGE_ENABLED',
      enabledByDefault: false,
      acceptanceAuthority: 'pcw',
      canonicalQueue: '@moonwitness/jobs',
      targetModels: ['ai.work_contract', 'ai.agent_run'],
    });
    expect(A2A_DISPATCH_BRIDGE_DESIGN.disabledBehavior).toContain('never enqueue base.job');
    expect(Object.isFrozen(A2A_DISPATCH_BRIDGE_DESIGN)).toBe(true);

    const exportedDispatchFunctions = Object.keys(a2a).filter(
      (key) => /dispatch|work_contract|enqueue/i.test(key) && key !== 'A2A_DISPATCH_BRIDGE_DESIGN'
    );
    expect(exportedDispatchFunctions).toEqual([]);
  });

  it('documents PCW, data-classification and jobs-fencing gates plus enablement evidence', () => {
    const gateIds = A2A_DISPATCH_BRIDGE_DESIGN.gates.map((gate) => gate.id);
    expect(gateIds).toEqual(
      expect.arrayContaining([
        'pcw_verification',
        'classification',
        'capability_grant',
        'delegation_depth',
        'company_scope',
        'agent_binding',
        'server_only_accepted',
        'jobs_lease_fencing',
        'peer_identity',
        'transport_identity',
      ])
    );
    for (const gate of A2A_DISPATCH_BRIDGE_DESIGN.gates) {
      expect(gate.enforcedAt).toBe('dispatch_time');
      expect(gate.failClosed).toBe(true);
      expect(gate.description.length).toBeGreaterThan(20);
    }
    expect(
      A2A_DISPATCH_BRIDGE_DESIGN.gates.find((gate) => gate.id === 'pcw_verification')?.description
    ).toContain('Proof-Carrying Work');
    expect(A2A_DISPATCH_BRIDGE_DESIGN.lifecycle).toMatchObject({
      failure: expect.stringContaining('fresh job lease'),
      cancellation: expect.stringContaining('never marked accepted'),
      revocation: expect.stringContaining('immediately'),
      timeout: expect.stringContaining('fencing token'),
    });
    expect(A2A_DISPATCH_BRIDGE_DESIGN.enablementChecklist.length).toBeGreaterThanOrEqual(6);
    expect(A2A_DISPATCH_BRIDGE_DESIGN.enablementChecklist.join(' ')).toContain('Human approval');
    expect(A2A_DISPATCH_BRIDGE_DESIGN.enablementChecklist.join(' ')).toContain('ADR');
    expect(A2A_DISPATCH_BRIDGE_DESIGN.enablementChecklist.join(' ')).toContain('Security evidence');
  });
});
