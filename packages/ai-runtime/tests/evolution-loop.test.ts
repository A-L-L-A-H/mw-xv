import { describe, expect, it } from 'vitest';
import {
  synthesizeEvolutionCandidates,
  type EvolutionSynthesisInput,
} from '../src/evolution-loop.js';

function createBaseInput(
  overrides: Partial<EvolutionSynthesisInput> = {}
): EvolutionSynthesisInput {
  return {
    companyId: 42,
    runId: 'run_m14_001',
    workContractId: 'wc_m14_001',
    proofGatePassed: true,
    checks: [
      { name: 'typecheck', passed: true, summary: '0 errors' },
      { name: 'unit-tests', passed: true, summary: '12 passed' },
    ],
    diffSummary: 'Added bounded retry logic for transient RPC timeouts.',
    lessons: [
      'Always bound retry backoff with jitter.',
      'Validate tenant companyId before persisting candidate artifacts.',
    ],
    ...overrides,
  };
}

describe('synthesizeEvolutionCandidates', () => {
  it('fails closed when proofGatePassed is false', () => {
    const result = synthesizeEvolutionCandidates(createBaseInput({ proofGatePassed: false }));

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('PROOF_GATE_NOT_PASSED');
    expect(result.candidates).toEqual([]);
    expect(result.synthesisSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('fails closed when companyId is non-positive or non-integer', () => {
    for (const invalidCompanyId of [0, -5, 1.5, Number.NaN]) {
      const result = synthesizeEvolutionCandidates(
        createBaseInput({ companyId: invalidCompanyId })
      );

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('PROOF_GATE_NOT_PASSED');
      expect(result.candidates).toEqual([]);
    }
  });

  it('synthesizes skill and memory candidates with strict human-approval guardrails', () => {
    const result = synthesizeEvolutionCandidates(createBaseInput());

    expect(result.accepted).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.candidates).toHaveLength(3);

    const skillCandidates = result.candidates.filter(
      (candidate) => candidate.artifactKind === 'ai.skill_version'
    );
    const memoryCandidates = result.candidates.filter(
      (candidate) => candidate.artifactKind === 'ai.memory_candidate'
    );

    expect(skillCandidates).toHaveLength(1);
    expect(memoryCandidates).toHaveLength(2);

    for (const candidate of result.candidates) {
      expect(candidate.candidateOnly).toBe(true);
      expect(candidate.requiresHumanApproval).toBe(true);
      expect(candidate.automatedPromotionAllowed).toBe(false);
      expect(candidate.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(candidate.companyId).toBe(42);
      expect(candidate.runId).toBe('run_m14_001');
      expect(candidate.workContractId).toBe('wc_m14_001');
    }
  });

  it('redacts secrets from diffSummary, lessons, and checks', () => {
    const rawSecret = 'super-secret-tenant-token-998877';
    const result = synthesizeEvolutionCandidates(
      createBaseInput({
        diffSummary: `Rotated Authorization: Bearer tok_secret_abcdef123456 and key=${rawSecret}`,
        lessons: [`Never log password=mySecretPass123 or ${rawSecret}`],
        checks: [
          {
            name: 'secret-scan',
            passed: true,
            summary: `Checked ${rawSecret}`,
          },
        ],
        knownSecrets: [rawSecret],
      })
    );

    expect(result.accepted).toBe(true);
    const serialized = JSON.stringify(result.candidates);
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain('tok_secret_abcdef123456');
    expect(serialized).not.toContain('mySecretPass123');
    expect(serialized).toContain('[REDACTED');
  });

  it('produces deterministic hashes regardless of lesson and check ordering', () => {
    const first = synthesizeEvolutionCandidates(createBaseInput());
    const second = synthesizeEvolutionCandidates(
      createBaseInput({
        checks: [
          { name: 'unit-tests', passed: true, summary: '12 passed' },
          { name: 'typecheck', passed: true, summary: '0 errors' },
        ],
        lessons: [
          'Validate tenant companyId before persisting candidate artifacts.',
          'Always bound retry backoff with jitter.',
        ],
      })
    );

    expect(second.synthesisSha256).toBe(first.synthesisSha256);
    expect(second.candidates).toEqual(first.candidates);
  });

  it('synthesizes a fallback memory candidate when lessons array is empty', () => {
    const result = synthesizeEvolutionCandidates(createBaseInput({ lessons: [] }));

    expect(result.accepted).toBe(true);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.artifactKind).toBe('ai.skill_version');
    expect(result.candidates[1]?.artifactKind).toBe('ai.memory_candidate');
    expect(result.candidates[1]?.content).toContain('bounded retry logic');
  });
});
