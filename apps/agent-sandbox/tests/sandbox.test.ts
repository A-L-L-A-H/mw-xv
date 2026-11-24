import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

import type {
  SandboxCommandResult,
  SandboxContainerSpec,
  SandboxExecOptions,
  SandboxExecutor,
} from '../src/contract.js';
import {
  buildContainerCreateBody,
  assertContainerSecurity,
  multiplexDockerExec,
} from '../src/executor.js';
import { resolveDockerSocketPath } from '../src/docker-transport.js';
import { WORKSPACE_LIMITS as LOCAL_LIMITS } from '../src/limits.js';
import { buildWorkspaceManifest } from '../src/manifest.js';
import { createSandboxServer, isAuthorized, loadSandboxConfig } from '../src/server.js';
import {
  assertPathAllowed,
  isSensitiveWorkspacePath,
  normalizeWorkspacePath,
  validateCreateParams,
  validateExecuteParams,
} from '../src/validation.js';
import { WorkspaceService } from '../src/workspace.js';
import { resolveSandboxPaths } from '../src/worktree.js';

const BASE_COMMIT = 'a'.repeat(40);
const IMAGE_REF = `registry.example.com/mw/sandbox@sha256:${'b'.repeat(64)}`;
const CONTAINER_ID = 'c'.repeat(64);

function okResult(stdout = ''): SandboxCommandResult {
  return {
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    cancelled: false,
    truncated: false,
    stdout,
    stderr: '',
  };
}

class FakeExecutor implements SandboxExecutor {
  readonly engine = 'rootless-docker' as const;
  readonly commands: string[][] = [];
  readonly containers = new Set<string>();
  stdoutFor: (command: readonly string[]) => string = () => '';

  async initialize(): Promise<void> {}
  async ensureContainer(): Promise<string> {
    this.containers.add(CONTAINER_ID);
    return CONTAINER_ID;
  }
  async execute(
    _id: string,
    command: readonly string[],
    _options: SandboxExecOptions
  ): Promise<SandboxCommandResult> {
    this.commands.push([...command]);
    return okResult(this.stdoutFor(command));
  }
  async removeContainer(id: string): Promise<void> {
    this.containers.delete(id);
  }
  async reconcile(): Promise<readonly string[]> {
    return [];
  }
}

async function fixture(): Promise<{
  dataDir: string;
  snapshotId: string;
  paths: Awaited<ReturnType<typeof resolveSandboxPaths>>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'mw-sandbox-test-'));
  const dataDir = path.join(root, 'data');
  const paths = await resolveSandboxPaths(dataDir);
  const snapshotId = 'fixture-snapshot';
  const snapshotDir = path.join(paths.snapshotsRoot, snapshotId);
  await mkdir(path.join(snapshotDir, 'src'), { recursive: true });
  await writeFile(path.join(snapshotDir, 'src', 'app.ts'), 'export const answer = 42;\n');
  await writeFile(path.join(snapshotDir, 'package.json'), '{"name":"fixture"}\n');
  await writeFile(
    path.join(snapshotDir, 'snapshot.json'),
    JSON.stringify({
      snapshotId,
      baseCommit: BASE_COMMIT,
      files: 2,
      sizeBytes: 50,
      treeSha256: 'e'.repeat(64),
      createdAt: new Date().toISOString(),
    })
  );
  return { dataDir, snapshotId, paths };
}

function createParams(snapshotId: string) {
  return {
    runId: 'run-1',
    snapshotId,
    imageRef: IMAGE_REF,
    baseCommit: BASE_COMMIT,
    allowedPaths: ['src', 'package.json'],
    cpuCores: 1,
    memoryMb: 512,
    pidsLimit: 64,
    timeoutMs: 10_000,
    maxOutputBytes: 65_536,
  };
}

