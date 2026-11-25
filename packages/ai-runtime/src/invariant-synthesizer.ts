import { sha256Canonical } from './canonical-json.js';
import { createRedactor } from './redaction.js';

export const PROTECTED_CONSTITUTIONAL_GATES = [
  'R0',
  'R1',
  'R2',
  'R3',
  'R4',
  'R0-R4',
  'ai-drift-watchdog',
  'check-desktop-non-overlap',
  'check-api-addon-boundary',
  'check-board-shared-ui',
  'check-m15-invariants',
] as const;

export type ProtectedConstitutionalGate = (typeof PROTECTED_CONSTITUTIONAL_GATES)[number];

export type InvariantSeverity = 'low' | 'medium' | 'high' | 'critical';

export type InvariantRejectionReasonCode =
  'INVALID_INCIDENT_INPUT' | 'PROTECTED_GATE_WEAKENING_FORBIDDEN' | 'AUTOMATED_PROMOTION_FORBIDDEN';

export interface InvariantIncidentInput {
  readonly incidentId: string;
  readonly title: string;
  readonly category: string;
  readonly description: string;
  readonly observedViolation: string;
  readonly expectedInvariant: string;
  readonly severity?: InvariantSeverity;
  readonly targetPaths?: readonly string[];
  readonly affectedGates?: readonly string[];
  readonly companyId?: number;
}

export interface InvariantRuleSpec {
  readonly ruleId: string;
  readonly incidentId: string;
  readonly title: string;
  readonly category: string;
  readonly severity: InvariantSeverity;
  readonly assertion: string;
  readonly observedViolation: string;
  readonly targetPaths: readonly string[];
  readonly protectedGatesPreserved: readonly ProtectedConstitutionalGate[];
  readonly automatedPromotionAllowed: false;
}

export interface InvariantRuleProposalResult {
  readonly accepted: boolean;
  readonly automatedPromotionAllowed: false;
  readonly rejectionReasonCode?: InvariantRejectionReasonCode;
  readonly rejectionReason?: string;
  readonly blockedGates?: readonly string[];
  readonly ruleSpec: InvariantRuleSpec | null;
  readonly testSkeleton: string | null;
  readonly ruleSha256: string;
}

const WEAKENING_ACTION_PATTERN =
  /\b(?:weaken|relax|disable|bypass|remove|skip|suppress|override|exempt|ignore|loosen|turn\s+off|downgrade|auto[-_\s]?promote|self[-_\s]?accept)\b/iu;

const AUTO_PROMOTION_PATTERN =
  /\b(?:automatedPromotionAllowed\s*:\s*true|auto[-_\s]?promote|self[-_\s]?merge|bypass[-_\s]?human[-_\s]?review)\b/iu;

function slugifyIdentifier(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized.length > 0 ? normalized.slice(0, 48) : 'invariant-rule';
}

function escapeJsString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'").replace(/\r?\n/gu, ' ');
}

function detectProtectedGateWeakening(
  combinedText: string,
  affectedGates: readonly string[]
): readonly string[] {
  const hasWeakeningIntent = WEAKENING_ACTION_PATTERN.test(combinedText);
  if (!hasWeakeningIntent) {
    return [];
  }

  const blocked = new Set<string>();
  const lowerCombined = combinedText.toLowerCase();

  for (const gate of PROTECTED_CONSTITUTIONAL_GATES) {
    const gateLower = gate.toLowerCase();
    const pattern = new RegExp(
      `(?:^|[^a-z0-9-])${gateLower.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:$|[^a-z0-9-])`,
      'iu'
    );
    if (pattern.test(lowerCombined)) {
      blocked.add(gate);
    }
  }

  for (const gate of affectedGates) {
    const trimmed = gate.trim();
    const match = PROTECTED_CONSTITUTIONAL_GATES.find(
      (protectedGate) => protectedGate.toLowerCase() === trimmed.toLowerCase()
    );
    if (match) {
      blocked.add(match);
    }
  }

  return Array.from(blocked).sort();
}

function buildNodeTestSkeleton(spec: InvariantRuleSpec): string {
  const safeRuleId = escapeJsString(spec.ruleId);
  const safeTitle = escapeJsString(spec.title);
  const safeAssertion = escapeJsString(spec.assertion);
  const safeViolation = escapeJsString(spec.observedViolation);

  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    '',
    `// Candidate invariant synthesized from incident ${spec.incidentId}`,
    '// automatedPromotionAllowed: false (requires human constitutional review)',
    `test('${safeRuleId}: ${safeTitle}', () => {`,
    `  const expectedInvariant = '${safeAssertion}';`,
    `  const observedViolation = '${safeViolation}';`,
    "  assert.ok(expectedInvariant.length > 0, 'Invariant assertion must be non-empty');",
    '  assert.notStrictEqual(',
    '    observedViolation,',
    '    expectedInvariant,',
    "    'Regression guard: observed violation must remain distinct from expected invariant',",
    '  );',
    '});',
    '',
  ].join('\n');
}

