/**
 * Read-only HTTP health probe for the MoonWitness API.
 * Performs a single GET request; never mutates anything.
 */
export interface ApiHealthOptions {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface ApiHealthResult {
  readonly ok: boolean;
  readonly status: number | null;
  readonly latencyMs: number;
  readonly error?: string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 5_000;

export async function probeApiHealth(options: ApiHealthOptions = {}): Promise<ApiHealthResult> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
