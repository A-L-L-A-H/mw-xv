import type { FastifyRequest } from 'fastify';

export interface ApiPaginationMeta {
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: ApiPaginationMeta;
  requestId?: string;
}

export interface ApiErrorEnvelope {
  success: false;
  error: string;
  code: string;
  requestId?: string;
  type?: string;
  data?: unknown;
}

export function okEnvelope<T>(
  data: T,
  options?: { meta?: ApiPaginationMeta; request?: FastifyRequest; requestId?: string }
): ApiSuccessEnvelope<T> {
  const requestId = options?.requestId ?? options?.request?.id;
  return {
    success: true,
    data,
    ...(options?.meta !== undefined ? { meta: options.meta } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

export function errorEnvelope(
  error: string,
  code: string,
  options?: {
    request?: FastifyRequest;
    requestId?: string;
    type?: string;
    data?: unknown;
  }
): ApiErrorEnvelope {
  const requestId = options?.requestId ?? options?.request?.id;
  return {
    success: false,
    error,
    code,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(options?.type !== undefined ? { type: options.type } : {}),
    ...(options?.data !== undefined ? { data: options.data } : {}),
  };
}
