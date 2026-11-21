import { createHash } from 'node:crypto';
import {
  createJsonSchemaValidator,
  hashCanonicalJson,
  type JsonSchemaContract,
  type KnowledgeValidationResult,
} from '@moonwitness/knowledge';
import gateSchema from './child-protection-gate.schema.json' with { type: 'json' };
import type { ResearchVisibility } from './relation.js';

export type ProtectionDisclosureChannel =
  | 'internal_review'
  | 'escalation_review'
  | 'public_projection'
  | 'public_url'
  | 'search_index'
  | 'ai_prompt'
  | 'analytics'
  | 'log_output';

export interface SafeguardingEscalationApproval {
  readonly safeguarding_owner_id: `mw:user:${string}`;
  readonly reviewer_id: `mw:user:${string}`;
  readonly requester_id: `mw:user:${string}`;
  readonly escalation_reason: string;
  readonly approved_at: string;
  readonly decision_ref: string;
}

export interface PublicationRiskApproval {
  readonly reviewer_id: `mw:user:${string}`;
  readonly requester_id: `mw:user:${string}`;
  readonly minimized: boolean;
  readonly source_revision_sha256: string;
  readonly projection_revision_sha256: string;
  readonly decision_ref: string;
}

export interface ChildProtectionGateInput {
  readonly schema_version: 1;
  readonly record_id: string;
  readonly classification: ResearchVisibility;
  readonly inherited_classifications: readonly ResearchVisibility[];
  readonly program_slot?: number;
  readonly minor_involved: boolean;
  readonly synthetic: boolean;
  readonly requested_channel: ProtectionDisclosureChannel;
  readonly safeguarding_process_approved: boolean;
  readonly escalation_approval?: SafeguardingEscalationApproval;
  readonly publication_approval?: PublicationRiskApproval;
  readonly candidate_payload: Readonly<Record<string, unknown>>;
}

export type ChildProtectionDenialReason =
  | 'invalid_gate_input'
  | 'public_projection_denied_by_default'
  | 'child_sensitive_channel_forbidden'
  | 'safeguarding_process_not_approved'
  | 'non_synthetic_minor_record_blocked'
  | 'minor_identifiers_detected'
  | 'escalation_approval_required'
  | 'publication_approval_required'
  | 'self_approval_forbidden'
  | 'unminimized_publication_blocked';

export interface ChildProtectionAuditSummary {
  readonly record_id_sha256: string;
  readonly effective_classification: ResearchVisibility;
  readonly requested_channel: ProtectionDisclosureChannel;
  readonly allowed: boolean;
  readonly reasons: readonly ChildProtectionDenialReason[];
  readonly decision_digest: string;
}

export interface ChildProtectionGateDecision {
  readonly allowed: boolean;
  readonly effective_classification: ResearchVisibility;
  readonly reasons: readonly ChildProtectionDenialReason[];
  readonly detected_minor_identifier_paths: readonly string[];
  readonly audit_summary: ChildProtectionAuditSummary;
}

const validateSchema = createJsonSchemaValidator(
  gateSchema as unknown as JsonSchemaContract,
  'does not match the child protection and publication risk gate contract'
);

const SENSITIVITY_RANK: Readonly<Record<ResearchVisibility, number>> = {
  PUBLIC_APPROVED: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
  CHILD_SENSITIVE: 4,
};

const HIGH_RISK_EXTERNAL_CHANNELS = new Set<ProtectionDisclosureChannel>([
  'public_projection',
  'public_url',
  'search_index',
  'ai_prompt',
  'analytics',
  'log_output',
]);

const PROHIBITED_MINOR_KEY_PATTERN =
  /^(?:child_?name|minor_?name|student_?name|guardian_?(?:name|phone|email)|date_of_birth|dob|birth_?date|school_?name|home_?address|address|phone|mobile|email|national_?id|passport|ssn|gps|coordinates|raw_allegation|minor_?id|child_?id)$/iu;

const ISO_DATE_OR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/u;

const PROHIBITED_VALUE_PATTERNS: readonly RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?:\+\d[\d\s-]{6,}\d|\b0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/u,
];

const MAX_SCAN_DEPTH = 12;

/**
 * Deep-scan a candidate payload for minor-identifying field names or PII-like
 * email/phone values. Always returns sorted unique JSON paths.
 */
