import {
  validateResearchEvidenceReference,
  type ResearchEvidenceReference,
} from '@moonwitness/research';
import type { Knex } from 'knex';
import {
  readBugCaseHistory,
  transitionBugCaseWorkflow,
  type AuthenticatedBugCaseActor,
  type BugCaseHistoryResult,
} from './bug-case-workflow.js';
import { canonicalResearchJson } from './research-release.js';
import { createHash } from 'node:crypto';

export type OutcomeEvidenceReviewStatus = 'accepted' | 'rejected' | 'unreviewed' | 'conflicting';
export type OutcomeEvidenceAccess = 'readable' | 'denied';

export interface TrustedBugOutcomeEvidenceResolution {
  readonly canonicalEvidence: ResearchEvidenceReference;
  readonly reviewStatus: OutcomeEvidenceReviewStatus;
  readonly access: OutcomeEvidenceAccess;
  readonly observedContentSha256: string;
  readonly capturedAt: string;
}

export type TrustedBugOutcomeEvidenceResolver = (
  evidenceId: string
) => Promise<TrustedBugOutcomeEvidenceResolution | null>;

export interface BugOutcomeTestProof {
  readonly test_run_id: string;
  readonly passed: boolean;
  readonly summary: string;
  readonly artifact_sha256: string;
}

export interface VerifyBugCaseOutcomeInput {
  readonly db: Knex;
  readonly actor: AuthenticatedBugCaseActor;
  readonly caseId: `mw:bug-case:${string}`;
  readonly expectedWorkflowRevision: number;
  readonly idempotencyKey: string;
  readonly evidence: ResearchEvidenceReference;
  readonly resolveTrustedEvidence: TrustedBugOutcomeEvidenceResolver;
  readonly outcomeTestProof: BugOutcomeTestProof;
  readonly maxEvidenceAgeHours?: number;
  readonly now?: Date;
}

export interface ReopenBugCaseOnStaleOrTamperedEvidenceInput {
  readonly db: Knex;
  readonly actor: AuthenticatedBugCaseActor;
  readonly caseId: `mw:bug-case:${string}`;
  readonly expectedWorkflowRevision: number;
  readonly idempotencyKey: string;
  readonly resolveTrustedEvidence: TrustedBugOutcomeEvidenceResolver;
  readonly maxEvidenceAgeHours?: number;
  readonly reason?: string;
  readonly now?: Date;
}

export type BugOutcomeVerificationErrorCode =
  | 'INVALID_EVIDENCE'
  | 'MISSING_EVIDENCE'
  | 'UNREVIEWED_EVIDENCE'
  | 'TAMPERED_EVIDENCE'
  | 'STALE_EVIDENCE'
  | 'OUTCOME_TEST_FAILED'
  | 'NOT_VERIFIED_RESOLVED';

export class BugOutcomeVerificationError extends Error {
  readonly code: BugOutcomeVerificationErrorCode;

  constructor(code: BugOutcomeVerificationErrorCode, message: string) {
    super(message);
    this.name = 'BugOutcomeVerificationError';
    this.code = code;
  }
}

const DEFAULT_MAX_EVIDENCE_AGE_HOURS = 720;
const sha256Pattern = /^[a-f0-9]{64}$/u;

function fail(code: BugOutcomeVerificationErrorCode, message: string): never {
  throw new BugOutcomeVerificationError(code, message);
}

function parseIsoTimestampMs(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    return Number.NaN;
  }
  return parsed.getTime();
}

function assertEvidenceFreshness(capturedAt: string, now: Date, maxAgeHours: number): void {
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    fail('INVALID_EVIDENCE', 'maxEvidenceAgeHours must be a positive finite number');
  }
  const capturedMs = parseIsoTimestampMs(capturedAt);
  if (Number.isNaN(capturedMs)) {
    fail('INVALID_EVIDENCE', 'Evidence capturedAt must be an ISO-8601 UTC timestamp');
  }
  const ageMs = now.getTime() - capturedMs;
  if (ageMs < 0) {
    fail('INVALID_EVIDENCE', 'Evidence capturedAt cannot be in the future');
  }
  if (ageMs > maxAgeHours * 3_600_000) {
    fail(
      'STALE_EVIDENCE',
      `Verification evidence exceeded maximum freshness age (${maxAgeHours}h)`
    );
  }
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(canonicalResearchJson(value), 'utf8').digest('hex');
}

/**
 * Verify a BUG case outcome with exact K3-002 evidence selector/digest validation,
 * trusted review/access verification, freshness window checks, passing outcome test
 * proof, and independent reviewer transition through `transitionBugCaseWorkflow`.
 */
