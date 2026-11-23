import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startDesktopSidecarDaemon, type DesktopSidecarDaemonHandle } from '../src/cli.js';
import { importDesktopTasks } from '../src/importer.js';
import { LocalSidecarController, DESKTOP_ADDONS } from '../src/local-sidecar.js';
import { ensureLocalWorkspaceBootstrap } from '../src/local-api-server.js';

describe('LocalApiServer & Desktop Importer', () => {
  const tempDirs: string[] = [];
  const handles: DesktopSidecarDaemonHandle[] = [];

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
      data: { queued: number; running: number; dead: number; outboxPending: number; outboxDead: number };
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
});
