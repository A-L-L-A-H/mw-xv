import { createHash } from 'node:crypto';
import type { JsonValue } from '@moonwitness/types';
import type { RiskTier } from './risk-policy.js';
import { validateJsonSchema } from './schema-validator.js';
import type { Clock, DataClassification, JsonSchemaNode } from './types.js';
import { SYSTEM_CLOCK } from './types.js';

export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/u;

export type VerificationMethod =
  | 'automated_test'
  | 'schema_check'
  | 'source_inspection'
  | 'independent_reviewer'
  | 'human_decision';

export type ArtifactLifecycleStatus =
  'proposed' | 'produced' | 'checked' | 'accepted' | 'rejected' | 'superseded';

export type ArtifactKind =
  'report' | 'transcript' | 'tool_output' | 'evidence_bundle' | 'eval_result';

export interface AcceptanceCriterionSpec {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly verificationMethod: VerificationMethod;
  readonly requiredEvidenceType: string;
  readonly mandatory: boolean;
  readonly version: number;
  readonly expectedSchema?: JsonSchemaNode;
}

export interface PcwWorkContractSpec {
  readonly id: string;
  readonly companyId: number;
  readonly code: string;
  readonly assignedAgentId: string | number;
  readonly reviewerAgentId?: string | number;
  readonly riskTier: RiskTier;
  readonly dataClassification: DataClassification;
  readonly criteriaLockedAt?: string;
  readonly criteria: readonly AcceptanceCriterionSpec[];
}

export interface PcwEvidenceArtifactInput {
  readonly id: string;
  readonly companyId: number;
  readonly workContractId: string;
  readonly acceptanceCriterionId: string;
  readonly criterionVersion?: number;
  readonly agentRunId: string;
  readonly producerAgentId: string | number;
  readonly artifactKind: ArtifactKind;
  readonly storageKey: string;
  readonly sha256: string;
  readonly rawContent?: string | Uint8Array;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly sourceSha?: string;
  readonly producedAt: string;
  readonly staleAt?: string;
  readonly verificationStatus: ArtifactLifecycleStatus;
  readonly automatedTestPassed?: boolean;
  readonly schemaValidationPassed?: boolean;
  readonly structuredPayload?: JsonValue;
}

export interface PcwReviewerDecision {
  readonly reviewerActorId: string | number;
  readonly reviewerType: 'agent' | 'user';
  readonly reviewerRunId?: string;
  readonly decision: 'approved' | 'rejected';
  readonly rationale: string;
  readonly decidedAt: string;
}

export interface PcwHumanSignoff {
  readonly userId: string | number;
  readonly approved: boolean;
  readonly rationale: string;
  readonly signedAt: string;
}

export type PcwCheckStatus = 'pass' | 'fail' | 'skipped' | 'not_applicable' | 'not_run';

export interface PcwCheckRecord {
  readonly code: string;
  readonly command?: string;
  readonly status: PcwCheckStatus;
  readonly mandatory?: boolean;
  readonly exitCode?: number;
  readonly reason?: string;
  readonly artifactId?: string;
  readonly durationMs?: number;
}

export interface PcwCheckMatrixSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly notApplicable: number;
  readonly notRun: number;
  readonly records: readonly PcwCheckRecord[];
}

export interface PcwDiffScopeResult {
  readonly scopeClean: boolean;
  readonly checkedFiles: readonly string[];
  readonly outOfScopeFiles: readonly string[];
  readonly unsafePaths: readonly string[];
}

export interface PcwVerificationInput {
  readonly contract: PcwWorkContractSpec;
  readonly artifacts: readonly PcwEvidenceArtifactInput[];
  readonly reviewerDecision?: PcwReviewerDecision;
  readonly reviewerUnavailable?: boolean;
  readonly humanSignoff?: PcwHumanSignoff;
  readonly requireIndependentReview?: boolean;
  readonly requireHumanSignoff?: boolean;
  readonly expectedSourceSha?: string;
  readonly nowMs?: number;
  readonly checks?: readonly PcwCheckRecord[];
  readonly changedFiles?: readonly string[];
  readonly allowedScopePaths?: readonly string[];
  readonly forbiddenScopePaths?: readonly string[];
}

