import '../../board/src/app/global.css';
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

interface DesktopApiWindow extends Window {
  __MW_DESKTOP_API_URL__?: string;
}

function getDesktopApiUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as DesktopApiWindow).__MW_DESKTOP_API_URL__;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

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
      <main className="min-h-dvh p-8" aria-busy="true">
        <Skeleton label="Starting local workspace" className="h-12 w-48" />
      </main>
    );
  }

  if (bootstrap.status === 'error') {
    return (
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
    );
  }

  return (
    <SkinProvider>
      <SoundProvider>
        <Suspense
          fallback={
            <main className="min-h-dvh p-8" aria-busy="true">
              <Skeleton label="Loading workspace" className="h-12 w-48" />
            </main>
          }
        >
          <BoardProviders>
            <DesktopRoutes />
          </BoardProviders>
        </Suspense>
      </SoundProvider>
    </SkinProvider>
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
