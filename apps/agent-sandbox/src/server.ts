import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  WorkspaceRpcFailure,
  WorkspaceRpcMethod,
  WorkspaceRpcRequest,
  WorkspaceRpcResponse,
} from './contract.js';
import { DisabledSandboxExecutor, DockerExecutor } from './executor.js';
import { DockerHttpTransport } from './docker-transport.js';
import { SandboxError, asSandboxError } from './errors.js';
import { WorkspaceService, type WorkspaceServiceOptions } from './workspace.js';

const MAX_REQUEST_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 130_000;
const METHODS: ReadonlySet<string> = new Set([
  'workspace.create',
  'workspace.snapshot',
  'workspace.execute-check',
  'workspace.list',
  'workspace.read',
  'workspace.apply-patch',
  'workspace.diff',
  'workspace.commit-local',
  'workspace.rollback',
  'workspace.cancel',
  'workspace.destroy',
  'workspace.get',
  'workspace.reconcile',
]);

export interface SandboxServerConfig {
  readonly token: string;
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly dockerSocket?: string;
}

export function loadSandboxConfig(env: NodeJS.ProcessEnv = process.env): SandboxServerConfig {
  const token = env.AGENT_SANDBOX_TOKEN;
  if (typeof token !== 'string' || token.trim().length < 32) {
    throw new Error(
      'AGENT_SANDBOX_TOKEN must be set to a high-entropy value of at least 32 characters'
    );
  }
  const host = env.AGENT_SANDBOX_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0', '::1'].includes(host)) {
    throw new Error('AGENT_SANDBOX_HOST must be a private bind address');
  }
  const port = Number(env.AGENT_SANDBOX_PORT ?? 3020);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('AGENT_SANDBOX_PORT must be a valid TCP port');
  }
  const dataDir = env.AGENT_SANDBOX_DATA_DIR ?? '/var/lib/agent-sandbox';
  const configuredSocket = env.AGENT_SANDBOX_DOCKER_SOCKET;
  const dockerSocket =
    typeof configuredSocket === 'string' && configuredSocket.trim() !== ''
      ? configuredSocket
      : undefined;
  return { token, host, port, dataDir, ...(dockerSocket ? { dockerSocket } : {}) };
}

export function isAuthorized(header: string | undefined, token: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const presented = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

function readBoundedBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(new SandboxError('INVALID_REQUEST', 'RPC request exceeded its byte limit'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks, total)));
    request.on('error', reject);
    request.on('aborted', () =>
      reject(new SandboxError('INVALID_REQUEST', 'RPC request was aborted'))
    );
  });
}

function asRpcRequest(value: unknown): WorkspaceRpcRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SandboxError('INVALID_REQUEST', 'RPC body must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 128) {
    throw new SandboxError('INVALID_REQUEST', 'RPC id must be a bounded non-empty string');
  }
  if (typeof candidate.method !== 'string' || !METHODS.has(candidate.method)) {
    throw new SandboxError('INVALID_REQUEST', 'Unknown or forbidden RPC method');
  }
  if (!Object.hasOwn(candidate, 'params')) {
    throw new SandboxError('INVALID_REQUEST', 'RPC params are required');
  }
  return candidate as unknown as WorkspaceRpcRequest;
}

export function createSandboxServer(options: WorkspaceServiceOptions & { readonly token: string }) {
  const service = new WorkspaceService(options);
  const token = options.token;

  return createHttpServer((request, response) => {
    const pathname = (request.url ?? '').split('?')[0];
    if (request.method === 'GET' && pathname === '/healthz') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || pathname !== '/rpc') {
      sendJson(response, 404, { ok: false, error: 'Not found' });
      return;
    }
    if (!isAuthorized(request.headers.authorization, token)) {
      sendJson(response, 401, {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Invalid sandbox credential', retryable: false },
      });
      return;
    }

    const timer = setTimeout(() => {
      if (!response.headersSent) {
        sendJson(response, 408, {
          ok: false,
          error: { code: 'TIMEOUT', message: 'RPC request timed out', retryable: true },
        });
      }
      request.destroy();
    }, REQUEST_TIMEOUT_MS);
    timer.unref?.();
    response.once('close', () => clearTimeout(timer));

    void (async () => {
      let requestId = 'unknown';
      try {
        const body = await readBoundedBody(request);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          throw new SandboxError('INVALID_REQUEST', 'RPC body must be valid JSON');
        }
        const rpc = asRpcRequest(rpcGuard(parsed));
        requestId = rpc.id;
        const result = await dispatch(service, rpc.method, rpc.params);
        sendJson(response, 200, { id: rpc.id, ok: true, result });
      } catch (error) {
        const sandboxError = asSandboxError(error);
        const failure: WorkspaceRpcFailure = {
          id: requestId,
          ok: false,
          error: {
            code: sandboxError.code,
            message: sandboxError.message,
            retryable: sandboxError.retryable,
          },
        };
        if (!response.headersSent) sendJson(response, sandboxError.statusCode, failure);
      }
    })();
  });
}

/** Prevent prototype pollution and unexpected key shapes before dispatch. */
function rpcGuard(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.some(([key]) => key === '__proto__' || key === 'constructor' || key === 'prototype')
  ) {
    throw new SandboxError('INVALID_REQUEST', 'RPC body contains forbidden keys');
  }
  return value;
}

async function dispatch(
  service: WorkspaceService,
  method: WorkspaceRpcMethod,
  params: unknown
): Promise<WorkspaceRpcResponse['result']> {
  switch (method) {
    case 'workspace.create':
      return service.createWorkspace(params);
    case 'workspace.snapshot':
      return service.snapshotWorkspace(params);
    case 'workspace.execute-check':
      return service.executeCheck(params);
    case 'workspace.list':
      return service.listWorkspace(params);
    case 'workspace.read':
      return service.readWorkspaceFile(params);
    case 'workspace.apply-patch':
      return service.applyWorkspacePatch(params);
    case 'workspace.diff':
      return service.diffWorkspace(params);
    case 'workspace.commit-local':
      return service.commitLocal(params);
    case 'workspace.rollback':
      return service.rollbackWorkspace(params);
    case 'workspace.cancel':
      return service.cancelWorkspace(params);
    case 'workspace.destroy':
      return service.destroyWorkspace(params);
    case 'workspace.get':
      return service.getWorkspace(params);
    case 'workspace.reconcile':
      return service.reconcileWorkspaces(params);
    default:
      throw new SandboxError('INVALID_REQUEST', 'Unsupported RPC method');
  }
}

export async function startSandboxServer(config: SandboxServerConfig): Promise<void> {
  const executor = config.dockerSocket
    ? new DockerExecutor(new DockerHttpTransport(config.dockerSocket))
    : new DisabledSandboxExecutor();
  const server = createSandboxServer({
    token: config.token,
    dataDir: config.dataDir,
    executor,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`agent-sandbox received ${signal}; draining\n`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref?.();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void startSandboxServer(loadSandboxConfig()).catch((error: unknown) => {
    process.stderr.write(
      `agent-sandbox failed to start: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
