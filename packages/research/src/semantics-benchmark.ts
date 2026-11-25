import { isRecord } from '@moonwitness/types';
import {
  createJsonSchemaValidator,
  hashCanonicalJson,
  type JsonSchemaContract,
  type KnowledgeValidationIssue,
  type KnowledgeValidationResult,
} from '@moonwitness/knowledge';
import benchmarkSchema from './semantics-benchmark.schema.json' with { type: 'json' };
import {
  validateConceptProfile,
  validateConceptProfileWithEvidence,
  type TrustedConceptEvidenceResolution,
} from './concept-profile.js';
import type { ResolvedEvidenceReference } from './evidence.js';
import {
  projectResearchSemanticAnnotation,
  type SemanticAssertionProjection,
  type SemanticContextMode,
} from './semantics.js';
import {
  projectTextualAlignmentCandidate,
  type TextualAlignmentPassage,
} from './textual-alignment.js';

export type BenchmarkDomain = 'polarity_speaker' | 'textual_alignment' | 'concept_profile';
export type BenchmarkInputState = 'measured' | 'empty' | 'unsupported' | 'unknown';
export type BenchmarkCaseStatus = 'matched' | 'mismatched' | 'empty' | 'unsupported' | 'unknown';
export type BenchmarkSuiteVerdict = 'passed' | 'failed' | 'incomplete' | 'no_measured_cases';

export type HistoricalObservationState =
  'measured' | 'historical_unverified' | 'unsupported' | 'unknown';

export type HistoricalReconciliationStatus =
  'discrepancy_recorded' | 'insufficient_evidence' | 'reconciled_with_evidence';

export interface PolaritySpeakerCasePayload {
  readonly annotation: unknown;
  readonly evidence: ResolvedEvidenceReference;
}

export interface PolaritySpeakerExpectation {
  readonly expected_status: SemanticAssertionProjection['status'];
  readonly expected_polarity?: 'positive' | 'negative';
  readonly expected_context_mode?: SemanticContextMode;
  readonly expected_speaker_id?: string;
  readonly expected_reason?: 'not_accepted' | 'polarity_uncertain';
}

export interface TextualAlignmentCasePayload {
  readonly candidate: unknown;
  readonly passages: Readonly<Record<string, TextualAlignmentPassage>>;
}

export interface TextualAlignmentExpectation {
  readonly expected_outcome: 'candidate' | 'rejected';
  readonly expected_asserts_identity?: false;
  readonly expected_asserts_quotation?: false;
  readonly expected_asserts_fulfillment?: false;
  readonly expected_asserts_doctrine?: false;
}

export interface ConceptProfileCasePayload {
  readonly document: unknown;
  readonly trusted_evidence?: Readonly<Record<string, TrustedConceptEvidenceResolution>>;
}

export interface ConceptProfileExpectation {
  readonly expected_valid: boolean;
  readonly expected_issue_codes?: readonly string[];
}

export interface MeasuredPolaritySpeakerCase {
  readonly case_id: string;
  readonly domain: 'polarity_speaker';
  readonly input_state: 'measured';
  readonly note?: string;
  readonly expected: PolaritySpeakerExpectation;
  readonly payload: PolaritySpeakerCasePayload;
}

export interface MeasuredTextualAlignmentCase {
  readonly case_id: string;
  readonly domain: 'textual_alignment';
  readonly input_state: 'measured';
  readonly note?: string;
  readonly expected: TextualAlignmentExpectation;
  readonly payload: TextualAlignmentCasePayload;
}

export interface MeasuredConceptProfileCase {
  readonly case_id: string;
  readonly domain: 'concept_profile';
  readonly input_state: 'measured';
  readonly note?: string;
  readonly expected: ConceptProfileExpectation;
  readonly payload: ConceptProfileCasePayload;
}

export interface NonMeasuredBenchmarkCase {
  readonly case_id: string;
  readonly domain: BenchmarkDomain;
  readonly input_state: 'empty' | 'unsupported' | 'unknown';
  readonly note?: string;
}

export type SemanticsBenchmarkCase =
  | MeasuredPolaritySpeakerCase
  | MeasuredTextualAlignmentCase
  | MeasuredConceptProfileCase
  | NonMeasuredBenchmarkCase;

export interface HistoricalCountObservation {
  readonly source_label: string;
  readonly count: number;
  readonly artifact_ref: string;
  readonly observation_state: HistoricalObservationState;
}

export interface HistoricalCountReconciliation {
  readonly record_id: string;
  readonly topic: string;
  readonly reconciliation_status: HistoricalReconciliationStatus;
  readonly observations: readonly HistoricalCountObservation[];
  readonly resolution_note: string;
}

export interface VerifiedHistoricalCountReconciliation extends HistoricalCountReconciliation {
  readonly discrepancy_delta: number;
}

export interface SemanticsBenchmarkSuite {
  readonly schema_version: 1;
  readonly suite_id: `mw:benchmark-suite:${string}`;
  readonly suite_version: string;
  readonly fixture_classification: 'synthetic' | 'pinned_approved_sample';
  readonly description?: string;
  readonly cases: readonly SemanticsBenchmarkCase[];
  readonly historical_reconciliations?: readonly HistoricalCountReconciliation[];
}

export interface SemanticsBenchmarkCaseResult {
  readonly case_id: string;
  readonly domain: BenchmarkDomain;
  readonly input_state: BenchmarkInputState;
  readonly status: BenchmarkCaseStatus;
  readonly expected_summary: Readonly<Record<string, unknown>> | null;
  readonly observed_summary: Readonly<Record<string, unknown>> | null;
  readonly mismatch_reasons: readonly string[];
}

