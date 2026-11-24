/**
 * Shared, transport-agnostic health contract for MoonWitness workers
 * (jobs worker, scheduler and outbox worker).
 *
 * The shapes in this module intentionally expose *only* process and dependency
 * status. They never carry job payloads, tokens, connection strings or any other
 * secret, so a health endpoint built from them is safe to expose on a private
 * interface. The functions at the bottom validate the configured bind interface
 * and port so that every worker fails startup with the same actionable errors.
 */

export type WorkerHealthState = 'starting' | 'ready' | 'draining' | 'stopped';
export type WorkerDependencyStatus = 'up' | 'down' | 'unknown';
export type WorkerLivenessState = 'alive';
export type WorkerReadinessState = 'ready' | 'not-ready';

/** `/livez` response: proves only that the process is running. */
export interface WorkerLivenessResponse {
  status: WorkerLivenessState;
  worker: string;
  pid: number;
  uptimeSeconds: number;
}

/** A single named dependency's safe status (no credentials or endpoints). */
export interface WorkerDependencyHealth {
  name: string;
  status: WorkerDependencyStatus;
  detail?: string;
}

/** `/readyz` response: proves bootstrap completed and dependencies are up. */
export interface WorkerReadinessResponse {
  status: WorkerReadinessState;
  worker: string;
  ready: boolean;
  state: WorkerHealthState;
  dependencies: WorkerDependencyHealth[];
}

/** Combined standardized health snapshot shared by every worker. */
export interface WorkerHealthResponse {
  live: WorkerLivenessResponse;
  ready: WorkerReadinessResponse;
}

/** Optional async probe used to refresh a dependency's status on demand. */
export type DependencyProbe = () => boolean | Promise<boolean>;

export interface WorkerHealthOptions {
  worker: string;
  /** Known dependency names; defaults to `['database']`. */
  dependencies?: readonly string[];
  /** Mark bootstrap as already complete (defaults to false: readiness starts false). */
  bootstrapped?: boolean;
  /** Monotonic milliseconds clock, injectable for deterministic tests. */
  now?: () => number;
  /** Process uptime in seconds, injectable for deterministic tests. */
  uptime?: () => number;
  pid?: number;
}

export interface WorkerHealthContract {
  readonly worker: string;
  readonly state: WorkerHealthState;
  /** Liveness never depends on bootstrap or external systems. */
  getLiveness(): WorkerLivenessResponse;
  /** Runs registered dependency probes and returns a fresh readiness response. */
  getReadiness(): Promise<WorkerReadinessResponse>;
  /** Cached readiness without probing (cheap enough for a shutdown hot path). */
  isReady(): boolean;
  snapshot(): Promise<WorkerHealthResponse>;
  /** Adds a dependency, optionally with a probe that refreshes its status. */
  registerDependency(name: string, probe?: DependencyProbe): void;
  setDependencyStatus(name: string, status: WorkerDependencyStatus, detail?: string): void;
  /** Called after bootstrap and all required dependencies are available. */
  markBootstrapped(): void;
  /** Manual readiness override; `false` forces not-ready regardless of dependencies. */
  setReady(ready: boolean): void;
  /** Readiness turns false *before* shutdown/drain begins. */
  beginDrain(reason?: string): void;
  markStopped(): void;
}

const REDACTION = /(bearer\s+\S+|(?:password|secret|token|credential)\s*[:=]\s*\S+)/gi;

/** Sanitizes free-form dependency detail so health output can never leak a secret. */
export function sanitizeHealthDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  return detail.replace(REDACTION, '[REDACTED]').slice(0, 200);
}

