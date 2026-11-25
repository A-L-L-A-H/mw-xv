#!/usr/bin/env node
import {
  DEFAULT_ROOT,
  checkCommonMilestoneRules,
  createForbiddenImportPatterns,
  evaluateMilestoneInvariants,
  runMilestoneInvariantCli,
} from './lib/ai-runtime-invariants.mjs';

export const ADR_0013_RELATIVE_PATH = 'docs/decisions/0013-autonomous-eval-harness-world-sim.md';

export const WORLD_SIM_MODULE = 'packages/ai-evaluation/src/world-sim.ts';
export const ADVERSARIAL_SUITE_MODULE = 'packages/ai-evaluation/src/adversarial-suite.ts';
export const AGI_BENCHMARK_MODULE = 'packages/ai-evaluation/src/agi-benchmark.ts';

export const M18_MODULES = [WORLD_SIM_MODULE, ADVERSARIAL_SUITE_MODULE, AGI_BENCHMARK_MODULE];

const FORBIDDEN_PATTERNS = createForbiddenImportPatterns('@moonwitness/ai-evaluation', 'M18', {
  forbidEval: true,
  forbidNewFunction: true,
  forbidMathRandom: true,
});

const SEED_PARAM_REGEX = /\bseed\b/u;
const CONSTITUTIONAL_PASS_REGEX = /\bconstitutionalPass\b/u;
const CONSTITUTIONAL_HARD_FAIL_REGEX = /constitutionalPass\s*&&|&&\s*constitutionalPass/u;

export function checkM18ModuleSource(relativePath, source) {
  const violations = checkCommonMilestoneRules(relativePath, source, {
    milestone: 'M18',
    forbiddenPatterns: FORBIDDEN_PATTERNS,
  });

  if (!SEED_PARAM_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_DETERMINISTIC_SEED',
      message: 'M18 module must enforce deterministic seeded execution (`seed`).',
    });
  }

  if (relativePath === ADVERSARIAL_SUITE_MODULE || relativePath === AGI_BENCHMARK_MODULE) {
    if (!CONSTITUTIONAL_PASS_REGEX.test(source) || !CONSTITUTIONAL_HARD_FAIL_REGEX.test(source)) {
      violations.push({
        file: relativePath,
        code: 'MISSING_CONSTITUTIONAL_HARD_FAIL',
        message:
          'M18 safety/benchmark module must enforce constitutional hard-fail (`constitutionalPass: false` forces `passed: false`).',
      });
    }
  }

  return violations;
}

export function evaluateM18Invariants({ rootDir = DEFAULT_ROOT, allowPartial = false } = {}) {
  return evaluateMilestoneInvariants({
    milestone: 'M18',
    adrNumber: '0013',
    adrRelativePath: ADR_0013_RELATIVE_PATH,
    modules: M18_MODULES,
    checkModuleSource: checkM18ModuleSource,
    rootDir,
    allowPartial,
  });
}

runMilestoneInvariantCli(import.meta.url, 'M18', evaluateM18Invariants);
