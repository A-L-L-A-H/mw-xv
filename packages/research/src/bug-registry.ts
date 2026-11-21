import {
  createJsonSchemaValidator,
  hashCanonicalJson,
  type JsonSchemaContract,
  type KnowledgeValidationIssue,
  type KnowledgeValidationResult,
} from '@moonwitness/knowledge';
import bugRegistrySchema from './bug-registry.schema.json' with { type: 'json' };

export type BugSlotState = 'planned_slot' | 'partial_mapping' | 'missing_source' | 'conflict_held';

export type BugSubmissionStatus = 'not_submitted' | 'synthetic_draft';
export type BugEditorialPublicationStatus = 'unpublished' | 'internal_draft';
export type BugHumanApprovalStatus = 'unreviewed' | 'human_approved' | 'human_rejected';
export type BugVerificationStatus = 'unverified' | 'verified_fix';
export type BugChildSafetyGate = 'standard' | 'child_sensitive_protected';
export type BugAliasConflictState = 'unresolved' | 'confirmed_alias' | 'distinct';

export interface BugProgramSlot {
  readonly slot_number: number;
  readonly program_id: `mw:bug-program:slot-${string}`;
  readonly case_id?: `mw:bug-case:${string}`;
  readonly submission_id?: `mw:bug-submission:${string}`;
  readonly story_id?: `mw:story:${string}`;
  readonly slot_state: BugSlotState;
  readonly canonical_title: string;
  readonly legacy_code?: string;
  readonly submission_status: BugSubmissionStatus;
  readonly editorial_publication_status: BugEditorialPublicationStatus;
  readonly human_approval_status: BugHumanApprovalStatus;
  readonly verification_status: BugVerificationStatus;
  readonly religious_approval_claimed: false;
  readonly child_safety_gate: BugChildSafetyGate;
  readonly action_owner_id?: `mw:user:${string}`;
  readonly verification_reviewer_id?: `mw:user:${string}`;
  readonly verification_evidence_ref?: `mw:evidence:${string}`;
  readonly missing_fields?: readonly string[];
}

export interface BugAliasObservation {
  readonly observation_id: `mw:bug-alias-obs:${string}`;
  readonly program_id: `mw:bug-program:slot-${string}`;
  readonly observed_label: string;
  readonly label_kind: 'title' | 'code';
  readonly source_ref: string;
}

export interface BugAliasResolutionDecision {
  readonly decision_id: `mw:bug-alias-decision:${string}`;
  readonly normalized_key: string;
  readonly program_ids: readonly `mw:bug-program:slot-${string}`[];
  readonly outcome: 'confirmed_alias' | 'distinct';
  readonly canonical_target_program_id?: `mw:bug-program:slot-${string}`;
  readonly reviewer_id: `mw:user:${string}`;
  readonly reviewed_at: string;
  readonly evidence_refs: readonly string[];
}

export interface BugRegistryDocument {
  readonly schema_version: 1;
  readonly registry_id: `mw:bug-registry:${string}`;
  readonly fixture_classification: 'synthetic';
  readonly legacy_import_authorized: false;
  readonly slots: readonly BugProgramSlot[];
  readonly alias_observations: readonly BugAliasObservation[];
  readonly alias_decisions: readonly BugAliasResolutionDecision[];
}

export interface BugAliasRedirectEntry {
  readonly observed_label: string;
  readonly label_kind: 'title' | 'code';
  readonly canonical_program_id: `mw:bug-program:slot-${string}`;
  readonly source_ref: string;
}

export interface BugAliasConflictRecord {
  readonly conflict_id: string;
  readonly normalized_key: string;
  readonly label_kinds: readonly ('title' | 'code')[];
  readonly observed_labels: readonly string[];
  readonly program_ids: readonly `mw:bug-program:slot-${string}`[];
  readonly resolution_state: BugAliasConflictState;
  readonly conflict_reason:
    | 'unreviewed_collision'
    | 'conflicting_decisions'
    | 'reviewed_confirmed_alias'
    | 'reviewed_distinct';
  readonly decision_ids: readonly string[];
  readonly redirect_history: readonly BugAliasRedirectEntry[];
}

export interface BugRegistryReviewReport {
  readonly schema_version: 1;
  readonly registry_id: string;
  readonly fixture_classification: 'synthetic';
  readonly legacy_import_authorized: false;
  readonly total_planned_slots: 33;
  readonly present_slots: readonly number[];
  readonly missing_slots: readonly number[];
  readonly planned_only_slot_count: number;
  readonly conflict_count: number;
  readonly unresolved_conflict_count: number;
  readonly confirmed_alias_count: number;
  readonly distinct_conflict_count: number;
  readonly conflicts: readonly BugAliasConflictRecord[];
  readonly report_digest: string;
}

