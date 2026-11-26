import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopHarnessBridge } from '../src/bridge.js';
import { startDesktopSidecarDaemon } from '../src/cli.js';
import { importDesktopTasks } from '../src/importer.js';
import { LocalSidecarController, DESKTOP_ADDONS } from '../src/local-sidecar.js';
import { ensureLocalWorkspaceBootstrap, startLocalApiServer } from '../src/local-api-server.js';

describe('LocalApiServer & Desktop Importer', () => {
  const tempDirs: string[] = [];
  const handles: Array<{ stop(): Promise<void> }> = [];

  function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    while (handles.length > 0) {
      const handle = handles.pop();
      if (handle) {
        await handle.stop();
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // Windows SQLite WAL handle may linger briefly after test teardown
        }
      }
    }
  });

  it('serves offline auth, /api/app/bootstrap, /api/projects/:id/board, /_desktop/rpc, and /mcp', async () => {
    const tempHome = makeTempDir('mw-desktop-api-');
    const sqlitePath = path.join(tempHome, 'local.db');
    const daemon = await startDesktopSidecarDaemon({
      repoRoot: process.cwd(),
      desktopHomeDir: tempHome,
      sqlitePath,
      boardOrigin: 'http://127.0.0.1:5173',
      apiBaseUrl: 'http://127.0.0.1:4242',
      healthPort: 0,
      apiPort: 0,
      offlineMode: true,
      installAddonsOnStart: true,
    });
    handles.push(daemon);

    // 1. Health check
    const healthRes = await fetch(daemon.healthUrl);
    expect(healthRes.status).toBe(200);
    const healthBody = (await healthRes.json()) as { ok: boolean };
    expect(healthBody.ok).toBe(true);

    // 2. Offline login
    const loginRes = await fetch(`${daemon.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'local', password: 'local-offline-session' }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as {
      success: boolean;
      data: { access_token: string; refresh_token: string; user: { login: string; role: string } };
    };
    expect(loginBody.success).toBe(true);
    expect(loginBody.data.user.login).toBe('local');
    expect(loginBody.data.user.role).toBe('superadmin');
    const token = loginBody.data.access_token;

    // 3. /api/app/bootstrap
    const bootRes = await fetch(`${daemon.apiUrl}/api/app/bootstrap`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bootRes.status).toBe(200);
    const bootBody = (await bootRes.json()) as {
      success: boolean;
      data: { user: { login: string }; activeCompany: { id: number; name: string } };
    };
    expect(bootBody.success).toBe(true);
    expect(bootBody.data.user.login).toBe('local');
    expect(bootBody.data.activeCompany.name).toBe('Local Workspace');

    // 4. /api/projects/1/board (INV-014 projectHttpPlugin)
    const boardRes = await fetch(`${daemon.apiUrl}/api/projects/1/board`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(boardRes.status).toBe(200);
    const boardBody = (await boardRes.json()) as {
      success: boolean;
      data: { project: { code: string }; stages: readonly { code: string }[] };
    };
    expect(boardBody.success).toBe(true);
    expect(boardBody.data.project.code.length).toBeGreaterThan(0);
    expect(boardBody.data.stages.length).toBeGreaterThanOrEqual(4);

    // 5. /_desktop/rpc auth rejection & acceptance
    const rpcUnauthRes = await fetch(`${daemon.apiUrl}/_desktop/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'getStatus' }),
    });
    expect(rpcUnauthRes.status).toBe(401);

    const rpcAuthRes = await fetch(`${daemon.apiUrl}/_desktop/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mw-desktop-token': daemon.rpcToken,
      },
      body: JSON.stringify({ command: 'getStatus' }),
    });
    expect(rpcAuthRes.status).toBe(200);
    const rpcBody = (await rpcAuthRes.json()) as {
      success: boolean;
      data: { protocolVersion: string };
    };
    expect(rpcBody.success).toBe(true);
    expect(rpcBody.data.protocolVersion).toBe('1.0');

    // 6. /mcp (Streamable HTTP MCP)
    const mcpRes = await fetch(daemon.mcpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });
    expect(mcpRes.status).toBe(200);
    const mcpBody = (await mcpRes.json()) as {
      jsonrpc: string;
      result: { tools: readonly { name: string }[] };
    };
    expect(mcpBody.jsonrpc).toBe('2.0');
    expect(mcpBody.result.tools.some((t) => t.name === 'project.list_tasks')).toBe(true);

    // 7. Offline admin & notification loopback endpoints
    const authHeaders = { authorization: `Bearer ${token}` };

    const jobsHealthRes = await fetch(`${daemon.apiUrl}/admin/jobs/health`, {
      headers: authHeaders,
    });
    expect(jobsHealthRes.status).toBe(200);
    const jobsHealthBody = (await jobsHealthRes.json()) as {
      success: boolean;
      data: {
        queued: number;
        running: number;
        dead: number;
        outboxPending: number;
        outboxDead: number;
      };
    };
    expect(jobsHealthBody.success).toBe(true);
    expect(typeof jobsHealthBody.data.queued).toBe('number');

    const cronsRes = await fetch(`${daemon.apiUrl}/admin/crons`, { headers: authHeaders });
    expect(cronsRes.status).toBe(200);
    const cronsBody = (await cronsRes.json()) as { success: boolean; data: unknown[] };
    expect(cronsBody.success).toBe(true);
    expect(Array.isArray(cronsBody.data)).toBe(true);

    const jobsRes = await fetch(`${daemon.apiUrl}/admin/jobs?status=dead&limit=20`, {
      headers: authHeaders,
    });
    expect(jobsRes.status).toBe(200);
    const jobsBody = (await jobsRes.json()) as { success: boolean; data: unknown[] };
    expect(jobsBody.success).toBe(true);
    expect(Array.isArray(jobsBody.data)).toBe(true);

    const outboxRes = await fetch(`${daemon.apiUrl}/admin/outbox?status=dead&limit=20`, {
      headers: authHeaders,
    });
    expect(outboxRes.status).toBe(200);
    const outboxBody = (await outboxRes.json()) as { success: boolean; data: unknown[] };
    expect(outboxBody.success).toBe(true);
    expect(Array.isArray(outboxBody.data)).toBe(true);

    const inboxRes = await fetch(`${daemon.apiUrl}/notifications/inbox?limit=20`, {
      headers: authHeaders,
    });
    expect(inboxRes.status).toBe(200);
    const inboxBody = (await inboxRes.json()) as { success: boolean; data: unknown[] };
    expect(inboxBody.success).toBe(true);
    expect(Array.isArray(inboxBody.data)).toBe(true);
  });

  it('rate-limits the authenticated notification inbox without changing auth or other routes', async () => {
    const tempHome = makeTempDir('mw-desktop-inbox-rate-limit-');
    const daemon = await startDesktopSidecarDaemon({
      repoRoot: process.cwd(),
      desktopHomeDir: tempHome,
      sqlitePath: path.join(tempHome, 'local.db'),
      boardOrigin: 'http://127.0.0.1:5173',
      apiBaseUrl: 'http://127.0.0.1:4242',
      healthPort: 0,
      apiPort: 0,
      offlineMode: true,
      installAddonsOnStart: true,
    });
    handles.push(daemon);

    const inboxUrl = `${daemon.apiUrl}/notifications/inbox?limit=20`;
    const unauthenticated = await fetch(inboxUrl);
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({
      success: false,
      error: 'Authentication required',
    });

    const loginRes = await fetch(`${daemon.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'local', password: 'local-offline-session' }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { data: { access_token: string } };
    const authHeaders = { authorization: `Bearer ${loginBody.data.access_token}` };

    const allowedResponses = await Promise.all(
      Array.from({ length: 60 }, () => fetch(inboxUrl, { headers: authHeaders }))
    );
    expect(allowedResponses.map((response) => response.status)).toEqual(
      Array.from({ length: 60 }, () => 200)
    );
    await Promise.all(allowedResponses.map((response) => response.arrayBuffer()));

    const limited = await fetch(inboxUrl, { headers: authHeaders });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({
      success: false,
      error: 'Rate limit exceeded',
      code: 'RATE_LIMITED',
      requestId: expect.any(String),
    });

    const unauthenticatedAfterLimit = await fetch(inboxUrl);
    expect(unauthenticatedAfterLimit.status).toBe(401);
    expect(await unauthenticatedAfterLimit.json()).toEqual({
      success: false,
      error: 'Authentication required',
    });

    const otherRoute = await fetch(`${daemon.apiUrl}/auth/me`, { headers: authHeaders });
    expect(otherRoute.status).toBe(200);
    await otherRoute.arrayBuffer();
  });

  it('imports moonwitness-tasks/v2 JSON idempotently by external_ref', async () => {
    const tempHome = makeTempDir('mw-desktop-import-');
    const sqlitePath = path.join(tempHome, 'local.db');
    const tasksPath = path.join(tempHome, 'tasks.json');
    writeFileSync(
      tasksPath,
      JSON.stringify({
        schemaVersion: '2.0.0',
        format: 'moonwitness-tasks/v2',
        projects: [{ slug: 'moonwitness', name: 'MoonWitness Platform' }],
        tasks: [
          {
            code: 'M0.01',
            project: 'moonwitness',
            title: 'Foundation Task',
            summary: 'First task',
            priority: 'p1',
            status: 'done',
            dependsOn: [],
          },
          {
            code: 'M0.02',
            project: 'moonwitness',
            title: 'Follow-up Task',
            summary: 'Depends on M0.01',
            priority: 'p0',
            status: 'todo',
            dependsOn: ['M0.01'],
          },
        ],
      }),
      'utf8'
    );

    const sidecar = new LocalSidecarController({
      sqlitePath,
      desktopHomeDir: tempHome,
      offlineMode: true,
    });
    try {
      await sidecar.initializeOrmAddons(DESKTOP_ADDONS);
      const db = sidecar.getOrmKnex();
      expect(db).not.toBeNull();
      const workspace = await ensureLocalWorkspaceBootstrap(db!);

      const first = await importDesktopTasks({
        db: db!,
        companyId: workspace.companyId,
        userId: workspace.userId,
        sourcePath: tasksPath,
      });
      expect(first.projectsCreated).toBe(1);
      expect(first.tasksCreated).toBe(2);
      expect(first.dependenciesCreated).toBe(1);

      const second = await importDesktopTasks({
        db: db!,
        companyId: workspace.companyId,
        userId: workspace.userId,
        sourcePath: tasksPath,
      });
      expect(second.projectsCreated).toBe(0);
      expect(second.tasksCreated).toBe(0);
      expect(second.tasksUpdated).toBe(2);
      expect(second.dependenciesCreated).toBe(0);
    } finally {
      sidecar.close();
    }
  });

  it('enforces desktop experience mode locking in workspace mode and unlocks in developer mode', async () => {
    const tempHome = makeTempDir('mw-desktop-mode-');
    const sqlitePath = path.join(tempHome, 'local.db');
    const modeFilePath = path.join(tempHome, 'mode.json');

    // Pre-seed mode.json as 'workspace' to verify startup persistence loading
    writeFileSync(modeFilePath, JSON.stringify({ mode: 'workspace' }), 'utf8');

    const daemon = await startDesktopSidecarDaemon({
      repoRoot: process.cwd(),
      desktopHomeDir: tempHome,
      sqlitePath,
      boardOrigin: 'http://127.0.0.1:5173',
      apiBaseUrl: 'http://127.0.0.1:4242',
      healthPort: 0,
      apiPort: 0,
      offlineMode: true,
      installAddonsOnStart: true,
    });
    handles.push(daemon);

    const loginRes = await fetch(`${daemon.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'local', password: 'local-offline-session' }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as {
      success: boolean;
      data: { access_token: string };
    };
    const authHeaders = {
      authorization: `Bearer ${loginBody.data.access_token}`,
      'content-type': 'application/json',
    };
    const rpcHeaders = {
      'content-type': 'application/json',
      'x-mw-desktop-token': daemon.rpcToken,
    };

    // 1. GET /api/desktop/mode reports workspace mode with restrictedCapabilities
    const modeRes = await fetch(`${daemon.apiUrl}/api/desktop/mode`, { headers: authHeaders });
    expect(modeRes.status).toBe(200);
    const modeBody = (await modeRes.json()) as {
      success: boolean;
      data: { mode: string; restrictedCapabilities: string[] };
    };
    expect(modeBody.success).toBe(true);
    expect(modeBody.data.mode).toBe('workspace');
    expect(modeBody.data.restrictedCapabilities).toEqual([
      'pty.*',
      'worktree.*',
      'mcp.invoke',
      'mesh.bootstrap',
      'projects.import_taskos',
    ]);

    // 2. Invalid mode rejected with 400
    const badModeRes = await fetch(`${daemon.apiUrl}/api/desktop/mode`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ mode: 'godmode' }),
    });
    expect(badModeRes.status).toBe(400);

    // 3. /_desktop/rpc allows getStatus & sidecar.getState in workspace mode
    for (const allowedCommand of ['getStatus', 'sidecar.getState']) {
      const okRpc = await fetch(`${daemon.apiUrl}/_desktop/rpc`, {
        method: 'POST',
        headers: rpcHeaders,
        body: JSON.stringify({ command: allowedCommand }),
      });
      expect(okRpc.status).toBe(200);
    }

    // 4. /_desktop/rpc rejects pty.*, worktree.*, mcp.*, risk.* with 403 WORKSPACE_MODE_RESTRICTED
    for (const blockedCommand of [
      'pty.listSessions',
      'worktree.list',
      'mcp.listServers',
      'risk.evaluate',
    ]) {
      const blockedRpc = await fetch(`${daemon.apiUrl}/_desktop/rpc`, {
        method: 'POST',
        headers: rpcHeaders,
        body: JSON.stringify({ command: blockedCommand }),
      });
      expect(blockedRpc.status).toBe(403);
      const blockedBody = (await blockedRpc.json()) as {
        success: boolean;
        code: string;
        error: string;
      };
      expect(blockedBody.success).toBe(false);
      expect(blockedBody.code).toBe('WORKSPACE_MODE_RESTRICTED');
    }

    // 5. /api/desktop/mesh/bootstrap and /api/desktop/projects/import-taskos return 403 in workspace mode
    const meshBootstrapBlocked = await fetch(`${daemon.apiUrl}/api/desktop/mesh/bootstrap`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(meshBootstrapBlocked.status).toBe(403);
    const meshBlockedBody = (await meshBootstrapBlocked.json()) as { code: string };
    expect(meshBlockedBody.code).toBe('WORKSPACE_MODE_RESTRICTED');

    const importBlocked = await fetch(`${daemon.apiUrl}/api/desktop/projects/import-taskos`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(importBlocked.status).toBe(403);
    const importBlockedBody = (await importBlocked.json()) as { code: string };
    expect(importBlockedBody.code).toBe('WORKSPACE_MODE_RESTRICTED');

    // 6. Normal workspace routes & AI assistant remain functional in workspace mode
    const bootRes = await fetch(`${daemon.apiUrl}/api/app/bootstrap`, { headers: authHeaders });
    expect(bootRes.status).toBe(200);
    const boardRes = await fetch(`${daemon.apiUrl}/api/projects/1/board`, { headers: authHeaders });
    expect(boardRes.status).toBe(200);

    const workspaceAssistRes = await fetch(`${daemon.apiUrl}/api/desktop/ai/assist`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ action: 'summarize_tasks', prompt: 'Daily check-in' }),
    });
    expect(workspaceAssistRes.status).toBe(200);
    const workspaceAssistBody = (await workspaceAssistRes.json()) as {
      success: boolean;
      data: { mode: string; readOnly: boolean; riskTier: string };
    };
    expect(workspaceAssistBody.success).toBe(true);
    expect(workspaceAssistBody.data.mode).toBe('workspace');
    expect(workspaceAssistBody.data.readOnly).toBe(true);
    expect(workspaceAssistBody.data.riskTier).toBe('R0');

    // AI task runner & PaaS Studio routes are blocked 403 in workspace mode
    for (const [method, endpoint, body] of [
      ['POST', '/api/desktop/ai/run-task', { taskId: 'T-1', code: 'T-1', title: 'Test' }],
      ['GET', '/api/desktop/paas/metrics', undefined],
      ['GET', '/api/desktop/paas/apps', undefined],
      ['POST', '/api/desktop/paas/apps/deploy', { slug: 'demo', image: 'nginx:alpine' }],
      ['POST', '/api/desktop/paas/apps/demo/restart', {}],
    ] as const) {
      const blocked = await fetch(`${daemon.apiUrl}${endpoint}`, {
        method,
        headers: authHeaders,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      expect(blocked.status).toBe(403);
      const blockedJson = (await blocked.json()) as { code: string };
      expect(blockedJson.code).toBe('WORKSPACE_MODE_RESTRICTED');
    }

    // 7. Switch to developer mode via POST /api/desktop/mode and verify persistence + unlock
    const switchRes = await fetch(`${daemon.apiUrl}/api/desktop/mode`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ mode: 'developer' }),
    });
    expect(switchRes.status).toBe(200);
    const switchBody = (await switchRes.json()) as {
      success: boolean;
      data: { mode: string; restrictedCapabilities: string[] };
    };
    expect(switchBody.success).toBe(true);
    expect(switchBody.data.mode).toBe('developer');
    expect(switchBody.data.restrictedCapabilities).toEqual([]);

    const persisted = JSON.parse(readFileSync(modeFilePath, 'utf8')) as { mode: string };
    expect(persisted.mode).toBe('developer');

    // 8. Engineering harness capabilities unlocked in developer mode
    const mcpRpc = await fetch(`${daemon.apiUrl}/_desktop/rpc`, {
      method: 'POST',
      headers: rpcHeaders,
      body: JSON.stringify({ command: 'mcp.listServers' }),
    });
    expect(mcpRpc.status).toBe(200);

    const meshBootstrapAllowed = await fetch(`${daemon.apiUrl}/api/desktop/mesh/bootstrap`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(meshBootstrapAllowed.status).toBe(200);
  });

  it('serves local AI discovery and SQLite backups in both modes, while gating VPS onboarding to developer mode', async () => {
    const tempHome = makeTempDir('mw-desktop-ai-backup-vps-');
    const sqlitePath = path.join(tempHome, 'local.db');
    writeFileSync(path.join(tempHome, 'mode.json'), JSON.stringify({ mode: 'workspace' }), 'utf8');

    const daemon = await startDesktopSidecarDaemon({
      repoRoot: process.cwd(),
      desktopHomeDir: tempHome,
      sqlitePath,
      boardOrigin: 'http://127.0.0.1:5173',
      apiBaseUrl: 'http://127.0.0.1:4242',
      healthPort: 0,
      apiPort: 0,
      offlineMode: true,
      installAddonsOnStart: true,
    });
    handles.push(daemon);

    const loginRes = await fetch(`${daemon.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'local', password: 'local-offline-session' }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { data: { access_token: string } };
    const authHeaders = {
      authorization: `Bearer ${loginBody.data.access_token}`,
      'content-type': 'application/json',
    };

    // 1. Local AI discovery works in workspace mode
    const aiRes = await fetch(`${daemon.apiUrl}/api/desktop/ai/models`, { headers: authHeaders });
    expect(aiRes.status).toBe(200);
    const aiBody = (await aiRes.json()) as {
      success: boolean;
      data: { onlineCount: number; providers: unknown[]; models: unknown[] };
    };
    expect(aiBody.success).toBe(true);
    expect(Array.isArray(aiBody.data.providers)).toBe(true);

    // 2. Local SQLite backup create/list/restore works in workspace mode
    const createBackupRes = await fetch(`${daemon.apiUrl}/api/desktop/backups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(createBackupRes.status).toBe(201);
    const createdBackup = (await createBackupRes.json()) as {
      success: boolean;
      data: { fileName: string; sha256: string; verified: boolean };
    };
    expect(createdBackup.success).toBe(true);
    expect(createdBackup.data.verified).toBe(true);

    const listBackupsRes = await fetch(`${daemon.apiUrl}/api/desktop/backups`, {
      headers: authHeaders,
    });
    expect(listBackupsRes.status).toBe(200);
    const listBackupsBody = (await listBackupsRes.json()) as {
      success: boolean;
      data: { backups: Array<{ fileName: string; verified: boolean }> };
    };
    expect(
      listBackupsBody.data.backups.some((b) => b.fileName === createdBackup.data.fileName)
    ).toBe(true);

    // Restore rejects missing confirmation and path traversal
    const restoreNoConfirm = await fetch(`${daemon.apiUrl}/api/desktop/backups/restore`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ fileName: createdBackup.data.fileName }),
    });
    expect(restoreNoConfirm.status).toBe(400);

    const restoreTraversal = await fetch(`${daemon.apiUrl}/api/desktop/backups/restore`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ fileName: '../local.db', confirm: true }),
    });
    expect(restoreTraversal.status).toBe(400);

    // 3. VPS status & onboarding are blocked with 403 WORKSPACE_MODE_RESTRICTED in workspace mode
    const vpsStatusBlocked = await fetch(`${daemon.apiUrl}/api/desktop/vps/status`, {
      headers: authHeaders,
    });
    expect(vpsStatusBlocked.status).toBe(403);
    const vpsStatusBlockedBody = (await vpsStatusBlocked.json()) as { code: string };
    expect(vpsStatusBlockedBody.code).toBe('WORKSPACE_MODE_RESTRICTED');

    const vpsOnboardingBlocked = await fetch(`${daemon.apiUrl}/api/desktop/vps/onboarding`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ login: 'admin', password: 'test-password-1234' }),
    });
    expect(vpsOnboardingBlocked.status).toBe(403);

    const meshConnectBlocked = await fetch(`${daemon.apiUrl}/api/desktop/mesh/connect`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(meshConnectBlocked.status).toBe(403);

    const meshDisconnectBlocked = await fetch(`${daemon.apiUrl}/api/desktop/mesh/disconnect`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(meshDisconnectBlocked.status).toBe(403);

    const meshPeersBlocked = await fetch(`${daemon.apiUrl}/api/desktop/mesh/peers`, {
      headers: authHeaders,
    });
    expect(meshPeersBlocked.status).toBe(403);

    const a2aDelegateBlocked = await fetch(`${daemon.apiUrl}/api/desktop/a2a/delegate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        targetEndpoint: 'http://10.144.0.2:8080/a2a/delegate',
        targetAgentId: 'mesh-node-2',
        payload: { task: 'ping' },
      }),
    });
    expect(a2aDelegateBlocked.status).toBe(403);
    const a2aBlockedBody = (await a2aDelegateBlocked.json()) as { code: string };
    expect(a2aBlockedBody.code).toBe('WORKSPACE_MODE_RESTRICTED');

    // Hybrid memory search is ACTIVE in workspace mode
    const memorySearchWorkspace = await fetch(`${daemon.apiUrl}/api/desktop/memory/search`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        query: 'postgresql mesh backup',
        records: [
          {
            id: 'doc-1',
            kind: 'document',
            title: 'PostgreSQL Mesh Backup',
            body: 'Automated WAL backup over EasyTier private mesh.',
          },
        ],
      }),
    });
    expect(memorySearchWorkspace.status).toBe(200);
    const memorySearchWorkspaceBody = (await memorySearchWorkspace.json()) as {
      success: boolean;
      data: { hits: Array<{ id: string }> };
    };
    expect(memorySearchWorkspaceBody.success).toBe(true);
    expect(memorySearchWorkspaceBody.data.hits[0]?.id).toBe('doc-1');

    // PaaS templates & failover-plan are BLOCKED (403) in workspace mode
    const templatesBlocked = await fetch(`${daemon.apiUrl}/api/desktop/paas/templates`, {
      headers: authHeaders,
    });
    expect(templatesBlocked.status).toBe(403);

    const failoverBlocked = await fetch(`${daemon.apiUrl}/api/desktop/paas/failover-plan`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ nodes: [], deployments: [] }),
    });
    expect(failoverBlocked.status).toBe(403);

    // 4. Switch to developer mode -> VPS status & mesh client endpoints unlock
    const devSwitch = await fetch(`${daemon.apiUrl}/api/desktop/mode`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ mode: 'developer' }),
    });
    expect(devSwitch.status).toBe(200);

    const vpsStatusDev = await fetch(`${daemon.apiUrl}/api/desktop/vps/status`, {
      headers: authHeaders,
    });
    expect(vpsStatusDev.status).toBe(200);
    const vpsStatusDevBody = (await vpsStatusDev.json()) as {
      success: boolean;
      data: { nodeId: string; apiHealth: string };
    };
    expect(vpsStatusDevBody.success).toBe(true);
    expect(typeof vpsStatusDevBody.data.nodeId).toBe('string');

    const meshPeersDev = await fetch(`${daemon.apiUrl}/api/desktop/mesh/peers`, {
      headers: authHeaders,
    });
    expect(meshPeersDev.status).toBe(200);

    const meshDisconnectDev = await fetch(`${daemon.apiUrl}/api/desktop/mesh/disconnect`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(meshDisconnectDev.status).toBe(200);

    // A2A delegate is active in developer mode and enforces private mesh IP via A2AMeshClient
    const a2aPublicRejected = await fetch(`${daemon.apiUrl}/api/desktop/a2a/delegate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        targetEndpoint: 'https://example.com/a2a/delegate',
        targetAgentId: 'mesh-node-public',
        payload: { task: 'ping' },
      }),
    });
    expect(a2aPublicRejected.status).toBe(400);
    const a2aPublicBody = (await a2aPublicRejected.json()) as { code: string };
    expect(a2aPublicBody.code).toBe('PUBLIC_ENDPOINT_FORBIDDEN');

    // Hybrid memory search remains active in developer mode
    const memorySearchDev = await fetch(`${daemon.apiUrl}/api/desktop/memory/search`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        query: 'mesh failover',
        records: [
          {
            id: 'doc-2',
            kind: 'run_note',
            title: 'Mesh Failover Runbook',
            body: 'Promote healthy standby node on degraded primary.',
          },
        ],
      }),
    });
    expect(memorySearchDev.status).toBe(200);

    // PaaS templates catalog unlocked in developer mode
    const templatesDev = await fetch(`${daemon.apiUrl}/api/desktop/paas/templates`, {
      headers: authHeaders,
    });
    expect(templatesDev.status).toBe(200);
    const templatesDevBody = (await templatesDev.json()) as {
      success: boolean;
      data: { templates: Array<{ id: string }> };
    };
    expect(templatesDevBody.success).toBe(true);
    expect(templatesDevBody.data.templates.length).toBeGreaterThanOrEqual(6);

    // Mesh HA failover-plan unlocked in developer mode
    const failoverDev = await fetch(`${daemon.apiUrl}/api/desktop/paas/failover-plan`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        nodes: [
          {
            nodeId: 'vps-1',
            meshIp: '10.144.0.1',
            region: 'sg',
            healthy: false,
            dockerStatus: 'offline',
            availableRamMb: 0,
            cpuLoadPercent: 100,
          },
          {
            nodeId: 'vps-2',
            meshIp: '10.144.0.2',
            region: 'sg',
            healthy: true,
            dockerStatus: 'running',
            availableRamMb: 4096,
            cpuLoadPercent: 20,
          },
        ],
        deployments: [
          {
            deploymentId: 'dep-1',
            tenantId: 'tenant-1',
            appSlug: 'api-core',
            primaryNodeId: 'vps-1',
            requiredRamMb: 512,
          },
        ],
      }),
    });
    expect(failoverDev.status).toBe(200);
    const failoverDevBody = (await failoverDev.json()) as {
      success: boolean;
      data: { actions: Array<{ kind: string }>; failClosed: boolean };
    };
    expect(failoverDevBody.success).toBe(true);
    expect(failoverDevBody.data.failClosed).toBe(false);
    expect(failoverDevBody.data.actions.some((a) => a.kind === 'failover_deploy')).toBe(true);
  });

  it('exposes M16 Sovereign Dreaming endpoints with workspace vs developer mode boundaries', async () => {
    const tempHome = makeTempDir('mw-desktop-m16-');
    const sqlitePath = path.join(tempHome, 'local.db');
    writeFileSync(path.join(tempHome, 'mode.json'), JSON.stringify({ mode: 'workspace' }), 'utf8');

    const daemon = await startDesktopSidecarDaemon({
      repoRoot: process.cwd(),
      desktopHomeDir: tempHome,
      sqlitePath,
      boardOrigin: 'http://127.0.0.1:5173',
      apiBaseUrl: 'http://127.0.0.1:4242',
      healthPort: 0,
      apiPort: 0,
      offlineMode: true,
      installAddonsOnStart: true,
    });
    handles.push(daemon);

    const loginRes = await fetch(`${daemon.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'local', password: 'local-offline-session' }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { data: { access_token: string } };
    const authHeaders = {
      authorization: `Bearer ${loginBody.data.access_token}`,
      'content-type': 'application/json',
    };

    const preflight = await fetch(`${daemon.apiUrl}/api/models`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'content-type,x-company-id',
      },
    });
    expect(preflight.status).toBeLessThan(400);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-company-id');

    // 1. Sleep-Dream works in workspace mode
    const sleepWs = await fetch(`${daemon.apiUrl}/api/desktop/ai/sleep-dream`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        companyId: '1',
        nowIso: '2026-11-23T10:00:00.000Z',
        memories: [
          {
            memoryId: 'mem-1',
            companyId: '1',
            topicKey: 'deploy-policy',
            content: 'Always run deterministic gates before push.',
            provenance: 'session-1',
            createdAtIso: '2026-11-22T10:00:00.000Z',
            importanceBps: 8500,
            retrievalConfidenceBps: 9000,
          },
        ],
        knowledgeNodes: [
          {
            nodeId: 'kn-1',
            companyId: '1',
            domain: 'security',
            claim: 'Unverified local cache assumption',
            verified: false,
            confidenceBps: 4000,
            evidenceCount: 0,
          },
        ],
        skillNodes: [],
      }),
    });
    expect(sleepWs.status).toBe(200);
    const sleepWsBody = (await sleepWs.json()) as {
      success: boolean;
      data: {
        nonRem: { survivingCount: number; automatedSelfAccept: boolean };
        rem: { probes: unknown[] };
      };
    };
    expect(sleepWsBody.success).toBe(true);
    expect(sleepWsBody.data.nonRem.survivingCount).toBe(1);
    expect(sleepWsBody.data.nonRem.automatedSelfAccept).toBe(false);
    expect(sleepWsBody.data.rem.probes.length).toBeGreaterThanOrEqual(1);

    // 2. Active Inference works in workspace mode
    const efeWs = await fetch(`${daemon.apiUrl}/api/desktop/ai/active-inference`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        candidates: [
          {
            actionId: 'probe-docs',
            kind: 'epistemic_action',
            label: 'Read verification gate',
            goalAlignmentBps: 7000,
            successProbabilityBps: 9000,
            priorUncertaintyBps: 8000,
            expectedPosteriorUncertaintyBps: 2000,
            reversible: true,
          },
        ],
      }),
    });
    expect(efeWs.status).toBe(200);
    const efeWsBody = (await efeWs.json()) as {
      success: boolean;
      data: { selectedActionId: string; automatedSelfAccept: boolean };
    };
    expect(efeWsBody.success).toBe(true);
    expect(efeWsBody.data.selectedActionId).toBe('probe-docs');
    expect(efeWsBody.data.automatedSelfAccept).toBe(false);

    // 3. Merkle Audit Root works in workspace mode
    const merkleWs = await fetch(`${daemon.apiUrl}/api/desktop/audit/merkle-root`, {
      method: 'GET',
      headers: authHeaders,
    });
    expect(merkleWs.status).toBe(200);
    const merkleWsBody = (await merkleWs.json()) as {
      success: boolean;
      data: { rootHash: string; rfc6962DomainSeparated: boolean; leafCount: number };
    };
    expect(merkleWsBody.success).toBe(true);
    expect(merkleWsBody.data.rootHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(merkleWsBody.data.rfc6962DomainSeparated).toBe(true);
    expect(merkleWsBody.data.leafCount).toBeGreaterThanOrEqual(1);

    // 4. Red-Team Arena blocked in workspace mode (403 WORKSPACE_MODE_RESTRICTED)
    const redteamWs = await fetch(`${daemon.apiUrl}/api/desktop/ai/redteam-arena`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(redteamWs.status).toBe(403);
    const redteamWsBody = (await redteamWs.json()) as { code: string };
    expect(redteamWsBody.code).toBe('WORKSPACE_MODE_RESTRICTED');

    // Switch to developer mode
    const switchRes = await fetch(`${daemon.apiUrl}/api/desktop/mode`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ mode: 'developer' }),
    });
    expect(switchRes.status).toBe(200);

    // Red-Team Arena unlocked in developer mode
    const redteamDev = await fetch(`${daemon.apiUrl}/api/desktop/ai/redteam-arena`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(redteamDev.status).toBe(200);
    const redteamDevBody = (await redteamDev.json()) as {
      success: boolean;
      data: { totalScenarios: number; defensePassRateBps: number; automatedSelfAccept: boolean };
    };
    expect(redteamDevBody.success).toBe(true);
    expect(redteamDevBody.data.totalScenarios).toBeGreaterThanOrEqual(6);
    expect(redteamDevBody.data.defensePassRateBps).toBe(10000);
    expect(redteamDevBody.data.automatedSelfAccept).toBe(false);
  });

  it('exposes centralized desktop logs endpoints in both workspace and developer modes and captures >=400 responses', async () => {
    const tempHome = mkdtempSync(path.join(os.tmpdir(), 'mw-desktop-logs-'));
    tempDirs.push(tempHome);
    const sqlitePath = path.join(tempHome, 'local.db');
    const daemon = await startDesktopSidecarDaemon({
      repoRoot: process.cwd(),
      desktopHomeDir: tempHome,
      sqlitePath,
      boardOrigin: 'http://127.0.0.1:5173',
      apiBaseUrl: 'http://127.0.0.1:4242',
      healthPort: 0,
      apiPort: 0,
      offlineMode: true,
      installAddonsOnStart: true,
    });
    handles.push(daemon);

    // Trigger a >=400 response to verify onResponse hook captures statusCode >= 400
    const missingRes = await fetch(`${daemon.apiUrl}/api/non-existent-route-for-log-test`);
    expect(missingRes.status).toBeGreaterThanOrEqual(400);

    // Unauthenticated requests should return 401
    const unauthEndpoints = [
      { method: 'GET', path: '/api/desktop/logs' },
      { method: 'POST', path: '/api/desktop/logs/ingest' },
      { method: 'POST', path: '/api/desktop/logs/clear' },
      { method: 'GET', path: '/api/desktop/logs/bundle' },
    ];
    for (const { method, path } of unauthEndpoints) {
      const res = await fetch(`${daemon.apiUrl}${path}`, { method });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ success: false, error: 'Authentication required' });
    }

    // Login to get token
    const loginRes = await fetch(`${daemon.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'local', password: 'local-offline-session' }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { data: { access_token: string } };
    const authHeaders = { authorization: `Bearer ${loginBody.data.access_token}` };

    // Ingest a webview error in workspace mode
    const ingestRes = await fetch(`${daemon.apiUrl}/api/desktop/logs/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        level: 'error',
        source: 'webview',
        message: 'Uncaught ReferenceError: foo is not defined Bearer secret-token-123',
        detail: 'at main.tsx:10:2',
      }),
    });
    expect(ingestRes.status).toBe(200);
    const ingestBody = (await ingestRes.json()) as {
      success: boolean;
      entry: { message: string; source: string; level: string };
    };
    expect(ingestBody.success).toBe(true);
    expect(ingestBody.entry.message).toContain('Bearer [REDACTED]');
    expect(ingestBody.entry.source).toBe('webview');

    // List logs in workspace mode
    const listRes = await fetch(`${daemon.apiUrl}/api/desktop/logs?level=all&source=all`, {
      headers: authHeaders,
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      success: boolean;
      entries: Array<{ source: string; message: string }>;
      total: number;
    };
    expect(listBody.success).toBe(true);
    expect(listBody.total).toBeGreaterThanOrEqual(2);
    expect(listBody.entries.some((e) => e.source === 'webview')).toBe(true);
    expect(
      listBody.entries.some(
        (e) => e.source === 'sidecar' && e.message.includes(`HTTP ${missingRes.status}`)
      )
    ).toBe(true);

    // Fetch diagnostic bundle in workspace mode
    const bundleRes = await fetch(`${daemon.apiUrl}/api/desktop/logs/bundle`, {
      headers: authHeaders,
    });
    expect(bundleRes.status).toBe(200);
    const bundleBody = (await bundleRes.json()) as {
      success: boolean;
      markdown: string;
      entryCount: number;
    };
    expect(bundleBody.success).toBe(true);
    expect(bundleBody.markdown).toContain('# MoonWitness Desktop Diagnostic Bundle');
    expect(bundleBody.entryCount).toBeGreaterThanOrEqual(2);

    // Clear logs in workspace mode
    const clearRes = await fetch(`${daemon.apiUrl}/api/desktop/logs/clear`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(clearRes.status).toBe(200);
    const afterClear = (await (
      await fetch(`${daemon.apiUrl}/api/desktop/logs`, { headers: authHeaders })
    ).json()) as {
      entries: unknown[];
      total: number;
    };
    expect(afterClear.total).toBe(0);
    expect(afterClear.entries).toHaveLength(0);
  });

  it('serves authenticated Observatory state, SSE stream, and path-confined headless --serve-web', async () => {
    const tempHome = makeTempDir('mw-desktop-obs-api-');
    const tempRepo = makeTempDir('mw-desktop-obs-repo-');
    const tempWebDist = makeTempDir('mw-desktop-obs-web-');
    const sqlitePath = path.join(tempHome, 'local.db');
    writeFileSync(path.join(tempHome, 'mode.json'), JSON.stringify({ mode: 'workspace' }), 'utf8');
    mkdirSync(path.join(tempRepo, '.plan'), { recursive: true });
    writeFileSync(
      path.join(tempRepo, '.plan', 'sample.md'),
      '# Sample Plan\n\n### Wave 1\n- [x] **D01** — Done task\n- [ ] **D02** — Pending task\n',
      'utf8'
    );
    writeFileSync(
      path.join(tempWebDist, 'index.html'),
      '<!doctype html><html><head><title>Desktop</title></head><body><div id="root"></div></body></html>',
      'utf8'
    );

    const bridge = createDesktopHarnessBridge(
      {
        repoRoot: tempRepo,
        desktopHomeDir: tempHome,
        sqlitePath,
        boardOrigin: 'http://127.0.0.1:5173',
        apiBaseUrl: 'http://127.0.0.1:4242',
        offlineMode: true,
      },
      { autoAttach: false }
    );
    const server = await startLocalApiServer({
      bridge,
      host: '127.0.0.1',
      port: 0,
      repoRoot: tempRepo,
      observatoryHomeDir: tempHome,
      enableObservatoryProbes: false,
      enableObservatoryAntigravityApi: false,
      serveWebDistDir: tempWebDist,
    });
    handles.push({
      stop: async () => {
        await server.stop();
        bridge.dispose();
      },
    });

    // Unauthenticated observatory request fails closed
    const unauthState = await fetch(`${server.apiUrl}/api/desktop/observatory/state`);
    expect(unauthState.status).toBe(401);

    const loginRes = await fetch(`${server.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'local', password: 'local-offline-session' }),
    });
    const loginBody = (await loginRes.json()) as { data: { access_token: string } };
    const authHeaders = { authorization: `Bearer ${loginBody.data.access_token}` };

    // T39: Cognitive Brain endpoints fail closed and return structured data when indexed.
    for (const route of ['search?q=plan', 'impact?target=src%2Fconfig.ts', 'graph?planId=sample']) {
      const unauthBrain = await fetch(`${server.apiUrl}/api/desktop/observatory/brain/${route}`);
      expect(unauthBrain.status).toBe(401);
    }
    // Authenticated state works in workspace mode
    const stateRes = await fetch(`${server.apiUrl}/api/desktop/observatory/state`, {
      headers: authHeaders,
    });
    expect(stateRes.status).toBe(200);
    const stateBody = (await stateRes.json()) as {
      success: boolean;
      data: { defaultPlanId: string; plans: Array<{ done: number; total: number }> };
    };
    expect(stateBody.success).toBe(true);
    expect(stateBody.data.defaultPlanId).toBe('sample');
    expect(stateBody.data.plans[0]?.done).toBe(1);
    expect(stateBody.data.plans[0]?.total).toBe(2);

    const brainSearch = await fetch(`${server.apiUrl}/api/desktop/observatory/brain/search?q=plan&limit=5`, {
      headers: authHeaders,
    });
    expect(brainSearch.status).toBe(200);
    expect(((await brainSearch.json()) as { success: boolean }).success).toBe(true);
    const brainImpact = await fetch(
      `${server.apiUrl}/api/desktop/observatory/brain/impact?target=${encodeURIComponent('src/config.ts')}`,
      { headers: authHeaders }
    );
    expect(brainImpact.status).toBe(200);
    const brainGraph = await fetch(`${server.apiUrl}/api/desktop/observatory/brain/graph?planId=sample`, {
      headers: authHeaders,
    });
    expect(brainGraph.status).toBe(200);
    expect(((await brainGraph.json()) as { data: { nodes: unknown[]; edges: unknown[] } }).data).toMatchObject({
      nodes: [],
      edges: [],
    });

    // Authenticated SSE stream pushes initial snapshot frame and cleans up on abort
    const sseAbort = new AbortController();
    const streamRes = await fetch(`${server.apiUrl}/api/desktop/observatory/stream`, {
      headers: authHeaders,
      signal: sseAbort.signal,
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream');
    const reader = streamRes.body?.getReader();
    expect(reader).toBeDefined();
    let sseChunk = '';
    if (reader) {
      for (let i = 0; i < 4 && !sseChunk.includes('event: snapshot'); i += 1) {
        const readRes = await reader.read();
        if (readRes.value) sseChunk += new TextDecoder().decode(readRes.value);
        if (readRes.done) break;
      }
    }
    sseAbort.abort();
    expect(sseChunk).toContain('event: snapshot');
    expect(sseChunk).toContain('"defaultPlanId":"sample"');

    // Authenticated v3 export (markdown + json), SSRF-guarded probe, and commit validation
    const mdExportRes = await fetch(
      `${server.apiUrl}/api/desktop/observatory/export?format=markdown`,
      { headers: authHeaders }
    );
    expect(mdExportRes.status).toBe(200);
    expect(mdExportRes.headers.get('content-type')).toContain('text/markdown');
    const mdText = await mdExportRes.text();
    expect(mdText).toContain('# MoonWitness Desktop Agent Observatory Report');
    expect(mdText).toContain('sample');

    const jsonExportRes = await fetch(
      `${server.apiUrl}/api/desktop/observatory/export?format=json`,
      { headers: authHeaders }
    );
    expect(jsonExportRes.status).toBe(200);
    const jsonExportBody = (await jsonExportRes.json()) as { version: number; defaultPlanId: string };
    expect(jsonExportBody.version).toBe(3);
    expect(jsonExportBody.defaultPlanId).toBe('sample');

    const ssrfProbeRes = await fetch(
      `${server.apiUrl}/api/desktop/observatory/probe?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data')}`,
      { headers: authHeaders }
    );
    expect(ssrfProbeRes.status).toBe(400);

    const badShaRes = await fetch(
      `${server.apiUrl}/api/desktop/observatory/git/commit?sha=not-a-sha`,
      { headers: authHeaders }
    );
    expect(badShaRes.status).toBe(400);

    // Headless --serve-web serves SPA with injected API URL and blocks path traversal & unknown files
    const spaRes = await fetch(`${server.apiUrl}/board/desktop/observatory`);
    expect(spaRes.status).toBe(200);
    const spaHtml = await spaRes.text();
    expect(spaHtml).toContain('window.__MW_DESKTOP_API_URL__=window.location.origin;');

    const missingAssetRes = await fetch(`${server.apiUrl}/package.json`);
    expect(missingAssetRes.status).toBe(404);

    const traversalStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: server.port,
          path: '/%2e%2e/package.json',
          method: 'GET',
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(traversalStatus).toBe(403);
  });
});