export interface SemanticsBenchmarkMetrics {
  readonly total_cases: number;
  readonly evaluated_cases: number;
  readonly matched_cases: number;
  readonly mismatched_cases: number;
  readonly empty_cases: number;
  readonly unsupported_cases: number;
  readonly unknown_cases: number;
  readonly precision: number | null;
  readonly error_rate: number | null;
}

export interface SemanticsBenchmarkReport {
  readonly schema_version: 1;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly fixture_classification: 'synthetic' | 'pinned_approved_sample';
  readonly verdict: BenchmarkSuiteVerdict;
  readonly metrics: SemanticsBenchmarkMetrics;
  readonly cases: readonly SemanticsBenchmarkCaseResult[];
  readonly historical_reconciliations: readonly VerifiedHistoricalCountReconciliation[];
  readonly report_digest: string;
}

export type SemanticsDriftKind =
  | 'polarity_drift'
  | 'speaker_drift'
  | 'alignment_drift'
  | 'concept_drift'
  | 'coverage_drift'
  | 'verdict_drift'
  | 'reconciliation_drift';

export interface SemanticsDriftItem {
  readonly case_id: string;
  readonly domain: BenchmarkDomain | 'suite' | 'reconciliation';
  readonly kind: SemanticsDriftKind;
  readonly regression: boolean;
  readonly baseline_summary: unknown;
  readonly candidate_summary: unknown;
  readonly detail: string;
}

export interface SemanticsDriftLedger {
  readonly schema_version: 1;
  readonly baseline_suite_id: string;
  readonly baseline_version: string;
  readonly baseline_digest: string;
  readonly candidate_suite_id: string;
  readonly candidate_version: string;
  readonly candidate_digest: string;
  readonly status: 'zero_drift' | 'regression_detected' | 'non_regression_change';
  readonly has_regression: boolean;
  readonly drifts: readonly SemanticsDriftItem[];
  readonly ledger_digest: string;
}

export type SemanticsBenchmarkErrorCode =
  | 'INVALID_BENCHMARK_SUITE'
  | 'INVALID_BENCHMARK_REPORT'
  | 'REPORT_DIGEST_MISMATCH'
  | 'INPUT_MUTATED';

export class SemanticsBenchmarkValidationError extends Error {
  readonly code: SemanticsBenchmarkErrorCode;
  readonly issues: readonly KnowledgeValidationIssue[];

  constructor(
    code: SemanticsBenchmarkErrorCode,
    message: string,
    issues: readonly KnowledgeValidationIssue[] = []
  ) {
    super(message);
    this.name = 'SemanticsBenchmarkValidationError';
    this.code = code;
    this.issues = issues;
  }
}

const validateSuiteSchema = createJsonSchemaValidator(
  benchmarkSchema as unknown as JsonSchemaContract,
  'does not match the semantics benchmark schema'
);

