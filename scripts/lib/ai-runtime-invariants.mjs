import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const NODE_FS_IMPORT_REGEX =
  /\b(?:from\s+['"](?:node:)?fs(?:\/promises)?['"]|import\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)|require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\))/u;

export const CHILD_PROCESS_IMPORT_REGEX =
  /\b(?:from\s+['"](?:node:)?child_process['"]|import\s*\(\s*['"](?:node:)?child_process['"]\s*\)|require\s*\(\s*['"](?:node:)?child_process['"]\s*\))/u;

export const EVAL_CALL_REGEX = /\beval\s*\(/u;
export const NEW_FUNCTION_REGEX = /\bnew\s+Function\b/u;
export const MATH_RANDOM_REGEX = /\bMath\.random\s*\(/u;
export const EXPLICIT_ANY_REGEX = /:\s*any\b/u;
export const SELF_ACCEPT_TRUE_REGEX = /\bautomatedSelfAccept\s*:\s*true\b/u;
export const SELF_MERGE_TRUE_REGEX = /\bautomatedSelfMerge\s*:\s*true\b/u;
export const SELF_PROMOTE_TRUE_REGEX = /\bautomatedPromotionAllowed\s*:\s*true\b/u;
export const CREATE_REDACTOR_REGEX = /\bcreateRedactor\b/u;
export const SHA256_REGEX = /createHash\s*\(\s*['"]sha256['"]\s*\)/u;
export const SHA256_CANONICAL_IMPORT_REGEX = /\bsha256(?:Hex|Canonical)\s*(?:,|\})/u;

export function createForbiddenImportPatterns(
  packageLabel,
  milestone,
  { forbidEval = false, forbidNewFunction = false, forbidMathRandom = false } = {}
) {
  const patterns = [
    {
      code: 'FORBIDDEN_NODE_FS_IMPORT',
      regex: NODE_FS_IMPORT_REGEX,
      message: `Direct node:fs import is forbidden inside ${packageLabel} ${milestone} modules.`,
    },
    {
      code: 'FORBIDDEN_CHILD_PROCESS_IMPORT',
      regex: CHILD_PROCESS_IMPORT_REGEX,
      message: `Direct node:child_process import is forbidden inside ${packageLabel} ${milestone} modules.`,
    },
  ];

  if (forbidEval) {
    patterns.push({
      code: 'FORBIDDEN_EVAL_CALL',
      regex: EVAL_CALL_REGEX,
      message: `Dynamic eval() execution is forbidden inside ${packageLabel} ${milestone} modules.`,
    });
  }

  if (forbidNewFunction) {
    patterns.push({
      code: 'FORBIDDEN_NEW_FUNCTION',
      regex: NEW_FUNCTION_REGEX,
      message: `Dynamic new Function() execution is forbidden inside ${packageLabel} ${milestone} modules.`,
    });
  }

  if (forbidMathRandom) {
    patterns.push({
      code: 'FORBIDDEN_MATH_RANDOM',
      regex: MATH_RANDOM_REGEX,
      message: `Non-deterministic Math.random() is forbidden in ${milestone} modules; use seeded mulberry32 PRNG.`,
    });
  }

  return patterns;
}

export function checkCommonMilestoneRules(
  relativePath,
  source,
  {
    milestone,
    forbiddenPatterns,
    forbidSelfAccept = false,
    forbidSelfMerge = false,
    forbidSelfPromote = false,
    requireRedactor = false,
    requireSha256 = false,
  }
) {
  const violations = [];

  for (const rule of forbiddenPatterns) {
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
      message: `Explicit \`: any\` annotation is forbidden in ${milestone} modules.`,
    });
  }

  if (forbidSelfAccept && SELF_ACCEPT_TRUE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_SELF_ACCEPT',
      message: 'Constitutional violation: `automatedSelfAccept: true` is forbidden.',
    });
  }

  if (forbidSelfMerge && SELF_MERGE_TRUE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_SELF_MERGE',
      message: 'Constitutional violation: `automatedSelfMerge: true` is forbidden.',
    });
  }

  if (forbidSelfPromote && SELF_PROMOTE_TRUE_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'FORBIDDEN_SELF_PROMOTE',
      message: 'Constitutional violation: `automatedPromotionAllowed: true` is forbidden.',
    });
  }

  if (requireRedactor && !CREATE_REDACTOR_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_REDACTOR',
      message: `${milestone} module must use \`createRedactor()\` for mandatory secret redaction.`,
    });
  }

  if (requireSha256 && !SHA256_REGEX.test(source) && !SHA256_CANONICAL_IMPORT_REGEX.test(source)) {
    violations.push({
      file: relativePath,
      code: 'MISSING_SHA256_DIGEST',
      message:
        `${milestone} module must compute SHA-256 digests via \`createHash('sha256')\` ` +
        'or import the centralized `sha256Hex`/`sha256Canonical` from canonical-json.',
    });
  }

  return violations;
}

export function evaluateMilestoneInvariants({
  milestone,
  adrNumber,
  adrRelativePath,
  modules,
  checkModuleSource,
  rootDir = DEFAULT_ROOT,
  allowPartial = false,
}) {
  const violations = [];
  const checkedModules = [];
  const skippedModules = [];

  const adrPath = join(rootDir, adrRelativePath);
  const adrPresent = existsSync(adrPath);
  if (!adrPresent) {
    violations.push({
      file: adrRelativePath,
      code: `MISSING_ADR_${adrNumber}`,
      message: `ADR ${adrNumber} (${adrRelativePath}) is required.`,
    });
  }

  for (const relativePath of modules) {
    const fullPath = join(rootDir, relativePath);
    if (!existsSync(fullPath)) {
      if (allowPartial) {
        skippedModules.push(relativePath);
      } else {
        violations.push({
          file: relativePath,
          code: `MISSING_${milestone}_MODULE`,
          message: `Required ${milestone} module is missing: ${relativePath}`,
        });
      }
      continue;
    }

    const source = readFileSync(fullPath, 'utf8');
    checkedModules.push(relativePath);
    violations.push(...checkModuleSource(relativePath, source));
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

export function runMilestoneInvariantCli(importMetaUrl, milestone, evaluateFn) {
  if (!process.argv[1] || importMetaUrl !== pathToFileURL(resolve(process.argv[1])).href) {
    return;
  }

  const args = new Set(process.argv.slice(2));
  const jsonOutput = args.has('--json');
  const allowPartial = args.has('--allow-partial');

  const result = evaluateFn({ rootDir: DEFAULT_ROOT, allowPartial });

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(
      `${milestone} constitutional invariants passed (${result.checkedCount} checked, ${result.skippedCount} skipped).\n`
    );
  } else {
    process.stderr.write(
      `${milestone} constitutional invariants failed (${result.violations.length} violation(s)):\n`
    );
    for (const v of result.violations) {
      process.stderr.write(`  - [${v.code}] ${v.file}: ${v.message}\n`);
    }
  }

  process.exitCode = result.ok ? 0 : 1;
}