export async function verifyBugCaseOutcomeWithEvidence(
  input: VerifyBugCaseOutcomeInput
): Promise<BugCaseHistoryResult> {
  const evidenceValidation = validateResearchEvidenceReference(input.evidence);
  if (!evidenceValidation.valid) {
    fail('INVALID_EVIDENCE', 'Outcome evidence does not match K3-002 evidence selector schema');
  }

  if (
    !input.outcomeTestProof ||
    input.outcomeTestProof.passed !== true ||
    input.outcomeTestProof.test_run_id.trim().length === 0 ||
    input.outcomeTestProof.summary.trim().length === 0 ||
    !sha256Pattern.test(input.outcomeTestProof.artifact_sha256)
  ) {
    fail(
      'OUTCOME_TEST_FAILED',
      'Verified outcome requires a passing test proof with valid SHA-256 artifact'
    );
  }

  const resolved = await input.resolveTrustedEvidence(input.evidence.id);
  if (!resolved) {
    fail('MISSING_EVIDENCE', `Trusted evidence "${input.evidence.id}" did not resolve`);
  }
  if (!validateResearchEvidenceReference(resolved.canonicalEvidence).valid) {
    fail('INVALID_EVIDENCE', 'Resolved canonical evidence is invalid');
  }
  if (resolved.access !== 'readable') {
    fail('MISSING_EVIDENCE', `Evidence "${input.evidence.id}" is not readable in this context`);
  }
  if (resolved.reviewStatus !== 'accepted') {
    fail(
      'UNREVIEWED_EVIDENCE',
      `Evidence "${input.evidence.id}" has reviewStatus "${resolved.reviewStatus}"; accepted evidence required`
    );
  }

  if (
    resolved.canonicalEvidence.id !== input.evidence.id ||
    canonicalResearchJson(resolved.canonicalEvidence.selector) !==
      canonicalResearchJson(input.evidence.selector) ||
    !sha256Pattern.test(resolved.observedContentSha256) ||
    resolved.observedContentSha256 !== input.evidence.selector.content_sha256
  ) {
    fail(
      'TAMPERED_EVIDENCE',
      'Resolved canonical evidence selector or content SHA-256 disagrees with submitted outcome evidence'
    );
  }

  const now = input.now ?? new Date();
  const maxAgeHours = input.maxEvidenceAgeHours ?? DEFAULT_MAX_EVIDENCE_AGE_HOURS;
  assertEvidenceFreshness(resolved.capturedAt, now, maxAgeHours);

  const evidenceSelectorDigest = sha256Hex(resolved.canonicalEvidence.selector);
  const verificationPayload = {
    evidence_id: input.evidence.id,
    evidence_selector_digest: evidenceSelectorDigest,
    observed_content_sha256: resolved.observedContentSha256,
    captured_at: resolved.capturedAt,
    test_run_id: input.outcomeTestProof.test_run_id,
    test_passed: true,
    test_summary: input.outcomeTestProof.summary,
    test_artifact_sha256: input.outcomeTestProof.artifact_sha256,
  };

  return transitionBugCaseWorkflow({
    db: input.db,
    actor: input.actor,
    caseId: input.caseId,
    action: 'verify_outcome',
    expectedWorkflowRevision: input.expectedWorkflowRevision,
    idempotencyKey: input.idempotencyKey,
    details: verificationPayload,
    now,
  });
}

/**
 * Re-check the latest verification event on a `verified_resolved` BUG case against
 * the trusted evidence resolver and freshness policy. Reopens the case to `reopened`
 * if evidence is missing, unreviewed, tampered, or stale.
 */
export async function reopenBugCaseOnEvidenceChange(
  input: ReopenBugCaseOnStaleOrTamperedEvidenceInput
): Promise<{ reopened: boolean; reason: string | null; history: BugCaseHistoryResult }> {
  const history = await readBugCaseHistory(input.db, input.caseId, input.actor);
  if (history.bugCase.case_state !== 'verified_resolved') {
    fail(
      'NOT_VERIFIED_RESOLVED',
      `BUG case "${input.caseId}" is in state "${history.bugCase.case_state}"`
    );
  }

  const lastVerification = [...history.events]
    .reverse()
    .find((event) => event.event_kind === 'verification');
  if (!lastVerification) {
    fail('NOT_VERIFIED_RESOLVED', 'Verified BUG case is missing its verification event');
  }

  const evidenceId = String(lastVerification.payload.evidence_id ?? '');
  const expectedSelectorDigest = String(lastVerification.payload.evidence_selector_digest ?? '');
  const expectedContentSha = String(lastVerification.payload.observed_content_sha256 ?? '');
  const capturedAt = String(lastVerification.payload.captured_at ?? '');
  const now = input.now ?? new Date();
  const maxAgeHours = input.maxEvidenceAgeHours ?? DEFAULT_MAX_EVIDENCE_AGE_HOURS;

  let reopenReason: string | null = null;
  const resolved = await input.resolveTrustedEvidence(evidenceId);
  if (!resolved) {
    reopenReason = 'missing_evidence';
  } else if (resolved.access !== 'readable' || resolved.reviewStatus !== 'accepted') {
    reopenReason = `evidence_review_${resolved.reviewStatus}`;
  } else if (
    sha256Hex(resolved.canonicalEvidence.selector) !== expectedSelectorDigest ||
    resolved.observedContentSha256 !== expectedContentSha
  ) {
    reopenReason = 'tampered_evidence_digest';
  } else {
    const capturedMs = parseIsoTimestampMs(capturedAt);
    const resolvedMs = parseIsoTimestampMs(resolved.capturedAt);
    const effectiveMs = Number.isNaN(resolvedMs) ? capturedMs : resolvedMs;
    if (Number.isNaN(effectiveMs) || now.getTime() - effectiveMs > maxAgeHours * 3_600_000) {
      reopenReason = 'stale_evidence';
    }
  }

  if (reopenReason === null && input.reason === undefined) {
    return { reopened: false, reason: null, history };
  }

  const finalReason = reopenReason ?? input.reason ?? 'manual_reopen';
  const updated = await transitionBugCaseWorkflow({
    db: input.db,
    actor: input.actor,
    caseId: input.caseId,
    action: 'reopen',
    expectedWorkflowRevision: input.expectedWorkflowRevision,
    idempotencyKey: input.idempotencyKey,
    details: {
      reopen_trigger: finalReason,
      prior_verification_sequence: lastVerification.workflow_event_sequence,
      evidence_id: evidenceId,
    },
    now,
  });

  return { reopened: true, reason: finalReason, history: updated };
}
