import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type {
  SandboxCommandResult,
  SandboxContainerSpec,
  SandboxExecutor,
  SandboxExecOptions,
  WorkspaceEngine,
} from './contract.js';
import {
  DockerApiError,
  DockerHttpTransport,
  DockerOutputLimitError,
  dockerQuery,
  isNotFound,
  type DockerTransport,
} from './docker-transport.js';
import { forbidden, unavailable } from './errors.js';

const MANAGED_LABEL = 'moonwitness.agent-sandbox';
const WORKSPACE_MOUNT = '/workspace';
const CONTAINER_ID = /^[a-f0-9]{12,64}$/u;
const FIXED_ENV = [
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'HOME=/workspace/.mw-sandbox/home',
  'TMPDIR=/workspace/.mw-sandbox/tmp',
  'XDG_CACHE_HOME=/workspace/.mw-sandbox/cache',
  'CI=1',
  'NO_COLOR=1',
  'GIT_CONFIG_NOSYSTEM=1',
  'GIT_CONFIG_GLOBAL=/dev/null',
] as const;

interface DockerCreateBody {
  readonly Image: string;
  readonly name?: string;
  readonly Cmd: readonly string[];
  readonly Entrypoint: readonly string[];
  readonly WorkingDir: string;
  readonly Env: readonly string[];
  readonly Labels: Readonly<Record<string, string>>;
  readonly HostConfig: {
    readonly NetworkMode: 'none';
    readonly ReadonlyRootfs: true;
    readonly CapDrop: readonly ['ALL'];
    readonly SecurityOpt: readonly ['no-new-privileges:true'];
    readonly Privileged: false;
    readonly AutoRemove: false;
    readonly Memory: number;
    readonly MemorySwap: number;
    readonly NanoCpus: number;
    readonly PidsLimit: { readonly Type: ''; readonly Hard: number };
    readonly RestartPolicy: { readonly Name: 'no'; readonly MaximumRetryCount: 0 };
    readonly Binds: readonly string[];
    readonly Mounts: readonly [];
    readonly ExposedPorts: Readonly<Record<string, never>>;
  };
}

interface DockerInspect {
  readonly Id?: unknown;
  readonly Name?: unknown;
  readonly Config?: {
    readonly Image?: unknown;
    readonly Env?: unknown;
    readonly WorkingDir?: unknown;
    readonly Labels?: unknown;
  };
  readonly HostConfig?: Record<string, unknown>;
  readonly Mounts?: unknown;
  readonly State?: { readonly Running?: unknown };
}