const sha256Hex = /^[a-f0-9]{64}$/u;
const validDomains = new Set<BenchmarkDomain>([
  'polarity_speaker',
  'textual_alignment',
  'concept_profile',
]);
const validInputStates = new Set<BenchmarkInputState>([
  'measured',
  'empty',
  'unsupported',
  'unknown',
]);
const validCaseStatuses = new Set<BenchmarkCaseStatus>([
  'matched',
  'mismatched',
  'empty',
  'unsupported',
  'unknown',
]);
const validVerdicts = new Set<BenchmarkSuiteVerdict>([
  'passed',
  'failed',
  'incomplete',
  'no_measured_cases',
]);
const validSemanticStatuses = new Set<SemanticAssertionProjection['status']>([
  'projected',
  'scoped',
  'review_required',
  'rejected',
  'invalid',
]);
const validContextModes = new Set<SemanticContextMode>([
  'direct_quote',
  'reported_speech',
  'narration',
  'analysis',
]);

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function validateReconciliationInternal(
  record: unknown,
  pathPrefix: string
): KnowledgeValidationIssue[] {
  if (!isRecord(record)) {
    return [
      {
        path: pathPrefix,
        keyword: 'type',
        message: 'historical reconciliation record must be an object',
      },
    ];
  }
  const issues: KnowledgeValidationIssue[] = [];
  if (
    !hasOnlyKeys(record, [
      'record_id',
      'topic',
      'reconciliation_status',
      'observations',
      'resolution_note',
    ])
  ) {
    issues.push({
      path: pathPrefix,
      keyword: 'additionalProperties',
      message: 'historical reconciliation record contains unsupported fields',
    });
  }
  if (
    typeof record.record_id !== 'string' ||
    !/^mw:count-reconciliation:[a-z0-9][a-z0-9._-]{0,127}$/u.test(record.record_id)
  ) {
    issues.push({
      path: `${pathPrefix}/record_id`,
      keyword: 'pattern',
      message: 'record_id must use mw:count-reconciliation:<slug>',
    });
  }
  if (typeof record.topic !== 'string' || record.topic.trim().length === 0) {
    issues.push({
      path: `${pathPrefix}/topic`,
      keyword: 'minLength',
      message: 'topic must be a non-empty string',
    });
  }
  if (
    record.reconciliation_status !== 'discrepancy_recorded' &&
    record.reconciliation_status !== 'insufficient_evidence' &&
    record.reconciliation_status !== 'reconciled_with_evidence'
  ) {
    issues.push({
      path: `${pathPrefix}/reconciliation_status`,
      keyword: 'enum',
      message:
        'reconciliation_status must be discrepancy_recorded, insufficient_evidence, or reconciled_with_evidence',
    });
  }
  if (typeof record.resolution_note !== 'string' || record.resolution_note.trim().length === 0) {
    issues.push({
      path: `${pathPrefix}/resolution_note`,
      keyword: 'minLength',
      message: 'resolution_note must be a non-empty string',
    });
  }
  if (!Array.isArray(record.observations) || record.observations.length < 2) {
    issues.push({
      path: `${pathPrefix}/observations`,
      keyword: 'minItems',
      message: 'observations must include at least two count sources',
    });
    return issues;
  }

  const counts: number[] = [];
  let allMeasured = true;
  for (const [index, obs] of record.observations.entries()) {
    const obsPath = `${pathPrefix}/observations/${index}`;
    if (!isRecord(obs)) {
      issues.push({ path: obsPath, keyword: 'type', message: 'observation must be an object' });
      allMeasured = false;
      continue;
    }
    if (
      !hasOnlyKeys(obs, ['source_label', 'count', 'artifact_ref', 'observation_state']) ||
      typeof obs.source_label !== 'string' ||
      obs.source_label.trim().length === 0 ||
      typeof obs.artifact_ref !== 'string' ||
      obs.artifact_ref.trim().length === 0 ||
      typeof obs.count !== 'number' ||
      !Number.isSafeInteger(obs.count) ||
      obs.count < 0
    ) {
      issues.push({
        path: obsPath,
        keyword: 'observation',
        message:
          'observation must include valid source_label, artifact_ref, non-negative integer count, and observation_state',
      });
      allMeasured = false;
      continue;
    }
    if (
      obs.observation_state !== 'measured' &&
      obs.observation_state !== 'historical_unverified' &&
      obs.observation_state !== 'unsupported' &&
      obs.observation_state !== 'unknown'
    ) {
      issues.push({
        path: `${obsPath}/observation_state`,
        keyword: 'enum',
        message:
          'observation_state must be measured, historical_unverified, unsupported, or unknown',
      });
      allMeasured = false;
      continue;
    }
    if (obs.observation_state !== 'measured') {
      allMeasured = false;
    }
    counts.push(obs.count);
  }

  if (counts.length >= 2) {
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const delta = max - min;
    if (record.reconciliation_status === 'reconciled_with_evidence') {
      if (delta !== 0 || !allMeasured) {
        issues.push({
          path: `${pathPrefix}/reconciliation_status`,
          keyword: 'reconciliation_consistency',
          message:
            'cannot mark counts reconciled_with_evidence when observations disagree or remain unverified/unknown',
        });
      }
    }
    if (record.reconciliation_status === 'discrepancy_recorded' && delta === 0) {
      issues.push({
        path: `${pathPrefix}/reconciliation_status`,
        keyword: 'reconciliation_consistency',
        message: 'discrepancy_recorded requires distinct counts across observations',
      });
    }
  }
  return issues;
}