export type BugRegistryErrorCode =
  'INVALID_BUG_REGISTRY' | 'SILENT_MERGE_FORBIDDEN' | 'FABRICATED_RECORD_FORBIDDEN';

export class BugRegistryValidationError extends Error {
  readonly code: BugRegistryErrorCode;
  readonly issues: readonly KnowledgeValidationIssue[];

  constructor(
    code: BugRegistryErrorCode,
    message: string,
    issues: readonly KnowledgeValidationIssue[] = []
  ) {
    super(message);
    this.name = 'BugRegistryValidationError';
    this.code = code;
    this.issues = issues;
  }
}

const validateSchema = createJsonSchemaValidator(
  bugRegistrySchema as unknown as JsonSchemaContract,
  'does not match the 33-BUG registry recovery contract'
);

const TOTAL_PLANNED_SLOTS = 33 as const;

export function normalizeBugAliasKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/gu, ' ');
}

function formatProgramId(slotNumber: number): `mw:bug-program:slot-${string}` {
  const padded = String(slotNumber).padStart(2, '0');
  const token = slotNumber < 10 ? `0${slotNumber}` : padded;
  return `mw:bug-program:slot-${token}`;
}

/**
 * Initialize 33 strictly planned synthetic slots (`001`..`033`) without fabricating
 * submitted case records, human approvals, or verified fixes. Slot 13 enforces
 * `child_sensitive_protected`.
 */
export function createPlannedBugRegistrySlots(): BugProgramSlot[] {
  return Array.from({ length: TOTAL_PLANNED_SLOTS }, (_, index) => {
    const slotNumber = index + 1;
    const paddedThree = String(slotNumber).padStart(3, '0');
    return {
      slot_number: slotNumber,
      program_id: formatProgramId(slotNumber),
      slot_state: 'planned_slot',
      canonical_title: `Synthetic Planned BUG Slot ${paddedThree}`,
      legacy_code: `SYNTH-BUG-${paddedThree}`,
      submission_status: 'not_submitted',
      editorial_publication_status: 'unpublished',
      human_approval_status: 'unreviewed',
      verification_status: 'unverified',
      religious_approval_claimed: false,
      child_safety_gate: slotNumber === 13 ? 'child_sensitive_protected' : 'standard',
      missing_fields: ['source_evidence', 'action_owner', 'independent_verification'],
    };
  });
}