export interface PcwRejectionReason {
  readonly code:
    | 'NO_ACCEPTANCE_CRITERIA'
    | 'CRITERIA_NOT_LOCKED'
    | 'MISSING_EVIDENCE'
    | 'PROPOSED_ONLY_EVIDENCE'
    | 'INVALID_SHA256_DIGEST'
    | 'EVIDENCE_DIGEST_MISMATCH'
    | 'EVIDENCE_SIZE_MISMATCH'
    | 'CROSS_COMPANY_EVIDENCE'
    | 'WRONG_CONTRACT_EVIDENCE'
    | 'STALE_EVIDENCE'
    | 'STALE_SOURCE_SHA'
    | 'CRITERION_VERSION_MISMATCH'
    | 'DETERMINISTIC_CHECK_FAILED'
    | 'SELF_APPROVAL_REJECTED'
    | 'REVIEWER_UNAVAILABLE'
    | 'REVIEWER_REJECTED'
    | 'MISSING_REVIEW_RATIONALE'
    | 'HUMAN_SIGNOFF_REQUIRED'
    | 'HUMAN_SIGNOFF_REJECTED'
    | 'MISSING_SKIP_REASON'
    | 'MANDATORY_CHECK_NOT_PASSED'
    | 'OUT_OF_SCOPE_DIFF_DETECTED';
  readonly criterionId?: string;
  readonly artifactId?: string;
  readonly message: string;
}

export interface PcwCriterionEvaluation {
  readonly criterionId: string;
  readonly code: string;
  readonly mandatory: boolean;
  readonly satisfied: boolean;
  readonly acceptedArtifactIds: readonly string[];
  readonly rejectionCodes: readonly string[];
}

export interface PcwVerificationReport {
  readonly contractId: string;
  readonly companyId: number;
  readonly accepted: boolean;
  readonly status: 'accepted' | 'rejected';
  readonly verifiedAt: string;
  readonly criterionResults: readonly PcwCriterionEvaluation[];
  readonly rejectionReasons: readonly PcwRejectionReason[];
  readonly verifiedArtifactDigests: Readonly<Record<string, string>>;
  readonly reviewerAudit: {
    readonly required: boolean;
    readonly reviewerActorId?: string | number;
    readonly independentVerified: boolean;
    readonly humanSignoffVerified: boolean;
  };
  readonly checkMatrix?: PcwCheckMatrixSummary;
  readonly diffScope?: PcwDiffScopeResult;
  readonly reportSha256: string;
}

export function computeSha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

const WINDOWS_DRIVE_PREFIX_REGEX = /^[A-Za-z]:(?:\/|$)/u;
const UNSAFE_EXTENSION_REGEX = /\.(?:pem|key|p12|pfx)$/iu;
const UNSAFE_SEGMENT_REGEX = /^(?:\.git$|\.env|id_rsa|credentials|secrets)/iu;

function normalizeScopePrefix(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/\\/gu, '/');
  if (trimmed === '.' || trimmed === './') {
    return '.';
  }
  let normalized = trimmed;
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function normalizeChangedFilePath(rawPath: string): {
  readonly normalized: string;
  readonly isUnsafe: boolean;
} {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    return { normalized: '', isUnsafe: true };
  }
  const slashed = trimmed.replace(/\\/gu, '/');
  const isAbsolute =
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    slashed.startsWith('/') ||
    WINDOWS_DRIVE_PREFIX_REGEX.test(slashed);

  let normalized = slashed;
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  if (normalized.length === 0 || isAbsolute) {
    return { normalized: normalized || slashed, isUnsafe: true };
  }

  const segments = normalized.split('/');
  const hasUnsafeSegment = segments.some(
    (segment) =>
      segment === '..' || UNSAFE_SEGMENT_REGEX.test(segment) || UNSAFE_EXTENSION_REGEX.test(segment)
  );

  return {
    normalized,
    isUnsafe: hasUnsafeSegment,
  };
}

function matchesScopePrefix(pathValue: string, prefix: string): boolean {
  if (prefix === '.') {
    return true;
  }
  return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
}

