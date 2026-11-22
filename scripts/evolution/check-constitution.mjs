import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const CONSTITUTION_IMMUTABLE_FILES = [
  'apps/api/tests/security-hardening.test.ts',
  'apps/api/tests/api-orm-hardening.test.ts',
  'packages/local-ai/tests/prompt-injection.test.ts',
  'scripts/check-api-addon-boundary.mjs',
  'scripts/knowledge/offline-egress-certification.test.mjs',
];

function listChangedFiles(repositoryRoot, baseRef) {
  try {
    const args = baseRef
      ? ['diff', '--name-only', `${baseRef}...HEAD`]
      : ['status', '--porcelain', '-uall'];
    const raw = execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
    if (baseRef) {
      return raw
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    }
    return raw
      .split(/\r?\n/u)
      .filter((line) => line.length >= 4)
      .map((line) => line.slice(3).trim().replaceAll('\\', '/'));
  } catch {
    return [];
  }
}

/**
 * Validates MoonWitness immutable safety, governance, engine, and addon-boundary invariants.
 */
export async function checkConstitution(options = {}) {
  const repositoryRoot = options.repositoryRoot
    ? path.resolve(options.repositoryRoot)
    : defaultRoot;
  const enforcePause = Boolean(options.enforcePause);
  const allowConstitutionalEdit = Boolean(options.allowConstitutionalEdit);
  const violations = [];

  if (enforcePause && existsSync(path.join(repositoryRoot, 'evolution', 'PAUSE'))) {
    violations.push('evolution/PAUSE kill-switch file is present');
  }

  const rootPkgPath = path.join(repositoryRoot, 'package.json');
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'));
  if (rootPkg?.engines?.node !== '24.x') {
    violations.push(
      `package.json engines.node must remain "24.x" (found "${rootPkg?.engines?.node}")`
    );
  }

  const boundaryPath = path.join(repositoryRoot, 'scripts/check-api-addon-boundary.mjs');
  const boundarySource = await readFile(boundaryPath, 'utf8');
  if (!/const\s+LEGACY_MODEL_ALLOWLIST\s*=\s*new\s+Set\(\s*\)/u.test(boundarySource)) {
    violations.push('LEGACY_MODEL_ALLOWLIST in scripts/check-api-addon-boundary.mjs must be empty');
  }
  if (!/const\s+LEGACY_ADDON_ALLOWLIST\s*=\s*new\s+Set\(\s*\)/u.test(boundarySource)) {
    violations.push('LEGACY_ADDON_ALLOWLIST in scripts/check-api-addon-boundary.mjs must be empty');
  }

  if (!allowConstitutionalEdit) {
    const changed = listChangedFiles(repositoryRoot, options.baseRef);
    const immutableSet = new Set(options.immutableFiles ?? CONSTITUTION_IMMUTABLE_FILES);
    for (const file of changed) {
      const normalized = file.replaceAll('\\', '/');
      if (immutableSet.has(normalized)) {
        violations.push(
          `Immutable constitutional file modified without --allow-constitutional-edit: ${normalized}`
        );
      }
    }
  }

  return {
    format: 'moonwitness-constitution-check/v1',
    passed: violations.length === 0,
    violations,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let baseRef;
  let enforcePause = false;
  let allowConstitutionalEdit = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--enforce-pause') enforcePause = true;
    else if (args[i] === '--allow-constitutional-edit') allowConstitutionalEdit = true;
    else if (args[i] === '--base-ref') {
      baseRef = args[i + 1];
      i += 1;
    }
  }
  const result = await checkConstitution({ enforcePause, allowConstitutionalEdit, baseRef });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}
