// Child-process worker used by worker-health-and-drain.test.ts. Plain .mjs with
// explicit .ts specifiers so Node 22's type stripping can run it directly from
// the TypeScript source without a build step.
import { createGracefulDrainController, raceWithAbort } from '../../src/drain.ts';
import { createWorkerHealthContract } from '../../src/health.ts';

const mode = process.argv[2] ?? 'drain';
const drainTimeoutMs = Number(process.argv[3] ?? 300);

const health = createWorkerHealthContract({ worker: `child-${mode}` });
health.markBootstrapped();
health.setDependencyStatus('database', 'up');

const emit = (type, payload = {}) => {
  process.stdout.write(`${JSON.stringify({ type, ...payload })}\n`);
};

const drain = createGracefulDrainController({
  workerId: `child-${mode}`,
  drainTimeoutMs,
  onDrainStart: () => health.beginDrain('SIGTERM'),
});

// Keep the event loop alive until the scenario completes.
const keepAlive = setInterval(() => {}, 1000);
let workTimer;
let settled = false;

function beginDrain() {
  if (settled || mode === 'forced') return;
  settled = true;
  drain.begin('SIGTERM');
  drain.enterJob();
  // Readiness must be false before the in-flight job is awaited.
  emit('drain-started', { ready: health.isReady(), state: drain.state });
  const work = raceWithAbort(
    new Promise((resolve) => {
      workTimer = setTimeout(resolve, mode === 'timeout' ? 60_000 : 40);
      workTimer.unref?.();
    }),
    drain.executionSignal
  );
  const finish = (error) => {
    drain.exitJob(!error);
    const outcome = drain.finish();
    emit('outcome', {
      ...outcome,
      ready: health.isReady(),
      error: error ? error.name : undefined,
    });
    clearInterval(keepAlive);
    if (workTimer !== undefined) clearTimeout(workTimer);
    // Drop the pipe to the parent. Keeping stdin open would retain an active
    // handle and prevent natural exit even after all drain work has settled.
    process.stdin.destroy();
    // process.exit() can truncate pending writes to a pipe. Let stdout flush,
    // then exit naturally now that no refs keep the event loop alive.
    process.exitCode = 0;
  };
  work.then(() => finish(undefined), finish);
}

if (mode === 'forced') {
  // SIGKILL is intentionally uncatchable; keeping the event loop alive is enough.
} else {
  // Install the signal handler before advertising readiness: the parent treats
  // "ready" as permission to send SIGTERM immediately.
  process.once('SIGTERM', beginDrain);
  process.stdin.once('data', () => {
    process.stdin.pause();
    beginDrain();
  });
}

emit('ready', { worker: health.worker, ready: health.isReady() });