export function validateDiffScope(
  changedFiles: readonly string[],
  allowedScopePaths: readonly string[],
  forbiddenPaths: readonly string[] = []
): PcwDiffScopeResult {
  const normalizedAllowed = allowedScopePaths
    .map(normalizeScopePrefix)
    .filter((entry) => entry.length > 0);
  const normalizedForbidden = forbiddenPaths
    .map(normalizeScopePrefix)
    .filter((entry) => entry.length > 0);

  const checkedSet = new Set<string>();
  const outOfScopeSet = new Set<string>();
  const unsafeSet = new Set<string>();

  for (const rawFile of changedFiles) {
    const { normalized, isUnsafe } = normalizeChangedFilePath(rawFile);
    checkedSet.add(normalized);

    if (isUnsafe) {
      unsafeSet.add(normalized);
      outOfScopeSet.add(normalized);
      continue;
    }

    const inAllowed =
      normalizedAllowed.length > 0 &&
      normalizedAllowed.some((prefix) => matchesScopePrefix(normalized, prefix));
    const inForbidden = normalizedForbidden.some((prefix) =>
      matchesScopePrefix(normalized, prefix)
    );

    if (!inAllowed || inForbidden) {
      outOfScopeSet.add(normalized);
    }
  }

  const checkedFiles = [...checkedSet].sort();
  const outOfScopeFiles = [...outOfScopeSet].sort();
  const unsafePaths = [...unsafeSet].sort();

  return {
    scopeClean: outOfScopeFiles.length === 0 && unsafePaths.length === 0,
    checkedFiles,
    outOfScopeFiles,
    unsafePaths,
  };
}

