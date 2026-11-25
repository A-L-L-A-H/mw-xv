import { sha256Canonical } from './canonical-json.js';
import { createRedactor } from './redaction.js';

export type SandboxRuntimeEngine = 'docker' | 'microvm';

export interface SandboxManifestRequest {
  readonly runId: string;
  readonly engine?: SandboxRuntimeEngine;
  readonly imageRef: string;
  readonly command: readonly string[];
  readonly cpuCores?: number;
  readonly memoryMb?: number;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface EphemeralSandboxManifest {
  readonly runId: string;
  readonly engine: SandboxRuntimeEngine;
  readonly imageRef: string;
  readonly command: readonly string[];
  readonly networkDisabled: true;
  readonly readOnlyRootFs: true;
  readonly secretsInjected: false;
  readonly droppedCapabilities: readonly ['ALL'];
  readonly cpuCores: number;
  readonly memoryMb: number;
  readonly timeoutMs: number;
  readonly cliArgs: readonly string[];
  readonly sanitizedEnvKeys: readonly string[];
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly manifestSha256: string;
}

export interface SandboxExecutionOutput {
  readonly runId: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly unifiedDiff: string;
}

export interface SandboxVerificationResult {
  readonly runId: string;
  readonly passed: boolean;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly secretLeakDetected: boolean;
  readonly redactedStdout: string;
  readonly redactedStderr: string;
  readonly diffLineCount: number;
  readonly ablationGateCompatible: boolean;
  readonly ablationDeltaBps: number;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfMerge: false;
  readonly verificationSha256: string;
}

const MAX_CPU_CORES = 4;
const MAX_MEMORY_MB = 4096;
const MAX_TIMEOUT_MS = 120_000;
const SENSITIVE_ENV_KEY_REGEX = /(?:secret|token|password|api[_-]?key|credential|auth)/iu;
const SECRET_LEAK_MARKER_REGEX = /\[REDACTED/u;

export function buildEphemeralSandboxManifest(
  request: SandboxManifestRequest
): EphemeralSandboxManifest {
  const redactor = createRedactor();
  const engine: SandboxRuntimeEngine = request.engine ?? 'docker';
  const cpuCores = Math.max(0.25, Math.min(MAX_CPU_CORES, request.cpuCores ?? 1));
  const memoryMb = Math.max(128, Math.min(MAX_MEMORY_MB, Math.floor(request.memoryMb ?? 512)));
  const timeoutMs = Math.max(
    1000,
    Math.min(MAX_TIMEOUT_MS, Math.floor(request.timeoutMs ?? 30_000))
  );

  const sanitizedEnvKeys = Object.keys(request.env ?? {})
    .filter((key) => !SENSITIVE_ENV_KEY_REGEX.test(key))
    .sort();

  const cliArgs: string[] =
    engine === 'docker'
      ? [
          'run',
          '--rm',
          '--network=none',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges:true',
          `--cpus=${String(cpuCores)}`,
          `--memory=${String(memoryMb)}m`,
          request.imageRef,
          ...request.command,
        ]
      : [
          'microvm-run',
          '--ephemeral',
          '--network=none',
          '--rootfs=ro',
          '--cap-drop=ALL',
          `--vcpus=${String(Math.ceil(cpuCores))}`,
          `--mem-mb=${String(memoryMb)}`,
          `--timeout-ms=${String(timeoutMs)}`,
          request.imageRef,
          ...request.command,
        ];

  const core = {
    runId: redactor.redactString(request.runId),
    engine,
    imageRef: redactor.redactString(request.imageRef),
    command: request.command.map((arg) => redactor.redactString(arg)),
    networkDisabled: true as const,
    readOnlyRootFs: true as const,
    secretsInjected: false as const,
    droppedCapabilities: ['ALL'] as const,
    cpuCores,
    memoryMb,
    timeoutMs,
    cliArgs,
    sanitizedEnvKeys,
    automatedPromotionAllowed: false as const,
    automatedSelfMerge: false as const,
  };

  return {
    ...core,
    manifestSha256: sha256Canonical(core),
  };
}

export function verifySandboxExecutionOutput(
  manifest: EphemeralSandboxManifest,
  output: SandboxExecutionOutput,
  baselineScoreBps = 5000,
  candidateScoreBps = 5000
): SandboxVerificationResult {
  const redactor = createRedactor();
  const redactedStdout = redactor.redactString(output.stdout);
  const redactedStderr = redactor.redactString(output.stderr);
  const timedOut = output.durationMs > manifest.timeoutMs;
  const secretLeakDetected =
    redactedStdout !== output.stdout ||
    redactedStderr !== output.stderr ||
    SECRET_LEAK_MARKER_REGEX.test(redactedStdout) ||
    SECRET_LEAK_MARKER_REGEX.test(redactedStderr);

  const diffLineCount = output.unifiedDiff
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-')).length;

  const passed = output.exitCode === 0 && !timedOut && !secretLeakDetected;
  const ablationDeltaBps = Math.round(candidateScoreBps - baselineScoreBps);
  const ablationGateCompatible = passed && ablationDeltaBps >= 0;

  const core = {
    runId: manifest.runId,
    passed,
    exitCode: output.exitCode,
    timedOut,
    secretLeakDetected,
    redactedStdout,
    redactedStderr,
    diffLineCount,
    ablationGateCompatible,
    ablationDeltaBps,
    automatedPromotionAllowed: false as const,
    automatedSelfMerge: false as const,
  };

  return {
    ...core,
    verificationSha256: sha256Canonical(core),
  };
}
