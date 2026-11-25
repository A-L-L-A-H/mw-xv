import { sha256Canonical } from './canonical-json.js';
import { createRedactor } from './redaction.js';

export type PolicyActionEffect = 'allow' | 'deny';

export interface PolicyRuleSpec {
  readonly ruleId: string;
  readonly actionPattern: string;
  readonly resourcePattern: string;
  readonly effect: PolicyActionEffect;
  readonly maxRiskTier?: number;
}

export interface AdversarialActionSample {
  readonly sampleIndex: number;
  readonly action: string;
  readonly resource: string;
  readonly riskTier: number;
  readonly boundaryProbe: boolean;
}

export type PolicyFuzzFindingKind = 'contradiction' | 'shadow_allow_regression' | 'boundary_escape';

export interface PolicyFuzzFinding {
  readonly kind: PolicyFuzzFindingKind;
  readonly sample: AdversarialActionSample;
  readonly baselineEffect: PolicyActionEffect;
  readonly candidateEffect: PolicyActionEffect;
  readonly matchedRuleIds: readonly string[];
  readonly detail: string;
}

export interface PolicyFuzzerOptions {
  readonly seed?: number;
  readonly iterations?: number;
  readonly forbiddenBoundaryResources?: readonly string[];
}

export interface PolicyFuzzReport {
  readonly seed: number;
  readonly iterations: number;
  readonly passed: boolean;
  readonly contradictionCount: number;
  readonly shadowAllowCount: number;
  readonly boundaryEscapeCount: number;
  readonly findings: readonly PolicyFuzzFinding[];
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly fuzzReportSha256: string;
}

const DEFAULT_SEED = 1337;
const DEFAULT_ITERATIONS = 100;

const ADVERSARIAL_ACTIONS = [
  'repo.read',
  'repo.write',
  'repo.merge',
  'secret.read',
  'shell.exec',
  'network.egress',
  'policy.promote',
  'sandbox.escape',
] as const;

const ADVERSARIAL_RESOURCES = [
  'workspace/src/app.ts',
  'workspace/.env',
  '../../etc/passwd',
  'secrets/prod-key',
  'git/main',
  'network://169.254.169.254/latest/meta-data',
  'policy/constitution',
  'workspace/tests/unit.test.ts',
] as const;

const DEFAULT_FORBIDDEN_BOUNDARY_RESOURCES = [
  '../../etc/passwd',
  'secrets/prod-key',
  'workspace/.env',
  'network://169.254.169.254/latest/meta-data',
  'policy/constitution',
] as const;

export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === '*') {
    return true;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*');
  return new RegExp(`^${escaped}$`, 'u').test(value);
}

function evaluateRules(
  rules: readonly PolicyRuleSpec[],
  sample: AdversarialActionSample
): {
  readonly effect: PolicyActionEffect;
  readonly matchedAllowIds: readonly string[];
  readonly matchedDenyIds: readonly string[];
} {
  const matchedAllowIds: string[] = [];
  const matchedDenyIds: string[] = [];

  for (const rule of rules) {
    const actionMatch = wildcardMatch(rule.actionPattern, sample.action);
    const resourceMatch = wildcardMatch(rule.resourcePattern, sample.resource);
    const tierMatch = rule.maxRiskTier === undefined || sample.riskTier <= rule.maxRiskTier;
    if (actionMatch && resourceMatch && tierMatch) {
      if (rule.effect === 'allow') {
        matchedAllowIds.push(rule.ruleId);
      } else {
        matchedDenyIds.push(rule.ruleId);
      }
    }
  }

  // Fail-closed: deny takes precedence over allow; default is deny.
  const effect: PolicyActionEffect =
    matchedDenyIds.length > 0 ? 'deny' : matchedAllowIds.length > 0 ? 'allow' : 'deny';

  return { effect, matchedAllowIds, matchedDenyIds };
}

export function fuzzPolicyInvariants(
  baselineRules: readonly PolicyRuleSpec[],
  candidateRules: readonly PolicyRuleSpec[],
  options: PolicyFuzzerOptions = {}
): PolicyFuzzReport {
  const redactor = createRedactor();
  const seed = Number.isInteger(options.seed) ? (options.seed as number) : DEFAULT_SEED;
  const iterations = Math.max(
    1,
    Math.min(10_000, Math.floor(options.iterations ?? DEFAULT_ITERATIONS))
  );
  const forbiddenResources = new Set(
    options.forbiddenBoundaryResources ?? DEFAULT_FORBIDDEN_BOUNDARY_RESOURCES
  );

  const nextRandom = createMulberry32(seed);
  const findings: PolicyFuzzFinding[] = [];
  let contradictionCount = 0;
  let shadowAllowCount = 0;
  let boundaryEscapeCount = 0;

  for (let i = 0; i < iterations; i += 1) {
    const action = ADVERSARIAL_ACTIONS[Math.floor(nextRandom() * ADVERSARIAL_ACTIONS.length)]!;
    const resource =
      ADVERSARIAL_RESOURCES[Math.floor(nextRandom() * ADVERSARIAL_RESOURCES.length)]!;
    const riskTier = Math.floor(nextRandom() * 5);
    const boundaryProbe = forbiddenResources.has(resource) || riskTier >= 4;

    const sample: AdversarialActionSample = {
      sampleIndex: i,
      action,
      resource,
      riskTier,
      boundaryProbe,
    };

    const baselineEval = evaluateRules(baselineRules, sample);
    const candidateEval = evaluateRules(candidateRules, sample);

    if (candidateEval.matchedAllowIds.length > 0 && candidateEval.matchedDenyIds.length > 0) {
      contradictionCount += 1;
      findings.push({
        kind: 'contradiction',
        sample,
        baselineEffect: baselineEval.effect,
        candidateEffect: candidateEval.effect,
        matchedRuleIds: [...candidateEval.matchedAllowIds, ...candidateEval.matchedDenyIds],
        detail: redactor.redactString(
          `Candidate policy has conflicting allow/deny rules for ${action} on ${resource}.`
        ),
      });
    }

    if (baselineEval.effect === 'deny' && candidateEval.effect === 'allow') {
      shadowAllowCount += 1;
      findings.push({
        kind: 'shadow_allow_regression',
        sample,
        baselineEffect: baselineEval.effect,
        candidateEffect: candidateEval.effect,
        matchedRuleIds: [...candidateEval.matchedAllowIds],
        detail: redactor.redactString(
          `Candidate policy allows ${action} on ${resource} which baseline denied.`
        ),
      });
    }

    if (boundaryProbe && candidateEval.effect === 'allow') {
      boundaryEscapeCount += 1;
      findings.push({
        kind: 'boundary_escape',
        sample,
        baselineEffect: baselineEval.effect,
        candidateEffect: candidateEval.effect,
        matchedRuleIds: [...candidateEval.matchedAllowIds],
        detail: redactor.redactString(
          `Candidate policy permitted boundary-restricted resource ${resource} at riskTier ${String(riskTier)}.`
        ),
      });
    }
  }

  const core = {
    seed,
    iterations,
    passed: findings.length === 0,
    contradictionCount,
    shadowAllowCount,
    boundaryEscapeCount,
    findings,
    automatedPromotionAllowed: false as const,
    automatedSelfMerge: false as const,
  };

  return {
    ...core,
    fuzzReportSha256: sha256Canonical(core),
  };
}