export function verifyProofCarryingWork(input: PcwVerificationInput): PcwVerificationReport {
  const nowMs = input.nowMs ?? Date.now();
  const { contract, artifacts } = input;
  const rejectionReasons: PcwRejectionReason[] = [];
  const verifiedArtifactDigests: Record<string, string> = {};

  if (contract.criteria.length === 0) {
    rejectionReasons.push({
      code: 'NO_ACCEPTANCE_CRITERIA',
      message: `Work contract "${contract.code}" has 0 acceptance criteria; cannot verify completion`,
    });
  }

  if (!contract.criteriaLockedAt || !Number.isFinite(Date.parse(contract.criteriaLockedAt))) {
    rejectionReasons.push({
      code: 'CRITERIA_NOT_LOCKED',
      message: `Work contract "${contract.code}" acceptance criteria must be locked before verification`,
    });
  }

  const producerActorIds = new Set<string>([String(contract.assignedAgentId)]);
  const producerRunIds = new Set<string>();

  for (const artifact of artifacts) {
    producerActorIds.add(String(artifact.producerAgentId));
    if (artifact.agentRunId) {
      producerRunIds.add(artifact.agentRunId);
    }
  }

  const criterionResults: PcwCriterionEvaluation[] = [];

  for (const criterion of contract.criteria) {
    const matchingArtifacts = artifacts.filter(
      (artifact) => artifact.acceptanceCriterionId === criterion.id
    );
    const acceptedArtifactIds: string[] = [];
    const criterionRejections: string[] = [];

    if (matchingArtifacts.length === 0) {
      if (criterion.mandatory) {
        rejectionReasons.push({
          code: 'MISSING_EVIDENCE',
          criterionId: criterion.id,
          message: `Mandatory acceptance criterion "${criterion.code}" has no supporting evidence`,
        });
        criterionRejections.push('MISSING_EVIDENCE');
      }
      criterionResults.push({
        criterionId: criterion.id,
        code: criterion.code,
        mandatory: criterion.mandatory,
        satisfied: !criterion.mandatory,
        acceptedArtifactIds: [],
        rejectionCodes: criterionRejections,
      });
      continue;
    }

    for (const artifact of matchingArtifacts) {
      if (
        artifact.verificationStatus === 'rejected' ||
        artifact.verificationStatus === 'superseded'
      ) {
        continue;
      }

      const pushArtifactRejection = (code: PcwRejectionReason['code'], message: string): void => {
        rejectionReasons.push({
          code,
          criterionId: criterion.id,
          artifactId: artifact.id,
          message,
        });
        criterionRejections.push(code);
      };

      if (artifact.companyId !== contract.companyId) {
        pushArtifactRejection(
          'CROSS_COMPANY_EVIDENCE',
          `Artifact "${artifact.id}" belongs to company ${artifact.companyId}, expected ${contract.companyId}`
        );
        continue;
      }
      if (artifact.workContractId !== contract.id) {
        pushArtifactRejection(
          'WRONG_CONTRACT_EVIDENCE',
          `Artifact "${artifact.id}" belongs to contract "${artifact.workContractId}", expected "${contract.id}"`
        );
        continue;
      }
      if (artifact.verificationStatus === 'proposed') {
        pushArtifactRejection(
          'PROPOSED_ONLY_EVIDENCE',
          `Artifact "${artifact.id}" is only "proposed" and has not been produced/checked`
        );
        continue;
      }
      if (
        artifact.criterionVersion !== undefined &&
        artifact.criterionVersion !== criterion.version
      ) {
        pushArtifactRejection(
          'CRITERION_VERSION_MISMATCH',
          `Artifact "${artifact.id}" targets criterion version ${artifact.criterionVersion}, current is ${criterion.version}`
        );
        continue;
      }
      if (!SHA256_HEX_REGEX.test(artifact.sha256)) {
        pushArtifactRejection(
          'INVALID_SHA256_DIGEST',
          `Artifact "${artifact.id}" has invalid SHA-256 digest "${artifact.sha256}"`
        );
        continue;
      }
      if (artifact.rawContent !== undefined) {
        const computedSha = computeSha256Hex(artifact.rawContent);
        if (computedSha !== artifact.sha256) {
          pushArtifactRejection(
            'EVIDENCE_DIGEST_MISMATCH',
            `Artifact "${artifact.id}" SHA-256 mismatch (declared ${artifact.sha256} !== computed ${computedSha})`
          );
          continue;
        }
        const actualBytes =
          typeof artifact.rawContent === 'string'
            ? Buffer.byteLength(artifact.rawContent, 'utf8')
            : artifact.rawContent.byteLength;
        if (actualBytes !== artifact.sizeBytes) {
          pushArtifactRejection(
            'EVIDENCE_SIZE_MISMATCH',
            `Artifact "${artifact.id}" byte length mismatch (${artifact.sizeBytes} !== ${actualBytes})`
          );
          continue;
        }
      }
      if (artifact.staleAt !== undefined) {
        const staleMs = Date.parse(artifact.staleAt);
        if (!Number.isFinite(staleMs) || staleMs <= nowMs) {
          pushArtifactRejection(
            'STALE_EVIDENCE',
            `Artifact "${artifact.id}" became stale at ${artifact.staleAt}`
          );
          continue;
        }
      }
      if (input.expectedSourceSha !== undefined && artifact.sourceSha !== input.expectedSourceSha) {
        pushArtifactRejection(
          'STALE_SOURCE_SHA',
          `Artifact "${artifact.id}" sourceSha "${artifact.sourceSha ?? 'none'}" !== expected "${input.expectedSourceSha}"`
        );
        continue;
      }

      if (
        criterion.verificationMethod === 'automated_test' &&
        artifact.automatedTestPassed !== true
      ) {
        pushArtifactRejection(
          'DETERMINISTIC_CHECK_FAILED',
          `Criterion "${criterion.code}" automated_test did not pass on artifact "${artifact.id}"`
        );
        continue;
      }

      if (criterion.verificationMethod === 'schema_check') {
        if (criterion.expectedSchema && artifact.structuredPayload !== undefined) {
          const check = validateJsonSchema(criterion.expectedSchema, artifact.structuredPayload);
          if (!check.valid) {
            pushArtifactRejection(
              'DETERMINISTIC_CHECK_FAILED',
              `Criterion "${criterion.code}" schema_check failed: ${check.errors[0]?.message ?? 'invalid'}`
            );
            continue;
          }
        } else if (artifact.schemaValidationPassed !== true) {
          pushArtifactRejection(
            'DETERMINISTIC_CHECK_FAILED',
            `Criterion "${criterion.code}" requires passing schemaValidationPassed flag`
          );
          continue;
        }
      }

      if (
        criterion.verificationMethod === 'source_inspection' &&
        (!artifact.sourceSha || !artifact.sourceSha.trim())
      ) {
        pushArtifactRejection(
          'DETERMINISTIC_CHECK_FAILED',
          `Criterion "${criterion.code}" source_inspection artifact "${artifact.id}" is missing sourceSha`
        );
        continue;
      }

      acceptedArtifactIds.push(artifact.id);
      verifiedArtifactDigests[artifact.id] = artifact.sha256;
    }

    if (
      acceptedArtifactIds.length === 0 &&
      criterion.mandatory &&
      criterionRejections.length === 0
    ) {
      rejectionReasons.push({
        code: 'MISSING_EVIDENCE',
        criterionId: criterion.id,
        message: `Mandatory criterion "${criterion.code}" has no active valid evidence artifacts`,
      });
      criterionRejections.push('MISSING_EVIDENCE');
    }

    criterionResults.push({
      criterionId: criterion.id,
      code: criterion.code,
      mandatory: criterion.mandatory,
      satisfied: acceptedArtifactIds.length > 0 || !criterion.mandatory,
      acceptedArtifactIds,
      rejectionCodes: criterionRejections,
    });
  }

  const needsIndependentReview =
    input.requireIndependentReview ??
    (contract.riskTier !== 'R0' ||
      contract.criteria.some((c) => c.verificationMethod === 'independent_reviewer'));

  let independentVerified = !needsIndependentReview;

  if (needsIndependentReview || input.reviewerDecision) {
    if (input.reviewerUnavailable || !input.reviewerDecision) {
      if (needsIndependentReview) {
        rejectionReasons.push({
          code: 'REVIEWER_UNAVAILABLE',
          message: 'Independent reviewer decision required but reviewer is unavailable',
        });
      }
    } else {
      const reviewer = input.reviewerDecision;
      const reviewerId = String(reviewer.reviewerActorId);
      const isSelfActor = producerActorIds.has(reviewerId);
      const isSameRun =
        reviewer.reviewerRunId !== undefined && producerRunIds.has(reviewer.reviewerRunId);

      if (isSelfActor || isSameRun) {
        rejectionReasons.push({
          code: 'SELF_APPROVAL_REJECTED',
          message: `Worker/producer "${reviewerId}" cannot independently approve its own work`,
        });
      } else if (!reviewer.rationale.trim()) {
        rejectionReasons.push({
          code: 'MISSING_REVIEW_RATIONALE',
          message: 'Independent reviewer decision must include a non-empty rationale',
        });
      } else if (reviewer.decision !== 'approved') {
        rejectionReasons.push({
          code: 'REVIEWER_REJECTED',
          message: `Independent reviewer rejected work: ${reviewer.rationale}`,
        });
      } else {
        independentVerified = true;
      }
    }
  }

  const needsHumanSignoff =
    input.requireHumanSignoff ??
    (contract.riskTier === 'R2' ||
      contract.riskTier === 'R3' ||
      contract.criteria.some((c) => c.verificationMethod === 'human_decision'));

  let humanSignoffVerified = !needsHumanSignoff;
  if (needsHumanSignoff) {
    if (!input.humanSignoff) {
      rejectionReasons.push({
        code: 'HUMAN_SIGNOFF_REQUIRED',
        message: `Risk tier ${contract.riskTier} requires explicit human sign-off`,
      });
    } else if (producerActorIds.has(String(input.humanSignoff.userId))) {
      rejectionReasons.push({
        code: 'SELF_APPROVAL_REJECTED',
        message: 'Human sign-off actor cannot be the producer identity',
      });
    } else if (!input.humanSignoff.approved || !input.humanSignoff.rationale.trim()) {
      rejectionReasons.push({
        code: 'HUMAN_SIGNOFF_REJECTED',
        message: 'Human sign-off was rejected or missing rationale',
      });
    } else {
      humanSignoffVerified = true;
    }
  }

  let checkMatrix: PcwCheckMatrixSummary | undefined;
  if (input.checks !== undefined) {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let notApplicable = 0;
    let notRun = 0;
    const hasHumanWaiver =
      input.humanSignoff?.approved === true && input.humanSignoff.rationale.trim().length > 0;

    for (const check of input.checks) {
      if (check.status === 'pass') passed += 1;
      else if (check.status === 'fail') failed += 1;
      else if (check.status === 'skipped') skipped += 1;
      else if (check.status === 'not_applicable') notApplicable += 1;
      else if (check.status === 'not_run') notRun += 1;

      if (
        (check.status === 'skipped' || check.status === 'not_applicable') &&
        (!check.reason || check.reason.trim().length === 0)
      ) {
        rejectionReasons.push({
          code: 'MISSING_SKIP_REASON',
          artifactId: check.artifactId,
          message: `Check "${check.code}" with status "${check.status}" requires a non-empty reason`,
        });
      }

      const mandatory = check.mandatory ?? true;
      if (
        mandatory &&
        (check.status === 'fail' || check.status === 'skipped' || check.status === 'not_run')
      ) {
        rejectionReasons.push({
          code: 'MANDATORY_CHECK_NOT_PASSED',
          artifactId: check.artifactId,
          message: `Mandatory check "${check.code}" did not pass (status: ${check.status})`,
        });
      } else if (mandatory && check.status === 'not_applicable' && !hasHumanWaiver) {
        rejectionReasons.push({
          code: 'MANDATORY_CHECK_NOT_PASSED',
          artifactId: check.artifactId,
          message: `Mandatory check "${check.code}" marked not_applicable requires approved human sign-off with rationale`,
        });
      } else if (!mandatory && check.status === 'fail') {
        rejectionReasons.push({
          code: 'MANDATORY_CHECK_NOT_PASSED',
          artifactId: check.artifactId,
          message: `Non-mandatory check "${check.code}" failed`,
        });
      }
    }

    checkMatrix = {
      total: input.checks.length,
      passed,
      failed,
      skipped,
      notApplicable,
      notRun,
      records: [...input.checks],
    };
  }

  let diffScope: PcwDiffScopeResult | undefined;
  if (input.changedFiles !== undefined && input.allowedScopePaths !== undefined) {
    diffScope = validateDiffScope(
      input.changedFiles,
      input.allowedScopePaths,
      input.forbiddenScopePaths
    );
    if (!diffScope.scopeClean) {
      rejectionReasons.push({
        code: 'OUT_OF_SCOPE_DIFF_DETECTED',
        message: `Out-of-scope or unsafe diff paths detected: ${diffScope.outOfScopeFiles.join(', ')}`,
      });
    }
  }

  const allMandatorySatisfied = criterionResults.every((item) => !item.mandatory || item.satisfied);
  const accepted =
    contract.criteria.length > 0 &&
    allMandatorySatisfied &&
    independentVerified &&
    humanSignoffVerified &&
    rejectionReasons.length === 0;

  const reportBase = {
    contractId: contract.id,
    companyId: contract.companyId,
    accepted,
    status: (accepted ? 'accepted' : 'rejected') as 'accepted' | 'rejected',
    verifiedAt: new Date(nowMs).toISOString(),
    criterionResults,
    rejectionReasons,
    verifiedArtifactDigests,
    reviewerAudit: {
      required: needsIndependentReview,
      reviewerActorId: input.reviewerDecision?.reviewerActorId,
      independentVerified,
      humanSignoffVerified,
    },
    ...(checkMatrix !== undefined ? { checkMatrix } : {}),
    ...(diffScope !== undefined ? { diffScope } : {}),
  };

  return {
    ...reportBase,
    reportSha256: createHash('sha256').update(JSON.stringify(reportBase)).digest('hex'),
  };
}