function validateDocumentInternal(value: unknown): {
  issues: KnowledgeValidationIssue[];
  errorCode: BugRegistryErrorCode;
} {
  const schemaResult = validateSchema(value);
  if (!schemaResult.valid) {
    return { issues: schemaResult.issues, errorCode: 'INVALID_BUG_REGISTRY' };
  }

  const doc = value as BugRegistryDocument;
  const issues: KnowledgeValidationIssue[] = [];
  let errorCode: BugRegistryErrorCode = 'INVALID_BUG_REGISTRY';

  const seenSlots = new Set<number>();
  const seenProgramIds = new Set<string>();
  const seenCaseIds = new Set<string>();
  const seenSubmissionIds = new Set<string>();
  const seenStoryIds = new Set<string>();

  for (const [index, slot] of doc.slots.entries()) {
    const basePath = `/slots/${index}`;
    const expectedProgramId = formatProgramId(slot.slot_number);
    if (slot.program_id !== expectedProgramId) {
      issues.push({
        path: `${basePath}/program_id`,
        keyword: 'slot_program_match',
        message: `program_id "${slot.program_id}" must match slot_number ${slot.slot_number} (${expectedProgramId})`,
      });
    }
    if (seenSlots.has(slot.slot_number)) {
      issues.push({
        path: `${basePath}/slot_number`,
        keyword: 'unique_slot_number',
        message: `duplicate slot_number ${slot.slot_number}`,
      });
    }
    seenSlots.add(slot.slot_number);

    if (seenProgramIds.has(slot.program_id)) {
      issues.push({
        path: `${basePath}/program_id`,
        keyword: 'unique_program_id',
        message: `duplicate program_id "${slot.program_id}"`,
      });
    }
    seenProgramIds.add(slot.program_id);

    if (slot.slot_number === 13 && slot.child_safety_gate !== 'child_sensitive_protected') {
      issues.push({
        path: `${basePath}/child_safety_gate`,
        keyword: 'child_safety_gate',
        message: 'slot 13 requires child_sensitive_protected gate',
      });
    }

    if (slot.slot_state === 'planned_slot') {
      if (
        slot.case_id !== undefined ||
        slot.submission_id !== undefined ||
        slot.story_id !== undefined ||
        slot.submission_status !== 'not_submitted' ||
        slot.editorial_publication_status !== 'unpublished' ||
        slot.human_approval_status !== 'unreviewed' ||
        slot.verification_status !== 'unverified'
      ) {
        errorCode = 'FABRICATED_RECORD_FORBIDDEN';
        issues.push({
          path: basePath,
          keyword: 'no_fabricated_submission_or_fix',
          message:
            'planned_slot cannot fabricate case/submission/story IDs, approvals, publication, or verified fixes',
        });
      }
    }

    if (slot.verification_status === 'verified_fix') {
      if (
        slot.action_owner_id === undefined ||
        slot.verification_reviewer_id === undefined ||
        slot.verification_evidence_ref === undefined ||
        slot.action_owner_id === slot.verification_reviewer_id ||
        slot.human_approval_status !== 'human_approved'
      ) {
        errorCode = 'FABRICATED_RECORD_FORBIDDEN';
        issues.push({
          path: `${basePath}/verification_status`,
          keyword: 'independent_verification_required',
          message:
            'verified_fix requires human_approved status, action_owner_id, distinct verification_reviewer_id, and verification_evidence_ref',
        });
      }
    }

    if (slot.case_id !== undefined) {
      if (seenCaseIds.has(slot.case_id)) {
        errorCode = 'SILENT_MERGE_FORBIDDEN';
        issues.push({
          path: `${basePath}/case_id`,
          keyword: 'separate_case_identity',
          message: `case_id "${slot.case_id}" cannot be shared across distinct program slots`,
        });
      }
      seenCaseIds.add(slot.case_id);
    }
    if (slot.submission_id !== undefined) {
      if (seenSubmissionIds.has(slot.submission_id)) {
        errorCode = 'SILENT_MERGE_FORBIDDEN';
        issues.push({
          path: `${basePath}/submission_id`,
          keyword: 'separate_submission_identity',
          message: `submission_id "${slot.submission_id}" cannot be shared across distinct program slots`,
        });
      }
      seenSubmissionIds.add(slot.submission_id);
    }
    if (slot.story_id !== undefined) {
      if (seenStoryIds.has(slot.story_id)) {
        errorCode = 'SILENT_MERGE_FORBIDDEN';
        issues.push({
          path: `${basePath}/story_id`,
          keyword: 'separate_story_identity',
          message: `story_id "${slot.story_id}" cannot be shared across distinct program slots`,
        });
      }
      seenStoryIds.add(slot.story_id);
    }
  }

  const seenObsIds = new Set<string>();
  for (const [index, obs] of doc.alias_observations.entries()) {
    const basePath = `/alias_observations/${index}`;
    if (seenObsIds.has(obs.observation_id)) {
      issues.push({
        path: `${basePath}/observation_id`,
        keyword: 'unique_observation_id',
        message: `duplicate observation_id "${obs.observation_id}"`,
      });
    }
    seenObsIds.add(obs.observation_id);
    if (!seenProgramIds.has(obs.program_id)) {
      issues.push({
        path: `${basePath}/program_id`,
        keyword: 'unknown_program_id',
        message: `alias observation references undeclared program_id "${obs.program_id}"`,
      });
    }
    if (obs.observed_label.trim().length === 0 || obs.source_ref.trim().length === 0) {
      issues.push({
        path: basePath,
        keyword: 'minLength',
        message: 'alias observation label and source_ref must not be blank',
      });
    }
  }

  const seenDecisionIds = new Set<string>();
  for (const [index, decision] of doc.alias_decisions.entries()) {
    const basePath = `/alias_decisions/${index}`;
    if (seenDecisionIds.has(decision.decision_id)) {
      issues.push({
        path: `${basePath}/decision_id`,
        keyword: 'unique_decision_id',
        message: `duplicate decision_id "${decision.decision_id}"`,
      });
    }
    seenDecisionIds.add(decision.decision_id);

    const uniqueDecisionPrograms = [...new Set(decision.program_ids)];
    if (uniqueDecisionPrograms.length !== decision.program_ids.length) {
      issues.push({
        path: `${basePath}/program_ids`,
        keyword: 'uniqueItems',
        message: 'decision program_ids must not contain duplicates',
      });
    }
    for (const pid of uniqueDecisionPrograms) {
      if (!seenProgramIds.has(pid)) {
        issues.push({
          path: `${basePath}/program_ids`,
          keyword: 'unknown_program_id',
          message: `alias decision references undeclared program_id "${pid}"`,
        });
      }
    }
    if (decision.outcome === 'confirmed_alias') {
      if (uniqueDecisionPrograms.length !== 1) {
        errorCode = 'SILENT_MERGE_FORBIDDEN';
        issues.push({
          path: `${basePath}/program_ids`,
          keyword: 'no_slot_collapse',
          message:
            'confirmed_alias cannot collapse multiple distinct program slots; use outcome "distinct" instead',
        });
      }
      if (
        decision.canonical_target_program_id === undefined ||
        !uniqueDecisionPrograms.includes(decision.canonical_target_program_id)
      ) {
        issues.push({
          path: `${basePath}/canonical_target_program_id`,
          keyword: 'canonical_target_required',
          message:
            'confirmed_alias decision must specify canonical_target_program_id matching program_ids',
        });
      }
    } else if (uniqueDecisionPrograms.length < 2) {
      issues.push({
        path: `${basePath}/program_ids`,
        keyword: 'distinct_requires_two_programs',
        message: 'distinct outcome requires at least two competing program_ids',
      });
    }
  }

  return { issues, errorCode };
}

