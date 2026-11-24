import { describe, expect, it } from 'vitest';

import {
  ApprovalRequiredError,
  EXECUTION_FINGERPRINT_VERSION,
  StaleFencingError,
  computeExecutionFingerprint,
  sha256Canonical,
} from '../src/agent-run-executor.js';

const baseInput = {
  contract: { id: 1, code: 'contract-a', revision: 2 },
  agent: { id: 2, code: 'builder' },
  grant: { id: 3, policyVersion: 4, expiresAt: '2027-01-01T00:00:00.000Z' },
  provider: { id: 4, code: 'freellmapi_default', kind: 'freellmapi' },
  model: { id: 5, modelId: 'real-gateway-model' },
  policy: { id: 6, version: 4, maxRiskTier: 'R3' },
  repository: { snapshotId: 'snap-1', baseCommit: 'a'.repeat(40), allowedPaths: ['src'] },
  classification: 'cloud_eligible',
  limits: { maxSteps: 16, maxTokens: 64000, maxCostMicros: 0 },
  secretRefName: 'MW_AI_FREELLM_KEY',
} as const;

describe('durable agent run fingerprints', () => {
  it('is deterministic, versioned and a SHA-256 digest', () => {
    const first = computeExecutionFingerprint(baseInput);
    expect(first).toBe(computeExecutionFingerprint(baseInput));
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(EXECUTION_FINGERPRINT_VERSION).toBe(1);
  });

  it('changes when any authority input changes', () => {
    const baseline = computeExecutionFingerprint(baseInput);
    expect(computeExecutionFingerprint({ ...baseInput, policy: { ...baseInput.policy, version: 5 } })).not.toBe(
      baseline
    );
    expect(
      computeExecutionFingerprint({
        ...baseInput,
        repository: { ...baseInput.repository, allowedPaths: ['src', 'tests'] },
      })
    ).not.toBe(baseline);
    expect(computeExecutionFingerprint({ ...baseInput, toolVersions: ['workspace-tools@v2'] })).not.toBe(
      baseline
    );
  });

  it('includes the secret reference name only, never a raw credential', () => {
    const withRef = computeExecutionFingerprint(baseInput);
    const withDifferentRef = computeExecutionFingerprint({
      ...baseInput,
      secretRefName: 'MW_AI_OTHER_KEY',
    });
    expect(withRef).not.toBe(withDifferentRef);
    expect(sha256Canonical({ a: 1, b: 2 })).toBe(sha256Canonical({ b: 2, a: 1 }));
  });

  it('exposes typed fail-closed errors for fencing and approval gating', () => {
    expect(new StaleFencingError('stale').code).toBe('STALE_FENCING_TOKEN');
    expect(new ApprovalRequiredError('needed').code).toBe('APPROVAL_REQUIRED');
  });
});