export type ObligationTriggerKind =
  'code_change' | 'source_change' | 'policy_change' | 'time_expiry' | 'manual';

export type ObligationStatus =
  'open' | 'reverification_due' | 'satisfied' | 'superseded' | 'retired';

export interface ObligationRecord {
  readonly id: string;
  readonly companyId: number;
  readonly code: string;
  readonly originContractId: string;
  readonly originArtifactId?: string;
  readonly ownerActorId: string | number;
  readonly triggerKind: ObligationTriggerKind;
  readonly impactLinks: readonly string[];
  readonly requiredEvidence: string;
  readonly status: ObligationStatus;
  readonly dueAt?: string;
  readonly lastVerifiedAt?: string;
  readonly decisionRationale?: string;
  readonly evidenceRef?: string;
  readonly supersededByObligationId?: string;
}

export interface ObligationTimelineEvent {
  readonly sequence: number;
  readonly obligationId: string;
  readonly companyId: number;
  readonly timestamp: string;
  readonly eventType:
    | 'created'
    | 'reverification_triggered'
    | 'satisfied'
    | 'superseded'
    | 'retired'
    | 'contract_close_checked';
  readonly actorId: string | number;
  readonly detail: string;
}

export interface ObligationTriggerEvent {
  readonly companyId: number;
  readonly triggerKind: ObligationTriggerKind;
  readonly actorId: string | number;
  readonly affectedImpacts?: readonly string[];
  readonly reason: string;
  readonly timestamp?: string;
}