test('workspace paths reject traversal, secrets and non-allowlisted checks', () => {
  assert.equal(normalizeWorkspacePath('src/app.ts'), 'src/app.ts');
  assert.throws(() => normalizeWorkspacePath('../etc/passwd'));
  assert.throws(() => normalizeWorkspacePath('/etc/passwd'));
  assert.throws(() => normalizeWorkspacePath('src/../../secret'));
  assert.equal(isSensitiveWorkspacePath('.env.local'), true);
  assert.equal(isSensitiveWorkspacePath('.git/config'), true);
  assert.equal(isSensitiveWorkspacePath('src/app.ts'), false);
  assert.throws(() => assertPathAllowed('secrets/key', ['src']));
  assert.doesNotThrow(() => assertPathAllowed('src/app.ts', ['src']));
  assert.throws(() => validateExecuteParams({ runId: 'run-1', check: 'bash' }));
  assert.deepEqual(
    validateExecuteParams({ runId: 'run-1', check: 'node-test' }).check,
    'node-test'
  );
});

test('create params require a pinned digest image and bounded resources', () => {
  const params = createParams('fixture-snapshot');
  assert.equal(validateCreateParams(params).runId, 'run-1');
  assert.throws(() => validateCreateParams({ ...params, imageRef: 'repo/image:latest' }));
  assert.throws(() => validateCreateParams({ ...params, memoryMb: 1_000_000 }));
});

