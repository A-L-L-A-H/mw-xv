#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as harness from './lib/harness.mjs';
import * as mocks from './lib/mock-providers.mjs';

const VALID_TIERS = new Set(['0', '1', '2', '3', '4', 'all']);

const TIER_FILES = [
  { tier: 0, fileName: 'tier0-harness.test.mjs' },
  { tier: 1, fileName: 'tier1-feature-coverage.test.mjs' },
  { tier: 2, fileName: 'tier2-boundary-cases.test.mjs' },
  { tier: 3, fileName: 'tier3-cross-feature.test.mjs' },
  { tier: 4, fileName: 'tier4-real-world.test.mjs' },
];

function printUsage() {
  process.stderr.write(
    [
      'Usage: node tests/ai-e2e/run-e2e.mjs [options]',
      '',
      'Options:',
      '  --tier=0|1|2|3|4|all   Select tier to execute (default: all)',
      '  --filter=<pattern>     Case-insensitive substring or /regex/ filter',
      '  --json                 Emit mw:ai-e2e:v1 JSON report to stdout',
      '  --strict               Fail on any pending or skipped case (or AI_E2E_STRICT=1)',
      '  --built                Use built packages/*/dist and apps/api/dist (default)',
      '  --help, -h             Show this help message',
      '',
    ].join('\n')
  );
}

