import { CI_GATE_CHECK_NAME } from './ci-gate.mjs';

const fullShaPattern = /^[a-f0-9]{40}$/u;

/**
 * Select the newest completed-or-running exact-SHA `push` run on `main`.
 * PR, dispatch, other-branch, other-SHA, and fork runs are never eligible.
 * @param {Array<{id:number,head_sha:string,head_branch:string,event:string,created_at:string,run_attempt?:number}>} workflowRuns
 * @param {string} sourceSha
 */
export function selectMainPushCiRun(workflowRuns, sourceSha) {
  if (!fullShaPattern.test(sourceSha)) return undefined;
  const time = (value) => {
    const parsed = Date.parse(value ?? '');
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return workflowRuns
    .filter(
      (run) =>
        run &&
        run.head_sha === sourceSha &&
        run.head_branch === 'main' &&
        run.event === 'push' &&
        Number.isSafeInteger(run.id)
    )
    .sort((left, right) => {
      const dateOrder = time(left.created_at) - time(right.created_at);
      const attemptOrder = Number(left.run_attempt ?? 0) - Number(right.run_attempt ?? 0);
      return dateOrder || attemptOrder || left.id - right.id;
    })
    .at(-1);
}

/**
 * Require a terminal, successful exact-SHA main push run whose newest
 * `ci-gate` job also succeeded. Missing, stale, cancelled, skipped and
 * non-success evidence all fail closed.
 * @param {{id:number,head_sha:string,head_branch:string,event:string,status:string,conclusion:string|null}} run
 * @param {Array<{id?:number,name:string,status?:string,conclusion?:string|null}>} jobs
 * @param {string} sourceSha
 */
export function verifyMainPushCiGate(run, jobs, sourceSha) {
  if (
    !fullShaPattern.test(sourceSha) ||
    !run ||
    run.head_sha !== sourceSha ||
    run.head_branch !== 'main' ||
    run.event !== 'push'
  ) {
    return { passed: false, reason: 'no exact main push CI run exists for this source SHA' };
  }
  if (run.status !== 'completed') {
    return { passed: false, pending: true, reason: `CI run status is ${run.status}` };
  }
  if (run.conclusion !== 'success') {
    return {
      passed: false,
      reason: `CI run concluded ${run.conclusion ?? 'without a conclusion'}`,
    };
  }
  const gate = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job?.name === CI_GATE_CHECK_NAME)
    .sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0))[0];
  if (gate?.status !== 'completed' || gate.conclusion !== 'success') {
    return {
      passed: false,
      reason: `main push CI run has no successful ${CI_GATE_CHECK_NAME} job`,
    };
  }
  return { passed: true, runId: run.id, runAttempt: run.run_attempt };
}

export { CI_GATE_CHECK_NAME };
