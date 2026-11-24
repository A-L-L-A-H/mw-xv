import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ghJson } from './lib/gh-cli.mjs';

const fullShaPattern = /^[a-f0-9]{40}$/u;

/**
 * Select the newest terminal CI workflow run for an exact commit SHA.
 * Reruns are ordered by run id so an older success can never mask a newer
 * failure. Fork, other-SHA, and non-terminal runs are never eligible.
 * @param {Array<{id:number,head_sha:string,event?:string,status?:string,conclusion?:string|null,head_repository?:{full_name?:string}}>} runs
 * @param {string} sha
 * @param {string} repository
 * @param {string[]} allowedEvents
 */
export function selectExactCiRun(
  runs,
  sha,
  repository,
  allowedEvents = ['workflow_dispatch', 'push']
) {
  if (!fullShaPattern.test(sha)) return undefined;
  return (Array.isArray(runs) ? runs : [])
    .filter(
      (run) =>
        run &&
        Number.isSafeInteger(run.id) &&
        run.head_sha === sha &&
        allowedEvents.includes(run.event ?? '') &&
        run.head_repository?.full_name === repository &&
        run.status === 'completed'
    )
    .sort((left, right) => right.id - left.id)[0];
}

/**
 * Require both governance checks to be successful on the exact SHA.
 * @param {Array<{name:string,status?:string,conclusion?:string|null,head_sha?:string}>} checkRuns
 * @param {string} sha
 * @param {string[]} requiredChecks
 */
export function verifyExactCheckRuns(checkRuns, sha, requiredChecks) {
  if (!fullShaPattern.test(sha) || !Array.isArray(requiredChecks) || requiredChecks.length === 0)
    return { passed: false, reason: 'invalid verification input' };
  const byName = new Map();
  for (const check of Array.isArray(checkRuns) ? checkRuns : []) {
    if (check?.head_sha && check.head_sha !== sha) continue;
    const current = byName.get(check?.name);
    if (!current || Number(check?.id ?? 0) > Number(current.id ?? 0))
      byName.set(check?.name, check);
  }
  const missing = requiredChecks.filter((name) => {
    const check = byName.get(name);
    return check?.status !== 'completed' || check.conclusion !== 'success';
  });
  return missing.length === 0
    ? { passed: true }
    : { passed: false, reason: `exact-SHA checks not successful: ${missing.join(', ')}` };
}

/**
 * Retry-safe decision: a prior successful, newest run plus successful checks
 * is enough to proceed without dispatching again.
 * @param {{runs:unknown[],checkRuns:unknown[]}} evidence
 */
export function evaluateAwaitEvidence(evidence, options) {
  const run = selectExactCiRun(
    evidence.runs,
    options.sha,
    options.repository,
    options.allowedEvents
  );
  if (!run) return { done: false, reason: 'no completed exact-SHA CI run' };
  if (run.conclusion !== 'success')
    return {
      done: false,
      reason: `exact-SHA CI run ${run.id} concluded ${run.conclusion ?? 'unknown'}`,
    };
  const checks = verifyExactCheckRuns(evidence.checkRuns, options.sha, options.requiredChecks);
  if (!checks.passed) return { done: false, reason: checks.reason };
  return { done: true, runId: run.id };
}

/** @param {{read:(kind:string)=>Promise<unknown>, sleep?:(ms:number)=>Promise<void>}} io */
export async function awaitExactCi(options, io) {
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  let lastReason;
  for (;;) {
    const runs = await io.read('runs');
    const checkRuns = await io.read('checkRuns');
    const verdict = evaluateAwaitEvidence({ runs, checkRuns }, options);
    if (verdict.done) return verdict;
    lastReason = verdict.reason;
    if (Date.now() >= deadline) throw new Error(`Timed out awaiting exact-SHA CI: ${lastReason}`);
    await (io.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))))(
      options.intervalSeconds * 1000
    );
  }
}

export function createGithubReader(repository, sha, env = {}) {
  return {
    async read(kind) {
      if (kind === 'runs')
        return ghJson(
          [
            `repos/${repository}/actions/workflows/ci.yml/runs`,
            '--paginate',
            '--slurp',
            '-X',
            'GET',
            '-F',
            `head_sha=${sha}`,
            '-F',
            'per_page=100',
          ],
          { env }
        ).then((pages) =>
          (Array.isArray(pages) ? pages : [pages]).flatMap(
            (page) => page?.workflow_runs ?? page ?? []
          )
        );
      if (kind === 'checkRuns')
        return ghJson(
          [
            `repos/${repository}/commits/${sha}/check-runs`,
            '--paginate',
            '--slurp',
            '-X',
            'GET',
            '-F',
            'per_page=100',
          ],
          { env }
        ).then((pages) =>
          (Array.isArray(pages) ? pages : [pages]).flatMap((page) => page?.check_runs ?? page ?? [])
        );
      throw new Error(`Unknown evidence kind: ${kind}`);
    },
  };
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const flags = Object.fromEntries(
    process.argv
      .slice(2)
      .map((arg, index, all) =>
        arg.startsWith('--')
          ? [arg.slice(2), all[index + 1]?.startsWith('--') ? 'true' : all[index + 1]]
          : null
      )
      .filter(Boolean)
  );
  try {
    const sha = flags.sha;
    if (!fullShaPattern.test(sha ?? '')) throw new Error('--sha must be a full 40-character SHA.');
    const options = {
      sha,
      repository: flags.repo,
      allowedEvents: ['workflow_dispatch', 'push'],
      requiredChecks: JSON.parse(flags.checks ?? '["ci-gate","policy-gate"]'),
      timeoutSeconds: Number(flags['timeout-seconds'] ?? 900),
      intervalSeconds: Number(flags['interval-seconds'] ?? 30),
    };
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository ?? ''))
      throw new Error('--repo must be owner/repo.');
    if (flags['checks-file']) {
      const checkRuns = JSON.parse(await readFile(flags['checks-file'], 'utf8'));
      const verdict = verifyExactCheckRuns(checkRuns, sha, options.requiredChecks);
      if (!verdict.passed) throw new Error(verdict.reason);
      process.stdout.write(`Exact-SHA governance checks verified for ${sha}.\n`);
    } else {
      const verdict = await awaitExactCi(options, createGithubReader(options.repository, sha));
      process.stdout.write(`Exact-SHA CI verified (run ${verdict.runId}).\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
