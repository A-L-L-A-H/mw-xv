#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ADR_0013_RELATIVE_PATH = 'docs/decisions/0013-autonomous-eval-harness-world-sim.md';

export const WORLD_SIM_MODULE = 'packages/ai-evaluation/src/world-sim.ts';
export const ADVERSARIAL_SUITE_MODULE = 'packages/ai-evaluation/src/adversarial-suite.ts';
export const AGI_BENCHMARK_MODULE = 'packages/ai-evaluation/src/agi-benchmark.ts';

export const M18_MODULES = [
  WORLD_SIM_MODULE,
  ADVERSARIAL_SUITE_MODULE,
  AGI_BENCHMARK_MODULE,
];

const FORBIDDEN_PATTERNS = [
  {
    code: 'FORBIDDEN_NODE_FS_IMPORT',
    regex: /\b(?:from\s+['"](?:node:)?fs(?:\/promises)?['"]|import\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)|require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\))/u,
    message: 'Direct node:fs import is forbidden inside @moonwitness/ai-evaluation M18 modules.',
  },
  {
    code: 'FORBIDDEN_CHILD_PROCESS_IMPORT',
    regex: /\b(?:from\s+['"](?:node:)?child_process['"]|import\s*\(\s*['"](?:node:)?child_process['"]\s*\)|require\s*\(\s*['"](?:node:)?child_process['"]\s*\))/u,
    message: 'Direct node:child_process import is forbidden inside @moonwitness/ai-evaluation M18 modules.',
  },
  {
    code: 'FORBIDDEN_EVAL_CALL',
    regex: /\beval\s*\(/u,
    message: 'Dynamic eval() execution is forbidden inside @moonwitness/ai-evaluation M18 modules.',
  },
  {
    code: 'FORBIDDEN_NEW_FUNCTION',
    regex: /\bnew\s+Function\b/u,
    message: 'Dynamic new Function() execution is forbidden inside @moonwitness/ai-evaluation M18 modules.',
  },
  {
    code: 'FORBIDDEN_MATH_RANDOM',
    regex: /\bMath\.random\s*\(/u,
    message: 'Non-deterministic Math.random() is forbidden in M18 modules; use seeded mulberry32 PRNG.',
  },
];

const EXPLICIT_ANY_REGEX = /:\s*any\b/u;
const SEED_PARAM_REGEX = /\bseed\b/u;
const CONSTITUTIONAL_PASS_REGEX = /\bconstitutionalPass\b/u;
const CONSTITUTIONAL_HARD_FAIL_REGEX = /constitutionalPass\s*&&|&&\s*constitutionalPass/u;

export function checkM18ModuleSource(relativePath, source) {
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
      message: 'Explicit `: any` annotation is forbidden in M18 modules.',
    });
  }

  if (!SEED_PARAM_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_DETERMINISTIC_SEED',
      message: 'M18 module must enforce deterministic seeded execution (`seed`).',
    });
  }

  if (
    relativePath === ADVERSARIAL_SUITE_MODULE ||
    relativePath === AGI_BENCHMARK_MODULE
  ) {
    if (
      !CONSTITUTIONAL_PASS_REGEX.test(source) ||
      !CONSTITUTIONAL_HARD_FAIL_REGEX.test(source)
    ) {
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

export function evaluateM18Invariants({ rootDir = defaultRoot, allowPartial = false } = {}) {
  const violations = [];
  const checkedModules = [];
  const skippedModules = [];

  const adrPath = join(rootDir, ADR_0013_RELATIVE_PATH);
  const adrPresent = existsSync(adrPath);
  if (!adrPresent) {
    violations.push({
      file: ADR_0013_RELATIVE_PATH,
      code: 'MISSING_ADR_0013',
      message:
        'ADR 0013 (docs/decisions/0013-autonomous-eval-harness-world-sim.md) is required.',
    });
  }

  for (const relativePath of M18_MODULES) {
    const fullPath = join(rootDir, relativePath);
    if (!existsSync(fullPath)) {
      if (allowPartial) {
        skippedModules.push(relativePath);
      } else {
        violations.push({
          file: relativePath,
          code: 'MISSING_M18_MODULE',
          message: `Required M18 module is missing: ${relativePath}`,
        });
      }
      continue;
    }

    const source = readFileSync(fullPath, 'utf8');
    checkedModules.push(relativePath);
    violations.push(...checkM18ModuleSource(relativePath, source));
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

  const result = evaluateM18Invariants({ rootDir: defaultRoot, allowPartial });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `M18 constitutional invariants passed (${result.checkedCount} checked, ${result.skippedCount} skipped).\n`
    );
  } else {
    process.stderr.write(
      `M18 constitutional invariants failed (${result.violations.length} violation(s)):\n`
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