/** Validate a standalone historical count reconciliation record without inventing consensus. */
export function validateHistoricalCountReconciliation(record: unknown): KnowledgeValidationResult {
  const issues = validateReconciliationInternal(record, '');
  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

function validateMeasuredCase(
  entry: Record<string, unknown>,
  index: number
): KnowledgeValidationIssue[] {
  const issues: KnowledgeValidationIssue[] = [];
  const basePath = `/cases/${index}`;
  const domain = entry.domain;
  if (!isRecord(entry.expected)) {
    issues.push({
      path: `${basePath}/expected`,
      keyword: 'required',
      message: 'measured benchmark case requires an expected object',
    });
  }
  if (!isRecord(entry.payload)) {
    issues.push({
      path: `${basePath}/payload`,
      keyword: 'required',
      message: 'measured benchmark case requires a payload object',
    });
  }
  if (issues.length > 0) return issues;

  const expected = entry.expected as Record<string, unknown>;
  const payload = entry.payload as Record<string, unknown>;

  if (domain === 'polarity_speaker') {
    if (
      !hasOnlyKeys(expected, [
        'expected_status',
        'expected_polarity',
        'expected_context_mode',
        'expected_speaker_id',
        'expected_reason',
      ])
    ) {
      issues.push({
        path: `${basePath}/expected`,
        keyword: 'additionalProperties',
        message: 'polarity_speaker expectation contains unsupported keys',
      });
    }
    if (
      !validSemanticStatuses.has(expected.expected_status as SemanticAssertionProjection['status'])
    ) {
      issues.push({
        path: `${basePath}/expected/expected_status`,
        keyword: 'enum',
        message: 'expected_status must be a valid SemanticAssertionProjection status',
      });
    }
    if (
      expected.expected_polarity !== undefined &&
      expected.expected_polarity !== 'positive' &&
      expected.expected_polarity !== 'negative'
    ) {
      issues.push({
        path: `${basePath}/expected/expected_polarity`,
        keyword: 'enum',
        message: 'expected_polarity must be positive or negative',
      });
    }
    if (
      expected.expected_context_mode !== undefined &&
      !validContextModes.has(expected.expected_context_mode as SemanticContextMode)
    ) {
      issues.push({
        path: `${basePath}/expected/expected_context_mode`,
        keyword: 'enum',
        message: 'expected_context_mode must be a valid SemanticContextMode',
      });
    }
    if (
      expected.expected_speaker_id !== undefined &&
      (typeof expected.expected_speaker_id !== 'string' ||
        expected.expected_speaker_id.trim().length === 0)
    ) {
      issues.push({
        path: `${basePath}/expected/expected_speaker_id`,
        keyword: 'type',
        message: 'expected_speaker_id must be a non-empty string',
      });
    }
    if (
      expected.expected_reason !== undefined &&
      expected.expected_reason !== 'not_accepted' &&
      expected.expected_reason !== 'polarity_uncertain'
    ) {
      issues.push({
        path: `${basePath}/expected/expected_reason`,
        keyword: 'enum',
        message: 'expected_reason must be not_accepted or polarity_uncertain',
      });
    }
    if (
      !hasOnlyKeys(payload, ['annotation', 'evidence']) ||
      !('annotation' in payload) ||
      !isRecord(payload.evidence)
    ) {
      issues.push({
        path: `${basePath}/payload`,
        keyword: 'payload_shape',
        message: 'polarity_speaker payload requires annotation and evidence object',
      });
    }
    return issues;
  }

  if (domain === 'textual_alignment') {
    if (
      !hasOnlyKeys(expected, [
        'expected_outcome',
        'expected_asserts_identity',
        'expected_asserts_quotation',
        'expected_asserts_fulfillment',
        'expected_asserts_doctrine',
      ])
    ) {
      issues.push({
        path: `${basePath}/expected`,
        keyword: 'additionalProperties',
        message: 'textual_alignment expectation contains unsupported keys',
      });
    }
    if (expected.expected_outcome !== 'candidate' && expected.expected_outcome !== 'rejected') {
      issues.push({
        path: `${basePath}/expected/expected_outcome`,
        keyword: 'enum',
        message: 'expected_outcome must be candidate or rejected',
      });
    }
    for (const flag of [
      'expected_asserts_identity',
      'expected_asserts_quotation',
      'expected_asserts_fulfillment',
      'expected_asserts_doctrine',
    ]) {
      if (expected[flag] !== undefined && expected[flag] !== false) {
        issues.push({
          path: `${basePath}/expected/${flag}`,
          keyword: 'const',
          message: `${flag} can only expect false`,
        });
      }
    }
    if (
      !hasOnlyKeys(payload, ['candidate', 'passages']) ||
      !('candidate' in payload) ||
      !isRecord(payload.passages)
    ) {
      issues.push({
        path: `${basePath}/payload`,
        keyword: 'payload_shape',
        message: 'textual_alignment payload requires candidate and passages lookup map',
      });
    }
    return issues;
  }

  if (domain === 'concept_profile') {
    if (!hasOnlyKeys(expected, ['expected_valid', 'expected_issue_codes'])) {
      issues.push({
        path: `${basePath}/expected`,
        keyword: 'additionalProperties',
        message: 'concept_profile expectation contains unsupported keys',
      });
    }
    if (typeof expected.expected_valid !== 'boolean') {
      issues.push({
        path: `${basePath}/expected/expected_valid`,
        keyword: 'type',
        message: 'expected_valid must be a boolean',
      });
    }
    if (
      expected.expected_issue_codes !== undefined &&
      (!Array.isArray(expected.expected_issue_codes) ||
        expected.expected_issue_codes.some(
          (code) => typeof code !== 'string' || code.trim().length === 0
        ))
    ) {
      issues.push({
        path: `${basePath}/expected/expected_issue_codes`,
        keyword: 'type',
        message: 'expected_issue_codes must be an array of non-empty strings',
      });
    }
    if (
      !hasOnlyKeys(payload, ['document', 'trusted_evidence']) ||
      !('document' in payload) ||
      (payload.trusted_evidence !== undefined && !isRecord(payload.trusted_evidence))
    ) {
      issues.push({
        path: `${basePath}/payload`,
        keyword: 'payload_shape',
        message: 'concept_profile payload requires document and optional trusted_evidence object',
      });
    }
    return issues;
  }

  return issues;
}

/** Validate a versioned semantics benchmark suite and any historical reconciliation entries. */
export function validateSemanticsBenchmarkSuite(value: unknown): KnowledgeValidationResult {
  const schemaResult = validateSuiteSchema(value);
  if (!schemaResult.valid) return schemaResult;

  const suite = value as Record<string, unknown>;
  const cases = suite.cases as unknown[];
  const issues: KnowledgeValidationIssue[] = [];
  const seenCaseIds = new Set<string>();

  for (const [index, rawCase] of cases.entries()) {
    const entry = rawCase as Record<string, unknown>;
    const caseId = String(entry.case_id);
    if (seenCaseIds.has(caseId)) {
      issues.push({
        path: `/cases/${index}/case_id`,
        keyword: 'unique_case_id',
        message: `duplicate benchmark case_id "${caseId}"`,
      });
      continue;
    }
    seenCaseIds.add(caseId);

    if (entry.input_state === 'measured') {
      issues.push(...validateMeasuredCase(entry, index));
    } else if ('expected' in entry || 'payload' in entry) {
      issues.push({
        path: `/cases/${index}`,
        keyword: 'non_measured_case',
        message: `case with input_state "${String(entry.input_state)}" must not carry measured expected/payload`,
      });
    }
  }

  if (Array.isArray(suite.historical_reconciliations)) {
    const seenRecIds = new Set<string>();
    for (const [index, rec] of suite.historical_reconciliations.entries()) {
      issues.push(...validateReconciliationInternal(rec, `/historical_reconciliations/${index}`));
      if (isRecord(rec) && typeof rec.record_id === 'string') {
        if (seenRecIds.has(rec.record_id)) {
          issues.push({
            path: `/historical_reconciliations/${index}/record_id`,
            keyword: 'unique_record_id',
            message: `duplicate reconciliation record_id "${rec.record_id}"`,
          });
        }
        seenRecIds.add(rec.record_id);
      }
    }
  }

  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

function evaluatePolaritySpeakerCase(
  entry: MeasuredPolaritySpeakerCase
): SemanticsBenchmarkCaseResult {
  const observed = projectResearchSemanticAnnotation(
    entry.payload.annotation,
    entry.payload.evidence
  );
  const expectedSummary: Record<string, unknown> = {
    status: entry.expected.expected_status,
    ...(entry.expected.expected_polarity !== undefined
      ? { polarity: entry.expected.expected_polarity }
      : {}),
    ...(entry.expected.expected_context_mode !== undefined
      ? { context_mode: entry.expected.expected_context_mode }
      : {}),
    ...(entry.expected.expected_speaker_id !== undefined
      ? { speaker_id: entry.expected.expected_speaker_id }
      : {}),
    ...(entry.expected.expected_reason !== undefined
      ? { reason: entry.expected.expected_reason }
      : {}),
  };

  const observedSummary: Record<string, unknown> =
    observed.status === 'projected' || observed.status === 'scoped'
      ? {
          status: observed.status,
          polarity: observed.polarity,
          context_mode: observed.context.mode,
          ...(observed.context.speaker_id !== undefined
            ? { speaker_id: observed.context.speaker_id }
            : {}),
        }
      : observed.status === 'review_required'
        ? { status: observed.status, reason: observed.reason }
        : observed.status === 'invalid'
          ? {
              status: observed.status,
              issue_keywords: observed.issues.map((issue) => issue.keyword).sort(),
            }
          : { status: observed.status };

  const mismatches: string[] = [];
  if (observed.status !== entry.expected.expected_status) {
    mismatches.push(
      `status expected ${entry.expected.expected_status} but observed ${observed.status}`
    );
  }
  if (entry.expected.expected_polarity !== undefined) {
    const obsPolarity =
      observed.status === 'projected' || observed.status === 'scoped'
        ? observed.polarity
        : undefined;
    if (obsPolarity !== entry.expected.expected_polarity) {
      mismatches.push(
        `polarity expected ${entry.expected.expected_polarity} but observed ${String(obsPolarity)}`
      );
    }
  }
  if (entry.expected.expected_context_mode !== undefined) {
    const obsMode =
      observed.status === 'projected' || observed.status === 'scoped'
        ? observed.context.mode
        : undefined;
    if (obsMode !== entry.expected.expected_context_mode) {
      mismatches.push(
        `context_mode expected ${entry.expected.expected_context_mode} but observed ${String(obsMode)}`
      );
    }
  }
  if (entry.expected.expected_speaker_id !== undefined) {
    const obsSpeaker =
      observed.status === 'projected' || observed.status === 'scoped'
        ? observed.context.speaker_id
        : undefined;
    if (obsSpeaker !== entry.expected.expected_speaker_id) {
      mismatches.push(
        `speaker_id expected ${entry.expected.expected_speaker_id} but observed ${String(obsSpeaker)}`
      );
    }
  }
  if (entry.expected.expected_reason !== undefined) {
    const obsReason = observed.status === 'review_required' ? observed.reason : undefined;
    if (obsReason !== entry.expected.expected_reason) {
      mismatches.push(
        `reason expected ${entry.expected.expected_reason} but observed ${String(obsReason)}`
      );
    }
  }

  return {
    case_id: entry.case_id,
    domain: entry.domain,
    input_state: 'measured',
    status: mismatches.length === 0 ? 'matched' : 'mismatched',
    expected_summary: expectedSummary,
    observed_summary: observedSummary,
    mismatch_reasons: mismatches,
  };
}

async function evaluateTextualAlignmentCase(
  entry: MeasuredTextualAlignmentCase
): Promise<SemanticsBenchmarkCaseResult> {
  const passages = entry.payload.passages;
  let observedSummary: Record<string, unknown>;
  try {
    const candidate = await projectTextualAlignmentCandidate(
      entry.payload.candidate,
      async (evidenceId) =>
        Object.prototype.hasOwnProperty.call(passages, evidenceId) ? passages[evidenceId] : null
    );
    observedSummary = {
      outcome: 'candidate',
      kind: candidate.kind,
      status: candidate.status,
      asserts_identity: candidate.interpretation_boundary.asserts_identity,
      asserts_quotation: candidate.interpretation_boundary.asserts_quotation,
      asserts_fulfillment: candidate.interpretation_boundary.asserts_fulfillment,
      asserts_doctrine: candidate.interpretation_boundary.asserts_doctrine,
    };
  } catch (error) {
    observedSummary = {
      outcome: 'rejected',
      error: error instanceof Error ? error.message : 'rejected',
    };
  }

  const expectedSummary: Record<string, unknown> = {
    outcome: entry.expected.expected_outcome,
    ...(entry.expected.expected_outcome === 'candidate'
      ? {
          asserts_identity: entry.expected.expected_asserts_identity ?? false,
          asserts_quotation: entry.expected.expected_asserts_quotation ?? false,
          asserts_fulfillment: entry.expected.expected_asserts_fulfillment ?? false,
          asserts_doctrine: entry.expected.expected_asserts_doctrine ?? false,
        }
      : {}),
  };

  const mismatches: string[] = [];
  if (observedSummary.outcome !== entry.expected.expected_outcome) {
    mismatches.push(
      `outcome expected ${entry.expected.expected_outcome} but observed ${String(observedSummary.outcome)}`
    );
  } else if (entry.expected.expected_outcome === 'candidate') {
    for (const flag of [
      'asserts_identity',
      'asserts_quotation',
      'asserts_fulfillment',
      'asserts_doctrine',
    ] as const) {
      if (observedSummary[flag] !== false) {
        mismatches.push(`interpretation_boundary.${flag} must remain false`);
      }
    }
  }

  return {
    case_id: entry.case_id,
    domain: entry.domain,
    input_state: 'measured',
    status: mismatches.length === 0 ? 'matched' : 'mismatched',
    expected_summary: expectedSummary,
    observed_summary: observedSummary,
    mismatch_reasons: mismatches,
  };
}

async function evaluateConceptProfileCase(
  entry: MeasuredConceptProfileCase
): Promise<SemanticsBenchmarkCaseResult> {
  const trustedEvidence = entry.payload.trusted_evidence;
  const result =
    trustedEvidence !== undefined
      ? await validateConceptProfileWithEvidence(entry.payload.document, async (evidenceId) =>
          Object.prototype.hasOwnProperty.call(trustedEvidence, evidenceId)
            ? trustedEvidence[evidenceId]
            : null
        )
      : validateConceptProfile(entry.payload.document);

  const observedCodes = result.valid
    ? []
    : [
        ...new Set(result.issues.map((issue) => ('code' in issue ? issue.code : issue.keyword))),
      ].sort();

  const expectedCodes = entry.expected.expected_issue_codes
    ? [...new Set(entry.expected.expected_issue_codes)].sort()
    : undefined;

  const expectedSummary: Record<string, unknown> = {
    valid: entry.expected.expected_valid,
    ...(expectedCodes !== undefined ? { issue_codes: expectedCodes } : {}),
  };

  const observedSummary: Record<string, unknown> = {
    valid: result.valid,
    issue_codes: observedCodes,
  };

  const mismatches: string[] = [];
  if (result.valid !== entry.expected.expected_valid) {
    mismatches.push(
      `valid expected ${String(entry.expected.expected_valid)} but observed ${String(result.valid)}`
    );
  }
  if (expectedCodes !== undefined) {
    for (const code of expectedCodes) {
      if (!observedCodes.includes(code)) {
        mismatches.push(`expected issue code "${code}" not observed`);
      }
    }
  }

  return {
    case_id: entry.case_id,
    domain: entry.domain,
    input_state: 'measured',
    status: mismatches.length === 0 ? 'matched' : 'mismatched',
    expected_summary: expectedSummary,
    observed_summary: observedSummary,
    mismatch_reasons: mismatches,
  };
}

/**
 * Deterministically execute a validated semantics benchmark suite against real
 * `@moonwitness/research` evaluators. Empty, unsupported, and unknown slices stay
 * strictly distinct and never produce an invented pass.
 */
export async function runSemanticsBenchmarkSuite(
  value: unknown
): Promise<SemanticsBenchmarkReport> {
  const validation = validateSemanticsBenchmarkSuite(value);
  if (!validation.valid) {
    throw new SemanticsBenchmarkValidationError(
      'INVALID_BENCHMARK_SUITE',
      'Semantics benchmark suite failed validation',
      validation.issues
    );
  }

  let snapshotHash: string;
  let suite: SemanticsBenchmarkSuite;
  try {
    snapshotHash = hashCanonicalJson(value);
    suite = JSON.parse(JSON.stringify(value)) as SemanticsBenchmarkSuite;
  } catch {
    throw new SemanticsBenchmarkValidationError(
      'INVALID_BENCHMARK_SUITE',
      'Semantics benchmark suite could not be canonically snapshotted'
    );
  }

  const caseResults: SemanticsBenchmarkCaseResult[] = [];
  for (const entry of suite.cases) {
    if (entry.input_state !== 'measured') {
      caseResults.push({
        case_id: entry.case_id,
        domain: entry.domain,
        input_state: entry.input_state,
        status: entry.input_state,
        expected_summary: null,
        observed_summary: null,
        mismatch_reasons: [],
      });
      continue;
    }

    if (entry.domain === 'polarity_speaker') {
      caseResults.push(evaluatePolaritySpeakerCase(entry));
    } else if (entry.domain === 'textual_alignment') {
      caseResults.push(await evaluateTextualAlignmentCase(entry));
    } else {
      caseResults.push(await evaluateConceptProfileCase(entry));
    }
  }

  try {
    if (hashCanonicalJson(value) !== snapshotHash) {
      throw new SemanticsBenchmarkValidationError(
        'INPUT_MUTATED',
        'Semantics benchmark suite was mutated during evaluation'
      );
    }
  } catch (error) {
    if (error instanceof SemanticsBenchmarkValidationError) throw error;
    throw new SemanticsBenchmarkValidationError(
      'INPUT_MUTATED',
      'Semantics benchmark suite became unserializable during evaluation'
    );
  }

  let matched = 0;
  let mismatched = 0;
  let empty = 0;
  let unsupported = 0;
  let unknown = 0;
  for (const result of caseResults) {
    if (result.status === 'matched') matched += 1;
    else if (result.status === 'mismatched') mismatched += 1;
    else if (result.status === 'empty') empty += 1;
    else if (result.status === 'unsupported') unsupported += 1;
    else unknown += 1;
  }

  const evaluated = matched + mismatched;
  const precision = evaluated > 0 ? Number((matched / evaluated).toFixed(6)) : null;
  const errorRate = evaluated > 0 ? Number((mismatched / evaluated).toFixed(6)) : null;

  let verdict: BenchmarkSuiteVerdict;
  if (evaluated === 0) {
    verdict = 'no_measured_cases';
  } else if (mismatched > 0) {
    verdict = 'failed';
  } else if (empty > 0 || unsupported > 0 || unknown > 0) {
    verdict = 'incomplete';
  } else {
    verdict = 'passed';
  }

  const verifiedReconciliations: VerifiedHistoricalCountReconciliation[] = (
    suite.historical_reconciliations ?? []
  ).map((record) => {
    const counts = record.observations.map((obs) => obs.count);
    return {
      ...record,
      discrepancy_delta: Math.max(...counts) - Math.min(...counts),
    };
  });

  const unsignedReport = {
    schema_version: 1 as const,
    suite_id: suite.suite_id,
    suite_version: suite.suite_version,
    fixture_classification: suite.fixture_classification,
    verdict,
    metrics: {
      total_cases: caseResults.length,
      evaluated_cases: evaluated,
      matched_cases: matched,
      mismatched_cases: mismatched,
      empty_cases: empty,
      unsupported_cases: unsupported,
      unknown_cases: unknown,
      precision,
      error_rate: errorRate,
    },
    cases: caseResults,
    historical_reconciliations: verifiedReconciliations,
  };

  return {
    ...unsignedReport,
    report_digest: hashCanonicalJson(unsignedReport),
  };
}

function assertValidReport(value: unknown, label: string): SemanticsBenchmarkReport {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schema_version',
      'suite_id',
      'suite_version',
      'fixture_classification',
      'verdict',
      'metrics',
      'cases',
      'historical_reconciliations',
      'report_digest',
    ]) ||
    value.schema_version !== 1 ||
    typeof value.suite_id !== 'string' ||
    typeof value.suite_version !== 'string' ||
    (value.fixture_classification !== 'synthetic' &&
      value.fixture_classification !== 'pinned_approved_sample') ||
    !validVerdicts.has(value.verdict as BenchmarkSuiteVerdict) ||
    !isRecord(value.metrics) ||
    !Array.isArray(value.cases) ||
    !Array.isArray(value.historical_reconciliations) ||
    typeof value.report_digest !== 'string' ||
    !sha256Hex.test(value.report_digest)
  ) {
    throw new SemanticsBenchmarkValidationError(
      'INVALID_BENCHMARK_REPORT',
      `${label} report does not match the benchmark report contract`
    );
  }

  for (const entry of value.cases) {
    if (
      !isRecord(entry) ||
      typeof entry.case_id !== 'string' ||
      !validDomains.has(entry.domain as BenchmarkDomain) ||
      !validInputStates.has(entry.input_state as BenchmarkInputState) ||
      !validCaseStatuses.has(entry.status as BenchmarkCaseStatus)
    ) {
      throw new SemanticsBenchmarkValidationError(
        'INVALID_BENCHMARK_REPORT',
        `${label} report contains a malformed case entry`
      );
    }
  }

  const { report_digest: digest, ...unsigned } = value;
  if (hashCanonicalJson(unsigned) !== digest) {
    throw new SemanticsBenchmarkValidationError(
      'REPORT_DIGEST_MISMATCH',
      `${label} report digest does not match its canonical contents`
    );
  }

  return JSON.parse(JSON.stringify(value)) as SemanticsBenchmarkReport;
}