export function buildContainerCreateBody(spec: SandboxContainerSpec): DockerCreateBody {
  if (!path.isAbsolute(spec.workspaceHostPath) || /[\0,\r\n:]/u.test(spec.workspaceHostPath)) {
    forbidden('Executor workspace must be a safe absolute bind-mount path');
  }
  const memoryBytes = spec.manifest.memoryMb * 1024 * 1024;
  return {
    Image: spec.imageRef,
    name: `mw-agent-${spec.workspaceId}`,
    // An idle PID 1 keeps the dedicated container available for later typed checks.
    Cmd: ['/bin/sh', '-c', 'exec sleep 2147483647'],
    Entrypoint: [],
    WorkingDir: WORKSPACE_MOUNT,
    Env: FIXED_ENV,
    Labels: {
      [MANAGED_LABEL]: 'true',
      'moonwitness.run-id': spec.runId,
      'moonwitness.workspace-id': spec.workspaceId,
    },
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Privileged: false,
      AutoRemove: false,
      Memory: memoryBytes,
      // Equal memory and swap prevents swap from bypassing the memory ceiling.
      MemorySwap: memoryBytes,
      NanoCpus: Math.round(spec.manifest.cpuCores * 1_000_000_000),
      PidsLimit: { Type: '', Hard: spec.pidsLimit },
      RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
      Binds: [`${path.resolve(spec.workspaceHostPath)}:${WORKSPACE_MOUNT}:rw`],
      Mounts: [],
      ExposedPorts: {},
    },
  };
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? (value as string[])
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function assertContainerSecurity(spec: SandboxContainerSpec, inspect: DockerInspect): void {
  const host = record(inspect.HostConfig);
  const config = record(inspect.Config);
  const labels = record(config.Labels);
  const mounts = Array.isArray(inspect.Mounts) ? inspect.Mounts.map(record) : [];
  const pids = record(host.PidsLimit);
  const expectedSource = path.resolve(spec.workspaceHostPath);

  if (
    labels[MANAGED_LABEL] !== 'true' ||
    labels['moonwitness.run-id'] !== spec.runId ||
    labels['moonwitness.workspace-id'] !== spec.workspaceId
  ) {
    forbidden('Container ownership labels do not match this workspace');
  }
  if (
    host.NetworkMode !== 'none' ||
    host.ReadonlyRootfs !== true ||
    !stringArray(host.CapDrop).includes('ALL') ||
    !stringArray(host.SecurityOpt).some(
      (option) => option === 'no-new-privileges:true' || option === 'no-new-privileges'
    ) ||
    host.Privileged === true ||
    host.AutoRemove !== false ||
    host.Memory !== spec.manifest.memoryMb * 1024 * 1024 ||
    host.MemorySwap !== spec.manifest.memoryMb * 1024 * 1024 ||
    host.NanoCpus !== Math.round(spec.manifest.cpuCores * 1_000_000_000) ||
    pids.Hard !== spec.pidsLimit ||
    record(host.RestartPolicy).Name !== 'no' ||
    config.WorkingDir !== WORKSPACE_MOUNT ||
    config.Image !== spec.imageRef
  ) {
    forbidden('Container security manifest does not match the required isolation policy');
  }
  if (
    mounts.length !== 1 ||
    mounts[0]?.Type !== 'bind' ||
    mounts[0]?.Source !== expectedSource ||
    mounts[0]?.Destination !== WORKSPACE_MOUNT ||
    mounts[0]?.RW !== true
  ) {
    forbidden('Container must have exactly one writable mount: its per-run workspace');
  }
  const env = stringArray(config.Env);
  for (const required of FIXED_ENV) {
    if (!env.includes(required)) forbidden('Container environment isolation is incomplete');
  }
  for (const entry of env) {
    if (
      /^(?:AWS_|AZURE_|GOOGLE_|MW_AI_|OPENAI_|ANTHROPIC_|.*(?:SECRET|TOKEN|PASSWORD|CREDENTIAL)).*/iu.test(
        entry
      )
    ) {
      forbidden('Container environment contains a prohibited host secret');
    }
  }
}

class ExecStreamDecoder {
  private pending = Buffer.alloc(0);
  private stdoutBytes = 0;
  private stderrBytes = 0;
  readonly stdout: Buffer[] = [];
  readonly stderr: Buffer[] = [];

  private readonly maxOutputBytes: number;

  constructor(maxOutputBytes: number) {
    this.maxOutputBytes = maxOutputBytes;
  }

  push(chunk: Buffer): void {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 8) {
      const stream = this.pending[0];
      const length = this.pending.readUInt32BE(4);
      if (stream !== 1 && stream !== 2) {
        throw new Error('Invalid Docker exec stream frame');
      }
      if (this.pending.length < 8 + length) break;
      const payload = this.pending.subarray(8, 8 + length);
      this.pending = this.pending.subarray(8 + length);
      const target = stream === 1 ? this.stdout : this.stderr;
      const used = stream === 1 ? this.stdoutBytes : this.stderrBytes;
      const remaining = Math.max(0, this.maxOutputBytes - used);
      if (payload.length > remaining) {
        target.push(payload.subarray(0, remaining));
        if (stream === 1) this.stdoutBytes += remaining;
        else this.stderrBytes += remaining;
        throw new DockerOutputLimitError();
      }
      target.push(payload);
      if (stream === 1) this.stdoutBytes += payload.length;
      else this.stderrBytes += payload.length;
    }
    if (this.pending.length > 8 * 1024 * 1024) {
      throw new Error('Docker exec frame exceeds its bounded header');
    }
  }

  finish(): void {
    if (this.pending.length !== 0) throw new Error('Truncated Docker exec stream frame');
  }

  get stdoutByteCount(): number {
    return this.stdoutBytes;
  }

  get stderrByteCount(): number {
    return this.stderrBytes;
  }
}

