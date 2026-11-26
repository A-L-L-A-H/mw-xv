import { expect, test, type Page } from '@playwright/test';

const sidecarUrl = 'http://127.0.0.1:4187';
const session = {
  access_token: 'desktop-test-access',
  refresh_token: 'desktop-test-refresh',
  token_type: 'Bearer',
  expires_in: 3600,
  user: {
    id: 1,
    login: 'local',
    role: 'superadmin',
    company_id: 1,
  },
};

async function mockSidecar(page: Page, loginStatus = 200): Promise<void> {
  await page.route(`${sidecarUrl}/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/auth/login') {
      await route.fulfill({
        status: loginStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          loginStatus === 200
            ? { data: session }
            : { success: false, error: 'Local API is warming up' }
        ),
      });
      return;
    }
    if (pathname === '/auth/me') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Account settings unavailable in mock' }),
      });
      return;
    }
    if (pathname === '/api/models') {
      await route.fulfill({ json: { models: [] } });
      return;
    }
    if (pathname === '/notifications/inbox') {
      await route.fulfill({
        json: { success: true, data: { notifications: [], unreadCount: 0 } },
      });
      return;
    }
    if (pathname === '/api/desktop/observatory/state' || pathname === '/api/desktop/observatory/stream') {
      const mockSnapshot = {
        version: 3,
        generatedAt: '2026-11-25T08:00:00Z',
        repoRoot: 'Z:/repo/mw-xv',
        antigravityApiConnected: true,
        host: {
          hostname: 'dev-box',
          platform: 'win32',
          arch: 'x64',
          cpus: 8,
          cpuModel: 'Ryzen Test CPU',
          cpuPct: 24.5,
          memUsedGb: 8.2,
          memTotalGb: 16,
          memPct: 51,
          uptimeSec: 120,
        },
        summary: {
          totalSessions: 3,
          runningSessions: 2,
          errorSessions: 0,
          subagents: 1,
          swarms: 1,
          runtimeCounts: { antigravity: 1, opencode: 1, magpie: 1 },
          tokens: { input: 1000, cached: 500, output: 200, total: 1200, delta: 50, cacheHitPct: 33.3 },
        },
        plans: [
          {
            id: 'desktop-agent-observatory-merge',
            title: 'Merge Multi-Agent Observatory',
            masterFile: '.plan/desktop-agent-observatory-merge.md',
            waveFiles: [],
            updatedAt: '2026-11-25T08:00:00Z',
            total: 2,
            done: 1,
            percent: 50,
            nextTaskId: 'D02',
            nextTaskTitle: 'Wire UI',
            waves: [{ title: 'Wave 1 — Core', done: 1, total: 2, percent: 50 }],
            tasks: [
              {
                id: 'D01',
                title: 'Collectors',
                done: true,
                wave: 'Wave 1 — Core',
                playbook: null,
                ownerFiles: 'apps/desktop/src/observatory/types.ts',
                dependsOn: 'None',
                depIds: [],
                dependents: ['D02'],
                dagState: 'done',
                acceptance: 'Builds cleanly',
                expected: 'Exit 0',
                verify: 'bun --filter @moonwitness/desktop typecheck',
                spec: 'Create typed contracts',
                commitSha: 'abc1234',
                commitSubject: 'feat(desktop): D01 types',
              },
              {
                id: 'D02',
                title: 'Wire UI',
                done: false,
                wave: 'Wave 1 — Core',
                playbook: null,
                ownerFiles: 'apps/desktop/desktop-web/observatory/observatory-page.tsx',
                dependsOn: 'D01',
                depIds: ['D01'],
                dependents: [],
                dagState: 'ready',
                acceptance: 'Renders tabs',
                expected: '0 UI findings',
                verify: 'bun run ui:check',
                spec: 'Build observatory page',
                commitSha: null,
                commitSubject: null,
              },
            ],
            dag: {
              nodes: [
                {
                  id: 'D01',
                  title: 'Collectors',
                  wave: 'Wave 1 — Core',
                  waveIndex: 0,
                  orderIndex: 0,
                  depth: 0,
                  state: 'done',
                  done: true,
                  depIds: [],
                  dependents: ['D02'],
                  commitSha: 'abc1234',
                  ownerFiles: 'apps/desktop/src/observatory/types.ts',
                },
                {
                  id: 'D02',
                  title: 'Wire UI',
                  wave: 'Wave 1 — Core',
                  waveIndex: 0,
                  orderIndex: 1,
                  depth: 1,
                  state: 'ready',
                  done: false,
                  depIds: ['D01'],
                  dependents: [],
                  commitSha: null,
                  ownerFiles: 'apps/desktop/desktop-web/observatory/observatory-page.tsx',
                },
              ],
              edges: [{ from: 'D01', to: 'D02', satisfied: true }],
              criticalPathIds: ['D02'],
              stats: { done: 1, active: 0, ready: 1, blocked: 0 },
            },
          },
        ],
        defaultPlanId: 'desktop-agent-observatory-merge',
        sessions: [
          {
            id: 'ag-conv-1',
            runtime: 'antigravity',
            runtimeLabel: 'Antigravity',
            title: 'Consolidate Desktop Observatory',
            status: 'running',
            runState: 'RUN_STATE_RUNNING',
            model: 'gemini-4-hydrogen-high',
            branch: 'dev',
            cwd: 'Z:/repo/mw-xv',
            inCurrentWorkspace: true,
            isCurrentSession: true,
            parentId: null,
            rootId: null,
            focus: 'Running verification gates',
            lastTool: 'run_command',
            lastError: '',
            errorCount: 0,
            steps: 12,
            tokens: { input: 800, cached: 400, output: 150, total: 950 },
            subagents: [
              {
                id: 'sub-1',
                role: 'UI Auditor',
                type: 'research',
                model: 'flash',
                at: '2026-11-25T07:59:00Z',
              },
            ],
            swarmWorkers: 1,
            toolCounts: { run_command: 5, edit_file: 3 },
            updatedAt: '2026-11-25T08:00:00Z',
            mtimeMs: 1795593600000,
            recentEvents: [
              {
                at: '2026-11-25T08:00:00Z',
                kind: 'focus',
                tool: 'update_focus',
                summary: 'Running verification gates',
              },
            ],
          },
          {
            id: 'oc-sess-1',
            runtime: 'opencode',
            runtimeLabel: 'OpenCode',
            title: 'OpenCode Live Worker',
            status: 'running',
            runState: 'BUSY',
            model: 'anthropic/claude-sonnet-4',
            branch: null,
            cwd: 'Z:/repo/mw-xv',
            inCurrentWorkspace: true,
            isCurrentSession: false,
            parentId: null,
            rootId: null,
            focus: 'edit_file: apps/desktop/src/index.ts',
            lastTool: 'edit_file',
            lastError: '',
            errorCount: 0,
            steps: 6,
            cost: 0.125,
            tokens: { input: 200, cached: 100, output: 50, total: 250 },
            subagents: [],
            swarmWorkers: 0,
            toolCounts: { edit_file: 4 },
            updatedAt: '2026-11-25T08:00:00Z',
            mtimeMs: 1795593590000,
            recentEvents: [],
          },
        ],
        swarms: [
          {
            runtime: 'antigravity',
            title: 'Desktop Observatory Swarm',
            line: 'Unify standalone script into apps/desktop',
            workers: [{ name: 'worker-ui', task: 'Build Observatory UI' }],
          },
        ],
        magpie: {
          connected: true,
          addr: '127.0.0.1:3425',
          version: '2.4.0',
          totalRecentCalls: 14,
          okCalls: 13,
          rateLimit429: 1,
          errorCalls: 0,
          avgLatencyMs: 310,
          avgTtftMs: 95,
          providers: [
            {
              provider: 'anthropic-primary',
              calls: 14,
              ok: 13,
              rateLimits: 1,
              errors: 0,
              tokens: 4200,
              avgMs: 310,
              models: ['claude-sonnet-4'],
            },
          ],
          memoryStats: { day: '2026-11-25', searches: 8, found: 6, recalled: 5, created: 2 },
          recentRoutes: [
            {
              at: '2026-11-25T08:00:00Z',
              agent: 'opencode',
              targetRuntime: 'opencode',
              provider: 'anthropic-primary',
              model: 'claude-sonnet-4',
              status: 200,
              ms: 290,
              ttftMs: 88,
              tokens: 900,
              cached: 400,
            },
          ],
          routedRuntimes: ['opencode'],
        },
        battle: {
          bossName: 'Merge Multi-Agent Observatory',
          bossHpPct: 50,
          bossShieldCount: 0,
          readyStrikeCount: 1,
          activeWarriors: 2,
          sidekickSwarmCount: 1,
          glitchCount: 0,
          magpieBoostCalls: 14,
        },
        activityFeed: [
          {
            at: '2026-11-25T08:00:00Z',
            runtime: 'antigravity',
            runtimeLabel: 'Antigravity',
            sessionId: 'ag-conv-1',
            sessionTitle: 'Consolidate Desktop Observatory',
            kind: 'focus',
            tool: 'update_focus',
            summary: 'Running verification gates',
          },
        ],
        git: {
          branch: 'dev',
          head: 'abc1234',
          ahead: 1,
          behind: 0,
          stashCount: 0,
          dirtyCount: 1,
          dirtyFiles: [
            {
              code: 'M',
              status: 'modified',
              path: 'apps/desktop/src/observatory/service.ts',
              area: 'apps/desktop',
            },
          ],
          dirtyByArea: { 'apps/desktop': 1 },
          diffStat: { filesChanged: 1, insertions: 42, deletions: 4 },
          commits: [
            {
              sha: 'abc1234',
              at: '2026-11-25T07:58:00Z',
              author: 'dev',
              subject: 'feat(desktop): D01 types',
              taskId: 'D01',
            },
          ],
          updatedAt: '2026-11-25T08:00:00Z',
        },
        probes: {
          vps: [
            {
              id: 'vps-apps-tls',
              label: 'HTTPS apps.moonwitness.biz.id',
              url: 'https://apps.moonwitness.biz.id/readyz',
              status: 'up',
              httpCode: 200,
              latencyMs: 35,
              detail: 'healthy',
            },
          ],
          localPorts: [
            { port: 3425, label: 'Magpie Gateway :3425', open: true },
            { port: 4242, label: 'Desktop Sidecar :4242', open: true },
          ],
          updatedAt: '2026-11-25T08:00:00Z',
        },
        flowGraph: {
          nodes: [
            {
              id: 'hub:workspace',
              tier: 0,
              kind: 'hub',
              runtime: 'hub',
              label: 'mw-xv',
              sublabel: 'dev@abc1234',
              status: 'running',
              metrics: { dirtyCount: 1 },
            },
            {
              id: 'rt:antigravity',
              tier: 1,
              kind: 'runtime',
              runtime: 'antigravity',
              label: 'Antigravity',
              sublabel: '1 active · 1 total',
              status: 'running',
              metrics: { sessions: 1 },
            },
            {
              id: 'agent:antigravity:ag-conv-1',
              tier: 2,
              kind: 'agent',
              runtime: 'antigravity',
              sessionId: 'ag-conv-1',
              label: 'Consolidate Desktop Observatory',
              sublabel: 'run_command',
              status: 'running',
              focus: 'Running verification gates',
              metrics: { tokens: 950 },
            },
          ],
          edges: [
            {
              id: 'edge:hub-ag',
              from: 'hub:workspace',
              to: 'rt:antigravity',
              kind: 'runtime-link',
              runtime: 'antigravity',
              weight: 3,
              active: true,
            },
            {
              id: 'edge:rt-ag-1',
              from: 'rt:antigravity',
              to: 'agent:antigravity:ag-conv-1',
              kind: 'session-link',
              runtime: 'antigravity',
              weight: 2,
              active: true,
            },
          ],
          pulses: [],
        },
        analytics: {
          toolFrequency: [{ name: 'run_command', calls: 5, errors: 0, runtimes: ['antigravity'] }],
          runtimeBreakdown: [
            {
              runtime: 'antigravity',
              label: 'Antigravity',
              sessions: 1,
              running: 1,
              subagents: 1,
              inputTokens: 800,
              cachedTokens: 400,
              outputTokens: 150,
              totalTokens: 950,
              errors: 0,
              cacheHitPct: 33.3,
            },
          ],
          modelBreakdown: [
            {
              model: 'gemini-4-hydrogen-high',
              runtime: 'antigravity',
              sessions: 1,
              tokens: 950,
              steps: 12,
            },
          ],
          activityBuckets: Array.from({ length: 24 }, (_, idx) => ({
            index: idx,
            label: `-${Math.round((24 - idx) * 2.5)}m`,
            total: idx === 23 ? 3 : 0,
            tools: idx === 23 ? 3 : 0,
            subagents: 0,
            errors: 0,
          })),
          errorLedger: [],
        },
        telemetryHistory: [
          {
            at: '2026-11-25T08:00:00Z',
            cpuPct: 24.5,
            memPct: 51,
            runningSessions: 2,
            totalSessions: 3,
            subagents: 1,
            tokensTotal: 1200,
            tokenDelta: 50,
            recentEvents: 3,
            errors: 0,
            vpsUp: 1,
            vpsAvgLatencyMs: 35,
          },
        ],
      };
      if (pathname === '/api/desktop/observatory/stream') {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream; charset=utf-8',
          body: `event: snapshot\ndata: ${JSON.stringify(mockSnapshot)}\n\n`,
        });
        return;
      }
      await route.fulfill({ json: { success: true, data: mockSnapshot } });
      return;
    }
    if (pathname === '/api/desktop/observatory/git/commit') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            sha: 'abc1234',
            header: 'commit abc1234\nAuthor: dev\nfeat(desktop): D01 types',
            changedFiles: [{ added: 42, removed: 4, path: 'apps/desktop/src/observatory/types.ts' }],
          },
        },
      });
      return;
    }
    if (pathname === '/api/desktop/observatory/probe') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            id: 'custom-1',
            label: 'https://apps.moonwitness.biz.id/readyz',
            url: 'https://apps.moonwitness.biz.id/readyz',
            status: 'up',
            httpCode: 200,
            latencyMs: 28,
            detail: 'ok',
          },
        },
      });
      return;
    }
    if (pathname === '/api/desktop/observatory/session') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            id: 'ag-conv-1',
            runtime: 'antigravity',
            runtimeLabel: 'Antigravity',
            title: 'Consolidate Desktop Observatory',
            status: 'running',
            runState: 'RUN_STATE_RUNNING',
            model: 'gemini-4-hydrogen-high',
            branch: 'dev',
            cwd: 'Z:/repo/mw-xv',
            inCurrentWorkspace: true,
            isCurrentSession: true,
            parentId: null,
            rootId: null,
            focus: 'Running verification gates',
            lastTool: 'run_command',
            lastError: '',
            steps: 12,
            tokens: { input: 800, cached: 400, output: 150, total: 950 },
            subagents: [
              {
                id: 'sub-1',
                role: 'UI Auditor',
                type: 'research',
                model: 'flash',
                at: '2026-11-25T07:59:00Z',
              },
            ],
            swarmWorkers: 1,
            updatedAt: '2026-11-25T08:00:00Z',
            mtimeMs: 1795593600000,
            recentEvents: [],
            detail: {
              events: [
                {
                  at: '2026-11-25T08:00:00Z',
                  kind: 'tool',
                  tool: 'run_command',
                  summary: 'Verified desktop build cleanly',
                },
              ],
            },
          },
        },
      });
      return;
    }
    if (pathname === '/api/desktop/doctor') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            healthy: true,
            generatedAt: '2026-11-25T00:00:00Z',
            platform: 'win32',
            checks: [
              {
                id: 'sqlite_integrity',
                status: 'ok',
                message: 'SQLite WAL integrity check passed',
              },
            ],
            supportReportMarkdown: '# Desktop Doctor Report\nAll checks healthy.',
          },
        },
      });
      return;
    }
    if (pathname === '/api/desktop/ai/models' || pathname === '/api/desktop/ai/discover') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            onlineCount: 0,
            models: [],
            recommendedWorkspaceModel: null,
            recommendedDevModel: null,
          },
        },
      });
      return;
    }
    if (pathname === '/api/desktop/backups') {
      await route.fulfill({
        json: {
          success: true,
          data: {
            sqlitePath: 'local.db',
            backupsDir: null,
            backups: [],
          },
        },
      });
      return;
    }
    if (pathname.startsWith('/api/corpus/sources/')) {
      await route.fulfill({
        json: {
          success: true,
          data: {
            sourceId: 'mw:source:tanzil-quran-text',
            editionId: 'tanzil-en',
            citation: 'Pinned Tanzil Qur’an sample edition.',
            availablePassages: ['1:1'],
          },
        },
      });
      return;
    }
    if (pathname.startsWith('/api/corpus/passages/')) {
      await route.fulfill({
        json: {
          success: true,
          data: {
            sourceId: 'mw:source:tanzil-quran-text',
            editionId: 'tanzil-en',
            locator: '1:1',
            text: 'In the name of God, the Merciful, the Compassionate.',
            sha256: 'a'.repeat(64),
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: { success: true, data: [], records: [], total: 0, models: [] },
    });
  });
}

async function configureDesktop(
  page: Page,
  options: {
    authenticated?: boolean;
    loginStatus?: number;
    desktopMode?: 'workspace' | 'developer' | null;
  } = {}
): Promise<void> {
  await mockSidecar(page, options.loginStatus);
  await page.addInitScript(
    ({ sidecar, authenticated, storedSession, desktopMode }) => {
      (window as Window & { __MW_DESKTOP_API_URL__?: string }).__MW_DESKTOP_API_URL__ = sidecar;
      if (desktopMode) {
        localStorage.setItem('mw-desktop-mode', desktopMode);
      }
      if (authenticated) {
        localStorage.setItem('mw-board-session', JSON.stringify(storedSession));
        if (!localStorage.getItem('mw-board-preferences')) {
          localStorage.setItem(
            'mw-board-preferences',
            JSON.stringify({
              skin: 'moonwitness-high-contrast',
              theme: 'dark',
              density: 'compact',
              language: 'en-US',
              timezone: 'UTC',
            })
          );
        }
      }
    },
    {
      sidecar: sidecarUrl,
      authenticated: options.authenticated ?? false,
      storedSession: session,
      desktopMode: options.desktopMode === undefined ? 'workspace' : options.desktopMode,
    }
  );
}

test('bootstrap failure is visible and retry recovers the local session', async ({ page }) => {
  let attempts = 0;
  await page.unroute(`${sidecarUrl}/**`);
  await page.route(`${sidecarUrl}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/auth/login') {
      attempts += 1;
      await route.fulfill({
        status: attempts === 1 ? 503 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          attempts === 1 ? { success: false, error: 'Local API is warming up' } : { data: session }
        ),
      });
      return;
    }
    if (pathname === '/notifications/inbox') {
      await route.fulfill({
        json: { success: true, data: { notifications: [], unreadCount: 0 } },
      });
      return;
    }
    await route.fulfill({
      json: { success: true, data: [], records: [], total: 0, models: [] },
    });
  });
  await page.addInitScript((sidecar) => {
    (window as Window & { __MW_DESKTOP_API_URL__?: string }).__MW_DESKTOP_API_URL__ = sidecar;
    localStorage.setItem('mw-desktop-mode', 'workspace');
  }, sidecarUrl);

  await page.goto('/board');
  await expect(page.getByRole('heading', { name: 'Local workspace unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: /Command center/i })).toBeVisible();
  expect(attempts).toBe(2);
});

test('Studio, NotFound, and browser history work for deep links', async ({ page }) => {
  await configureDesktop(page, { authenticated: true });
  await page.goto('/board/studio');
  await expect(
    page.getByRole('heading', { name: 'Editorial & Asmaul Husna Studio' })
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'moonwitness-high-contrast');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.goto('/board');
  await expect(page.getByRole('heading', { name: /Command center/i })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Editorial & Asmaul Husna Studio' })
  ).toBeVisible();

  await page.goto('/board/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('manual login rejects an external returnTo target', async ({ page }) => {
  await configureDesktop(page);
  await page.goto('/login?returnTo=https%3A%2F%2Fevil.example%2Fsteal');
  await expect(page.getByRole('heading', { name: /Enter the Shadow/i })).toBeVisible();
  await page.locator('#login').fill('local');
  await page.locator('#password').fill('local-offline-session');
  await page.locator('#auth-submit').click();
  await expect(page).toHaveURL(/\/board$/u);
  await expect(page.getByRole('heading', { name: /Command center/i })).toBeVisible();
});

test('manual login preserves an internal returnTo query and hash', async ({ page }) => {
  await configureDesktop(page);
  await page.goto(`/login?returnTo=${encodeURIComponent('/board/studio?section=asmaul#preview')}`);
  await page.locator('#login').fill('local');
  await page.locator('#password').fill('local-offline-session');
  await page.locator('#auth-submit').click();
  await expect(page).toHaveURL(/\/board\/studio\?section=asmaul#preview$/u);
  await expect(
    page.getByRole('heading', { name: 'Editorial & Asmaul Husna Studio' })
  ).toBeVisible();
});

test('moonwitness-riot skin toggling in Settings persists across navigation', async ({ page }) => {
  await configureDesktop(page, { authenticated: true });
  await page.goto('/board/settings');
  await expect(page.getByRole('heading', { name: /Settings/i }).first()).toBeVisible();

  await page.getByRole('button', { name: /MoonWitness Riot/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'moonwitness-riot');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveClass(/dark/);

  const storedSkin = await page.evaluate(() => {
    const raw = localStorage.getItem('mw-board-preferences');
    return raw ? (JSON.parse(raw) as { skin?: string }).skin : null;
  });
  expect(storedSkin).toBe('moonwitness-riot');

  await page.goto('/board/studio');
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'moonwitness-riot');
});

test('/board/studio renders Signal Riot progression and Asmaul Husna explorer', async ({
  page,
}) => {
  await configureDesktop(page, { authenticated: true });
  await page.goto('/board/studio');
  await expect(
    page.getByRole('heading', { name: 'Editorial & Asmaul Husna Studio' })
  ).toBeVisible();
  await expect(page.getByText('Kuro Signal Studio Desk')).toBeVisible();

  await page.locator('#check-typography').click();
  await page.locator('#check-provenance').click();
  await page.locator('#check-preflight').click();
  await expect(page.getByText('4 / 4 gates verified')).toBeVisible();
  await expect(page.getByText('PRESS READY')).toBeVisible();

  await page.getByRole('tab', { name: /Asmaul Husna Concept Explorer/i }).click();
  await expect(page.getByText('Ar-Rahman')).toBeVisible();
  await page.getByLabel('Search Asmaul Husna concepts').fill('zzzz-no-match');
  await expect(
    page.getByText('No Asmaul Husna concept entries match', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset Filters' }).last().click();
  await expect(page.getByText('Ar-Rahman')).toBeVisible();
});

test('/knowledge desktop route renders KnowledgePage', async ({ page }) => {
  await configureDesktop(page, { authenticated: true });
  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge explorer' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pinned passages' })).toBeVisible();
  await expect(
    page.getByText('In the name of God, the Merciful, the Compassionate.')
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find graph records' })).toBeVisible();
});

test('prefers-reduced-motion: reduce renders studio cleanly and resolves motion tokens', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await configureDesktop(page, { authenticated: true });
  await page.goto('/board/studio');
  await expect(
    page.getByRole('heading', { name: 'Editorial & Asmaul Husna Studio' })
  ).toBeVisible();

  const reducedState = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      matches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      motionPop: styles.getPropertyValue('--mw-motion-pop').trim(),
      motionFast: styles.getPropertyValue('--mw-motion-fast').trim(),
    };
  });
  expect(reducedState.matches).toBe(true);
  expect(['0ms', '0s']).toContain(reducedState.motionPop);
  expect(['0ms', '0s']).toContain(reducedState.motionFast);
});

test('DesktopUpdateBannerMount mounts and window.__MW_DESKTOP__ updater methods settle deterministically', async ({
  page,
}) => {
  await configureDesktop(page, { authenticated: true });
  await page.goto('/board');
  await expect(page.getByRole('heading', { name: /Command center/i })).toBeVisible();

  const banner = page.locator('[data-slot="update-banner"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('MoonWitness Desktop v1.0.0-rc.1');

  const updaterResults = await page.evaluate(async () => {
    const bridge = (
      window as Window & {
        __MW_DESKTOP__?: {
          checkForUpdates?: () => Promise<unknown>;
          installUpdate?: () => Promise<unknown>;
        };
      }
    ).__MW_DESKTOP__;
    const checkResult = await bridge?.checkForUpdates?.();
    const installResult = await bridge?.installUpdate?.();
    return { checkResult, installResult };
  });
  expect(updaterResults.checkResult).toEqual({
    status: 'up-to-date',
    currentVersion: '1.0.0-rc.1',
  });
  expect(updaterResults.installResult).toEqual({ status: 'up-to-date' });

  await page.getByRole('button', { name: 'Dismiss update banner' }).click();
  await expect(banner).toBeHidden();
});

test('/board/desktop/observatory renders v3 multi-agent observatory, all 6 tabs, DAG, Magpie telemetry, probe console, commit diff stat, and session inspector', async ({
  page,
}) => {
  await configureDesktop(page, { authenticated: true });
  await page.goto('/board/desktop/observatory');

  await expect(page.getByRole('heading', { level: 1, name: /Agent Observatory/i })).toBeVisible();
  await expect(page.getByText('1/2 (50%)')).toBeVisible();
  await expect(page.getByText('Consolidate Desktop Observatory').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /All-Out Clash/i })).toBeVisible();

  await page.getByRole('tab', { name: /2\. Quest Map/i }).click();
  await expect(page.getByText('Merge Multi-Agent Observatory', { exact: true })).toBeVisible();
  await expect(page.getByText('abc1234', { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: /3\. Beat Lab/i }).click();
  await expect(page.getByText('Magpie Hyper-Router Gateway', { exact: true })).toBeVisible();
  await expect(page.getByText('anthropic-primary', { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: /4\. Cast Roster/i }).click();
  await expect(page.getByText('OpenCode Live Worker', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect' }).first().click();
  await expect(page.getByText('Verified desktop build cleanly', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: /5\. Swarms/i }).click();
  await expect(page.getByText('Desktop Observatory Swarm', { exact: true })).toBeVisible();
  await expect(page.getByText('UI Auditor', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /6\. City, VPS & Git/i }).click();
  await expect(page.getByText('HTTPS apps.moonwitness.biz.id', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Magpie Gateway :3425', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Diff Stat' }).first().click();
  await expect(page.getByText('+42 / -4', { exact: true })).toBeVisible();

  await page.getByLabel('Custom HTTP probe URL').fill('https://apps.moonwitness.biz.id/readyz');
  await page.getByRole('button', { name: 'Probe URL' }).click();
  await expect(page.getByText(/HTTP 200 · 28ms/i)).toBeVisible();
});