/** Validate a synthetic 33-BUG registry recovery document without mutating slots. */
export function validateBugRegistryDocument(value: unknown): KnowledgeValidationResult {
  const { issues } = validateDocumentInternal(value);
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

interface AliasAccumulator {
  readonly normalized_key: string;
  readonly label_kinds: Set<'title' | 'code'>;
  readonly observed_labels: Set<string>;
  readonly program_ids: Set<`mw:bug-program:slot-${string}`>;
  readonly source_refs: Map<
    string,
    {
      observed_label: string;
      label_kind: 'title' | 'code';
      program_id: `mw:bug-program:slot-${string}`;
      source_ref: string;
    }
  >;
}

/**
 * Deterministically classify all title and code collisions/aliases into `unresolved`,
 * `confirmed_alias`, or `distinct` without performing silent title-based merges.
 */
export function reviewBugRegistryAliases(value: unknown): BugRegistryReviewReport {
  const { issues, errorCode } = validateDocumentInternal(value);
  if (issues.length > 0) {
    throw new BugRegistryValidationError(
      errorCode,
      '33-BUG registry recovery document failed validation',
      issues
    );
  }

  const doc = JSON.parse(JSON.stringify(value)) as BugRegistryDocument;
  const groups = new Map<string, AliasAccumulator>();

  function addEntry(
    rawLabel: string,
    labelKind: 'title' | 'code',
    programId: `mw:bug-program:slot-${string}`,
    sourceRef: string
  ) {
    const key = normalizeBugAliasKey(rawLabel);
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        normalized_key: key,
        label_kinds: new Set(),
        observed_labels: new Set(),
        program_ids: new Set(),
        source_refs: new Map(),
      };
      groups.set(key, acc);
    }
    acc.label_kinds.add(labelKind);
    acc.observed_labels.add(rawLabel.trim());
    acc.program_ids.add(programId);
    acc.source_refs.set(`${programId}|${labelKind}|${rawLabel.trim()}|${sourceRef}`, {
      observed_label: rawLabel.trim(),
      label_kind: labelKind,
      program_id: programId,
      source_ref: sourceRef,
    });
  }

  for (const slot of doc.slots) {
    addEntry(slot.canonical_title, 'title', slot.program_id, `slot:${slot.program_id}:title`);
    if (slot.legacy_code !== undefined) {
      addEntry(slot.legacy_code, 'code', slot.program_id, `slot:${slot.program_id}:code`);
    }
  }

  for (const obs of doc.alias_observations) {
    addEntry(obs.observed_label, obs.label_kind, obs.program_id, obs.source_ref);
  }

  // Track which program_ids have secondary alias observations (distinct from canonical title/code).
  const observationsByProgram = new Map<string, BugAliasObservation[]>();
  for (const obs of doc.alias_observations) {
    const list = observationsByProgram.get(obs.program_id) ?? [];
    list.push(obs);
    observationsByProgram.set(obs.program_id, list);
  }

  const decisionsByKey = new Map<string, BugAliasResolutionDecision[]>();
  for (const decision of doc.alias_decisions) {
    const normKey = normalizeBugAliasKey(decision.normalized_key);
    const list = decisionsByKey.get(normKey) ?? [];
    list.push(decision);
    decisionsByKey.set(normKey, list);
  }

  const conflicts: BugAliasConflictRecord[] = [];
  const sortedKeys = [...groups.keys()].sort();

  for (const key of sortedKeys) {
    const acc = groups.get(key);
    if (!acc) continue;
    const programIds = [...acc.program_ids].sort();
    const observedLabels = [...acc.observed_labels].sort();
    const labelKinds = [...acc.label_kinds].sort() as ('title' | 'code')[];
    const matchingDecisions = decisionsByKey.get(key) ?? [];

    const hasMultiProgramCollision = programIds.length > 1;
    const hasExplicitAliasDecision = matchingDecisions.length > 0;
    const isSecondaryAliasOnSingleProgram =
      !hasMultiProgramCollision &&
      doc.alias_observations.some(
        (obs) =>
          obs.program_id === programIds[0] && normalizeBugAliasKey(obs.observed_label) === key
      );

    if (
      !hasMultiProgramCollision &&
      !hasExplicitAliasDecision &&
      !isSecondaryAliasOnSingleProgram
    ) {
      continue;
    }

    const decisionOutcomes = new Set(matchingDecisions.map((item) => item.outcome));
    let resolutionState: BugAliasConflictState;
    let conflictReason: BugAliasConflictRecord['conflict_reason'];
    let redirectHistory: BugAliasRedirectEntry[] = [];

    if (decisionOutcomes.size > 1) {
      resolutionState = 'unresolved';
      conflictReason = 'conflicting_decisions';
    } else if (matchingDecisions.length === 0) {
      resolutionState = 'unresolved';
      conflictReason = 'unreviewed_collision';
    } else if (decisionOutcomes.has('distinct')) {
      const covered = new Set(matchingDecisions.flatMap((item) => item.program_ids));
      if (programIds.some((pid) => !covered.has(pid))) {
        resolutionState = 'unresolved';
        conflictReason = 'unreviewed_collision';
      } else {
        resolutionState = 'distinct';
        conflictReason = 'reviewed_distinct';
      }
    } else {
      // confirmed_alias: only valid when all observations belong to the single canonical target
      const targets = new Set(
        matchingDecisions
          .map((item) => item.canonical_target_program_id)
          .filter((id): id is `mw:bug-program:slot-${string}` => id !== undefined)
      );
      if (hasMultiProgramCollision || targets.size !== 1 || !targets.has(programIds[0])) {
        resolutionState = 'unresolved';
        conflictReason = 'conflicting_decisions';
      } else {
        resolutionState = 'confirmed_alias';
        conflictReason = 'reviewed_confirmed_alias';
        const target = programIds[0];
        redirectHistory = [...acc.source_refs.values()]
          .map((entry) => ({
            observed_label: entry.observed_label,
            label_kind: entry.label_kind,
            canonical_program_id: target,
            source_ref: entry.source_ref,
          }))
          .sort((a, b) =>
            `${a.observed_label}|${a.source_ref}`.localeCompare(
              `${b.observed_label}|${b.source_ref}`
            )
          );
      }
    }

    conflicts.push({
      conflict_id: `mw:bug-conflict:${hashCanonicalJson({ key, programIds }).slice(0, 16)}`,
      normalized_key: key,
      label_kinds: labelKinds,
      observed_labels: observedLabels,
      program_ids: programIds,
      resolution_state: resolutionState,
      conflict_reason: conflictReason,
      decision_ids: matchingDecisions.map((item) => item.decision_id).sort(),
      redirect_history: redirectHistory,
    });
  }

  const presentSlotNumbers = doc.slots.map((slot) => slot.slot_number).sort((a, b) => a - b);
  const presentSet = new Set(presentSlotNumbers);
  const missingSlots = Array.from({ length: TOTAL_PLANNED_SLOTS }, (_, index) => index + 1).filter(
    (slotNum) => !presentSet.has(slotNum)
  );

  const unsignedReport = {
    schema_version: 1 as const,
    registry_id: doc.registry_id,
    fixture_classification: doc.fixture_classification,
    legacy_import_authorized: doc.legacy_import_authorized,
    total_planned_slots: TOTAL_PLANNED_SLOTS,
    present_slots: presentSlotNumbers,
    missing_slots: missingSlots,
    planned_only_slot_count: doc.slots.filter((slot) => slot.slot_state === 'planned_slot').length,
    conflict_count: conflicts.length,
    unresolved_conflict_count: conflicts.filter((item) => item.resolution_state === 'unresolved')
      .length,
    confirmed_alias_count: conflicts.filter((item) => item.resolution_state === 'confirmed_alias')
      .length,
    distinct_conflict_count: conflicts.filter((item) => item.resolution_state === 'distinct')
      .length,
    conflicts,
  };

  return {
    ...unsignedReport,
    report_digest: hashCanonicalJson(unsignedReport),
  };
}
