import type { WorkspaceCheckKind, WorkspaceCreateParams } from './contract.js';
import { forbidden, invalid } from './errors.js';
import { WORKSPACE_LIMITS } from './limits.js';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const SNAPSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const COMMIT_SHA = /^[a-f0-9]{40,64}$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/u;
const PINNED_IMAGE =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]{1,5})?\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u;
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
const SENSITIVE_SEGMENT =
  /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|_netrc|\.aws|\.ssh|\.gnupg|\.docker|\.kube|\.secrets|secrets|credentials(?:\.json)?|service-account[^/]*\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.mw-sandbox)$/iu;
const SENSITIVE_SUFFIX = /\.(?:pem|key|p12|pfx|jks|keystore)$/iu;

export function assertRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = []
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of required) {
    if (!Object.hasOwn(record, key)) invalid(`${label}.${key} is required`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) {
    if (!allowed.has(key)) invalid(`${label}.${key} is not allowed`);
  }
}

export function requiredString(value: unknown, label: string, maxBytes = 1024): string {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`${label} must be a non-empty string`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes || value.includes('\0')) {
    invalid(`${label} is too long or contains a NUL byte`);
  }
  return value;
}

export function validateRunId(value: unknown): string {
  const runId = requiredString(value, 'runId', 64);
  if (!RUN_ID.test(runId)) invalid('runId contains unsupported characters');
  return runId;
}

export function validateSnapshotId(value: unknown): string {
  const snapshotId = requiredString(value, 'snapshotId', 64);
  if (!SNAPSHOT_ID.test(snapshotId)) invalid('snapshotId contains unsupported characters');
  return snapshotId;
}

export function validateLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const label = requiredString(value, 'label', 48);
  if (!LABEL.test(label)) invalid('label contains unsupported characters');
  return label;
}

export function validateImageRef(value: unknown): string {
  const imageRef = requiredString(value, 'imageRef', 512);
  if (!PINNED_IMAGE.test(imageRef)) {
    invalid('imageRef must be a lowercase registry reference pinned to a sha256 digest');
  }
  return imageRef;
}

export function validateBaseCommit(value: unknown): string {
  const baseCommit = requiredString(value, 'baseCommit', 64);
  if (!COMMIT_SHA.test(baseCommit)) invalid('baseCommit must be a full lowercase commit SHA');
  return baseCommit;
}

export function isSensitiveWorkspacePath(relativePath: string): boolean {
  const segments = relativePath.toLowerCase().split('/');
  return segments.some(
    (segment) => SENSITIVE_SEGMENT.test(segment) || SENSITIVE_SUFFIX.test(segment)
  );
}

/** Strict POSIX relative paths. No URL decoding, backslashes, traversal, or symlink components. */
export function normalizeWorkspacePath(value: unknown, label = 'path'): string {
  const raw = requiredString(value, label, 1024);
  if (
    hasControlCharacter(raw) ||
    raw.includes('\\') ||
    raw.includes(':') ||
    raw.startsWith('/') ||
    raw.startsWith('~') ||
    raw.includes('//')
  ) {
    forbidden(`${label} must be a safe relative workspace path`);
  }
  if (raw === '.') return raw;
  const segments = raw.split('/');
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..' || segment.length > 255
    )
  ) {
    forbidden(`${label} contains an unsafe path segment`);
  }
  const normalized = segments.join('/');
  if (isSensitiveWorkspacePath(normalized)) {
    forbidden(`${label} targets a reserved or sensitive path`);
  }
  return normalized;
}

export function validateAllowedPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > WORKSPACE_LIMITS.allowedPaths) {
    invalid(`allowedPaths must contain 1..${WORKSPACE_LIMITS.allowedPaths} paths`);
  }
  const paths = value.map((entry) => normalizeWorkspacePath(entry, 'allowedPaths entry'));
  return [...new Set(paths)].sort();
}

