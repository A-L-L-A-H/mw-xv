import { describe, expect, it } from 'vitest';
import {
  BugRegistryValidationError,
  createPlannedBugRegistrySlots,
  reviewBugRegistryAliases,
  validateBugRegistryDocument,
  type BugProgramSlot,
  type BugRegistryDocument,
} from '../src/index.js';

function baseSyntheticDocument(overrides: Partial<BugRegistryDocument> = {}): BugRegistryDocument {
  return {
    schema_version: 1,
    registry_id: 'mw:bug-registry:synthetic-recovery-v1',
    fixture_classification: 'synthetic',
    legacy_import_authorized: false,
    slots: createPlannedBugRegistrySlots(),
    alias_observations: [],
    alias_decisions: [],
    ...overrides,
  };
}

describe('33-BUG synthetic registry recovery and alias conflict review', () => {
  it('initializes 33 planned slots without fabricated submissions, approvals, or fixes and enforces slot 13 child safety', () => {
    const doc = baseSyntheticDocument();
    expect(doc.slots).toHaveLength(33);
    expect(doc.slots[12]).toMatchObject({
      slot_number: 13,
      program_id: 'mw:bug-program:slot-13',
      slot_state: 'planned_slot',
      submission_status: 'not_submitted',
      human_approval_status: 'unreviewed',
      verification_status: 'unverified',
      religious_approval_claimed: false,
      child_safety_gate: 'child_sensitive_protected',
    });

    expect(validateBugRegistryDocument(doc)).toEqual({ valid: true, issues: [] });
    const report = reviewBugRegistryAliases(doc);
    expect(report.total_planned_slots).toBe(33);
    expect(report.present_slots).toHaveLength(33);
    expect(report.missing_slots).toEqual([]);
    expect(report.planned_only_slot_count).toBe(33);
    expect(report.conflict_count).toBe(0);
    expect(report.report_digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('reports missing slots explicitly and classifies unresolved, confirmed_alias, and distinct deterministically', () => {
    const partialSlots: BugProgramSlot[] = [
      {
        slot_number: 1,
        program_id: 'mw:bug-program:slot-01',
        case_id: 'mw:bug-case:synthetic-001',
        submission_id: 'mw:bug-submission:synthetic-001',
        story_id: 'mw:story:synthetic-001',
        slot_state: 'partial_mapping',
        canonical_title: 'Synthetic Access Equity Slot',
        legacy_code: 'SYNTH-001',
        submission_status: 'synthetic_draft',
        editorial_publication_status: 'internal_draft',
        human_approval_status: 'unreviewed',
        verification_status: 'unverified',
        religious_approval_claimed: false,
        child_safety_gate: 'standard',
      },
      {
        slot_number: 14,
        program_id: 'mw:bug-program:slot-14',
        slot_state: 'conflict_held',
        canonical_title: 'Synthetic Shared Title',
        legacy_code: 'SYNTH-CONFLICT-014',
        submission_status: 'not_submitted',
        editorial_publication_status: 'unpublished',
        human_approval_status: 'unreviewed',
        verification_status: 'unverified',
        religious_approval_claimed: false,
        child_safety_gate: 'standard',
      },
      {
        slot_number: 15,
        program_id: 'mw:bug-program:slot-15',
        slot_state: 'conflict_held',
        canonical_title: 'Synthetic Shared Title',
        legacy_code: 'SYNTH-015',
        submission_status: 'not_submitted',
        editorial_publication_status: 'unpublished',
        human_approval_status: 'unreviewed',
        verification_status: 'unverified',
        religious_approval_claimed: false,
        child_safety_gate: 'standard',
      },
      {
        slot_number: 16,
        program_id: 'mw:bug-program:slot-16',
        slot_state: 'partial_mapping',
        canonical_title: 'Synthetic Distinct Alpha',
        legacy_code: 'SYNTH-CODE-DUP',
        submission_status: 'synthetic_draft',
        editorial_publication_status: 'unpublished',
        human_approval_status: 'unreviewed',
        verification_status: 'unverified',
        religious_approval_claimed: false,
        child_safety_gate: 'standard',
      },
      {
        slot_number: 17,
        program_id: 'mw:bug-program:slot-17',
        slot_state: 'partial_mapping',
        canonical_title: 'Synthetic Distinct Beta',
        legacy_code: 'SYNTH-CODE-DUP',
        submission_status: 'synthetic_draft',
        editorial_publication_status: 'unpublished',
        human_approval_status: 'unreviewed',
        verification_status: 'unverified',
        religious_approval_claimed: false,
        child_safety_gate: 'standard',
      },
    ];

    const doc = baseSyntheticDocument({
      slots: partialSlots,
      alias_observations: [
        {
          observation_id: 'mw:bug-alias-obs:001',
          program_id: 'mw:bug-program:slot-01',
          observed_label: 'Synthetic Former Equity Title',
          label_kind: 'title',
          source_ref: 'synthetic:ledger:obs-1',
        },
      ],
      alias_decisions: [
        {
          decision_id: 'mw:bug-alias-decision:001',
          normalized_key: 'synthetic former equity title',
          program_ids: ['mw:bug-program:slot-01'],
          outcome: 'confirmed_alias',
          canonical_target_program_id: 'mw:bug-program:slot-01',
          reviewer_id: 'mw:user:reviewer-1',
          reviewed_at: '2026-11-21T00:00:00Z',
          evidence_refs: ['synthetic:review:001'],
        },
        {
          decision_id: 'mw:bug-alias-decision:002',
          normalized_key: 'synth-code-dup',
          program_ids: ['mw:bug-program:slot-16', 'mw:bug-program:slot-17'],
          outcome: 'distinct',
          reviewer_id: 'mw:user:reviewer-1',
          reviewed_at: '2026-11-21T00:00:00Z',
          evidence_refs: ['synthetic:review:002'],
        },
      ],
    });

    const report = reviewBugRegistryAliases(doc);
    expect(report.present_slots).toEqual([1, 14, 15, 16, 17]);
    expect(report.missing_slots).toHaveLength(28);
    expect(report.missing_slots).toContain(13);
    expect(report.conflict_count).toBe(3);
    expect(report.unresolved_conflict_count).toBe(1);
    expect(report.confirmed_alias_count).toBe(1);
    expect(report.distinct_conflict_count).toBe(1);

    const unresolved = report.conflicts.find(
      (item) => item.normalized_key === 'synthetic shared title'
    );
    expect(unresolved?.resolution_state).toBe('unresolved');
    expect(unresolved?.program_ids).toEqual(['mw:bug-program:slot-14', 'mw:bug-program:slot-15']);

    const confirmed = report.conflicts.find(
      (item) => item.normalized_key === 'synthetic former equity title'
    );
    expect(confirmed?.resolution_state).toBe('confirmed_alias');
    expect(confirmed?.redirect_history).toEqual([
      {
        observed_label: 'Synthetic Former Equity Title',
        label_kind: 'title',
        canonical_program_id: 'mw:bug-program:slot-01',
        source_ref: 'synthetic:ledger:obs-1',
      },
    ]);

    const distinct = report.conflicts.find((item) => item.normalized_key === 'synth-code-dup');
    expect(distinct?.resolution_state).toBe('distinct');
    expect(distinct?.program_ids).toEqual(['mw:bug-program:slot-16', 'mw:bug-program:slot-17']);
  });

  it('rejects fail-closed silent title merges, shared case/story IDs, fabricated fixes, and unverified legacy imports', () => {
    // 1. Silent merge: confirmed_alias attempting to collapse two distinct program slots
    const silentCollapse = baseSyntheticDocument({
      alias_decisions: [
        {
          decision_id: 'mw:bug-alias-decision:bad-merge',
          normalized_key: 'synthetic shared title',
          program_ids: ['mw:bug-program:slot-14', 'mw:bug-program:slot-15'],
          outcome: 'confirmed_alias',
          canonical_target_program_id: 'mw:bug-program:slot-14',
          reviewer_id: 'mw:user:reviewer-1',
          reviewed_at: '2026-11-21T00:00:00Z',
          evidence_refs: ['synthetic:review:bad'],
        },
      ],
    });
    expect(validateBugRegistryDocument(silentCollapse).valid).toBe(false);
    expect(() => reviewBugRegistryAliases(silentCollapse)).toThrow(BugRegistryValidationError);

    // 2. Shared case_id across two program slots
    const slots = createPlannedBugRegistrySlots().slice(0, 2);
    slots[0] = {
      ...slots[0],
      slot_state: 'partial_mapping',
      case_id: 'mw:bug-case:shared-001',
    };
    slots[1] = {
      ...slots[1],
      slot_state: 'partial_mapping',
      case_id: 'mw:bug-case:shared-001',
    };
    expect(() => reviewBugRegistryAliases(baseSyntheticDocument({ slots }))).toThrow(
      BugRegistryValidationError
    );

    // 3. Fabricated submission/approval on planned_slot
    const fabricatedPlanned = createPlannedBugRegistrySlots();
    fabricatedPlanned[0] = {
      ...fabricatedPlanned[0],
      submission_status: 'synthetic_draft',
      human_approval_status: 'human_approved',
    };
    expect(() =>
      reviewBugRegistryAliases(baseSyntheticDocument({ slots: fabricatedPlanned }))
    ).toThrow(BugRegistryValidationError);

    // 4. Self-verified fix (action_owner_id === verification_reviewer_id)
    const selfVerified = createPlannedBugRegistrySlots();
    selfVerified[0] = {
      ...selfVerified[0],
      slot_state: 'partial_mapping',
      submission_status: 'synthetic_draft',
      human_approval_status: 'human_approved',
      verification_status: 'verified_fix',
      action_owner_id: 'mw:user:actor-1',
      verification_reviewer_id: 'mw:user:actor-1',
      verification_evidence_ref: 'mw:evidence:proof-001',
    };
    expect(() => reviewBugRegistryAliases(baseSyntheticDocument({ slots: selfVerified }))).toThrow(
      BugRegistryValidationError
    );

    // 5. Unapproved legacy import attempt (legacy_import_authorized: true)
    const unapprovedImport = {
      ...baseSyntheticDocument(),
      legacy_import_authorized: true,
    };
    expect(validateBugRegistryDocument(unapprovedImport).valid).toBe(false);

    // 6. Slot 13 without child_sensitive_protected gate
    const unsafeSlot13 = createPlannedBugRegistrySlots();
    unsafeSlot13[12] = { ...unsafeSlot13[12], child_safety_gate: 'standard' };
    expect(validateBugRegistryDocument(baseSyntheticDocument({ slots: unsafeSlot13 })).valid).toBe(
      false
    );
  });
});
