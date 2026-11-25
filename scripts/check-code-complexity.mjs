#!/usr/bin/env node
/**
 * MW-XV Deterministic Code Complexity & Max-Lines Ratchet Gate
 * Enforces max-lines (400 prod / 800 tests) across apps/ and packages/.
 * Existing god-files are baselined in scripts/code-complexity-baseline.json:
 *   - New files exceeding limits FAIL immediately.
 *   - Baselined files that GROW beyond their baseline FAIL immediately.
 *   - Baselined files that shrink are allowed (ratchet down).
 *
 * Usage:
 *   node scripts/check-code-complexity.mjs                  # report mode
 *   node scripts/check-code-complexity.mjs --strict         # fail on new violations or growth
 *   node scripts/check-code-complexity.mjs --write-baseline # update baseline JSON
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SCAN_DIRS = ['apps', 'packages'];
const IGNORE_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.turbo', 'coverage', 'generated', 'test-results']);
const BASELINE_PATH = path.join(ROOT, 'scripts', 'code-complexity-baseline.json');

const PROD_MAX_LINES = 400;
const TEST_MAX_LINES = 800;

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const WRITE_BASELINE = args.has('--write-baseline');

function walkTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      if (!entry.name.endsWith('.d.ts')) results.push(full);
    }
  }
  return results;
}

function isTestFile(relPath) {
  return (
    relPath.includes('/tests/') ||
    relPath.includes('/test/') ||
    relPath.includes('/e2e/') ||
    /\.test\.tsx?$/.test(relPath) ||
    /\.spec\.tsx?$/.test(relPath)
  );
}

function countEffectiveLines(content) {
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    count += 1;
  }
  return count;
}

function scan() {
  const oversized = {};
  let totalFiles = 0;

  for (const rootDir of SCAN_DIRS) {
    for (const full of walkTsFiles(path.join(ROOT, rootDir))) {
      totalFiles += 1;
      const rel = path.relative(ROOT, full).replace(/\\/g, '/');
      const limit = isTestFile(rel) ? TEST_MAX_LINES : PROD_MAX_LINES;
      const lines = countEffectiveLines(fs.readFileSync(full, 'utf8'));
      if (lines > limit) {
        oversized[rel] = { lines, limit };
      }
    }
  }

  return { totalFiles, oversized };
}

const { totalFiles, oversized } = scan();

if (WRITE_BASELINE) {
  const sorted = Object.fromEntries(Object.entries(oversized).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({ prodMaxLines: PROD_MAX_LINES, testMaxLines: TEST_MAX_LINES, files: sorted }, null, 2) + '\n');
  console.log(`Wrote complexity baseline: ${Object.keys(sorted).length} oversized files out of ${totalFiles} TS/TSX files.`);
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).files || {}
  : {};

const regressions = [];
const improved = [];

for (const [rel, info] of Object.entries(oversized)) {
  const base = baseline[rel];
  if (!base) {
    regressions.push({ file: rel, reason: 'NEW_OVERSIZED', lines: info.lines, limit: info.limit });
  } else if (info.lines > base.lines) {
    regressions.push({ file: rel, reason: 'GREW_BEYOND_BASELINE', lines: info.lines, baseline: base.lines });
  } else if (info.lines < base.lines) {
    improved.push({ file: rel, from: base.lines, to: info.lines });
  }
}

console.log(`MW-XV Code Complexity Ratchet: scanned ${totalFiles} TS/TSX files | baselined=${Object.keys(oversized).length} | regressions=${regressions.length} | improved=${improved.length}`);
for (const r of regressions) {
  console.error(`  [FAIL] ${r.file} (${r.reason}: ${r.lines} lines > ${r.baseline ?? r.limit})`);
}

if (STRICT && regressions.length > 0) {
  process.exit(1);
}