export class ObligationContinuityLedger {
  private readonly obligations = new Map<string, ObligationRecord>();
  private readonly timeline: ObligationTimelineEvent[] = [];
  private readonly clock: Clock;
  private seq = 1;

  constructor(clock: Clock = SYSTEM_CLOCK) {
    this.clock = clock;
  }

  private appendTimeline(event: Omit<ObligationTimelineEvent, 'sequence'>): void {
    this.timeline.push({
      sequence: this.seq++,
      ...event,
    });
  }

  registerObligation(
    record: Omit<ObligationRecord, 'status'> & { readonly status?: ObligationStatus }
  ): ObligationRecord {
    const created: ObligationRecord = {
      ...record,
      status: record.status ?? 'open',
    };
    this.obligations.set(created.id, created);
    this.appendTimeline({
      obligationId: created.id,
      companyId: created.companyId,
      timestamp: new Date(this.clock.now()).toISOString(),
      eventType: 'created',
      actorId: created.ownerActorId,
      detail: `Registered obligation "${created.code}" (${created.triggerKind})`,
    });
    return created;
  }

  getObligation(id: string): ObligationRecord | undefined {
    return this.obligations.get(id);
  }

  listCompanyObligations(companyId: number): readonly ObligationRecord[] {
    return [...this.obligations.values()].filter((ob) => ob.companyId === companyId);
  }

