const DEFAULT_POLL_INTERVAL_MS = 250;

export async function waitForApiReady({
  url,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  isStopping = () => false,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}) {
  while (!isStopping()) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return true;
    } catch {
      // The API may still be starting or restarting.
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

export function isApiFatalLine(line) {
  return (
    line.includes('"event":"api_startup_failure"') ||
    line.includes('Schema migration failed') ||
    line.includes('"level":60')
  );
}