function parseCliArgs(argv) {
  const parsed = {
    tier: 'all',
    filter: null,
    json: false,
    strict: process.env.AI_E2E_STRICT === '1',
    built: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--strict') {
      parsed.strict = true;
      continue;
    }
    if (arg === '--built') {
      parsed.built = true;
      continue;
    }
    if (arg === '--tier') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        return { error: 'Missing value for --tier' };
      }
      i += 1;
      if (!VALID_TIERS.has(next)) {
        return { error: `Invalid --tier value: ${next}` };
      }
      parsed.tier = next;
      continue;
    }
    if (arg.startsWith('--tier=')) {
      const value = arg.slice('--tier='.length);
      if (!VALID_TIERS.has(value)) {
        return { error: `Invalid --tier value: ${value}` };
      }
      parsed.tier = value;
      continue;
    }
    if (arg === '--filter') {
      const next = argv[i + 1];
      if (next === undefined) {
        return { error: 'Missing value for --filter' };
      }
      i += 1;
      parsed.filter = next;
      continue;
    }
    if (arg.startsWith('--filter=')) {
      parsed.filter = arg.slice('--filter='.length);
      continue;
    }
    return { error: `Unknown CLI argument: ${arg}` };
  }

  if (
    parsed.filter &&
    parsed.filter.startsWith('/') &&
    parsed.filter.endsWith('/') &&
    parsed.filter.length >= 2
  ) {
    try {
      new RegExp(parsed.filter.slice(1, -1), 'i');
    } catch (err) {
      return {
        error: `Invalid --filter regex: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { options: parsed };
}

function createFilterMatcher(filterPattern) {
  if (!filterPattern) return () => true;
  if (filterPattern.startsWith('/') && filterPattern.endsWith('/') && filterPattern.length >= 2) {
    const regex = new RegExp(filterPattern.slice(1, -1), 'i');
    return (testCase, tierInfo) =>
      regex.test(testCase.id) ||
      regex.test(testCase.name) ||
      regex.test(testCase.featureArea) ||
      regex.test(tierInfo?.name ?? '');
  }
  const needle = filterPattern.toLowerCase();
  return (testCase, tierInfo) =>
    testCase.id.toLowerCase().includes(needle) ||
    testCase.name.toLowerCase().includes(needle) ||
    testCase.featureArea.toLowerCase().includes(needle) ||
    (tierInfo?.name ?? '').toLowerCase().includes(needle);
}

async function loadOptionalPlaywrightHelper(root) {
  const helperPath = path.join(root, 'tests', 'ai-e2e', 'lib', 'playwright-helper.mjs');
  if (!existsSync(helperPath)) {
    return {
      isPlaywrightAvailable: async () => false,
      hasBoardAiRoutes: async () => false,
      runBoardAiPlaywrightCheck: async () => ({
        ok: false,
        details: 'playwright-helper.mjs is not present',
      }),
    };
  }
  return import(pathToFileURL(harness.canonicalizePath(helperPath)).href);
}

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.error) {
    process.stderr.write(`Error: ${parsed.error}\n`);
    printUsage();
    process.exit(2);
  }

  const { options } = parsed;
  if (options.help) {
    printUsage();
    process.exit(0);
  }

  const root = harness.resolveRepoRoot();
  const startedAt = new Date().toISOString();
  const runStartMs = Date.now();
  const playwright = await loadOptionalPlaywrightHelper(root);
  const matcher = createFilterMatcher(options.filter);

  const selectedTierEntries = TIER_FILES.filter(
    (entry) => options.tier === 'all' || String(entry.tier) === options.tier
  );

  const loadedTiers = [];
  for (const entry of selectedTierEntries) {
    const filePath = path.join(root, 'tests', 'ai-e2e', 'tiers', entry.fileName);
    if (!existsSync(filePath)) continue;
    const mod = await import(pathToFileURL(harness.canonicalizePath(filePath)).href);
    const tierInfo = mod.tierInfo ?? {
      tier: entry.tier,
      name: `Tier ${entry.tier}`,
      description: '',
    };
    const allCases = Array.isArray(mod.cases) ? mod.cases : [];
    const matchedCases = allCases.filter((testCase) => matcher(testCase, tierInfo));
    loadedTiers.push({ tierInfo, matchedCases });
  }

  const totalMatchedCases = loadedTiers.reduce((acc, item) => acc + item.matchedCases.length, 0);
  const tierResults = [];
  const caseResults = [];
  let passedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  const skippedCount = 0;

  const log = (message) => {
    process.stderr.write(`${message}\n`);
  };

  const ctx = {
    root,
    harness,
    mocks,
    playwright,
    strict: options.strict,
    log,
  };

  for (const { tierInfo, matchedCases } of loadedTiers) {
    let tierPassed = 0;
    let tierFailed = 0;
    let tierPending = 0;
    const tierStartMs = Date.now();

    for (const testCase of matchedCases) {
      const caseStartMs = Date.now();
      const prereqResult = await harness.checkPrerequisites(testCase.prerequisites ?? []);

      if (!prereqResult.ok) {
        const missingDetail = prereqResult.missing.join(',');
        if (options.strict) {
          failedCount += 1;
          tierFailed += 1;
          caseResults.push({
            id: testCase.id,
            tier: testCase.tier,
            featureArea: testCase.featureArea,
            name: testCase.name,
            status: 'failed',
            reason: 'strict_mode_pending_not_allowed',
            missingPrerequisites: prereqResult.missing,
            durationMs: Date.now() - caseStartMs,
          });
        } else {
          pendingCount += 1;
          tierPending += 1;
          caseResults.push({
            id: testCase.id,
            tier: testCase.tier,
            featureArea: testCase.featureArea,
            name: testCase.name,
            status: 'pending',
            reason: `missing_prerequisite:${missingDetail}`,
            missingPrerequisites: prereqResult.missing,
            durationMs: Date.now() - caseStartMs,
          });
        }
        continue;
      }

      try {
        const outcome = (await testCase.run(ctx)) ?? {};
        passedCount += 1;
        tierPassed += 1;
        caseResults.push({
          id: testCase.id,
          tier: testCase.tier,
          featureArea: testCase.featureArea,
          name: testCase.name,
          status: 'passed',
          details: outcome.details ?? null,
          metrics: outcome.metrics ?? null,
          durationMs: Date.now() - caseStartMs,
        });
      } catch (error) {
        failedCount += 1;
        tierFailed += 1;
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error && error.stack ? error.stack.slice(0, 2000) : null;
        caseResults.push({
          id: testCase.id,
          tier: testCase.tier,
          featureArea: testCase.featureArea,
          name: testCase.name,
          status: 'failed',
          error: message,
          stack,
          durationMs: Date.now() - caseStartMs,
        });
      } finally {
        await harness.cleanupTempDirs();
      }
    }

    tierResults.push({
      tier: tierInfo.tier,
      name: tierInfo.name,
      cases: matchedCases.length,
      passed: tierPassed,
      failed: tierFailed,
      pending: tierPending,
      skipped: 0,
      durationMs: Date.now() - tierStartMs,
    });
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - runStartMs;
  const zeroFilterMatches = options.filter !== null && totalMatchedCases === 0;

  let overallStatus = 'passed';
  if (failedCount > 0 || zeroFilterMatches) {
    overallStatus = 'failed';
  } else if (pendingCount > 0 || skippedCount > 0) {
    overallStatus = 'passed_with_pending';
  }

  const report = {
    contract: 'mw:ai-e2e:v1',
    sourceSha: harness.resolveGitSha(root),
    mode: options.strict ? 'strict' : 'progressive',
    tier: options.tier,
    filter: options.filter,
    startedAt,
    completedAt,
    overallStatus,
    ...(zeroFilterMatches ? { error: 'no_matching_tests' } : {}),
    totals: {
      tiers: tierResults.length,
      cases: caseResults.length,
      passed: passedCount,
      failed: failedCount,
      pending: pendingCount,
      skipped: skippedCount,
      durationMs,
    },
    tiers: tierResults,
    cases: caseResults,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `mw:ai-e2e:v1 (${report.mode}) tier=${report.tier} status=${report.overallStatus} ` +
        `passed=${passedCount} failed=${failedCount} pending=${pendingCount} durationMs=${durationMs}\n`
    );
    for (const item of caseResults) {
      const suffix =
        item.status === 'failed'
          ? ` — ${item.error ?? item.reason}`
          : item.status === 'pending'
            ? ` — ${item.reason}`
            : item.details
              ? ` — ${item.details}`
              : '';
      process.stdout.write(`  [${item.status.toUpperCase()}] ${item.id} ${item.name}${suffix}\n`);
    }
    if (zeroFilterMatches) {
      process.stdout.write(`  [FAILED] Filter "${options.filter}" matched 0 cases.\n`);
    }
  }

  process.exit(overallStatus === 'failed' ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`Fatal error in run-e2e.mjs: ${error?.stack ?? error}\n`);
  process.exit(1);
});
