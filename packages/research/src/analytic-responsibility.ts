import { isRecord } from '@moonwitness/types';
import {
  createJsonSchemaValidator,
  hashCanonicalJson,
  type JsonSchemaContract,
  type KnowledgeValidationIssue,
  type KnowledgeValidationResult,
} from '@moonwitness/knowledge';
import analyticSchema from '../../../ontology/domains/analytic-responsibility.schema.json' with { type: 'json' };
import { validateResearchEvidenceReference, type ResearchEvidenceReference } from './evidence.js';

export type AnalyticFactorInputState = 'measured' | 'missing' | 'conflicting' | 'unknown';
export type AnalyticEvidenceReviewStatus = 'accepted' | 'rejected' | 'unreviewed' | 'conflicting';
export type AnalyticEvidenceAccess = 'readable' | 'denied';

export interface TrustedAnalyticEvidenceResolution {
  readonly canonicalEvidence: ResearchEvidenceReference;
  readonly reviewStatus: AnalyticEvidenceReviewStatus;
  readonly access: AnalyticEvidenceAccess;
}

export type TrustedAnalyticEvidenceResolver = (evidenceId: string) => Promise<unknown>;

export interface AnalyticFactorInput {
  readonly factor_key: string;
  readonly input_state: AnalyticFactorInputState;
  readonly weight: number;
  readonly score?: number;
  readonly evidence_ids: readonly `mw:evidence:${string}`[];
  readonly note?: string;
}

export interface AnalyticHumanOverride {
  readonly override_state: 'hold_for_review' | 'advisory_adjustment' | 'mark_unknown';
  readonly adjusted_advisory_band?: 'low' | 'moderate' | 'elevated' | 'unknown';
  readonly reviewer_id: `mw:user:${string}`;
  readonly reviewed_at: string;
  readonly rationale: string;
  readonly evidence_refs: readonly string[];
}

export interface AnalyticResponsibilityScope {
  readonly domain: string;
  readonly context_label: string;
  readonly advisory_purpose: string;
}

export interface AnalyticResponsibilityRequest {
  readonly schema_version: 1;
  readonly request_id: `mw:analytic-request:${string}`;
  readonly policy_profile_id: `mw:profile:${string}`;
  readonly policy_version: string;
  readonly subject_id: string;
  readonly scope: AnalyticResponsibilityScope;
  readonly factors: readonly AnalyticFactorInput[];
  readonly human_override?: AnalyticHumanOverride;
}

export interface AnalyticNormativeBoundary {
  readonly advisory_only: true;
  readonly normative_verdicts_allowed: false;
  readonly certifies_human_worth: false;
  readonly certifies_salvation: false;
  readonly certifies_divine_judgment: false;
  readonly certifies_legal_status: false;
  readonly autonomous_action_allowed: false;
}

export interface AnalyticFactorEvaluation {
  readonly factor_key: string;
  readonly declared_state: AnalyticFactorInputState;
  readonly resolved_state: 'measured' | 'unknown';
  readonly weight: number;
  readonly score: number | null;
  readonly weighted_contribution: number | null;
  readonly evidence_ids: readonly string[];
  readonly uncertainty_reason: string | null;
}

export interface AnalyticResponsibilityEngineConfig {
  readonly enabled?: boolean;
}

export type AnalyticResponsibilityResult =
  | {
      readonly status: 'disabled';
      readonly reason: 'analytic_engine_disabled_by_default';
      readonly policy_profile_id: string;
      readonly policy_version: string;
      readonly normative_boundary: AnalyticNormativeBoundary;
    }
  | {
      readonly status: 'evaluated';
      readonly request_id: string;
      readonly policy_profile_id: string;
      readonly policy_version: string;
      readonly subject_id: string;
      readonly scope: AnalyticResponsibilityScope;
      readonly overall_assessment_state: 'measured_advisory' | 'unknown';
      readonly numeric_aggregate: number | null;
      readonly advisory_band: 'low' | 'moderate' | 'elevated' | 'unknown';
      readonly factors: readonly AnalyticFactorEvaluation[];
      readonly human_override: AnalyticHumanOverride | null;
      readonly uncertainty_notes: readonly string[];
      readonly normative_boundary: AnalyticNormativeBoundary;
      readonly output_digest: string;
    };

export type AnalyticResponsibilityErrorCode =
  'INVALID_ANALYTIC_REQUEST' | 'INPUT_MUTATED' | 'RESOLVER_ERROR';

export class AnalyticResponsibilityError extends Error {
  readonly code: AnalyticResponsibilityErrorCode;
  readonly issues: readonly KnowledgeValidationIssue[];

  constructor(
    code: AnalyticResponsibilityErrorCode,
    message: string,
    issues: readonly KnowledgeValidationIssue[] = []
  ) {
    super(message);
    this.name = 'AnalyticResponsibilityError';
    this.code = code;
    this.issues = issues;
  }
}

