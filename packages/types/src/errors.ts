export type PlatformErrorCode =
  | 'validation_failed'
  | 'access_denied'
  | 'not_found'
  | 'concurrency_conflict'
  | 'schema_sync_failed'
  | 'platform_error';

export interface PlatformErrorOptions {
  readonly code?: PlatformErrorCode;
  readonly details?: unknown;
  readonly cause?: unknown;
}

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  httpStatus: number;
  readonly details?: unknown;

  constructor(message: string, options: PlatformErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? 'platform_error';
    this.httpStatus = 500;
    this.details = options.details;
  }
}

export class ValidationError extends PlatformError {
  constructor(message = 'Validation failed', options: PlatformErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'validation_failed' });
    this.httpStatus = 400;
  }
}

export class AccessDeniedError extends PlatformError {
  constructor(message = 'Access denied', options: PlatformErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'access_denied' });
    this.httpStatus = 403;
  }
}

export class NotFoundError extends PlatformError {
  constructor(message = 'Not found', options: PlatformErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'not_found' });
    this.httpStatus = 404;
  }
}

export class ConcurrencyConflictError extends PlatformError {
  constructor(message = 'Concurrency conflict', options: PlatformErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'concurrency_conflict' });
    this.httpStatus = 409;
  }
}

export class SchemaSyncError extends PlatformError {
  constructor(message = 'Schema sync failed', options: PlatformErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'schema_sync_failed' });
    this.httpStatus = 500;
  }
}
