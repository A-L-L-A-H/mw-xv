import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  containsProhibitedMinorIdentifiers,
  evaluateChildProtectionAndPublicationGate,
  validateChildProtectionGateInput,
  type ChildProtectionGateInput,
} from '../src/index.js';

const sha = (label: string) => createHash('sha256').update(label, 'utf8').digest('hex');

function baseInput(overrides: Partial<ChildProtectionGateInput> = {}): ChildProtectionGateInput {
  return {
    schema_version: 1,
    record_id: 'mw:bug-case:synth-013',
    classification: 'CHILD_SENSITIVE',
    inherited_classifications: [],
    program_slot: 13,
    minor_involved: true,
    synthetic: true,
    requested_channel: 'escalation_review',
    safeguarding_process_approved: false,
    candidate_payload: {
      summary: 'Synthetic minimized safeguarding summary without minor identifiers.',
    },
    ...overrides,
  };
}

describe('child protection and publication risk gates', () => {
  it('denies PUBLIC projection by default and blocks minor-related records on all external/AI/log channels', () => {
    const internalRecord = baseInput({
      classification: 'INTERNAL',
      program_slot: 1,
      minor_involved: false,
      requested_channel: 'public_projection',
    });
    const internalPublicAttempt = evaluateChildProtectionAndPublicationGate(internalRecord);
    expect(internalPublicAttempt.allowed).toBe(false);
    expect(internalPublicAttempt.reasons).toContain('public_projection_denied_by_default');
    expect(internalPublicAttempt.reasons).toContain('publication_approval_required');

    for (const channel of [
      'public_projection',
      'public_url',
      'search_index',
      'ai_prompt',
      'analytics',
      'log_output',
    ] as const) {
      const decision = evaluateChildProtectionAndPublicationGate(
        baseInput({
          requested_channel: channel,
          safeguarding_process_approved: true,
          escalation_approval: {
            safeguarding_owner_id: 'mw:user:owner-1',
            reviewer_id: 'mw:user:reviewer-1',
            requester_id: 'mw:user:requester-1',
            escalation_reason: 'Synthetic escalation check',
            approved_at: '2026-11-21T00:00:00Z',
            decision_ref: 'synthetic:esc:001',
          },
          publication_approval: {
            reviewer_id: 'mw:user:pub-reviewer-1',
            requester_id: 'mw:user:requester-1',
            minimized: true,
            source_revision_sha256: sha('src'),
            projection_revision_sha256: sha('proj'),
            decision_ref: 'synthetic:pub:001',
          },
        })
      );
      expect(decision.allowed).toBe(false);
      expect(decision.effective_classification).toBe('CHILD_SENSITIVE');
      expect(decision.reasons).toContain('child_sensitive_channel_forbidden');
    }
  });

  it('prevents classification downgrade via inherited records or slot 13', () => {
    const downgradedClaim = baseInput({
      classification: 'PUBLIC_APPROVED',
      inherited_classifications: ['CHILD_SENSITIVE'],
      program_slot: 1,
      minor_involved: false,
      requested_channel: 'public_projection',
      publication_approval: {
        reviewer_id: 'mw:user:pub-reviewer-1',
        requester_id: 'mw:user:requester-1',
        minimized: true,
        source_revision_sha256: sha('src'),
        projection_revision_sha256: sha('proj'),
        decision_ref: 'synthetic:pub:001',
      },
    });
    const decision = evaluateChildProtectionAndPublicationGate(downgradedClaim);
    expect(decision.allowed).toBe(false);
    expect(decision.effective_classification).toBe('CHILD_SENSITIVE');
    expect(decision.reasons).toContain('child_sensitive_channel_forbidden');
  });

  it('denies child-sensitive internal review until safeguarding process is approved and detects minor PII', () => {
    const unapprovedProcess = evaluateChildProtectionAndPublicationGate(baseInput());
    expect(unapprovedProcess.allowed).toBe(false);
    expect(unapprovedProcess.reasons).toContain('safeguarding_process_not_approved');
    expect(unapprovedProcess.reasons).toContain('escalation_approval_required');

    const withIdentifiers = baseInput({
      safeguarding_process_approved: true,
      escalation_approval: {
        safeguarding_owner_id: 'mw:user:owner-1',
        reviewer_id: 'mw:user:reviewer-1',
        requester_id: 'mw:user:requester-1',
        escalation_reason: 'Escalation check',
        approved_at: '2026-11-21T00:00:00Z',
        decision_ref: 'synthetic:esc:002',
      },
      candidate_payload: {
        nested: {
          child_name: 'Synthetic Minor',
          school_name: 'Synthetic School',
          contact: 'parent@example.invalid',
        },
      },
    });
    const piiDecision = evaluateChildProtectionAndPublicationGate(withIdentifiers);
    expect(piiDecision.allowed).toBe(false);
    expect(piiDecision.reasons).toContain('minor_identifiers_detected');
    expect(piiDecision.detected_minor_identifier_paths).toEqual([
      '/nested/child_name',
      '/nested/contact',
      '/nested/school_name',
    ]);
    // Audit summary must never contain raw minor identifier text
    expect(JSON.stringify(piiDecision.audit_summary)).not.toContain('Synthetic Minor');
    expect(JSON.stringify(piiDecision.audit_summary)).not.toContain('parent@example.invalid');
    expect(containsProhibitedMinorIdentifiers({ dob: '2015-01-01' })).toEqual(['/dob']);
  });

  it('allows minimized PUBLIC_APPROVED non-minor projection and approved synthetic escalation only when all gates pass', () => {
    const validEscalation = baseInput({
      safeguarding_process_approved: true,
      escalation_approval: {
        safeguarding_owner_id: 'mw:user:owner-1',
        reviewer_id: 'mw:user:reviewer-1',
        requester_id: 'mw:user:requester-1',
        escalation_reason: 'Authorized synthetic safeguarding review.',
        approved_at: '2026-11-21T00:00:00Z',
        decision_ref: 'synthetic:esc:003',
      },
    });
    const escDecision = evaluateChildProtectionAndPublicationGate(validEscalation);
    expect(escDecision.allowed).toBe(true);
    expect(escDecision.reasons).toEqual([]);

    const validPublic = baseInput({
      classification: 'PUBLIC_APPROVED',
      inherited_classifications: ['PUBLIC_APPROVED'],
      program_slot: 1,
      minor_involved: false,
      requested_channel: 'public_projection',
      publication_approval: {
        reviewer_id: 'mw:user:pub-reviewer-1',
        requester_id: 'mw:user:requester-1',
        minimized: true,
        source_revision_sha256: sha('src'),
        projection_revision_sha256: sha('proj'),
        decision_ref: 'synthetic:pub:003',
      },
    });
    const pubDecision = evaluateChildProtectionAndPublicationGate(validPublic);
    expect(pubDecision.allowed).toBe(true);
    expect(pubDecision.reasons).toEqual([]);
  });

  it('rejects self-approval, unminimized publications, non-synthetic minor data, and malformed inputs fail-closed', () => {
    const selfApprovedPublic = baseInput({
      classification: 'PUBLIC_APPROVED',
      program_slot: 1,
      minor_involved: false,
      requested_channel: 'public_projection',
      publication_approval: {
        reviewer_id: 'mw:user:same-actor',
        requester_id: 'mw:user:same-actor',
        minimized: false,
        source_revision_sha256: sha('src'),
        projection_revision_sha256: sha('proj'),
        decision_ref: 'synthetic:pub:bad',
      },
    });
    const badPubDecision = evaluateChildProtectionAndPublicationGate(selfApprovedPublic);
    expect(badPubDecision.allowed).toBe(false);
    expect(badPubDecision.reasons).toContain('self_approval_forbidden');
    expect(badPubDecision.reasons).toContain('unminimized_publication_blocked');

    const nonSyntheticMinor = baseInput({
      synthetic: false,
      safeguarding_process_approved: true,
      escalation_approval: {
        safeguarding_owner_id: 'mw:user:owner-1',
        reviewer_id: 'mw:user:reviewer-1',
        requester_id: 'mw:user:requester-1',
        escalation_reason: 'Should block non-synthetic minor data',
        approved_at: '2026-11-21T00:00:00Z',
        decision_ref: 'synthetic:esc:bad',
      },
    });
    expect(evaluateChildProtectionAndPublicationGate(nonSyntheticMinor).reasons).toContain(
      'non_synthetic_minor_record_blocked'
    );

    expect(validateChildProtectionGateInput({ bad: true }).valid).toBe(false);
    const malformedDecision = evaluateChildProtectionAndPublicationGate({ bad: true });
    expect(malformedDecision.allowed).toBe(false);
    expect(malformedDecision.reasons).toEqual(['invalid_gate_input']);
  });
});