export function containsProhibitedMinorIdentifiers(payload: unknown): string[] {
  const paths = new Set<string>();
  const seen = new Set<object>();

  function scan(node: unknown, currentPath: string, depth: number): void {
    if (depth > MAX_SCAN_DEPTH) {
      paths.add(currentPath || '/');
      return;
    }
    if (typeof node === 'string') {
      if (!ISO_DATE_OR_TIMESTAMP.test(node)) {
        for (const pattern of PROHIBITED_VALUE_PATTERNS) {
          if (pattern.test(node)) {
            paths.add(currentPath || '/');
            break;
          }
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      if (seen.has(node)) return;
      seen.add(node);
      for (const [index, entry] of node.entries()) {
        scan(entry, `${currentPath}/${index}`, depth + 1);
      }
      seen.delete(node);
      return;
    }
    if (node !== null && typeof node === 'object') {
      if (seen.has(node)) return;
      seen.add(node);
      for (const key of Object.keys(node)) {
        const nextPath = `${currentPath}/${key}`;
        if (PROHIBITED_MINOR_KEY_PATTERN.test(key)) {
          paths.add(nextPath);
        }
        scan((node as Record<string, unknown>)[key], nextPath, depth + 1);
      }
      seen.delete(node);
    }
  }

  scan(payload, '', 0);
  return [...paths].sort();
}

/** Validate gate input shape strictly. */
export function validateChildProtectionGateInput(value: unknown): KnowledgeValidationResult {
  return validateSchema(value);
}

function maxClassification(input: ChildProtectionGateInput): ResearchVisibility {
  let effective: ResearchVisibility = input.classification;
  for (const inherited of input.inherited_classifications) {
    if (SENSITIVITY_RANK[inherited] > SENSITIVITY_RANK[effective]) {
      effective = inherited;
    }
  }
  if (input.minor_involved || input.program_slot === 13) {
    effective = 'CHILD_SENSITIVE';
  }
  return effective;
}

function buildDecision(
  recordId: string,
  effectiveClassification: ResearchVisibility,
  requestedChannel: ProtectionDisclosureChannel,
  reasons: readonly ChildProtectionDenialReason[],
  detectedPaths: readonly string[]
): ChildProtectionGateDecision {
  const uniqueReasons = [...new Set(reasons)];
  const allowed = uniqueReasons.length === 0;
  const unsignedAudit = {
    record_id_sha256: createHash('sha256').update(recordId, 'utf8').digest('hex'),
    effective_classification: effectiveClassification,
    requested_channel: requestedChannel,
    allowed,
    reasons: uniqueReasons,
  };
  return {
    allowed,
    effective_classification: effectiveClassification,
    reasons: uniqueReasons,
    detected_minor_identifier_paths: detectedPaths,
    audit_summary: {
      ...unsignedAudit,
      decision_digest: hashCanonicalJson(unsignedAudit),
    },
  };
}

/**
 * Evaluate fail-closed minor-safety and publication risk gates.
 * - Classification inherits upward without downgrade; slot 13 or `minor_involved` forces `CHILD_SENSITIVE`.
 * - `PUBLIC_APPROVED` projection is denied by default unless explicit non-self-approved, minimized
 *   publication approval is present and effective classification is `PUBLIC_APPROVED`.
 * - `CHILD_SENSITIVE` / minor-involved records are unconditionally forbidden on public URLs,
 *   public projections, search indexes, AI prompts, analytics, and logs, and denied internally
 *   until `safeguarding_process_approved === true` with an independent escalation review.
 */
export function evaluateChildProtectionAndPublicationGate(
  value: unknown
): ChildProtectionGateDecision {
  const structural = validateSchema(value);
  if (!structural.valid) {
    return buildDecision(
      'invalid',
      'CHILD_SENSITIVE',
      'public_projection',
      ['invalid_gate_input'],
      []
    );
  }

  const input = JSON.parse(JSON.stringify(value)) as ChildProtectionGateInput;
  const effective = maxClassification(input);
  const detectedPaths = containsProhibitedMinorIdentifiers(input.candidate_payload);
  const reasons: ChildProtectionDenialReason[] = [];

  if (effective === 'CHILD_SENSITIVE' || input.minor_involved) {
    if (HIGH_RISK_EXTERNAL_CHANNELS.has(input.requested_channel)) {
      reasons.push('child_sensitive_channel_forbidden');
    }
    if (detectedPaths.length > 0) {
      reasons.push('minor_identifiers_detected');
    }
    if (!input.safeguarding_process_approved) {
      reasons.push('safeguarding_process_not_approved');
    }
    if (!input.synthetic) {
      reasons.push('non_synthetic_minor_record_blocked');
    }
    const esc = input.escalation_approval;
    if (!esc) {
      reasons.push('escalation_approval_required');
    } else if (esc.reviewer_id === esc.requester_id) {
      reasons.push('self_approval_forbidden');
    }
    return buildDecision(
      input.record_id,
      effective,
      input.requested_channel,
      reasons,
      detectedPaths
    );
  }

  // Non-child records: public channels deny by default unless PUBLIC_APPROVED + reviewed publication approval.
  if (HIGH_RISK_EXTERNAL_CHANNELS.has(input.requested_channel)) {
    if (effective !== 'PUBLIC_APPROVED') {
      reasons.push('public_projection_denied_by_default');
    }
    if (
      input.requested_channel === 'public_projection' ||
      input.requested_channel === 'public_url'
    ) {
      const pub = input.publication_approval;
      if (!pub) {
        reasons.push('publication_approval_required');
      } else {
        if (!pub.minimized) {
          reasons.push('unminimized_publication_blocked');
        }
        if (pub.reviewer_id === pub.requester_id) {
          reasons.push('self_approval_forbidden');
        }
      }
    }
    if (detectedPaths.length > 0) {
      reasons.push('minor_identifiers_detected');
    }
  }

  return buildDecision(input.record_id, effective, input.requested_channel, reasons, detectedPaths);
}