test('container create body enforces rootless isolation and exactly one workspace mount', () => {
  const spec: SandboxContainerSpec = {
    runId: 'run-1',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    workspaceHostPath: '/var/lib/agent-sandbox/workspaces/run-1',
    imageRef: IMAGE_REF,
    manifest: buildWorkspaceManifest({
      runId: 'run-1',
      imageRef: IMAGE_REF,
      cpuCores: 1,
      memoryMb: 512,
      timeoutMs: 10_000,
    }),
    pidsLimit: 64,
  };
  const body = buildContainerCreateBody(spec);
  assert.equal(body.HostConfig.NetworkMode, 'none');
  assert.equal(body.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(body.HostConfig.CapDrop, ['ALL']);
  assert.equal(body.HostConfig.Privileged, false);
  assert.equal(body.HostConfig.Memory, body.HostConfig.MemorySwap);
  assert.deepEqual(body.HostConfig.Binds, [`${spec.workspaceHostPath}:/workspace:rw`]);
  assertContainerSecurity(spec, {
    Config: {
      Image: spec.imageRef,
      Env: body.Env,
      WorkingDir: '/workspace',
      Labels: body.Labels,
    },
    HostConfig: body.HostConfig,
    Mounts: [{ Type: 'bind', Source: spec.workspaceHostPath, Destination: '/workspace', RW: true }],
    State: { Running: true },
  });
  assert.throws(() =>
    assertContainerSecurity(spec, {
      Config: {
        Image: spec.imageRef,
        Env: body.Env,
        WorkingDir: '/workspace',
        Labels: body.Labels,
      },
      HostConfig: { ...body.HostConfig, Privileged: true },
      Mounts: [],
    })
  );
});

test('root-equivalent Docker socket is rejected; dedicated rootless socket is accepted', () => {
  assert.throws(() => resolveDockerSocketPath('/var/run/docker.sock'));
  assert.throws(() => resolveDockerSocketPath('/run/docker.sock'));
  assert.equal(resolveDockerSocketPath('/run/user/1000/docker.sock'), '/run/user/1000/docker.sock');
});

test('exec stream decoder handles multiplexing and rejects truncation', () => {
  const frame = multiplexDockerExec('hello', 'warn');
  assert.equal(frame.readUInt8(0), 1);
  assert.equal(frame.readUInt8(13), 2);
});

test('workspace lifecycle creates, diffs, commits, rolls back and destroys without host escapes', async () => {
  const { dataDir, snapshotId } = await fixture();
  const executor = new FakeExecutor();
  const service = new WorkspaceService({ dataDir, executor });
  const info = await service.createWorkspace(createParams(snapshotId));
  assert.equal(info.status, 'active');
  assert.equal(info.headCommit, BASE_COMMIT);

  executor.stdoutFor = (command) => {
    const text = command.join(' ');
    if (text.startsWith('git status')) return ' M src/app.ts\0';
    if (text.startsWith('git diff')) return 'diff --git a/src/app.ts b/src/app.ts\n+1\n';
    if (text.startsWith('git rev-parse')) return 'd'.repeat(40);
    return '';
  };
  const check = await service.executeCheck({ runId: 'run-1', check: 'node-test' });
  assert.deepEqual(executor.commands.at(-1), ['node', '--test']);
  assert.equal(check.exitCode, 0);

  const diff = await service.diffWorkspace({ runId: 'run-1' });
  assert.equal(diff.scopeClean, true);
  assert.deepEqual(diff.files, [{ path: 'src/app.ts', status: 'M' }]);
  assert.equal(diff.truncated, false);

  const commit = await service.commitLocal({ runId: 'run-1', message: 'local change' });
  assert.equal(commit.pushed, false);
  assert.equal(commit.commitSha, 'd'.repeat(40));

  const rolledBack = await service.rollbackWorkspace({ runId: 'run-1' });
  assert.equal(rolledBack.headCommit, BASE_COMMIT);

  const snapshot = await service.snapshotWorkspace({ runId: 'run-1', label: 'pre' });
  assert.equal(snapshot.base, false);
  await service.rollbackWorkspace({ runId: 'run-1', snapshotId: snapshot.snapshotId });

  const cancelled = await service.cancelWorkspace({ runId: 'run-1' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(executor.containers.size, 0);
  const destroyed = await service.destroyWorkspace({ runId: 'run-1' });
  assert.equal(destroyed.status, 'destroyed');
  await assert.rejects(() => service.executeCheck({ runId: 'run-1', check: 'node-test' }));
});

test('diff rejects paths outside the approved scope', async () => {
  const { dataDir, snapshotId } = await fixture();
  const executor = new FakeExecutor();
  executor.stdoutFor = (command) => (command.join(' ').startsWith('git status') ? '?? .env\0' : '');
  const service = new WorkspaceService({ dataDir, executor });
  await service.createWorkspace(createParams(snapshotId));
  await assert.rejects(() => service.diffWorkspace({ runId: 'run-1' }));
});

test('RPC server requires a bearer token and dispatches typed methods', async () => {
  const { dataDir, snapshotId } = await fixture();
  const executor = new FakeExecutor();
  const token = 'x'.repeat(48);
  const server = createSandboxServer({ token, dataDir, executor });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await (await fetch(`${url}/healthz`)).json(), { ok: true });

    const unauthorized = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '1', method: 'workspace.get', params: { runId: 'run-1' } }),
    });
    assert.equal(unauthorized.status, 401);

    assert.equal(isAuthorized(`Bearer ${token}`, token), true);
    assert.equal(isAuthorized(`Bearer ${'y'.repeat(48)}`, token), false);
    assert.equal(isAuthorized(undefined, token), false);

    const unknown = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: '2', method: 'workspace.shell', params: {} }),
    });
    assert.equal(unknown.status, 400);
    assert.equal(
      ((await unknown.json()) as { error: { code: string } }).error.code,
      'INVALID_REQUEST'
    );

    const created = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id: '3',
        method: 'workspace.create',
        params: createParams(snapshotId),
      }),
    });
    assert.equal(created.status, 200);
    const payload = (await created.json()) as { ok: boolean; result: { status: string } };
    assert.equal(payload.ok, true);
    assert.equal(payload.result.status, 'active');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('config fails closed without a strong token or with a root socket default', () => {
  assert.throws(() => loadSandboxConfig({}));
  assert.throws(() => loadSandboxConfig({ AGENT_SANDBOX_TOKEN: 'short' }));
  const config = loadSandboxConfig({
    AGENT_SANDBOX_TOKEN: 'z'.repeat(48),
    AGENT_SANDBOX_DOCKER_SOCKET: '/run/user/1000/docker.sock',
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3020);

  // No socket means the production default: health/read-only work, execution fails closed.
  const withoutSocket = loadSandboxConfig({ AGENT_SANDBOX_TOKEN: 'z'.repeat(48) });
  assert.equal(withoutSocket.dockerSocket, undefined);
});

test('local contract mirrors ai-runtime workspace contract limits', async () => {
  const { WORKSPACE_LIMITS } =
    await import('../../../packages/ai-runtime/src/workspace-contract.js');
  assert.deepEqual(LOCAL_LIMITS, WORKSPACE_LIMITS);
});
