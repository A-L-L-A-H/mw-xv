import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AnalyticResponsibilityError,
  evaluateScopedAnalyticResponsibility,
  validateAnalyticResponsibilityRequest,
  type AnalyticResponsibilityRequest,
  type ResearchEvidenceReference,
  type TrustedAnalyticEvidenceResolution,
} from '../src/index.js';

const syntheticDigest = createHash('sha256')
  .update('synthetic-analytic-evidence', 'utf8')
  .digest('hex');

function makeEvidence(id: `mw:evidence:${string}`): TrustedAnalyticEvidenceResolution {
  const canonicalEvidence: ResearchEvidenceReference = {
    id,
    assertion_id: 'mw:assertion:analytic-001',
    direction: 'supporting',
    selector: {
      source_id: 'mw:source:ebible-webp-protestant',
      expression_id: 'mw:expression:webp-protestant',
      edition_id: 'mw:edition:webp-protestant-2020-stable',
      locator: 'Genesis 1:1',
      content_sha256: syntheticDigest,
    },
  };
  return {
    canonicalEvidence,
    reviewStatus: 'accepted',
    access: 'readable',
  };
}

function makeRequest(
  overrides: Partial<AnalyticResponsibilityRequest> = {}
): AnalyticResponsibilityRequest {
  return {
    schema_version: 1,
    request_id: 'mw:analytic-request:synth-001',
    policy_profile_id: 'mw:profile:mizan-policy-boundary-v1',
    policy_version: '1.0.0',
    subject_id: 'mw:entity:synthetic-subject-001',
    scope: {
      domain: 'synthetic_program_triage',
      context_label: 'synthetic-unit-test',
      advisory_purpose: 'Non-normative analytic factor calculation for synthetic test fixture.',
    },
    factors: [
      {
        factor_key: 'documentation_completeness',
        input_state: 'measured',
        weight: 0.6,
        score: 0.8,
        evidence_ids: ['mw:evidence:analytic-001'],
      },
      {
        factor_key: 'remediation_readiness',
        input_state: 'measured',
        weight: 0.4,
        score: 0.5,
        evidence_ids: ['mw:evidence:analytic-002'],
      },
    ],
    ...overrides,
  };
}

async function resolveAccepted(evidenceId: string): Promise<unknown> {
  if (evidenceId === 'mw:evidence:analytic-001' || evidenceId === 'mw:evidence:analytic-002') {
    return makeEvidence(evidenceId as `mw:evidence:${string}`);
  }
  return null;
}

