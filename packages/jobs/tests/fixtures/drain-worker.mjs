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
emit('ready', { worker: health.worker, ready: health.isReady() });

if (mode !== 'forced') {
  process.once('SIGTERM', () => {
    drain.begin('SIGTERM');
    drain.enterJob();
    // Readiness must be false before the in-flight job is awaited.
    emit('drain-started', { ready: health.isReady(), state: drain.state });
    const work = raceWithAbort(
      new Promise((resolve) => setTimeout(resolve, mode === 'timeout' ? 60_000 : 40)),
      drain.executionSignal
    );
    const settle = (error) => {
      drain.exitJob(!error);
      const outcome = drain.finish();
      emit('outcome', {
        ...outcome,
        ready: health.isReady(),
        error: error ? error.name : undefined,
      });
      clearInterval(keepAlive);
      // The bounded work timer may still be pending; exit explicitly so the
      // drain scenario is deterministic and does not keep the process alive.
      process.exit(0);
    };
    work.then(() => settle(undefined), settle);
  });
}