export function assertPathAllowed(relativePath: string, allowedPaths: readonly string[]): void {
  const normalized = normalizeWorkspacePath(relativePath);
  if (
    !allowedPaths.some(
      (prefix) => prefix === '.' || normalized === prefix || normalized.startsWith(`${prefix}/`)
    )
  ) {
    forbidden(`Path '${normalized}' is outside the workspace scope`);
  }
}

function boundedNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer: boolean
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(`${label} must be a finite number`);
  }
  if ((integer && !Number.isInteger(value)) || value < min || value > max) {
    invalid(`${label} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return value;
}

export function validateResources(value: Record<string, unknown>): {
  cpuCores: number;
  memoryMb: number;
  pidsLimit: number;
  timeoutMs: number;
  maxOutputBytes: number;
} {
  return {
    cpuCores: boundedNumber(value.cpuCores, 'cpuCores', 0.25, 4, false),
    memoryMb: boundedNumber(value.memoryMb, 'memoryMb', 128, 4096, true),
    pidsLimit: boundedNumber(value.pidsLimit, 'pidsLimit', 16, 256, true),
    timeoutMs: boundedNumber(value.timeoutMs, 'timeoutMs', 1_000, 120_000, true),
    maxOutputBytes: boundedNumber(value.maxOutputBytes, 'maxOutputBytes', 1_024, 1_048_576, true),
  };
}

export function validateCreateParams(value: unknown): WorkspaceCreateParams {
  assertRecord(
    value,
    'params',
    [
      'runId',
      'snapshotId',
      'imageRef',
      'baseCommit',
      'allowedPaths',
      ...Object.keys(validateResourceKeys()),
    ],
    []
  );
  return {
    runId: validateRunId(value.runId),
    snapshotId: validateSnapshotId(value.snapshotId),
    imageRef: validateImageRef(value.imageRef),
    baseCommit: validateBaseCommit(value.baseCommit),
    allowedPaths: validateAllowedPaths(value.allowedPaths),
    ...validateResources(value),
  };
}

function validateResourceKeys(): Record<string, true> {
  return {
    cpuCores: true,
    memoryMb: true,
    pidsLimit: true,
    timeoutMs: true,
    maxOutputBytes: true,
  };
}

export function validateRunParams(value: unknown): { readonly runId: string } {
  assertRecord(value, 'params', ['runId']);
  return { runId: validateRunId(value.runId) };
}

export function validateSnapshotParams(value: unknown): {
  readonly runId: string;
  readonly label?: string;
} {
  assertRecord(value, 'params', ['runId'], ['label']);
  return { runId: validateRunId(value.runId), ...validateLabelOptional(value.label) };
}

function validateLabelOptional(label: unknown): { readonly label?: string } {
  const validated = validateLabel(label);
  return validated === undefined ? {} : { label: validated };
}

export function validateExecuteParams(value: unknown): {
  readonly runId: string;
  readonly check: WorkspaceCheckKind;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
} {
  assertRecord(value, 'params', ['runId', 'check'], ['cwd', 'timeoutMs', 'maxOutputBytes']);
  const checks = new Set([
    'node-test',
    'bun-test',
    'bun-typecheck',
    'bun-lint',
    'bun-build',
    'vitest-run',
    'tsc-noemit',
  ]);
  if (typeof value.check !== 'string' || !checks.has(value.check)) {
    forbidden('check is not an allowed fixed command template');
  }
  const result: {
    runId: string;
    check: WorkspaceCheckKind;
    cwd?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
  } = {
    runId: validateRunId(value.runId),
    check: value.check as WorkspaceCheckKind,
  };
  if (value.cwd !== undefined) result.cwd = normalizeWorkspacePath(value.cwd, 'cwd');
  if (value.timeoutMs !== undefined) {
    result.timeoutMs = boundedNumber(value.timeoutMs, 'timeoutMs', 1_000, 120_000, true);
  }
  if (value.maxOutputBytes !== undefined) {
    result.maxOutputBytes = boundedNumber(
      value.maxOutputBytes,
      'maxOutputBytes',
      1_024,
      1_048_576,
      true
    );
  }
  return result;
}

export function validateListParams(value: unknown): {
  readonly runId: string;
  readonly path?: string;
} {
  assertRecord(value, 'params', ['runId'], ['path']);
  const runId = validateRunId(value.runId);
  if (value.path === undefined) return { runId };
  return { runId, path: normalizeWorkspacePath(value.path, 'path') };
}

export function validateReadParams(value: unknown): {
  readonly runId: string;
  readonly path: string;
  readonly offset?: number;
  readonly maxBytes?: number;
} {
  assertRecord(value, 'params', ['runId', 'path'], ['offset', 'maxBytes']);
  const result: {
    runId: string;
    path: string;
    offset?: number;
    maxBytes?: number;
  } = { runId: validateRunId(value.runId), path: normalizeWorkspacePath(value.path, 'path') };
  if (value.offset !== undefined) {
    result.offset = boundedNumber(value.offset, 'offset', 0, 16 * 1024 * 1024, true);
  }
  if (value.maxBytes !== undefined) {
    result.maxBytes = boundedNumber(value.maxBytes, 'maxBytes', 1_024, 1_048_576, true);
  }
  return result;
}

export function validatePatchParams(value: unknown): {
  readonly runId: string;
  readonly operations: readonly {
    readonly type: 'write' | 'append';
    readonly path: string;
    readonly content: string;
  }[];
} {
  assertRecord(value, 'params', ['runId', 'operations'], []);
  const runId = validateRunId(value.runId);
  if (
    !Array.isArray(value.operations) ||
    value.operations.length === 0 ||
    value.operations.length > 64
  ) {
    invalid('operations must contain 1..64 typed patch operations');
  }
  const operations = value.operations.map((raw) => {
    assertRecord(raw, 'operation', ['type', 'path', 'content'], []);
    if (raw.type !== 'write' && raw.type !== 'append') {
      forbidden('Patch operation type must be write or append');
    }
    const content = requiredString(raw.content, 'operation.content', 512 * 1024);
    return {
      type: raw.type as 'write' | 'append',
      path: normalizeWorkspacePath(raw.path, 'operation.path'),
      content,
    };
  });
  return { runId, operations };
}

export function validateDiffParams(value: unknown): {
  readonly runId: string;
  readonly maxOutputBytes?: number;
} {
  assertRecord(value, 'params', ['runId'], ['maxOutputBytes']);
  const runId = validateRunId(value.runId);
  if (value.maxOutputBytes === undefined) return { runId };
  return {
    runId,
    maxOutputBytes: boundedNumber(value.maxOutputBytes, 'maxOutputBytes', 1_024, 1_048_576, true),
  };
}

export function validateCommitParams(value: unknown): {
  readonly runId: string;
  readonly message: string;
} {
  assertRecord(value, 'params', ['runId', 'message']);
  const message = requiredString(value.message, 'message', WORKSPACE_LIMITS.commitMessageBytes);
  if (hasControlCharacter(message.replaceAll('\n', '').replaceAll('\t', ''))) {
    invalid('message contains control characters');
  }
  return { runId: validateRunId(value.runId), message: message.trim() };
}

export function validateRollbackParams(value: unknown): {
  readonly runId: string;
  readonly snapshotId?: string;
} {
  assertRecord(value, 'params', ['runId'], ['snapshotId']);
  const runId = validateRunId(value.runId);
  if (value.snapshotId === undefined) return { runId };
  return { runId, snapshotId: validateSnapshotId(value.snapshotId) };
}

export function validateReconcileParams(value: unknown): { readonly olderThanMs?: number } {
  assertRecord(value, 'params', [], ['olderThanMs']);
  if (value.olderThanMs === undefined) return {};
  return {
    olderThanMs: boundedNumber(value.olderThanMs, 'olderThanMs', 0, 86_400_000, true),
  };
}
