import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const PKG_NAME_RE = /^(@moonwitness\/[a-z0-9-]+|paas-template-pack-[a-z0-9-]+)$/u;
const ANTIPATTERN_RE = new RegExp(
  [
    '\\bMOCK_[A-Z0-9_]+',
    `\\b(?:${['TO' + 'DO', 'FIX' + 'ME', 'HA' + 'CK'].join('|')}):`,
    `${'@' + 'ts-ignore'}`,
  ].join('|'),
  'u'
);
const REQUIRED_CI_SCRIPTS = [
  'api:addon:check',
  'agent:boundary:check',
  'architecture:check',
  'standard:check',
];

function collectTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

function hasOrmAddonStructure(pkgDir) {
  const srcDir = path.join(root, 'packages', pkgDir, 'src');
  if (!existsSync(path.join(srcDir, 'index.ts'))) return false;
  const candidates = [
    'manifest.ts',
    'seed-manifest.ts',
    'models.ts',
    path.join('models', 'index.ts'),
  ];
  return candidates.some((rel) => existsSync(path.join(srcDir, rel)));
}

function checkPackageDirectory(pkgDir, violations) {
  const pkgPath = path.join(root, 'packages', pkgDir, 'package.json');
  if (!existsSync(pkgPath)) {
    violations.push(`C37: packages/${pkgDir} is missing package.json`);
    return;
  }
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (typeof manifest.name !== 'string' || !PKG_NAME_RE.test(manifest.name)) {
    violations.push(`C37: invalid package name "${manifest.name}" in packages/${pkgDir}`);
  }
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    violations.push(`C37: invalid SemVer "${manifest.version}" in packages/${pkgDir}`);
  }
  if (pkgDir.startsWith('orm-') && pkgDir !== 'orm-cli' && !hasOrmAddonStructure(pkgDir)) {
    violations.push(`C39: packages/${pkgDir} must expose src/index.ts and manifest/models`);
  }
  checkPackageSourceAntiPatterns(pkgDir, violations);
}

function checkPackageSourceAntiPatterns(pkgDir, violations) {
  const srcDir = path.join(root, 'packages', pkgDir, 'src');
  if (!existsSync(srcDir)) return;
  for (const file of collectTsFiles(srcDir)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (ANTIPATTERN_RE.test(line)) {
        const rel = path.relative(root, file).replaceAll('\\', '/');
        violations.push(`C46: anti-pattern marker in ${rel}:${index + 1}`);
      }
    });
  }
}

function checkRepoGovernance(violations) {
  for (const forbidden of ['docs', 'doc', 'documentation']) {
    if (existsSync(path.join(root, forbidden))) {
      violations.push(`C42: forbidden local "${forbidden}/" directory exists (use mw-docs)`);
    }
  }
  const codeownersPath = path.join(root, '.github', 'CODEOWNERS');
  if (!existsSync(codeownersPath) || !readFileSync(codeownersPath, 'utf8').trim()) {
    violations.push('C44: .github/CODEOWNERS must exist and be non-empty');
  }
  const ciPath = path.join(root, '.github', 'workflows', 'ci.yml');
  if (!existsSync(ciPath)) {
    violations.push('C40: .github/workflows/ci.yml is missing');
    return;
  }
  const baselinePath = path.join(root, '.gitleaks-baseline.json');
  if (existsSync(baselinePath)) {
    const entries = JSON.parse(readFileSync(baselinePath, 'utf8'));
    if (Array.isArray(entries) && entries.length > 148) {
      violations.push(`SEC: .gitleaks-baseline.json exceeded 148-entry cap (${entries.length})`);
    }
  }
  const ciText = readFileSync(ciPath, 'utf8');
  for (const scriptName of REQUIRED_CI_SCRIPTS) {
    if (!ciText.includes(scriptName)) {
      violations.push(`C40: ci.yml must enforce "${scriptName}"`);
    }
  }
}

function main() {
  const violations = [];
  const packagesDir = path.join(root, 'packages');
  const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const pkgDir of packageDirs) {
    checkPackageDirectory(pkgDir, violations);
  }
  checkRepoGovernance(violations);

  if (violations.length > 0) {
    for (const issue of violations) process.stderr.write(`${issue}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Package & add-on standard checks passed (${packageDirs.length} packages).\n`
  );
}

main();
