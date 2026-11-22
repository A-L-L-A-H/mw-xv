export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export interface ProcessShutdownController {
  signal: AbortSignal;
  dispose(): void;
}

export interface ProcessShutdownOptions {
  readonly onUnhandledError?: (reason: unknown) => void;
}

export interface ServiceContainerLike {
  disposeAll(): Promise<void> | void;
}

/** Connect termination signals and fatal process errors to one graceful abort signal. */
export function createProcessShutdownController(
  onStopping: () => void = () => undefined,
  options: ProcessShutdownOptions & { services?: ServiceContainerLike } = {}
): ProcessShutdownController {
  const controller = new AbortController();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    onStopping();
    void options.services?.disposeAll();
    controller.abort();
  };
  const stopOnFatal = (error: unknown) => {
    options.onUnhandledError?.(error);
    if (!options.onUnhandledError) {
      const summary = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Fatal unhandled worker error: ${summary}\n`);
    }
    process.exitCode = 1;
    stop();
  };
  const signals: ShutdownSignal[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) process.once(signal, stop);
  process.once('unhandledRejection', stopOnFatal);
  process.once('uncaughtException', stopOnFatal);

  return {
    signal: controller.signal,
    dispose() {
      for (const signal of signals) process.removeListener(signal, stop);
      process.removeListener('unhandledRejection', stopOnFatal);
      process.removeListener('uncaughtException', stopOnFatal);
    },
  };
}
