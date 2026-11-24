import type { WorkspaceRpcErrorCode } from './contract.js';

export class SandboxError extends Error {
  readonly code: WorkspaceRpcErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number;

  constructor(
    code: WorkspaceRpcErrorCode,
    message: string,
    options: { readonly retryable?: boolean; readonly statusCode?: number; readonly cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SandboxError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode =
      options.statusCode ??
      (code === 'UNAUTHENTICATED'
        ? 401
        : code === 'INVALID_REQUEST'
          ? 400
          : code === 'FORBIDDEN'
            ? 403
            : code === 'NOT_FOUND'
              ? 404
              : code === 'CONFLICT' || code === 'CANCELLED'
                ? 409
                : code === 'TIMEOUT'
                  ? 408
                  : code === 'OUTPUT_LIMIT'
                    ? 413
                    : code === 'EXECUTOR_UNAVAILABLE'
                      ? 503
                      : 500);
  }
}

export function invalid(message: string): never {
  throw new SandboxError('INVALID_REQUEST', message);
}

export function forbidden(message: string): never {
  throw new SandboxError('FORBIDDEN', message);
}

export function notFound(message: string): never {
  throw new SandboxError('NOT_FOUND', message);
}

export function conflict(message: string): never {
  throw new SandboxError('CONFLICT', message);
}

export function cancelled(message = 'Workspace execution was cancelled'): never {
  throw new SandboxError('CANCELLED', message);
}

export function unavailable(message: string, cause?: unknown): never {
  throw new SandboxError('EXECUTOR_UNAVAILABLE', message, { retryable: true, cause });
}

export function outputLimit(message = 'Workspace output exceeded its bound'): never {
  throw new SandboxError('OUTPUT_LIMIT', message);
}

export function asSandboxError(error: unknown): SandboxError {
  return error instanceof SandboxError
    ? error
    : new SandboxError('INTERNAL', 'Sandbox operation failed', { cause: error });
}