  evaluateTrigger(event: ObligationTriggerEvent): readonly ObligationRecord[] {
    const nowIso = event.timestamp ?? new Date(this.clock.now()).toISOString();
    const nowMs = Date.parse(nowIso);
    const impacts = new Set(event.affectedImpacts ?? []);
    const reopened: ObligationRecord[] = [];

    for (const [id, ob] of this.obligations.entries()) {
      if (ob.companyId !== event.companyId) continue;
      if (ob.status === 'superseded' || ob.status === 'retired') continue;

      let matches = false;
      if (event.triggerKind === 'time_expiry') {
        if (ob.dueAt !== undefined && Date.parse(ob.dueAt) <= nowMs) {
          matches = true;
        }
      } else if (ob.triggerKind === event.triggerKind || event.triggerKind === 'manual') {
        if (impacts.size === 0) {
          matches = true;
        } else {
          matches = ob.impactLinks.some(
            (link) => impacts.has(link) || [...impacts].some((target) => target.startsWith(link))
          );
        }
      }

      if (!matches) continue;

      const updated: ObligationRecord = {
        ...ob,
        status: 'reverification_due',
        decisionRationale: event.reason,
      };
      this.obligations.set(id, updated);
      this.appendTimeline({
        obligationId: id,
        companyId: ob.companyId,
        timestamp: nowIso,
        eventType: 'reverification_triggered',
        actorId: event.actorId,
        detail: `${event.triggerKind}: ${event.reason}`,
      });
      reopened.push(updated);
    }

    return reopened;
  }

