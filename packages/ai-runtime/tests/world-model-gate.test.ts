import { describe, expect, it } from 'vitest';
import { createRedactor } from '../src/redaction.js';
import { evaluateWorldModelConsistency } from '../src/world-model-gate.js';

describe('evaluateWorldModelConsistency', () => {
  it('returns consistent report with 0 surprise when prediction matches observation', () => {
    const report = evaluateWorldModelConsistency(
      {
        companyId: 7,
        runId: 'run-100',
        actionSummary: 'Update billing service',
        expectedChangedFiles: [
          'packages/api/src/billing.ts',
          './packages/api/tests/billing.test.ts',
        ],
        expectedHttpHealth: [
          {
            endpoint: 'https://api.example.test/health',
            expectedHealthy: true,
            expectedStatusCode: 200,
          },
        ],
        expectedContainerHealth: [
          { containerName: 'mw-api', expectedHealthy: true, expectedState: 'running' },
        ],
        expectedInvariants: [{ id: 'inv-no-5xx', expectedPass: true, expectedValue: '0' }],
      },
      {
        observedChangedFiles: [
          'packages\\api\\src\\billing.ts',
          'packages/api/tests/billing.test.ts',
        ],
        observedHttpHealth: [
          { endpoint: 'https://api.example.test/health', healthy: true, statusCode: 200 },
        ],
        observedContainerHealth: [{ containerName: 'mw-api', healthy: true, state: 'running' }],
        observedInvariants: [{ id: 'inv-no-5xx', passed: true, observedValue: '0' }],
      }
    );

    expect(report.consistent).toBe(true);
    expect(report.surpriseScoreBps).toBe(0);
    expect(report.reasonCodes).toEqual([]);
    expect(report.findings).toEqual([]);
    expect(report.obligationProposal).toBeNull();
    expect(report.automatedSelfAccept).toBe(false);
    expect(report.reportSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('detects UNEXPECTED_SIDE_EFFECT and PREDICTION_MISMATCH and emits advisory ai.obligation proposal', () => {
    const report = evaluateWorldModelConsistency(
      {
        companyId: 42,
        runId: 'run-202',
        actionSummary: 'Migrate auth handler',
        expectedChangedFiles: ['packages/api/src/auth.ts'],
        expectedHttpHealth: [
          {
            endpoint: 'https://api.example.test/health',
            expectedHealthy: true,
            expectedStatusCode: 200,
          },
        ],
        expectedContainerHealth: [
          { containerName: 'mw-api', expectedHealthy: true, expectedState: 'running' },
        ],
        expectedInvariants: [{ id: 'inv-tenant-isolation', expectedPass: true }],
      },
      {
        observedChangedFiles: ['packages/api/src/unexpected-file.ts'],
        observedHttpHealth: [
          { endpoint: 'https://api.example.test/health', healthy: false, statusCode: 503 },
        ],
        observedContainerHealth: [
          { containerName: 'mw-api', healthy: true, state: 'running' },
          { containerName: 'mw-worker', healthy: false, state: 'restarting' },
        ],
        observedInvariants: [{ id: 'inv-tenant-isolation', passed: false }],
      },
      { thresholdBps: 2000 }
    );

    expect(report.consistent).toBe(false);
    expect(report.surpriseScoreBps).toBeGreaterThanOrEqual(2000);
    expect(report.surpriseScoreBps).toBeLessThanOrEqual(10000);
    expect(report.reasonCodes).toEqual(['PREDICTION_MISMATCH', 'UNEXPECTED_SIDE_EFFECT']);
    expect(report.findings.length).toBeGreaterThanOrEqual(5);

    expect(report.obligationProposal).not.toBeNull();
    expect(report.obligationProposal?.kind).toBe('ai.obligation');
    expect(report.obligationProposal?.advisoryOnly).toBe(true);
    expect(report.obligationProposal?.automatedSelfAccept).toBe(false);
    expect(report.obligationProposal?.companyId).toBe(42);
    expect(report.obligationProposal?.surpriseScoreBps).toBe(report.surpriseScoreBps);
  });

  it('does not emit obligationProposal when surpriseScoreBps is below threshold', () => {
    const report = evaluateWorldModelConsistency(
      {
        expectedChangedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      },
      {
        observedChangedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'extra.ts'],
      },
      { thresholdBps: 3000 }
    );

    // 1 mismatch out of 6 checks => 1667 bps < 3000
    expect(report.surpriseScoreBps).toBe(1667);
    expect(report.consistent).toBe(false);
    expect(report.reasonCodes).toEqual(['UNEXPECTED_SIDE_EFFECT']);
    expect(report.obligationProposal).toBeNull();
  });

  it('redacts secrets in findings and produces deterministic reportSha256', () => {
    const redactor = createRedactor();
    const secret = 'sk-proj-supersecretvalue123456';
    redactor.registerSecret(secret);

    const inputPrediction = {
      actionSummary: `Deploy with ${secret}`,
      expectedHttpHealth: [
        { endpoint: `https://api.example.test/health?api_key=${secret}`, expectedHealthy: true },
      ],
    };
    const inputObservation = {
      observedHttpHealth: [
        {
          endpoint: `https://api.example.test/health?api_key=${secret}`,
          healthy: false,
          detail: `Bearer ${secret}`,
        },
      ],
    };

    const report1 = evaluateWorldModelConsistency(inputPrediction, inputObservation, { redactor });
    const report2 = evaluateWorldModelConsistency(inputPrediction, inputObservation, { redactor });

    expect(JSON.stringify(report1)).not.toContain(secret);
    expect(report1.reportSha256).toBe(report2.reportSha256);
    expect(report1.obligationProposal?.proposalId).toBe(report2.obligationProposal?.proposalId);
  });
});
