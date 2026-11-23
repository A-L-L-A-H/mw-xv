#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const FORBIDDEN_PATTERNS = [
  {
    code: 'FORBIDDEN_NODE_FS_IMPORT',
    regex:
      /\b(?:from\s+['"](?:node:)?fs(?:\/promises)?['"]|import\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)|require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\))/u,
    message: 'Direct node:fs import is forbidden inside @moonwitness/ai-runtime M17 modules.',
  },
  {
    code: 'FORBIDDEN_CHILD_PROCESS_IMPORT',
    regex:
      /\b(?:from\s+['"](?:node:)?child_process['"]|import\s*\(\s*['"](?:node:)?child_process['"]\s*\)|require\s*\(\s*['"](?:node:)?child_process['"]\s*\))/u,
    message:
      'Direct node:child_process import is forbidden inside @moonwitness/ai-runtime M17 modules.',
  },
  {
    code: 'FORBIDDEN_EVAL_CALL',
    regex: /\beval\s*\(/u,
    message: 'Dynamic eval() execution is forbidden inside @moonwitness/ai-runtime M17 modules.',
  },
  {
    code: 'FORBIDDEN_NEW_FUNCTION',
    regex: /\bnew\s+Function\b/u,
    message:
      'Dynamic new Function() execution is forbidden inside @moonwitness/ai-runtime M17 modules.',
  },
];

const EXPLICIT_ANY_REGEX = /:\s*any\b/u;
const SELF_MERGE_TRUE_REGEX = /\bautomatedSelfMerge\s*:\s*true\b/u;
const SELF_PROMOTE_TRUE_REGEX = /\bautomatedPromotionAllowed\s*:\s*true\b/u;
const CONSTITUTIONAL_LOCK_FALSE_REGEX =
  /\b(?:automatedSelfMerge|automatedPromotionAllowed)\s*:\s*false\b/u;
const CREATE_REDACTOR_REGEX = /\bcreateRedactor\s*\(/u;
const NETWORK_DISABLED_TRUE_REGEX = /\bnetworkDisabled\s*:\s*true\b/u;
const NETWORK_DISABLED_FALSE_REGEX = /\bnetworkDisabled\s*:\s*false\b/u;
const SECRETS_INJECTED_FALSE_REGEX = /\bsecretsInjected\s*:\s*false\b/u;
const SECRETS_INJECTED_TRUE_REGEX = /\bsecretsInjected\s*:\s*true\b/u;
const VERIFY_INCLUSION_PROOF_REGEX = /\bverifyInclusionProof\b/u;
const CALIBRATION_QUORUM_REGEX = /quorum/iu;
const CALIBRATION_WEIGHT_REGEX = /(?:calibration|brier|ece)/iu;

export function checkM17ModuleSource(relativePath, source) {
  const violations = [];

  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.regex.test(source)) {
      violations.push({
        file: relativePath,
        code: rule.code,
        message: rule.message,
      });
    }
  }

  if (EXPLICIT_ANY_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_EXPLICIT_ANY',
      message: 'Explicit `: any` annotation is forbidden in M17 modules.',
    });
  }

  if (SELF_MERGE_TRUE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_SELF_MERGE',
      message: 'Constitutional violation: `automatedSelfMerge: true` is forbidden.',
    });
  }

  if (SELF_PROMOTE_TRUE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_SELF_PROMOTE',
      message: 'Constitutional violation: `automatedPromotionAllowed: true` is forbidden.',
    });
  }

  if (!CONSTITUTIONAL_LOCK_FALSE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_CONSTITUTIONAL_LOCK',
      message:
        'M17 module must enforce `automatedSelfMerge: false` or `automatedPromotionAllowed: false`.',
    });
  }

  if (relativePath === INCIDENT_HEALER_MODULE && !CREATE_REDACTOR_REGEX.test(source)) {
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

export function evaluateM17Invariants({ rootDir = defaultRoot, allowPartial = false } = {}) {
  const violations = [];
  const checkedModules = [];
  const skippedModules = [];

  const adrPath = join(rootDir, ADR_0012_RELATIVE_PATH);
  const adrPresent = existsSync(adrPath);
  if (!adrPresent) {
    violations.push({
      file: ADR_0012_RELATIVE_PATH,
      code: 'MISSING_ADR_0012',
      message:
        'ADR 0012 (docs/decisions/0012-verifiable-a2a-consensus-self-healing.md) is required.',
    });
  }

  for (const relativePath of M17_MODULES) {
    const fullPath = join(rootDir, relativePath);
    if (!existsSync(fullPath)) {
      if (allowPartial) {
        skippedModules.push(relativePath);
      } else {
        violations.push({
          file: relativePath,
          code: 'MISSING_M17_MODULE',
          message: `Required M17 module is missing: ${relativePath}`,
        });
      }
      continue;
    }

    const source = readFileSync(fullPath, 'utf8');
    checkedModules.push(relativePath);
    violations.push(...checkM17ModuleSource(relativePath, source));
  }

  return {
    ok: violations.length === 0,
    adrPresent,
    allowPartial,
    checkedCount: checkedModules.length,
    skippedCount: skippedModules.length,
    checkedModules,
    skippedModules,
    violations,
  };
}

function main(argv) {
  const args = new Set(argv);
  const jsonOutput = args.has('--json');
  const allowPartial = args.has('--allow-partial');

  const result = evaluateM17Invariants({ rootDir: defaultRoot, allowPartial });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `M17 constitutional invariants passed (${result.checkedCount} checked, ${result.skippedCount} skipped).\n`
    );
  } else {
    process.stderr.write(
      `M17 constitutional invariants failed (${result.violations.length} violation(s)):\n`
    );
    for (const v of result.violations) {
      process.stderr.write(`  - [${v.code}] ${v.file}: ${v.message}\n`);
    }
  }

  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