export function createWorkerHealthContract(options: WorkerHealthOptions): WorkerHealthContract {
  if (!options.worker || options.worker.length > 255)
    throw new Error('worker must contain 1 to 255 characters');
  const now = options.now ?? (() => Date.now());
  const bootTime = now();
  const uptime = options.uptime ?? (() => Math.max(0, (now() - bootTime) / 1000));
  const pid = options.pid ?? process.pid;

  let state: WorkerHealthState = options.bootstrapped ? 'ready' : 'starting';
  let manualReady = true;
  const statuses = new Map<string, WorkerDependencyHealth>();
  const probes = new Map<string, DependencyProbe>();
  for (const name of options.dependencies ?? ['database']) {
    statuses.set(name, { name, status: 'unknown' });
  }

  const isReadyCached = (): boolean =>
    manualReady &&
    state !== 'starting' &&
    state !== 'stopped' &&
    state !== 'draining' &&
    [...statuses.values()].every(({ status }) => status === 'up');

  const contract: WorkerHealthContract = {
    get worker() {
      return options.worker;
    },
    get state() {
      return state;
    },
    getLiveness() {
      return {
        status: 'alive',
        worker: options.worker,
        pid,
        uptimeSeconds: Math.max(0, Math.floor(uptime())),
      };
    },
    async getReadiness() {
      for (const [name, probe] of probes) {
        try {
          const ok = await probe();
          statuses.set(name, { name, status: ok ? 'up' : 'down' });
        } catch {
          statuses.set(name, { name, status: 'down' });
        }
      }
      const ready = isReadyCached();
      return {
        status: ready ? 'ready' : 'not-ready',
        worker: options.worker,
        ready,
        state,
        dependencies: [...statuses.values()].map((dependency) => ({ ...dependency })),
      };
    },
    isReady: isReadyCached,
    async snapshot() {
      return { live: contract.getLiveness(), ready: await contract.getReadiness() };
    },
    registerDependency(name, probe) {
      if (!name) throw new Error('dependency name must not be empty');
      if (!statuses.has(name)) statuses.set(name, { name, status: 'unknown' });
      if (probe) probes.set(name, probe);
    },
    setDependencyStatus(name, status, detail) {
      statuses.set(name, { name, status, detail: sanitizeHealthDetail(detail) });
    },
    markBootstrapped() {
      if (state === 'starting') state = 'ready';
    },
    setReady(ready) {
      manualReady = ready;
    },
    beginDrain() {
      // Readiness must be false before any drain work starts, and liveness stays
      // true so the process is not restarted merely for shutting down.
      manualReady = false;
      if (state !== 'stopped') state = 'draining';
    },
    markStopped() {
      manualReady = false;
      state = 'stopped';
    },
  };
  return contract;
}

// ---------------------------------------------------------------------------
// Safe listener configuration shared by jobs-worker, scheduler and outbox worker
// ---------------------------------------------------------------------------

export const DEFAULT_WORKER_HEALTH_HOST = '127.0.0.1';

const SAFE_BIND_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Health probes may only bind to a loopback interface. */
export function isSafeBindHost(host: string): boolean {
  return SAFE_BIND_HOSTS.has(host.trim().toLowerCase());
}

/** Parses a port from the environment; `0` disables probes. */
export function readWorkerHealthPort(value: string | undefined, name: string): number {
  if (value === undefined || value === '') return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535; 0 disables worker probes`);
  }
  return port;
}

/** Parses and validates the configured bind host, defaulting to loopback. */
export function readWorkerHealthHost(value: string | undefined, name: string): string {
  const host = (value ?? '').trim() || DEFAULT_WORKER_HEALTH_HOST;
  if (!isSafeBindHost(host)) {
    throw new Error(
      `${name} must be a loopback interface (127.0.0.1, localhost or ::1); refusing to bind "${host}"`
    );
  }
  return host;
}

export interface WorkerProbeConfig {
  host: string;
  port: number;
}

/**
 * Validates a worker's probe listener configuration with one shared, actionable
 * error contract. Returns `null` when probes are disabled (`port === 0`).
 */
export function validateWorkerProbeConfig(config: {
  name: string;
  host?: string;
  port: number | string | undefined;
}): WorkerProbeConfig | null {
  const { name } = config;
  const port =
    typeof config.port === 'string' || config.port === undefined
      ? readWorkerHealthPort(config.port, name)
      : config.port;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535; 0 disables worker probes`);
  }
  if (port === 0) return null;
  return { host: readWorkerHealthHost(config.host, `${name}_HOST`), port };
}
