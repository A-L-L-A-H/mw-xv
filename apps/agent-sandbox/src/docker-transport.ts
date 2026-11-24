import { request as httpRequest } from 'node:http';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { forbidden, invalid, unavailable } from './errors.js';

export interface DockerApiRequest {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly onData?: (chunk: Buffer) => void;
}

export interface DockerApiResponse {
  readonly statusCode: number;
  readonly body: Buffer;
}

export interface DockerTransport {
  request(options: DockerApiRequest): Promise<DockerApiResponse>;
}

export class DockerApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DockerApiError';
    this.statusCode = statusCode;
  }
}

export class DockerOutputLimitError extends Error {
  constructor() {
    super('Docker response exceeded its byte limit');
    this.name = 'DockerOutputLimitError';
  }
}

const FORBIDDEN_SOCKETS = new Set(['/var/run/docker.sock', '/run/docker.sock']);
const DEFAULT_API_TIMEOUT_MS = 10_000;
const DEFAULT_API_RESPONSE_BYTES = 4 * 1024 * 1024;

/** No implicit fallback: operators must name the dedicated rootless daemon socket. */
export function resolveDockerSocketPath(configuredPath: string): string {
  if (
    typeof configuredPath !== 'string' ||
    configuredPath.trim() === '' ||
    configuredPath.includes('\0') ||
    !path.isAbsolute(configuredPath)
  ) {
    invalid('AGENT_SANDBOX_DOCKER_SOCKET must be an absolute Unix socket path');
  }
  const absolute = path.resolve(configuredPath);
  let real = absolute;
  try {
    real = realpathSync(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') unavailable('Docker socket cannot be resolved', error);
  }
  if (FORBIDDEN_SOCKETS.has(absolute) || FORBIDDEN_SOCKETS.has(real)) {
    forbidden('The root-equivalent default Docker socket is never accepted');
  }
  // A rootless Docker daemon exposes its socket at /run/user/<uid>/docker.sock.
  // Requiring that dedicated runtime directory keeps it distinct from the
  // root-equivalent /var/run/docker.sock and /run/docker.sock rejected above.
  if (!/^\/run\/user\/[0-9]+\/docker\.sock$/u.test(real)) {
    forbidden('A dedicated rootless daemon socket under /run/user/<uid>/ is required');
  }
  return real;
}

export function dockerQuery(
  pathname: string,
  values: Readonly<Record<string, string | number | boolean>>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) query.set(key, String(value));
  return `${pathname}?${query.toString()}`;
}

export class DockerHttpTransport implements DockerTransport {
  readonly socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = resolveDockerSocketPath(socketPath);
  }

  request(options: DockerApiRequest): Promise<DockerApiResponse> {
    if (
      !options.path.startsWith('/') ||
      options.path.startsWith('//') ||
      /[\r\n]/u.test(options.path)
    ) {
      return Promise.reject(invalid('Docker API path must be a local absolute path'));
    }
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? new Error('Docker request aborted'));
    }

    const payload =
      options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
    const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_API_RESPONSE_BYTES;

    return new Promise<DockerApiResponse>((resolve, reject) => {
      let settled = false;
      let responseBytes = 0;
      const chunks: Buffer[] = [];
      let timer: NodeJS.Timeout | undefined = undefined;
      let activeRequest: ReturnType<typeof httpRequest> | undefined;

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => {
        const error = options.signal?.reason ?? new Error('Docker request aborted');
        activeRequest?.destroy(error instanceof Error ? error : new Error(String(error)));
        fail(error);
      };

      try {
        activeRequest = httpRequest(
          {
            socketPath: this.socketPath,
            path: options.path,
            method: options.method,
            agent: false,
            headers: {
              accept: 'application/json, application/vnd.docker.raw-stream',
              ...(payload === undefined
                ? {}
                : { 'content-type': 'application/json', 'content-length': payload.length }),
            },
          },
          (response) => {
            response.on('data', (chunk: Buffer) => {
              if (settled) return;
              responseBytes += chunk.length;
              try {
                options.onData?.(chunk);
                if (responseBytes > maxResponseBytes) {
                  throw new DockerOutputLimitError();
                }
                chunks.push(chunk);
              } catch (error) {
                response.destroy(error instanceof Error ? error : new Error(String(error)));
                activeRequest?.destroy(error instanceof Error ? error : new Error(String(error)));
                fail(error);
              }
            });
            response.on('end', () => {
              if (settled) return;
              const body = Buffer.concat(chunks, responseBytes);
              if (response.statusCode !== undefined && response.statusCode >= 400) {
                fail(dockerError(response.statusCode, body));
                return;
              }
              settled = true;
              cleanup();
              resolve({ statusCode: response.statusCode ?? 0, body });
            });
            response.on('aborted', () => fail(new Error('Docker response was aborted')));
            response.on('error', (error) => fail(error));
          }
        );
      } catch (error) {
        fail(error);
        return;
      }

      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        const error = new Error('Docker API request timed out');
        activeRequest?.destroy(error);
        fail(error);
      }, timeoutMs);
      timer.unref?.();
      activeRequest.on('error', (error) => fail(error));
      if (payload !== undefined) activeRequest.end(payload);
      else activeRequest.end();
    });
  }
}

function dockerError(statusCode: number, body: Buffer): DockerApiError {
  let message = `Docker API returned HTTP ${statusCode}`;
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { message?: unknown };
    if (typeof parsed.message === 'string') message = parsed.message.slice(0, 1_024);
  } catch {
    // A non-JSON daemon error is still bounded and must not be echoed verbatim.
  }
  return new DockerApiError(statusCode, message);
}

export function isNotFound(error: unknown): boolean {
  return error instanceof DockerApiError && error.statusCode === 404;
}