export function synthesizeInvariantRuleProposal(
  incident: InvariantIncidentInput
): InvariantRuleProposalResult {
  const redactor = createRedactor();
  const incidentId = redactor.redactString(incident.incidentId ?? '').trim();
  const title = redactor.redactString(incident.title ?? '').trim();
  const category = redactor.redactString(incident.category ?? '').trim();
  const description = redactor.redactString(incident.description ?? '').trim();
  const observedViolation = redactor.redactString(incident.observedViolation ?? '').trim();
  const expectedInvariant = redactor.redactString(incident.expectedInvariant ?? '').trim();
  const severity: InvariantSeverity = incident.severity ?? 'high';
  const targetPaths = (incident.targetPaths ?? [])
    .map((entry) => redactor.redactString(entry).trim())
    .filter((entry) => entry.length > 0)
    .sort();
  const affectedGates = (incident.affectedGates ?? [])
    .map((entry) => redactor.redactString(entry).trim())
    .filter((entry) => entry.length > 0);

  if (
    !incidentId ||
    !title ||
    !category ||
    !description ||
    !observedViolation ||
    !expectedInvariant
  ) {
    const rejectionPayload = {
      accepted: false,
      automatedPromotionAllowed: false as const,
      incidentId,
      rejectionReasonCode: 'INVALID_INCIDENT_INPUT' as const,
    };
    return {
      accepted: false,
      automatedPromotionAllowed: false,
      rejectionReasonCode: 'INVALID_INCIDENT_INPUT',
      rejectionReason:
        'Incident input must include non-empty incidentId, title, category, description, observedViolation, and expectedInvariant.',
      ruleSpec: null,
      testSkeleton: null,
      ruleSha256: sha256Canonical(rejectionPayload),
    };
  }

  const combinedText = [
    title,
    category,
    description,
    observedViolation,
    expectedInvariant,
    ...affectedGates,
  ].join('\n');

  if (AUTO_PROMOTION_PATTERN.test(combinedText)) {
    const rejectionPayload = {
      accepted: false,
      automatedPromotionAllowed: false as const,
      incidentId,
      rejectionReasonCode: 'AUTOMATED_PROMOTION_FORBIDDEN' as const,
    };
    return {
      accepted: false,
      automatedPromotionAllowed: false,
      rejectionReasonCode: 'AUTOMATED_PROMOTION_FORBIDDEN',
      rejectionReason:
        'Synthesized invariant proposals cannot request automated promotion or bypass human review.',
      ruleSpec: null,
      testSkeleton: null,
      ruleSha256: sha256Canonical(rejectionPayload),
    };
  }

  const blockedGates = detectProtectedGateWeakening(combinedText, affectedGates);
  if (blockedGates.length > 0) {
    const rejectionPayload = {
      accepted: false,
      automatedPromotionAllowed: false as const,
      incidentId,
      rejectionReasonCode: 'PROTECTED_GATE_WEAKENING_FORBIDDEN' as const,
      blockedGates,
    };
    return {
      accepted: false,
      automatedPromotionAllowed: false,
      rejectionReasonCode: 'PROTECTED_GATE_WEAKENING_FORBIDDEN',
      rejectionReason: `Fail-closed rejection: proposal attempts to weaken protected constitutional gate(s): ${blockedGates.join(', ')}.`,
      blockedGates,
      ruleSpec: null,
      testSkeleton: null,
      ruleSha256: sha256Canonical(rejectionPayload),
    };
  }

  const ruleId = `inv-${slugifyIdentifier(category)}-${slugifyIdentifier(incidentId)}`;
  const ruleSpec: InvariantRuleSpec = {
    ruleId,
    incidentId,
    title,
    category,
    severity,
    assertion: expectedInvariant,
    observedViolation,
    targetPaths,
    protectedGatesPreserved: PROTECTED_CONSTITUTIONAL_GATES,
    automatedPromotionAllowed: false,
  };

  const testSkeleton = buildNodeTestSkeleton(ruleSpec);
  const ruleSha256 = sha256Canonical({
    ruleSpec,
    testSkeleton,
    automatedPromotionAllowed: false as const,
  });

  return {
    accepted: true,
    automatedPromotionAllowed: false,
    ruleSpec,
    testSkeleton,
    ruleSha256,
  };
}
