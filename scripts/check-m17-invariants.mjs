#!/usr/bin/env node
import {
  DEFAULT_ROOT,
  checkCommonMilestoneRules,
  createForbiddenImportPatterns,
  evaluateMilestoneInvariants,
  runMilestoneInvariantCli,
} from './lib/ai-runtime-invariants.mjs';

export const ADR_0012_RELATIVE_PATH =
  'docs/decisions/0012-verifiable-a2a-consensus-self-healing.md';

export const A2A_CONSENSUS_MODULE = 'packages/ai-runtime/src/a2a-consensus.ts';
export const POLICY_FUZZER_MODULE = 'packages/ai-runtime/src/policy-fuzzer.ts';
export const SANDBOX_RUNNER_MODULE = 'packages/ai-runtime/src/sandbox-runner.ts';
export const INCIDENT_HEALER_MODULE = 'packages/ai-runtime/src/incident-healer.ts';

export const M17_MODULES = [
  A2A_CONSENSUS_MODULE,
  POLICY_FUZZER_MODULE,
  SANDBOX_RUNNER_MODULE,
  INCIDENT_HEALER_MODULE,
];

const FORBIDDEN_PATTERNS = createForbiddenImportPatterns('@moonwitness/ai-runtime', 'M17', {
  forbidEval: true,
  forbidNewFunction: true,
});

const CONSTITUTIONAL_LOCK_FALSE_REGEX =
  /\b(?:automatedSelfMerge|automatedPromotionAllowed)\s*:\s*false\b/u;
const CREATE_REDACTOR_CALL_REGEX = /\bcreateRedactor\s*\(/u;
const NETWORK_DISABLED_TRUE_REGEX = /\bnetworkDisabled\s*:\s*true\b/u;
const NETWORK_DISABLED_FALSE_REGEX = /\bnetworkDisabled\s*:\s*false\b/u;
const SECRETS_INJECTED_FALSE_REGEX = /\bsecretsInjected\s*:\s*false\b/u;
const SECRETS_INJECTED_TRUE_REGEX = /\bsecretsInjected\s*:\s*true\b/u;
const VERIFY_INCLUSION_PROOF_REGEX = /\bverifyInclusionProof\b/u;
const CALIBRATION_QUORUM_REGEX = /quorum/iu;
const CALIBRATION_WEIGHT_REGEX = /(?:calibration|brier|ece)/iu;

export function checkM17ModuleSource(relativePath, source) {
  const violations = checkCommonMilestoneRules(relativePath, source, {
    milestone: 'M17',
    forbiddenPatterns: FORBIDDEN_PATTERNS,
    forbidSelfMerge: true,
    forbidSelfPromote: true,
  });

  if (!CONSTITUTIONAL_LOCK_FALSE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_CONSTITUTIONAL_LOCK',
      message:
        'M17 module must enforce `automatedSelfMerge: false` or `automatedPromotionAllowed: false`.',
    });
  }

  if (relativePath === INCIDENT_HEALER_MODULE && !CREATE_REDACTOR_CALL_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_REDACTOR',
      message: 'incident-healer.ts must invoke `createRedactor()` for mandatory log redaction.',
    });
  }

  if (relativePath === SANDBOX_RUNNER_MODULE) {
    if (!NETWORK_DISABLED_TRUE_REGEX.test(source) || NETWORK_DISABLED_FALSE_REGEX.test(source)) {
      violations.push({
        file: relativePath,
        code: 'INVALID_SANDBOX_NETWORK_LOCK',
        message: 'sandbox-runner.ts must strictly enforce `networkDisabled: true`.',
      });
    }
    if (!SECRETS_INJECTED_FALSE_REGEX.test(source) || SECRETS_INJECTED_TRUE_REGEX.test(source)) {
      violations.push({
        file: relativePath,
        code: 'INVALID_SANDBOX_SECRETS_LOCK',
        message: 'sandbox-runner.ts must strictly enforce `secretsInjected: false`.',
      });
    }
  }

  if (relativePath === A2A_CONSENSUS_MODULE) {
    if (!VERIFY_INCLUSION_PROOF_REGEX.test(source)) {
      violations.push({
        file: relativePath,
        code: 'MISSING_MERKLE_PROOF_VERIFICATION',
        message: 'a2a-consensus.ts must verify Merkle proofs via `verifyInclusionProof`.',
      });
    }
    if (!CALIBRATION_QUORUM_REGEX.test(source) || !CALIBRATION_WEIGHT_REGEX.test(source)) {
      violations.push({
        file: relativePath,
        code: 'MISSING_CALIBRATION_WEIGHTED_QUORUM',
        message: 'a2a-consensus.ts must enforce calibration-weighted quorum checks (Brier/ECE).',
      });
    }
  }

  return violations;
}

export function evaluateM17Invariants({ rootDir = DEFAULT_ROOT, allowPartial = false } = {}) {
  return evaluateMilestoneInvariants({
    milestone: 'M17',
    adrNumber: '0012',
    adrRelativePath: ADR_0012_RELATIVE_PATH,
    modules: M17_MODULES,
    checkModuleSource: checkM17ModuleSource,
    rootDir,
    allowPartial,
  });
}

runMilestoneInvariantCli(import.meta.url, 'M17', evaluateM17Invariants);