  satisfyObligation(params: {
    readonly obligationId: string;
    readonly companyId: number;
    readonly verifiedBy: string | number;
    readonly evidenceRef: string;
    readonly rationale: string;
  }): ObligationRecord {
    const existing = this.obligations.get(params.obligationId);
    if (!existing || existing.companyId !== params.companyId) {
      throw new Error(
        `Obligation "${params.obligationId}" not found for company ${params.companyId}`
      );
    }
    if (!params.evidenceRef.trim() || !params.rationale.trim()) {
      throw new Error('Satisfying an obligation requires evidenceRef and rationale');
    }
    if (existing.status === 'superseded' || existing.status === 'retired') {
      throw new Error(
        `Cannot satisfy closed obligation "${params.obligationId}" (${existing.status})`
      );
    }
    const nowIso = new Date(this.clock.now()).toISOString();
    const updated: ObligationRecord = {
      ...existing,
      status: 'satisfied',
      lastVerifiedAt: nowIso,
      evidenceRef: params.evidenceRef,
      decisionRationale: params.rationale,
    };
    this.obligations.set(existing.id, updated);
    this.appendTimeline({
      obligationId: existing.id,
      companyId: existing.companyId,
      timestamp: nowIso,
      eventType: 'satisfied',
      actorId: params.verifiedBy,
      detail: `Verified with evidence "${params.evidenceRef}": ${params.rationale}`,
    });
    return updated;
  }

  /**
   * Checks whether a work contract can close without leaving unresolved obligations.
   * Normal contract closure NEVER deletes open or reverification_due obligations.
   */
  attemptCloseContract(
    companyId: number,
    contractId: string,
    actorId: string | number = 'system'
  ): {
    readonly contractId: string;
    readonly hasUnresolvedObligations: boolean;
    readonly unresolvedObligations: readonly ObligationRecord[];
    readonly preservedInLedger: true;
  } {
    const unresolved = [...this.obligations.values()].filter(
      (ob) =>
        ob.companyId === companyId &&
        ob.originContractId === contractId &&
        (ob.status === 'open' || ob.status === 'reverification_due')
    );

    const nowIso = new Date(this.clock.now()).toISOString();
    for (const ob of unresolved) {
      this.appendTimeline({
        obligationId: ob.id,
        companyId,
        timestamp: nowIso,
        eventType: 'contract_close_checked',
        actorId,
        detail: `Contract "${contractId}" closure checked; continuing obligation "${ob.code}" retained as ${ob.status}`,
      });
    }

    return {
      contractId,
      hasUnresolvedObligations: unresolved.length > 0,
      unresolvedObligations: unresolved,
      preservedInLedger: true,
    };
  }

  supersedeOrRetireObligation(params: {
    readonly obligationId: string;
    readonly companyId: number;
    readonly action: 'supersede' | 'retire';
    readonly actorId: string | number;
    readonly rationale: string;
    readonly evidenceRef: string;
    readonly supersededByObligationId?: string;
  }): ObligationRecord {
    const existing = this.obligations.get(params.obligationId);
    if (!existing || existing.companyId !== params.companyId) {
      throw new Error(
        `Obligation "${params.obligationId}" not found for company ${params.companyId}`
      );
    }
    if (!params.rationale.trim() || !params.evidenceRef.trim()) {
      throw new Error('Superseding or retiring an obligation requires rationale and evidenceRef');
    }
    if (params.action === 'supersede' && !params.supersededByObligationId) {
      throw new Error('Superseding an obligation requires supersededByObligationId');
    }
    const nowIso = new Date(this.clock.now()).toISOString();
    const status: ObligationStatus = params.action === 'supersede' ? 'superseded' : 'retired';
    const updated: ObligationRecord = {
      ...existing,
      status,
      decisionRationale: params.rationale,
      evidenceRef: params.evidenceRef,
      supersededByObligationId: params.supersededByObligationId,
    };
    this.obligations.set(existing.id, updated);
    this.appendTimeline({
      obligationId: existing.id,
      companyId: existing.companyId,
      timestamp: nowIso,
      eventType: status,
      actorId: params.actorId,
      detail: `${status} (evidence=${params.evidenceRef}): ${params.rationale}`,
    });
    return updated;
  }

  getTimelineReport(
    companyId: number,
    filter?: { readonly obligationId?: string; readonly contractId?: string }
  ): readonly ObligationTimelineEvent[] {
    return this.timeline.filter((event) => {
      if (event.companyId !== companyId) return false;
      if (filter?.obligationId && event.obligationId !== filter.obligationId) return false;
      if (filter?.contractId) {
        const ob = this.obligations.get(event.obligationId);
        if (!ob || ob.originContractId !== filter.contractId) return false;
      }
      return true;
    });
  }
}
