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
        generatedAt: '2026-11-25T08:00:00Z',
        repoRoot: 'Z:/repo/mw-xv',
        antigravityApiConnected: true,
        host: {
          hostname: 'dev-box',
          platform: 'win32',
          cpus: 8,
          memUsedGb: 8.2,
          memTotalGb: 16,
          memPct: 51,
          uptimeSec: 120,
        },
        summary: {
          totalSessions: 2,
          runningSessions: 1,
          subagents: 1,
          swarms: 1,
          runtimeCounts: { antigravity: 1, claude: 1 },
          tokens: { input: 1000, cached: 500, output: 200, total: 1200 },
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
                acceptance: 'Renders tabs',
                expected: '0 UI findings',
                verify: 'bun run ui:check',
                spec: 'Build observatory page',
                commitSha: null,
                commitSubject: null,
              },
            ],
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
            recentEvents: [
              {
                at: '2026-11-25T08:00:00Z',
                kind: 'focus',
                tool: 'update_focus',
                summary: 'Running verification gates',
              },
            ],
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
          dirtyCount: 0,
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
          localPorts: [{ port: 4242, label: 'Desktop Sidecar :4242', open: true }],
          updatedAt: '2026-11-25T08:00:00Z',
        },
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

test('/board/desktop/observatory renders real-time multi-agent observatory, tabs, and session inspector', async ({
  page,
}) => {
  await configureDesktop(page, { authenticated: true });
  await page.goto('/board/desktop/observatory');

  await expect(page.getByRole('heading', { name: /Agent Observatory/i })).toBeVisible();
  await expect(page.getByText('Consolidate Desktop Observatory', { exact: true })).toBeVisible();
  await expect(page.getByText('1/2 (50%)')).toBeVisible();

  await page.getByRole('tab', { name: /Plan Micro-Tasks/i }).click();
  await expect(page.getByText('Merge Multi-Agent Observatory', { exact: true })).toBeVisible();
  await expect(page.getByText('abc1234', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Subagents & Swarms/i }).click();
  await expect(page.getByText('Desktop Observatory Swarm', { exact: true })).toBeVisible();
  await expect(page.getByText('UI Auditor', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Server, VPS & Git/i }).click();
  await expect(page.getByText('HTTPS apps.moonwitness.biz.id', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Desktop Sidecar :4242', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: /Live Agents & Activity/i }).click();
  await page.getByRole('button', { name: 'Inspect' }).first().click();
  await expect(page.getByText('Verified desktop build cleanly', { exact: true })).toBeVisible();
});
