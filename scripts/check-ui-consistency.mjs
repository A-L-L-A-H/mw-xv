#!/usr/bin/env node
/**
 * MW-XV Cross-App Shared Component Consistency & Drift Gate
 * Audits all UI apps under apps/ for @moonwitness/ui & @moonwitness/assets adoption,
 * raw unstyled HTML primitives, and local component duplication.
 *
 * Usage:
 *   node scripts/check-ui-consistency.mjs           # report mode (exit 0)
 *   node scripts/check-ui-consistency.mjs --strict  # fail on P0/P1 drift (exit 1)
 *   node scripts/check-ui-consistency.mjs --json    # machine-readable JSON output
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const APPS_DIR = path.join(ROOT, 'apps');
const UI_PKG_DIR = path.join(ROOT, 'packages', 'ui', 'src');
const IGNORE_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.turbo', 'coverage']);

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const JSON_OUT = args.has('--json');

function walkFiles(dir, exts) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function getSharedUiExports() {
  const names = new Set();
  for (const file of walkFiles(UI_PKG_DIR, ['.ts', '.tsx'])) {
    const base = path.basename(file, path.extname(file));
    if (base !== 'index') names.add(base.toLowerCase());
  }
  return names;
}

function auditApps() {
  const sharedExports = getSharedUiExports();
  const report = [];

  for (const entry of fs.readdirSync(APPS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const appName = entry.name;
    const appDir = path.join(APPS_DIR, appName);
    const pkgPath = path.join(appDir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const tsxFiles = walkFiles(appDir, ['.tsx', '.jsx']);
    const isUiApp = tsxFiles.length > 0 || Boolean(allDeps.react || allDeps.next || allDeps.vite);

    if (!isUiApp) continue;

    const hasUiDep = Boolean(allDeps['@moonwitness/ui']);
    const hasAssetsDep = Boolean(allDeps['@moonwitness/assets']);

    const missingUiImport = [];
    const rawHtmlPrimitives = [];
    const duplicateLocalComponents = [];

    for (const file of tsxFiles) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf8');
      const usesSharedUi = content.includes('@moonwitness/ui');

      if (!usesSharedUi && !rel.endsWith('/main.tsx') && !rel.endsWith('.test.tsx')) {
        missingUiImport.push(rel);
      }

      if (!usesSharedUi && /<(button|input|dialog|select)\b/.test(content)) {
        rawHtmlPrimitives.push(rel);
      }

      if (rel.includes('/components/')) {
        const base = path.basename(file, path.extname(file)).toLowerCase();
        if (sharedExports.has(base)) {
          duplicateLocalComponents.push(rel);
        }
      }
    }

    const adoptionPct = tsxFiles.length === 0
      ? 100
      : Math.round(((tsxFiles.length - missingUiImport.length) / tsxFiles.length) * 100);

    report.push({
      app: appName,
      hasUiDep,
      hasAssetsDep,
      tsxCount: tsxFiles.length,
      adoptionPct,
      missingUiImportCount: missingUiImport.length,
      missingUiImport,
      rawHtmlPrimitivesCount: rawHtmlPrimitives.length,
      rawHtmlPrimitives,
      duplicateLocalComponents,
    });
  }

  return report;
}

const report = auditApps();
const p0Failures = report.filter((r) => !r.hasUiDep);
const totalMissing = report.reduce((acc, r) => acc + r.missingUiImportCount, 0);
const totalRaw = report.reduce((acc, r) => acc + r.rawHtmlPrimitivesCount, 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ summary: { apps: report.length, p0Failures: p0Failures.length, totalMissing, totalRaw }, report }, null, 2));
} else {
  console.log('MW-XV Cross-App Shared UI Consistency Report');
  console.log('--------------------------------------------------------------------------');
  console.log('App            | UI Dep | Assets | TSX | Adoption | Missing | RawHTML | Dup');
  console.log('--------------------------------------------------------------------------');
  for (const r of report) {
    console.log(
      `${r.app.padEnd(14)} | ${String(r.hasUiDep).padEnd(6)} | ${String(r.hasAssetsDep).padEnd(6)} | ${String(r.tsxCount).padStart(3)} | ${String(r.adoptionPct + '%').padStart(8)} | ${String(r.missingUiImportCount).padStart(7)} | ${String(r.rawHtmlPrimitivesCount).padStart(7)} | ${String(r.duplicateLocalComponents.length).padStart(3)}`
    );
  }
  console.log('--------------------------------------------------------------------------');
  console.log(`Summary: ${report.length} UI apps | P0 missing @moonwitness/ui dep: ${p0Failures.length} | Missing imports: ${totalMissing} | Raw HTML primitives: ${totalRaw}`);
}

if (STRICT && (p0Failures.length > 0 || totalRaw > 0)) {
  process.exit(1);
}
