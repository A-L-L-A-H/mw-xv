import '../../board/src/app/global.css';
import './desktop.css';
import { StrictMode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { createRoot } from 'react-dom/client';
import { SoundProvider } from '@moonwitness/ui/components/audio';
import { SkinProvider } from '@/components/providers/skin-provider';
import { ProtectedRoute } from '@/components/layout/protected-route';
import { BoardProviders } from '@/providers';
import { client } from '@/lib/client';
import { DashboardPage } from '@/board-pages/dashboard-page';
import { ProjectsPage } from '@/board-pages/projects-page';
import { KnowledgePage } from '@/board-pages/knowledge-page';
import { ModelPage } from '@/board-pages/model-page';
import { SettingsPage } from '@/board-pages/settings-page';
import { ProfilePage } from '@/board-pages/profile-page';
import { StoryWorkbenchPage } from '@/board-pages/story-workbench-page';
import { WhatsappPage } from '@/board-pages/whatsapp-page';
import { WhatsAppStatusPage } from '@/board-pages/whatsapp-status-page';
import { CloudIspPage } from '@/board-pages/cloud-isp-page';
import { CommercialPage } from '@/board-pages/commercial-page';
import { AuthPage } from '@/board-pages/auth-page';
import BoardStudioPage from '@/app/board/studio/page';
import NotFound from '@/app/not-found';
import AiCompanyHqPage from '@/app/board/ai/hq/page';
import AiMissionControlPage from '@/app/board/ai/mission-control/page';
import AiOperationsPage from '@/app/board/ai/operations/page';
import AiContinuityPage from '@/app/board/ai/continuity/page';
import AiGovernancePage from '@/app/board/ai/governance/page';
import AiEvalLabPage from '@/app/board/ai/eval-lab/page';
import AiProvidersPage from '@/app/board/ai/providers/page';
import { navigate, usePathname } from './shims/next-navigation';
import { DesktopErrorBoundary, installWebviewErrorTelemetry } from './error-telemetry';

import type {
  DesktopBridgeSnapshot,
  DesktopCapabilityBridge,
} from '@/lib/desktop-bridge';

const DESKTOP_APP_VERSION = '1.0.0-rc.1';
const UPDATER_IPC_TIMEOUT_MS = 4000;

export interface DesktopUpdateCheckSummary {
  readonly status: 'up-to-date' | 'available' | 'error';
  readonly currentVersion: string;
  readonly availableVersion?: string;
  readonly releaseUrl?: string;
  readonly errorMessage?: string;
}

export interface DesktopUpdateInstallSummary {
  readonly status: 'ready' | 'up-to-date' | 'error';
  readonly availableVersion?: string;
  readonly errorMessage?: string;
}

type WebDesktopBridgeWithUpdater = DesktopCapabilityBridge & {
  checkForUpdates?: () => Promise<DesktopUpdateCheckSummary>;
  installUpdate?: () => Promise<DesktopUpdateInstallSummary>;
};

interface DesktopApiWindow extends Window {
  __MW_DESKTOP_API_URL__?: string;
  __MW_DESKTOP__?: WebDesktopBridgeWithUpdater;
  __TAURI_INTERNALS__?: {
    invoke?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
  __TAURI__?: {
    core?: {
      invoke?: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
}

function getDesktopApiUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as DesktopApiWindow).__MW_DESKTOP_API_URL__;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

function resolveTauriInvoke():
  | (<T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>)
  | null {
  if (typeof window === 'undefined') return null;
  const win = window as DesktopApiWindow;
  if (typeof win.__TAURI_INTERNALS__?.invoke === 'function') {
    return win.__TAURI_INTERNALS__.invoke.bind(win.__TAURI_INTERNALS__);
  }
  if (typeof win.__TAURI__?.core?.invoke === 'function') {
    return win.__TAURI__.core.invoke.bind(win.__TAURI__.core);
  }
  return null;
}

async function runBoundedPromise<T>(
  operation: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function checkForDesktopUpdates(): Promise<DesktopUpdateCheckSummary> {
  const fallback: DesktopUpdateCheckSummary = {
    status: 'up-to-date',
    currentVersion: DESKTOP_APP_VERSION,
  };
  const invoke = resolveTauriInvoke();
  if (!invoke) return fallback;

  const rawResult = await runBoundedPromise<unknown>(
    invoke('plugin:updater|check'),
    UPDATER_IPC_TIMEOUT_MS,
    null
  );
  if (rawResult && typeof rawResult === 'object') {
    const record = rawResult as {
      available?: unknown;
      version?: unknown;
      releaseUrl?: unknown;
    };
    if (record.available === true && typeof record.version === 'string' && record.version.trim()) {
      return {
        status: 'available',
        currentVersion: DESKTOP_APP_VERSION,
        availableVersion: record.version.trim(),
        ...(typeof record.releaseUrl === 'string' ? { releaseUrl: record.releaseUrl } : {}),
      };
    }
  }
  return fallback;
}

async function installDesktopUpdate(): Promise<DesktopUpdateInstallSummary> {
  const fallback: DesktopUpdateInstallSummary = {
    status: 'up-to-date',
  };
  const invoke = resolveTauriInvoke();
  if (!invoke) return fallback;

  const rawResult = await runBoundedPromise<unknown>(
    invoke('plugin:updater|download_and_install'),
    UPDATER_IPC_TIMEOUT_MS,
    null
  );
  if (rawResult && typeof rawResult === 'object') {
    const record = rawResult as { status?: unknown; version?: unknown };
    if (record.status === 'ready') {
      return {
        status: 'ready',
        ...(typeof record.version === 'string' ? { availableVersion: record.version } : {}),
      };
    }
  }
  return fallback;
}

function createWebFallbackBridge(): WebDesktopBridgeWithUpdater {
  const offlineSidecarState = (offline: boolean) => ({
    status: (offline ? 'offline' : 'ready') as 'offline' | 'ready',
    sqlitePath: 'webview-fallback',
    schemaVersion: 1,
    offlineMode: offline,
    registeredOrmModels: [] as readonly string[],
    pendingOutboxCount: 0,
    syncedOutboxCount: 0,
    failedOutboxCount: 0,
    conflictOutboxCount: 0,
    activeRunCount: 0,
    lastSyncAt: null,
    lastSyncError: null,
  });

  const bridge: WebDesktopBridgeWithUpdater = {
    protocolVersion: '1.0',
    hostSurface: 'apps/board',
    async getStatus(): Promise<DesktopBridgeSnapshot> {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1';
      return {
        protocolVersion: '1.0',
        hostSurface: 'apps/board',
        boardOrigin: origin,
        apiBaseUrl: getDesktopApiUrl() ?? origin,
        localAiEndpoint: null,
        activeLeases: [],
        sidecar: offlineSidecarState(false),
        mcpServers: [],
      };
    },
    checkForUpdates: checkForDesktopUpdates,
    installUpdate: installDesktopUpdate,
    worktree: Object.freeze({
      listLeases: async () => [],
      diff: async (runId: string) => ({
        runId,
        leaseId: 'webview',
        branchName: 'local',
        headCommit: '',
        clean: true,
        files: [],
        patch: '',
        patchSha256: '',
        outOfScopeFiles: [],
        scopeClean: true,
      }),
      release: async (runId: string) => ({
        leaseId: 'webview',
        runId,
        branchName: 'local',
        worktreePath: '',
        baseRef: '',
        headCommit: '',
        fencingToken: 0,
        status: 'released' as const,
        createdAt: new Date().toISOString(),
        allowedPaths: [],
      }),
    }),
    risk: Object.freeze({
      getAuditLog: () => [],
    }),
    sidecar: Object.freeze({
      getState: () => offlineSidecarState(false),
      setOfflineMode: (offline: boolean) => offlineSidecarState(offline),
      listEnvelopes: () => [],
    }),
    mcp: Object.freeze({
      listServers: () => [],
    }),
    dispose: () => {},
  };

  return Object.freeze(bridge);
}

function ensureDesktopWindowBridge(): void {
  if (typeof window === 'undefined') return;
  const win = window as DesktopApiWindow;
  const existing = win.__MW_DESKTOP__;
  if (!existing) {
    win.__MW_DESKTOP__ = createWebFallbackBridge();
    return;
  }
  if (!Object.isFrozen(existing)) {
    if (typeof existing.checkForUpdates !== 'function') {
      existing.checkForUpdates = checkForDesktopUpdates;
    }
    if (typeof existing.installUpdate !== 'function') {
      existing.installUpdate = installDesktopUpdate;
    }
  }
}

ensureDesktopWindowBridge();
installWebviewErrorTelemetry(getDesktopApiUrl);

function DesktopRouteSwitch() {
  const pathname = usePathname();
  const normalized = pathname.replace(/\/+$/u, '') || '/';

  if (normalized === '/' || normalized === '/board') {
    return <DashboardPage />;
  }
  if (normalized === '/board/projects') {
    return <ProjectsPage />;
  }
  if (normalized === '/board/ai' || normalized === '/board/ai/hq') {
    return <AiCompanyHqPage />;
  }
  if (normalized === '/board/ai/mission-control') {
    return <AiMissionControlPage />;
  }
  if (normalized === '/board/ai/operations') {
    return <AiOperationsPage />;
  }
  if (normalized === '/board/ai/continuity') {
    return <AiContinuityPage />;
  }
  if (normalized === '/board/ai/governance') {
    return <AiGovernancePage />;
  }
  if (normalized === '/board/ai/eval-lab') {
    return <AiEvalLabPage />;
  }
  if (normalized === '/board/ai/providers') {
    return <AiProvidersPage />;
  }
  if (normalized === '/board/knowledge' || normalized === '/knowledge') {
    return <KnowledgePage />;
  }
  if (normalized.startsWith('/board/m/')) {
    return <ModelPage />;
  }
  if (normalized === '/board/settings') {
    return <SettingsPage />;
  }
  if (normalized === '/board/profile') {
    return <ProfilePage />;
  }
  if (normalized === '/board/stories/workbench') {
    return <StoryWorkbenchPage />;
  }
  if (normalized === '/board/whatsapp/status') {
    return <WhatsAppStatusPage />;
  }
  if (normalized === '/board/whatsapp') {
    return <WhatsappPage />;
  }
  if (normalized === '/board/cloud') {
    return <CloudIspPage />;
  }
  if (normalized === '/board/commercial') {
    return <CommercialPage />;
  }
  if (normalized === '/board/studio') {
    return <BoardStudioPage />;
  }
  return <NotFound />;
}

type BootstrapState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | { readonly status: 'error'; readonly message: string };

function DesktopChrome() {
  return (
    <div className="desktop-chrome" aria-hidden="true">
      <span className="desktop-chrome-mark" />
      <span className="desktop-chrome-title">MoonWitness Desktop</span>
      <span className="desktop-chrome-badge">Local workspace</span>
    </div>
  );
}

function DesktopBoot({ label }: { readonly label: string }) {
  return (
    <main className="desktop-boot-art" aria-busy="true">
      <Skeleton label={label} className="h-12 w-64" />
    </main>
  );
}

function DesktopRoutes() {
  const pathname = usePathname();
  const normalized = pathname.replace(/\/+$/u, '') || '/';

  if (normalized === '/login') return <AuthPage mode="login" />;
  if (normalized === '/register') return <AuthPage mode="register" />;
  return (
    <ProtectedRoute>
      <DesktopRouteSwitch />
    </ProtectedRoute>
  );
}

function DesktopBoardApp() {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login' || pathname === '/register';
  const [bootstrap, setBootstrap] = useState<BootstrapState>(() =>
    isAuthRoute || client.currentUser ? { status: 'ready' } : { status: 'loading' }
  );
  const [attempt, setAttempt] = useState(0);
  const bootstrapPromise = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    if (isAuthRoute || client.currentUser) {
      setBootstrap({ status: 'ready' });
      return;
    }
    let active = true;
    setBootstrap({ status: 'loading' });
    const pending = (bootstrapPromise.current ??= client.login({
      login: 'local',
      password: 'local-offline-session',
    }));
    void pending
      .then(() => {
        if (active) setBootstrap({ status: 'ready' });
      })
      .catch((error: unknown) => {
        if (active) {
          setBootstrap({
            status: 'error',
            message:
              error instanceof Error ? error.message : 'The local session could not be started.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, isAuthRoute]);

  const retry = useCallback(() => {
    bootstrapPromise.current = null;
    setAttempt((value) => value + 1);
  }, []);

  const openSignIn = useCallback(() => {
    setBootstrap({ status: 'ready' });
    navigate('/login');
  }, []);

  if (bootstrap.status === 'loading') {
    return (
      <>
        <DesktopChrome />
        <DesktopBoot label="Starting local workspace" />
      </>
    );
  }

  if (bootstrap.status === 'error') {
    return (
      <>
        <DesktopChrome />
        <main className="grid min-h-dvh place-items-center p-6">
        <Panel
          surface="paper"
          frame="torn"
          className="max-w-xl p-8"
          title="Local workspace unavailable"
          description={bootstrap.message}
        >
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={retry}>
              Retry
            </Button>
            <Button type="button" variant="outline" onClick={openSignIn}>
              Sign in manually
            </Button>
          </div>
        </Panel>
      </main>
      </>
    );
  }

  return (
    <>
      <DesktopChrome />
      <SkinProvider>
        <SoundProvider>
          <Suspense fallback={<DesktopBoot label="Loading workspace" />}>
            <BoardProviders>
              <DesktopRoutes />
            </BoardProviders>
          </Suspense>
        </SoundProvider>
      </SkinProvider>
    </>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <DesktopErrorBoundary getApiUrl={getDesktopApiUrl}>
        <DesktopBoardApp />
      </DesktopErrorBoundary>
    </StrictMode>
  );
}