export class DockerExecutor implements SandboxExecutor {
  readonly engine = 'rootless-docker' as const;
  private readonly transport: DockerTransport;
  private initialized = false;

  constructor(transport: DockerTransport) {
    this.transport = transport;
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    const response = await this.transport.request({
      method: 'GET',
      path: '/info',
      signal,
      timeoutMs: 5_000,
      maxResponseBytes: 1024 * 1024,
    });
    let info: { SecurityOptions?: unknown };
    try {
      info = JSON.parse(response.body.toString('utf8')) as { SecurityOptions?: unknown };
    } catch (error) {
      throw unavailable('Docker daemon returned malformed /info JSON', error);
    }
    if (!stringArray(info.SecurityOptions).includes('name=rootless')) {
      forbidden('Docker daemon does not certify rootless mode; refusing all execution');
    }
    this.initialized = true;
  }

  async ensureContainer(spec: SandboxContainerSpec, signal?: AbortSignal): Promise<string> {
    await this.initialize(signal);
    const body = buildContainerCreateBody(spec);
    let existing: DockerInspect | undefined;
    try {
      existing = await this.inspectNamed(body.name ?? '', signal);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (existing !== undefined) {
      return this.adoptOrStart(existing, spec, signal);
    }

    let created: { Id?: unknown };
    try {
      created = await this.api<{ Id?: unknown }>(
        'POST',
        dockerQuery('/containers/create', { name: body.name ?? '' }),
        {
          body,
          signal,
          timeoutMs: 30_000,
        }
      );
    } catch (error) {
      if (!(error instanceof DockerApiError) || error.statusCode !== 409) throw error;
      existing = await this.inspectNamed(body.name ?? '', signal);
      return this.adoptOrStart(existing, spec, signal);
    }
    const id = containerId(created.Id);
    const inspect = await this.inspect(id, signal);
    assertContainerSecurity(spec, inspect);
    await this.api('POST', dockerQuery(`/containers/${id}/start`, {}), {
      signal,
      timeoutMs: 30_000,
    });
    return id;
  }

  async execute(
    containerIdValue: string,
    command: readonly string[],
    options: SandboxExecOptions
  ): Promise<SandboxCommandResult> {
    await this.initialize(options.signal);
    const id = containerId(containerIdValue);
    if (command.length === 0 || command.length > 64 || command.some((arg) => arg.includes('\0'))) {
      forbidden('Executor command is empty, too large, or contains a NUL byte');
    }
    const startedAt = Date.now();
    let execId: string | undefined;
    const decoder = new ExecStreamDecoder(options.maxOutputBytes);
    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    let truncated = false;
    const onAbort = (): void => {
      cancelled = true;
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Sandbox check timed out'));
    }, options.timeoutMs);
    timer.unref?.();

    try {
      const exec = await this.api<{ Id?: unknown }>(
        'POST',
        dockerQuery(`/containers/${id}/exec`, {}),
        {
          body: {
            AttachStdout: true,
            AttachStderr: true,
            AttachStdin: false,
            Detach: false,
            Tty: false,
            Privileged: false,
            Cmd: [...command],
            Env: FIXED_ENV,
            WorkingDir: options.cwd ?? WORKSPACE_MOUNT,
          },
          signal: controller.signal,
          timeoutMs: options.timeoutMs + 5_000,
        }
      );
      execId = containerId(exec.Id);
      await this.api('POST', dockerQuery(`/exec/${execId}/start`, {}), {
        body: { Detach: false, Tty: false },
        signal: controller.signal,
        timeoutMs: options.timeoutMs + 5_000,
        maxResponseBytes: Math.min(16 * 1024 * 1024, options.maxOutputBytes * 16 + 65_536),
        onData: (chunk) => decoder.push(chunk),
      });
      decoder.finish();
    } catch (error) {
      if (options.signal?.aborted) cancelled = true;
      if (timedOut) timedOut = true;
      if (error instanceof DockerOutputLimitError) truncated = true;
      if (!cancelled && !timedOut && !truncated) {
        throw unavailable('Docker exec transport failed', error);
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    if (cancelled || timedOut || truncated) {
      // Killing the container cgroup terminates the complete process tree, not only PID 1.
      await this.removeContainer(id);
    }

    let exitCode = cancelled ? 130 : timedOut ? 124 : truncated ? 125 : 0;
    if (!cancelled && !timedOut && !truncated && execId !== undefined) {
      const exec = await this.api<{ Running?: unknown; ExitCode?: unknown }>(
        'GET',
        dockerQuery(`/exec/${execId}/json`, {}),
        { timeoutMs: 5_000, maxResponseBytes: 64 * 1024 }
      );
      if (
        exec.Running !== false ||
        typeof exec.ExitCode !== 'number' ||
        !Number.isInteger(exec.ExitCode)
      ) {
        throw unavailable('Docker exec did not terminate with a valid exit code', exec.Running);
      }
      exitCode = exec.ExitCode;
    }

    return {
      exitCode,
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut,
      cancelled,
      truncated,
      stdout: Buffer.concat(decoder.stdout, decoder.stdoutByteCount).toString('utf8'),
      stderr: Buffer.concat(decoder.stderr, decoder.stderrByteCount).toString('utf8'),
    };
  }

  async removeContainer(containerIdValue: string, signal?: AbortSignal): Promise<void> {
    const id = containerId(containerIdValue);
    try {
      await this.api('POST', dockerQuery(`/containers/${id}/kill`, {}), {
        signal,
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
      });
    } catch (error) {
      if (!isNotFound(error) && !(error instanceof DockerApiError && error.statusCode === 409)) {
        throw error;
      }
    }
    try {
      await this.api('DELETE', dockerQuery(`/containers/${id}`, { force: true, v: true }), {
        signal,
        timeoutMs: 15_000,
        maxResponseBytes: 64 * 1024,
      });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async reconcile(workspaceRoot: string, signal?: AbortSignal): Promise<readonly string[]> {
    await this.initialize(signal);
    const realRoot = realpathSync(workspaceRoot);
    const filters = JSON.stringify({ label: [`${MANAGED_LABEL}=true`] });
    const containers = await this.api<readonly DockerInspect[]>(
      'GET',
      dockerQuery('/containers/all', { all: true, filters }),
      { signal, timeoutMs: 15_000, maxResponseBytes: 4 * 1024 * 1024 }
    );
    const removed: string[] = [];
    for (const container of containers) {
      const id = containerId(container.Id);
      const inspect = await this.inspect(id, signal);
      const labels = record(record(inspect.Config).Labels);
      const workspaceId = labels['moonwitness.workspace-id'];
      const runId = labels['moonwitness.run-id'];
      if (
        typeof workspaceId !== 'string' ||
        !/^[a-f0-9-]{36}$/u.test(workspaceId) ||
        typeof runId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(runId)
      ) {
        forbidden('Refusing to reconcile a container with invalid ownership labels');
      }
      const mounts = Array.isArray(inspect.Mounts) ? inspect.Mounts.map(record) : [];
      const expected = path.join(realRoot, `run-${workspaceId}`);
      if (
        mounts.length !== 1 ||
        mounts[0]?.Type !== 'bind' ||
        mounts[0]?.Destination !== WORKSPACE_MOUNT ||
        path.resolve(String(mounts[0]?.Source ?? '')) !== expected
      ) {
        forbidden('Refusing to reconcile a container outside the managed workspace root');
      }
      await this.removeContainer(id, signal);
      removed.push(id);
    }
    return removed;
  }

  private async adoptOrStart(
    inspect: DockerInspect,
    spec: SandboxContainerSpec,
    signal?: AbortSignal
  ): Promise<string> {
    assertContainerSecurity(spec, inspect);
    const id = containerId(inspect.Id);
    if (record(inspect.State).Running !== true) {
      await this.api('POST', dockerQuery(`/containers/${id}/start`, {}), {
        signal,
        timeoutMs: 30_000,
      });
    }
    return id;
  }

  private async inspectNamed(name: string, signal?: AbortSignal): Promise<DockerInspect> {
    return this.api<DockerInspect>(
      'GET',
      dockerQuery(`/containers/${encodeURIComponent(name)}/json`, {}),
      { signal, timeoutMs: 10_000, maxResponseBytes: 1024 * 1024 }
    );
  }

  private async inspect(id: string, signal?: AbortSignal): Promise<DockerInspect> {
    return this.api<DockerInspect>('GET', dockerQuery(`/containers/${id}/json`, {}), {
      signal,
      timeoutMs: 10_000,
      maxResponseBytes: 1024 * 1024,
    });
  }

  private async api<T>(
    method: 'GET' | 'POST' | 'DELETE',
    requestPath: string,
    options: {
      readonly body?: unknown;
      readonly signal?: AbortSignal;
      readonly timeoutMs?: number;
      readonly maxResponseBytes?: number;
      readonly onData?: (chunk: Buffer) => void;
    } = {}
  ): Promise<T> {
    await this.initializeIfMutating(method, options.signal);
    const response = await this.transport.request({ method, path: requestPath, ...options });
    if (response.statusCode === 204 || response.statusCode === 304 || response.body.length === 0) {
      return {} as T;
    }
    try {
      return JSON.parse(response.body.toString('utf8')) as T;
    } catch (error) {
      throw unavailable('Docker daemon returned malformed JSON', error);
    }
  }

  private async initializeIfMutating(method: string, signal?: AbortSignal): Promise<void> {
    if (method !== 'GET' || !this.initialized) await this.initialize(signal);
  }
}

function containerId(value: unknown): string {
  if (typeof value !== 'string' || !CONTAINER_ID.test(value)) {
    throw unavailable('Docker daemon returned an invalid container/exec identifier');
  }
  return value;
}

/** Exported for deterministic fake-daemon tests. */
/**
 * Fail-closed executor used when no dedicated rootless Docker socket is
 * configured. The sandbox still serves health and read-only workspace
 * inspection, but every container operation is rejected with EXECUTOR_UNAVAILABLE.
 */
export class DisabledSandboxExecutor implements SandboxExecutor {
  readonly engine: WorkspaceEngine = 'rootless-docker';

  private reject(): never {
    unavailable(
      'Docker execution is disabled: mount a dedicated rootless daemon socket via docker-compose.agent-sandbox-socket.yml'
    );
  }

  async initialize(): Promise<void> {
    // No external dependency to initialize when execution is disabled.
  }

  async ensureContainer(): Promise<string> {
    return this.reject();
  }

  async execute(): Promise<SandboxCommandResult> {
    return this.reject();
  }

  async removeContainer(): Promise<void> {
    return this.reject();
  }

  async reconcile(): Promise<readonly string[]> {
    return [];
  }
}

export function multiplexDockerExec(stdout: string, stderr = ''): Buffer {
  const frames: Buffer[] = [];
  for (const [stream, text] of [
    [1, stdout],
    [2, stderr],
  ] as const) {
    const payload = Buffer.from(text, 'utf8');
    if (payload.length === 0) continue;
    const header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    frames.push(header, payload);
  }
  return Buffer.concat(frames);
}
