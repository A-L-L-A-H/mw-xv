export interface GracefulShutdownTarget {
  close(): Promise<void>;
  closeConnections(): void | Promise<void>;
  log(level: 'info' | 'error', message: string): void;
  forceExit?: (code: number) => void;
}

export async function gracefulShutdown(
  target: GracefulShutdownTarget,
  signal: NodeJS.Signals,
  timeoutMs = 30_000,
  forceExitDelayMs = 5_000
): Promise<void> {
  target.log('info', `Graceful shutdown started after ${signal}`);
  let hardExit: ReturnType<typeof setTimeout> | undefined;
  const forceClose = setTimeout(() => {
    target.log('error', `Graceful shutdown exceeded ${timeoutMs} ms; closing active connections`);
    void Promise.resolve(target.closeConnections()).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      target.log('error', `Force close connections failed: ${detail}`);
    });
    if (target.forceExit) {
      hardExit = setTimeout(() => {
        target.log('error', `Graceful shutdown still hung after force-close grace window; exiting`);
        target.forceExit?.(1);
      }, forceExitDelayMs);
      hardExit.unref();
    }
  }, timeoutMs);
  forceClose.unref();
  try {
    await target.close();
    target.log('info', 'Graceful shutdown complete');
  } finally {
    clearTimeout(forceClose);
    if (hardExit) clearTimeout(hardExit);
  }
}
