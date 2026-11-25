import { stderr, env, argv } from 'node:process';
import { appendFile } from 'node:fs/promises';
import { exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * The canonical check context required by the branch rulesets and by every
 * promotion/release consumer. Keep a single spelling across the governance
 * plane; `ci-technical-gate` and `policy-gate` are not aliases for this check.
 */
export const CI_GATE_CHECK_NAME = 'ci-gate';

/**
 * Required technical lanes. These must match the job names in ci.yml. A lane
 * that is missing, renamed, skipped, cancelled, or non-success fails closed.
 */
export const requiredJobs = [
  'secret-scan',
  'static-analysis',
  'dependency-audit',
  'quality-and-build',
  'unit-tests',
  'knowledge-gate',
  'postgres-integration',
  'dx-test',
];

/** Additional, optional lanes that may be promoted to required via config. */
export const knownOptionalJobs = ['freellmapi-vendor', 'desktop-webview'];
export const knownJobs = [...requiredJobs, ...knownOptionalJobs];

/**
 * Resolve the enforceable job list. The baseline can only be strengthened:
 * configuration may add known optional lanes, it can never remove a required
 * one or inject an unknown name. This keeps the gate fail-closed even if an
 * untrusted workflow input is supplied.
 * @param {NodeJS.ProcessEnv} environment
 */
export function resolveRequiredJobs(environment = env) {
  let extra = [];
  if (environment.CI_GATE_EXTRA_JOBS) {
    try {
      const parsed = JSON.parse(environment.CI_GATE_EXTRA_JOBS);
      if (Array.isArray(parsed)) extra = parsed;
    } catch {
      extra = [];
    }
  }
  const allowed = new Set(knownOptionalJobs);
  return [...requiredJobs, ...new Set(extra.filter((job) => allowed.has(job)))];
}

/**
 * Read the aggregate job conclusions. Prefer a single JSON map (the exact-SHA
 * aggregate job passes `needs.<id>.result` values through it); fall back to
 * per-job `<JOB>_RESULT` variables for direct invocations.
 * @param {NodeJS.ProcessEnv} environment
 * @param {string[]} jobs
 */
export function readJobResults(environment = env, jobs = requiredJobs) {
  const inline = environment.CI_GATE_RESULTS ?? environment.CI_JOB_RESULTS;
  if (inline) {
    try {
      const parsed = JSON.parse(inline);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // An unparseable payload is treated as no results and fails closed below.
    }
    return {};
  }
  return Object.fromEntries(
    jobs.map((job) => [job, environment[`${job.toUpperCase().replaceAll('-', '_')}_RESULT`]])
  );
}

/**
 * @param {Record<string, unknown>} results
 * @param {string[]} jobs
 */
export function isCiGatePassing(results, jobs = requiredJobs) {
  return (
    Array.isArray(jobs) &&
    jobs.length > 0 &&
    jobs.every((job) => knownJobs.includes(job)) &&
    jobs.every((job) => results?.[job] === 'success')
  );
}

/**
 * @param {Record<string, unknown>} results
 * @param {string[]} jobs
 */
export function renderCiJobSummary(results, jobs = requiredJobs) {
  const rows = jobs.map((job) => [job, results?.[job] ?? 'missing']);
  const passed = isCiGatePassing(results, jobs);
  return [
    `## ${CI_GATE_CHECK_NAME} result`,
    '',
    `Overall: **${passed ? 'passed' : 'failed'}**`,
    '',
    '| Job | Result |',
    '| --- | --- |',
    ...rows.map(([job, result]) => `| ${job} | ${result} |`),
    '',
  ].join('\n');
}

const isDirectExecution =
  argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(argv[1]);

if (isDirectExecution) {
  const jobs = resolveRequiredJobs(env);
  const results = readJobResults(env, jobs);
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, renderCiJobSummary(results, jobs));
  }

  if (!isCiGatePassing(results, jobs)) {
    for (const job of jobs) {
      if (results[job] !== 'success') {
        stderr.write(`Required CI job '${job}' result was '${results[job] ?? 'missing'}'\n`);
      }
    }
    exit(1);
  }
}
