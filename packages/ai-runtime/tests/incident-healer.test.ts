import { describe, expect, it } from 'vitest';
import {
  synthesizeIncidentHealingProposal,
  type StructuredIncidentLog,
} from '../src/incident-healer.js';
import type { CausalCheckpoint } from '../src/causal-replay.js';

describe('M17.04 incident-healer', () => {
  it('redacts secrets, clusters recurring faults, integrates EFE + causal replay, and locks automatedSelfMerge=false', () => {
    const logs: StructuredIncidentLog[] = [
      {
        timestamp: '2026-11-23T01:00:00Z',
        service: 'gateway',
        level: 'error',
        errorCode: 'E_CONN_RESET',
        message: 'Upstream reset with token=super_secret_token_value_12345 on req 101',
      },
      {
        timestamp: '2026-11-23T01:00:05Z',
        service: 'gateway',
        level: 'error',
        errorCode: 'E_CONN_RESET',
        message: 'Upstream reset with token=super_secret_token_value_99999 on req 202',
      },
      {
        timestamp: '2026-11-23T01:00:10Z',
        service: 'worker',
        level: 'info',
        message: 'Heartbeat ok',
      },
    ];

    const checkpoints: CausalCheckpoint[] = [
      {
        stepIndex: 0,
        checkpointId: 'cp-0',
        commitSha: 'aaaa1111',
        proofGatePassed: true,
        worldModelSurpriseBps: 500,
      },
      {
        stepIndex: 1,
        checkpointId: 'cp-1',
        commitSha: 'bbbb2222',
        proofGatePassed: false,
        worldModelSurpriseBps: 4500,
        toolErrors: ['E_CONN_RESET upstream socket closed'],
      },
    ];

    const proposal = synthesizeIncidentHealingProposal('inc-42', logs, checkpoints);

    expect(proposal.primaryCluster).not.toBeNull();
    expect(proposal.primaryCluster?.occurrenceCount).toBe(2);
    expect(proposal.primaryCluster?.service).toBe('gateway');
    expect(JSON.stringify(proposal)).not.toContain('super_secret_token_value_12345');
    expect(JSON.stringify(proposal)).not.toContain('super_secret_token_value_99999');
    expect(proposal.causalDivergence?.diverged).toBe(true);
    expect(proposal.efeDecision.selectedActionId).toBeTruthy();
    expect(proposal.requiresHumanApproval).toBe(true);
    expect(proposal.automatedSelfMerge).toBe(false);
    expect(proposal.automatedPromotionAllowed).toBe(false);
    expect(proposal.proposalSha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});