function classifyDomainDrift(domain: BenchmarkDomain): SemanticsDriftKind {
  if (domain === 'polarity_speaker') return 'polarity_drift';
  if (domain === 'textual_alignment') return 'alignment_drift';
  return 'concept_drift';
}

function isSpeakerOnlyOrIncludesSpeakerDrift(
  baseline: SemanticsBenchmarkCaseResult,
  candidate: SemanticsBenchmarkCaseResult
): boolean {
  if (baseline.domain !== 'polarity_speaker') return false;
  const baseObs = baseline.observed_summary ?? {};
  const candObs = candidate.observed_summary ?? {};
  return baseObs.speaker_id !== candObs.speaker_id || baseObs.context_mode !== candObs.context_mode;
}

/**
 * Compare a baseline and candidate `SemanticsBenchmarkReport` after verifying both
 * canonical digests. Detects polarity, speaker, alignment, concept, coverage, and
 * metric regressions deterministically.
 */
export function compareSemanticsBenchmarkReports(
  baselineValue: unknown,
  candidateValue: unknown
): SemanticsDriftLedger {
  const baseline = assertValidReport(baselineValue, 'baseline');
  const candidate = assertValidReport(candidateValue, 'candidate');

  const drifts: SemanticsDriftItem[] = [];
  const baseById = new Map(baseline.cases.map((item) => [item.case_id, item]));
  const candById = new Map(candidate.cases.map((item) => [item.case_id, item]));
  const allCaseIds = [...new Set([...baseById.keys(), ...candById.keys()])].sort();

  for (const caseId of allCaseIds) {
    const baseCase = baseById.get(caseId);
    const candCase = candById.get(caseId);

    if (!baseCase && candCase) {
      drifts.push({
        case_id: caseId,
        domain: candCase.domain,
        kind: 'coverage_drift',
        regression: candCase.status === 'mismatched',
        baseline_summary: null,
        candidate_summary: { status: candCase.status, observed: candCase.observed_summary },
        detail: `case "${caseId}" was added in candidate with status "${candCase.status}"`,
      });
      continue;
    }

    if (baseCase && !candCase) {
      drifts.push({
        case_id: caseId,
        domain: baseCase.domain,
        kind: 'coverage_drift',
        regression: true,
        baseline_summary: { status: baseCase.status, observed: baseCase.observed_summary },
        candidate_summary: null,
        detail: `case "${caseId}" was removed from candidate suite`,
      });
      continue;
    }

    if (!baseCase || !candCase) continue;

    if (baseCase.domain !== candCase.domain) {
      drifts.push({
        case_id: caseId,
        domain: 'suite',
        kind: 'coverage_drift',
        regression: true,
        baseline_summary: { domain: baseCase.domain },
        candidate_summary: { domain: candCase.domain },
        detail: `case "${caseId}" changed domain from "${baseCase.domain}" to "${candCase.domain}"`,
      });
      continue;
    }

    if (baseCase.input_state !== candCase.input_state) {
      drifts.push({
        case_id: caseId,
        domain: candCase.domain,
        kind: 'coverage_drift',
        regression: baseCase.input_state === 'measured' && candCase.input_state !== 'measured',
        baseline_summary: { input_state: baseCase.input_state, status: baseCase.status },
        candidate_summary: { input_state: candCase.input_state, status: candCase.status },
        detail: `case "${caseId}" changed input_state from "${baseCase.input_state}" to "${candCase.input_state}"`,
      });
      continue;
    }

    const baseJson = hashCanonicalJson({
      status: baseCase.status,
      observed: baseCase.observed_summary,
    });
    const candJson = hashCanonicalJson({
      status: candCase.status,
      observed: candCase.observed_summary,
    });
    if (baseJson === candJson) continue;

    const regression =
      (baseCase.status === 'matched' && candCase.status === 'mismatched') ||
      (baseCase.status === 'mismatched' && candCase.status === 'mismatched') ||
      (baseCase.status === 'matched' && candCase.status === 'matched');

    if (isSpeakerOnlyOrIncludesSpeakerDrift(baseCase, candCase)) {
      const baseObs = baseCase.observed_summary ?? {};
      const candObs = candCase.observed_summary ?? {};
      const polarityAlsoChanged =
        baseObs.polarity !== candObs.polarity || baseObs.status !== candObs.status;
      if (polarityAlsoChanged) {
        drifts.push({
          case_id: caseId,
          domain: candCase.domain,
          kind: 'polarity_drift',
          regression,
          baseline_summary: baseCase.observed_summary,
          candidate_summary: candCase.observed_summary,
          detail: `case "${caseId}" drifted in semantic status/polarity (${baseCase.status} -> ${candCase.status})`,
        });
      }
      drifts.push({
        case_id: caseId,
        domain: candCase.domain,
        kind: 'speaker_drift',
        regression,
        baseline_summary: {
          context_mode: baseObs.context_mode ?? null,
          speaker_id: baseObs.speaker_id ?? null,
        },
        candidate_summary: {
          context_mode: candObs.context_mode ?? null,
          speaker_id: candObs.speaker_id ?? null,
        },
        detail: `case "${caseId}" drifted in speaker or quotation context`,
      });
    } else {
      drifts.push({
        case_id: caseId,
        domain: candCase.domain,
        kind: classifyDomainDrift(candCase.domain),
        regression,
        baseline_summary: { status: baseCase.status, observed: baseCase.observed_summary },
        candidate_summary: { status: candCase.status, observed: candCase.observed_summary },
        detail: `case "${caseId}" drifted (${baseCase.status} -> ${candCase.status})`,
      });
    }
  }

  const precisionRegressed =
    baseline.metrics.precision !== null &&
    (candidate.metrics.precision === null ||
      candidate.metrics.precision < baseline.metrics.precision);
  const mismatchesIncreased =
    candidate.metrics.mismatched_cases > baseline.metrics.mismatched_cases;

  if (baseline.verdict !== candidate.verdict || precisionRegressed || mismatchesIncreased) {
    const verdictRegressed =
      (baseline.verdict === 'passed' && candidate.verdict !== 'passed') ||
      precisionRegressed ||
      mismatchesIncreased;
    drifts.push({
      case_id: '__suite__',
      domain: 'suite',
      kind: 'verdict_drift',
      regression: verdictRegressed,
      baseline_summary: { verdict: baseline.verdict, metrics: baseline.metrics },
      candidate_summary: { verdict: candidate.verdict, metrics: candidate.metrics },
      detail: `suite metrics or verdict changed (${baseline.verdict} -> ${candidate.verdict})`,
    });
  }

  if (
    hashCanonicalJson(baseline.historical_reconciliations) !==
    hashCanonicalJson(candidate.historical_reconciliations)
  ) {
    drifts.push({
      case_id: '__reconciliations__',
      domain: 'reconciliation',
      kind: 'reconciliation_drift',
      regression: false,
      baseline_summary: baseline.historical_reconciliations,
      candidate_summary: candidate.historical_reconciliations,
      detail: 'historical count reconciliation entries changed between baseline and candidate',
    });
  }

  const hasRegression = drifts.some((item) => item.regression);
  const status: SemanticsDriftLedger['status'] =
    drifts.length === 0
      ? 'zero_drift'
      : hasRegression
        ? 'regression_detected'
        : 'non_regression_change';

  const unsignedLedger = {
    schema_version: 1 as const,
    baseline_suite_id: baseline.suite_id,
    baseline_version: baseline.suite_version,
    baseline_digest: baseline.report_digest,
    candidate_suite_id: candidate.suite_id,
    candidate_version: candidate.suite_version,
    candidate_digest: candidate.report_digest,
    status,
    has_regression: hasRegression,
    drifts,
  };

  return {
    ...unsignedLedger,
    ledger_digest: hashCanonicalJson(unsignedLedger),
  };
}