describe('scoped analytic responsibility engine (optional)', () => {
  it('stays disabled by default unless explicitly opted in with enabled: true', async () => {
    const req = makeRequest();
    const defaultResult = await evaluateScopedAnalyticResponsibility(req, resolveAccepted);
    expect(defaultResult).toEqual({
      status: 'disabled',
      reason: 'analytic_engine_disabled_by_default',
      policy_profile_id: 'mw:profile:mizan-policy-boundary-v1',
      policy_version: '1.0.0',
      normative_boundary: {
        advisory_only: true,
        normative_verdicts_allowed: false,
        certifies_human_worth: false,
        certifies_salvation: false,
        certifies_divine_judgment: false,
        certifies_legal_status: false,
        autonomous_action_allowed: false,
      },
    });

    const explicitOff = await evaluateScopedAnalyticResponsibility(req, resolveAccepted, {
      enabled: false,
    });
    expect(explicitOff.status).toBe('disabled');
  });

  it('computes reproducible, evidence-bound, non-normative golden factors when enabled', async () => {
    const req = makeRequest();
    const first = await evaluateScopedAnalyticResponsibility(req, resolveAccepted, {
      enabled: true,
    });
    const second = await evaluateScopedAnalyticResponsibility(req, resolveAccepted, {
      enabled: true,
    });

    expect(first.status).toBe('evaluated');
    if (first.status !== 'evaluated' || second.status !== 'evaluated') {
      throw new Error('expected evaluated status');
    }
    expect(first.output_digest).toBe(second.output_digest);
    expect(first.overall_assessment_state).toBe('measured_advisory');
    expect(first.numeric_aggregate).toBe(0.68);
    expect(first.advisory_band).toBe('elevated');
    expect(first.normative_boundary).toEqual({
      advisory_only: true,
      normative_verdicts_allowed: false,
      certifies_human_worth: false,
      certifies_salvation: false,
      certifies_divine_judgment: false,
      certifies_legal_status: false,
      autonomous_action_allowed: false,
    });
  });

  it('preserves unknown when data is missing, conflicting, unreviewed, or access-denied', async () => {
    const missingDataReq = makeRequest({
      factors: [
        {
          factor_key: 'documentation_completeness',
          input_state: 'measured',
          weight: 0.5,
          score: 0.9,
          evidence_ids: ['mw:evidence:analytic-001'],
        },
        {
          factor_key: 'remediation_readiness',
          input_state: 'missing',
          weight: 0.5,
          evidence_ids: [],
        },
      ],
    });

    const missingResult = await evaluateScopedAnalyticResponsibility(
      missingDataReq,
      resolveAccepted,
      { enabled: true }
    );
    expect(missingResult.status).toBe('evaluated');
    if (missingResult.status !== 'evaluated') throw new Error('expected evaluated');
    expect(missingResult.overall_assessment_state).toBe('unknown');
    expect(missingResult.numeric_aggregate).toBeNull();
    expect(missingResult.advisory_band).toBe('unknown');
    expect(missingResult.factors[1].score).toBeNull();

    const unreviewedResult = await evaluateScopedAnalyticResponsibility(
      makeRequest(),
      async (evidenceId) => {
        if (evidenceId === 'mw:evidence:analytic-002') {
          return { ...makeEvidence('mw:evidence:analytic-002'), reviewStatus: 'unreviewed' };
        }
        return resolveAccepted(evidenceId);
      },
      { enabled: true }
    );
    if (unreviewedResult.status !== 'evaluated') throw new Error('expected evaluated');
    expect(unreviewedResult.overall_assessment_state).toBe('unknown');
    expect(unreviewedResult.numeric_aggregate).toBeNull();

    const deniedResult = await evaluateScopedAnalyticResponsibility(
      makeRequest(),
      async (evidenceId) => {
        if (evidenceId === 'mw:evidence:analytic-001') {
          return { ...makeEvidence('mw:evidence:analytic-001'), access: 'denied' };
        }
        return resolveAccepted(evidenceId);
      },
      { enabled: true }
    );
    if (deniedResult.status !== 'evaluated') throw new Error('expected evaluated');
    expect(deniedResult.overall_assessment_state).toBe('unknown');
    expect(deniedResult.numeric_aggregate).toBeNull();
  });

  it('applies explicit human override without erasing original factor calculations', async () => {
    const req = makeRequest({
      human_override: {
        override_state: 'mark_unknown',
        reviewer_id: 'mw:user:reviewer-1',
        reviewed_at: '2026-11-21T00:00:00Z',
        rationale: 'Human reviewer held score pending contextual clarification.',
        evidence_refs: ['synthetic:review:hold-1'],
      },
    });
    const res = await evaluateScopedAnalyticResponsibility(req, resolveAccepted, { enabled: true });
    if (res.status !== 'evaluated') throw new Error('expected evaluated');
    expect(res.numeric_aggregate).toBe(0.68);
    expect(res.overall_assessment_state).toBe('unknown');
    expect(res.advisory_band).toBe('unknown');
    expect(res.human_override?.reviewer_id).toBe('mw:user:reviewer-1');
  });

  it('fails closed on normative fields, invalid weights, missing evidence IDs, and async mutation', async () => {
    const withNormativeClaim = { ...makeRequest(), certifies_salvation: true };
    expect(validateAnalyticResponsibilityRequest(withNormativeClaim).valid).toBe(false);
    await expect(
      evaluateScopedAnalyticResponsibility(withNormativeClaim, resolveAccepted, { enabled: true })
    ).rejects.toThrow(AnalyticResponsibilityError);

    const badWeights = makeRequest({
      factors: [
        {
          factor_key: 'documentation_completeness',
          input_state: 'measured',
          weight: 0.5,
          score: 0.5,
          evidence_ids: ['mw:evidence:analytic-001'],
        },
      ],
    });
    expect(validateAnalyticResponsibilityRequest(badWeights).valid).toBe(false);

    const measuredWithoutEvidence = makeRequest({
      factors: [
        {
          factor_key: 'documentation_completeness',
          input_state: 'measured',
          weight: 1,
          score: 0.5,
          evidence_ids: [],
        },
      ],
    });
    expect(validateAnalyticResponsibilityRequest(measuredWithoutEvidence).valid).toBe(false);

    const mutableReq = makeRequest();
    await expect(
      evaluateScopedAnalyticResponsibility(
        mutableReq,
        async (evidenceId) => {
          (mutableReq.factors[0] as { score?: number }).score = 0.99;
          return resolveAccepted(evidenceId);
        },
        { enabled: true }
      )
    ).rejects.toThrow(AnalyticResponsibilityError);
  });
});
