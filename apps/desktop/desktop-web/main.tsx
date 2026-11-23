import '../../board/src/app/global.css';
import { StrictMode, Suspense, useEffect, useState } from 'react';
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
import AiCompanyHqPage from '@/app/board/ai/hq/page';
import AiMissionControlPage from '@/app/board/ai/mission-control/page';
import AiOperationsPage from '@/app/board/ai/operations/page';
import AiContinuityPage from '@/app/board/ai/continuity/page';
import AiGovernancePage from '@/app/board/ai/governance/page';
import AiEvalLabPage from '@/app/board/ai/eval-lab/page';
import AiProvidersPage from '@/app/board/ai/providers/page';
import { usePathname } from './shims/next-navigation';
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
  return <DashboardPage />;
}

function DesktopBoardApp() {
  const [authReady, setAuthReady] = useState(Boolean(client.currentUser));

  useEffect(() => {
    let active = true;
    const bootstrapLocalSession = async () => {
      if (!client.currentUser) {
        try {
          await client.login({
            login: 'local',
            password: 'local-offline-session',
          });
        } catch {
          // Local loopback API may still be warming up; ProtectedRoute handles retry/fallback.
        }
      }
      if (active) setAuthReady(true);
    };
    void bootstrapLocalSession();
    return () => {
      active = false;
    };
  }, []);

  if (!authReady) {
    return <main className="min-h-dvh p-8" aria-busy="true" />;
  }

  return (
    <SkinProvider>
      <SoundProvider>
        <Suspense fallback={<main className="min-h-dvh p-8" aria-busy="true" />}>
          <BoardProviders>
            <ProtectedRoute>
              <DesktopRouteSwitch />
            </ProtectedRoute>
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