const NORMATIVE_BOUNDARY: AnalyticNormativeBoundary = Object.freeze({
  advisory_only: true,
  normative_verdicts_allowed: false,
  certifies_human_worth: false,
  certifies_salvation: false,
  certifies_divine_judgment: false,
  certifies_legal_status: false,
  autonomous_action_allowed: false,
});

const validateSchema = createJsonSchemaValidator(
  analyticSchema as unknown as JsonSchemaContract,
  'does not match the scoped analytic responsibility contract'
);

/** Validate analytic responsibility request structure, factor weights, and evidence prerequisites. */
export function validateAnalyticResponsibilityRequest(value: unknown): KnowledgeValidationResult {
  const structural = validateSchema(value);
  if (!structural.valid) return structural;

  const req = value as AnalyticResponsibilityRequest;
  const issues: KnowledgeValidationIssue[] = [];
  const seenKeys = new Set<string>();
  let totalWeight = 0;

  for (const [index, factor] of req.factors.entries()) {
    const basePath = `/factors/${index}`;
    if (seenKeys.has(factor.factor_key)) {
      issues.push({
        path: `${basePath}/factor_key`,
        keyword: 'unique_factor_key',
        message: `duplicate factor_key "${factor.factor_key}"`,
      });
    }
    seenKeys.add(factor.factor_key);

    if (!Number.isFinite(factor.weight) || factor.weight <= 0) {
      issues.push({
        path: `${basePath}/weight`,
        keyword: 'exclusiveMinimum',
        message: 'factor weight must be a finite number strictly greater than 0',
      });
    } else {
      totalWeight += factor.weight;
    }

    if (factor.input_state === 'measured') {
      if (typeof factor.score !== 'number' || !Number.isFinite(factor.score)) {
        issues.push({
          path: `${basePath}/score`,
          keyword: 'required',
          message: 'measured factor requires a finite numeric score in [0, 1]',
        });
      }
      if (factor.evidence_ids.length === 0) {
        issues.push({
          path: `${basePath}/evidence_ids`,
          keyword: 'minItems',
          message: 'measured factor must bind to at least one canonical evidence_id',
        });
      }
    } else if (factor.score !== undefined) {
      issues.push({
        path: `${basePath}/score`,
        keyword: 'non_measured_score_forbidden',
        message: `factor with input_state "${factor.input_state}" must not supply a numeric score`,
      });
    }
  }

  if (Math.abs(totalWeight - 1) > 1e-6) {
    issues.push({
      path: '/factors',
      keyword: 'weight_sum',
      message: `factor weights must sum to 1.0 (received ${totalWeight})`,
    });
  }

  if (
    req.human_override?.override_state === 'advisory_adjustment' &&
    req.human_override.adjusted_advisory_band === undefined
  ) {
    issues.push({
      path: '/human_override/adjusted_advisory_band',
      keyword: 'required',
      message: 'advisory_adjustment override requires adjusted_advisory_band',
    });
  }

  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

function bandForAggregate(aggregate: number): 'low' | 'moderate' | 'elevated' {
  if (aggregate < 0.34) return 'low';
  if (aggregate < 0.67) return 'moderate';
  return 'elevated';
}

/**
 * Evaluate scoped, non-normative analytic responsibility factors. Disabled by
 * default unless `config.enabled === true`. Missing, unreviewed, conflicting, or
 * denied evidence keeps outputs `unknown` rather than coercing to zero.
 */
export async function evaluateScopedAnalyticResponsibility(
  value: unknown,
  resolveTrustedEvidence: TrustedAnalyticEvidenceResolver,
  config: AnalyticResponsibilityEngineConfig = {}
): Promise<AnalyticResponsibilityResult> {
  const validation = validateAnalyticResponsibilityRequest(value);
  if (!validation.valid) {
    throw new AnalyticResponsibilityError(
      'INVALID_ANALYTIC_REQUEST',
      'Scoped analytic responsibility request failed validation',
      validation.issues
    );
  }

  let snapshotHash: string;
  let request: AnalyticResponsibilityRequest;
  try {
    snapshotHash = hashCanonicalJson(value);
    request = JSON.parse(JSON.stringify(value)) as AnalyticResponsibilityRequest;
  } catch {
    throw new AnalyticResponsibilityError(
      'INVALID_ANALYTIC_REQUEST',
      'Analytic responsibility request could not be canonically snapshotted'
    );
  }

  if (config.enabled !== true) {
    return {
      status: 'disabled',
      reason: 'analytic_engine_disabled_by_default',
      policy_profile_id: request.policy_profile_id,
      policy_version: request.policy_version,
      normative_boundary: NORMATIVE_BOUNDARY,
    };
  }

  const evaluations: AnalyticFactorEvaluation[] = [];
  const uncertaintyNotes: string[] = [];

  for (const factor of request.factors) {
    if (factor.input_state !== 'measured') {
      const reason = `factor "${factor.factor_key}" declared as ${factor.input_state}`;
      uncertaintyNotes.push(reason);
      evaluations.push({
        factor_key: factor.factor_key,
        declared_state: factor.input_state,
        resolved_state: 'unknown',
        weight: factor.weight,
        score: null,
        weighted_contribution: null,
        evidence_ids: [...factor.evidence_ids],
        uncertainty_reason: reason,
      });
      continue;
    }

    let evidenceProblem: string | null = null;
    for (const evidenceId of factor.evidence_ids) {
      let resolved: unknown;
      try {
        resolved = await resolveTrustedEvidence(evidenceId);
      } catch {
        evidenceProblem = `evidence resolver failed for "${evidenceId}"`;
        break;
      }
      if (
        !isRecord(resolved) ||
        !isRecord(resolved.canonicalEvidence) ||
        !validateResearchEvidenceReference(resolved.canonicalEvidence).valid ||
        resolved.canonicalEvidence.id !== evidenceId
      ) {
        evidenceProblem = `evidence "${evidenceId}" missing or invalid`;
        break;
      }
      if (resolved.access !== 'readable') {
        evidenceProblem = `evidence "${evidenceId}" access denied`;
        break;
      }
      if (resolved.reviewStatus !== 'accepted') {
        evidenceProblem = `evidence "${evidenceId}" review status is "${String(resolved.reviewStatus)}"`;
        break;
      }
    }

    if (evidenceProblem !== null) {
      uncertaintyNotes.push(evidenceProblem);
      evaluations.push({
        factor_key: factor.factor_key,
        declared_state: factor.input_state,
        resolved_state: 'unknown',
        weight: factor.weight,
        score: null,
        weighted_contribution: null,
        evidence_ids: [...factor.evidence_ids],
        uncertainty_reason: evidenceProblem,
      });
      continue;
    }

    const score = factor.score as number;
    const weighted = Number((factor.weight * score).toFixed(6));
    evaluations.push({
      factor_key: factor.factor_key,
      declared_state: factor.input_state,
      resolved_state: 'measured',
      weight: factor.weight,
      score,
      weighted_contribution: weighted,
      evidence_ids: [...factor.evidence_ids],
      uncertainty_reason: null,
    });
  }

  try {
    if (hashCanonicalJson(value) !== snapshotHash) {
      throw new AnalyticResponsibilityError(
        'INPUT_MUTATED',
        'Analytic responsibility request was mutated during evidence resolution'
      );
    }
  } catch (error) {
    if (error instanceof AnalyticResponsibilityError) throw error;
    throw new AnalyticResponsibilityError(
      'INPUT_MUTATED',
      'Analytic responsibility request became unserializable during evaluation'
    );
  }

  const allMeasured = evaluations.every((item) => item.resolved_state === 'measured');
  const numericAggregate = allMeasured
    ? Number(
        evaluations.reduce((sum, item) => sum + (item.weighted_contribution ?? 0), 0).toFixed(6)
      )
    : null;

  let overallState: 'measured_advisory' | 'unknown' = allMeasured ? 'measured_advisory' : 'unknown';
  let advisoryBand: 'low' | 'moderate' | 'elevated' | 'unknown' =
    numericAggregate !== null ? bandForAggregate(numericAggregate) : 'unknown';

  if (request.human_override) {
    if (request.human_override.override_state === 'mark_unknown') {
      overallState = 'unknown';
      advisoryBand = 'unknown';
      uncertaintyNotes.push(`human_override: ${request.human_override.rationale}`);
    } else if (
      request.human_override.override_state === 'advisory_adjustment' &&
      request.human_override.adjusted_advisory_band
    ) {
      advisoryBand = request.human_override.adjusted_advisory_band;
      uncertaintyNotes.push(`human_override: ${request.human_override.rationale}`);
    } else {
      uncertaintyNotes.push(`human_override_hold: ${request.human_override.rationale}`);
    }
  }

  const unsignedResult = {
    status: 'evaluated' as const,
    request_id: request.request_id,
    policy_profile_id: request.policy_profile_id,
    policy_version: request.policy_version,
    subject_id: request.subject_id,
    scope: request.scope,
    overall_assessment_state: overallState,
    numeric_aggregate: numericAggregate,
    advisory_band: advisoryBand,
    factors: evaluations,
    human_override: request.human_override ?? null,
    uncertainty_notes: uncertaintyNotes,
    normative_boundary: NORMATIVE_BOUNDARY,
  };

  return {
    ...unsignedResult,
    output_digest: hashCanonicalJson(unsignedResult),
  };
}
