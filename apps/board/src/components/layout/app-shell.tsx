'use client';

import './board-chrome.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ModelInfo } from '@moonwitness/client';
import { ToastHost } from '@moonwitness/ui/components/toast';
import {
  CalendarIcon,
  CheckIcon,
  CodeIcon,
  ColumnsIcon,
  CompanyIcon,
  GlobeIcon,
  KeyboardIcon,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  KnowledgeIcon,
  SearchIcon,
  StoryIcon,
  SunIcon,
  SettingsIcon,
  SparkleIcon,
  UserIcon,
  MessageIcon,
  PartnerIcon,
} from '@moonwitness/ui/icons';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import { canReadResearch } from '@/lib/research-access';
import { useAuth } from '@/hooks/use-auth-context';
import { useModels } from '@/hooks/use-model';
import { useSkin } from '@/components/providers/skin-context';
import { DashboardIcon, modelIcon, modelLabel } from '@/lib/models';
import { readDevelopmentMode, updateDevelopmentMode } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@moonwitness/ui/components/button';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@moonwitness/ui/components/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@moonwitness/ui/components/dropdown-menu';
import { Logo } from '@/components/manga/logo';
import { DecorativeMotif, Doodle, LoadingSpinner } from '@moonwitness/ui/components/effects';
import { ShortcutsDialog } from '@/components/manga/shortcuts-dialog';
import { ActivityBell } from './activity-bell';
import { NotificationBell } from './notification-bell';
import { Sheet, SheetContent, SheetTrigger } from '@moonwitness/ui/components/sheet';
import { SoundToggle } from '@moonwitness/ui/components/audio';
import { DesktopHarnessDrawer } from '@/components/ai/desktop-harness-drawer';
import { DesktopLogDrawer } from '@/components/ai/desktop-log-drawer';
import { WorkspaceAssistantDrawer } from '@/components/ai/workspace-assistant-drawer';
import { QuickCaptureModal } from '@/components/desktop/quick-capture-modal';
import { AI_MISSION_CONTROL_ROUTES } from '@/components/ai/ai-api';
import { UpdateBanner, type UpdateBannerStatus } from '@moonwitness/ui/components/update-banner';
import { ModePicker } from '@moonwitness/ui/components/mode-picker';
import { getDesktopBridge, useDesktopBridge } from '@/lib/desktop-bridge';
import { useDesktopMode } from '@/lib/desktop-mode';

function NavItem({
  to,
  label,
  icon: Icon,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: typeof DashboardIcon;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === to || (to !== '/board' && pathname?.startsWith(`${to}/`));
  return (
    <Link
      href={to}
      onClick={onNavigate}
      title={label}
      className={cn(
        'board-nav-item group relative flex min-h-10 min-w-0 items-center gap-3 border-l-4 border-transparent px-2 py-2 font-sans text-sm font-semibold tracking-normal text-ink/75 hover:bg-ink/10 hover:text-ink',
        active &&
          'board-nav-item-active border-magenta bg-magenta text-on-magenta hover:bg-magenta hover:text-on-magenta'
      )}
      aria-current={active ? 'page' : undefined}
    >
      <>
        <Icon className="relative size-5" strokeWidth={2.4} />
        <span className="relative min-w-0 whitespace-normal leading-tight">{label}</span>
      </>
    </Link>
  );
}

function ModelNavigation({
  groups,
  isLoading,
  canReadResearch,
  canEditStories,
  isWorkspaceDesktop = false,
  onNavigate,
}: {
  groups: Array<[string, ModelInfo[]]>;
  isLoading: boolean;
  canReadResearch: boolean;
  canEditStories: boolean;
  isWorkspaceDesktop?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Models" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      <NavItem to="/board" label="Dashboard" icon={DashboardIcon} onNavigate={onNavigate} />
      {canReadResearch && (
        <NavItem
          to="/board/knowledge"
          label="Knowledge explorer"
          icon={KnowledgeIcon}
          onNavigate={onNavigate}
        />
      )}
      {canEditStories && (
        <NavItem
          to="/board/stories/workbench"
          label="Story workbench"
          icon={StoryIcon}
          onNavigate={onNavigate}
        />
      )}
      <NavItem to="/board/whatsapp" label="WhatsApp" icon={MessageIcon} onNavigate={onNavigate} />
      <NavItem
        to="/board/projects"
        label="Project Command"
        icon={ColumnsIcon}
        onNavigate={onNavigate}
      />
      <NavItem
        to="/board/commercial"
        label="Commercial"
        icon={CompanyIcon}
        onNavigate={onNavigate}
      />
      <NavItem to="/board/studio" label="Studio" icon={SparkleIcon} onNavigate={onNavigate} />
      {!isWorkspaceDesktop && (
        <>
          <NavItem to="/board/cloud" label="Cloud & ISP" icon={GlobeIcon} onNavigate={onNavigate} />
          <NavItem
            to="/board/ai/hq"
            label="AI Mission Control"
            icon={SparkleIcon}
            onNavigate={onNavigate}
          />
          {isLoading &&
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 bg-ink/10" />)}
          {groups.map(([group, items]) => (
            <div key={group} className="space-y-1">
              <p className="px-3 pb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">
                {group}
              </p>
              {items.map((item) => (
                <NavItem
                  key={item.model}
                  to={`/board/m/${item.model}`}
                  label={item.menu.label ?? modelLabel(item.model)}
                  icon={modelIcon(item.model)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ))}
        </>
      )}
    </nav>
  );
}

function DesktopUpdateBannerMount() {
  const { isDesktop, bridge } = useDesktopBridge();
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<UpdateBannerStatus>('idle');
  const [currentVersion, setCurrentVersion] = useState('1.0.0-rc.1');
  const [availableVersion, setAvailableVersion] = useState<string | undefined>(undefined);
  const [releaseUrl, setReleaseUrl] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const handleCheck = useCallback(async () => {
    setStatus('checking');
    setErrorMessage(undefined);
    const activeBridge = bridge ?? getDesktopBridge();
    if (!activeBridge || typeof activeBridge.checkForUpdates !== 'function') {
      setStatus('idle');
      return;
    }
    try {
      const summary = await activeBridge.checkForUpdates();
      if (summary.currentVersion) setCurrentVersion(summary.currentVersion);
      setAvailableVersion(summary.availableVersion);
      setReleaseUrl(summary.releaseUrl);
      if (summary.status === 'available') {
        setStatus('available');
      } else if (summary.status === 'error') {
        setErrorMessage(summary.errorMessage ?? 'Unable to check for updates.');
        setStatus('error');
      } else {
        setStatus('idle');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to check for updates.');
      setStatus('error');
    }
  }, [bridge]);

  const handleInstall = useCallback(async () => {
    const activeBridge = bridge ?? getDesktopBridge();
    if (!activeBridge || typeof activeBridge.installUpdate !== 'function') return;
    setStatus('downloading');
    setErrorMessage(undefined);
    try {
      const result = await activeBridge.installUpdate();
      if (result.availableVersion) setAvailableVersion(result.availableVersion);
      if (result.status === 'ready') {
        setStatus('ready');
      } else if (result.status === 'error') {
        setErrorMessage(result.errorMessage ?? 'Unable to install update.');
        setStatus('error');
      } else {
        setStatus('idle');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to install update.');
      setStatus('error');
    }
  }, [bridge]);

  if (!isDesktop || dismissed) return null;

  return (
    <UpdateBanner
      currentVersion={currentVersion}
      availableVersion={availableVersion}
      releaseUrl={releaseUrl}
      errorMessage={errorMessage}
      status={status}
      onCheck={() => void handleCheck()}
      onInstall={() => void handleInstall()}
      onDismiss={() => setDismissed(true)}
    />
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { mode: theme, setMode } = useSkin();
  const toggle = useCallback(() => setMode(theme === 'dark' ? 'light' : 'dark'), [setMode, theme]);
  const { isDesktop } = useDesktopBridge();
  const {
    mode: desktopMode,
    isChosen: desktopModeChosen,
    setMode: setDesktopMode,
  } = useDesktopMode();
  const isWorkspaceDesktop = isDesktop && desktopMode === 'workspace';
  const toggleDesktopMode = useCallback(() => {
    setDesktopMode(desktopMode === 'workspace' ? 'developer' : 'workspace');
  }, [desktopMode, setDesktopMode]);
  const { data: models, isLoading } = useModels();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const commandPaletteTriggerRef = useRef<HTMLButtonElement>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [activeCompanyId, setActiveCompanyId] = useState<number | undefined>(() =>
    client.getCompanyId()
  );
  const researchAccess = canReadResearch(user?.role, client.getCompanyId());
  const canEditStories =
    (user?.role === 'user' || user?.role === 'superadmin') && Boolean(client.getCompanyId());
  const [developmentMode, setDevelopmentMode] = useState(readDevelopmentMode);

  const toggleDevelopmentMode = useCallback(() => {
    setDevelopmentMode((enabled) => !enabled);
  }, []);

  useEffect(() => {
    updateDevelopmentMode(developmentMode);
  }, [developmentMode]);

  const router = useRouter();

  // Query accessible companies for the tenant switcher
  const { data: companiesData } = useQuery({
    queryKey: scopedQueryKey(['companies_selector']),
    queryFn: () =>
      client.model<{ id: number; name: string }>('base.company').searchRead({
        limit: 50,
        order: 'name asc',
      }),
  });

  const companies = companiesData?.records ?? [];
  const currentCompany = companies.find((c) => c.id === activeCompanyId);

  const handleSelectCompany = (companyId: number | undefined) => {
    client.setCompanyId(companyId);
    setActiveCompanyId(companyId);
    // Tenant-scoped query keys switch atomically; don't refetch old keys with the new header.
  };

  // Omnisearch cross-model query
  const searchQuery = useQuery({
    queryKey: scopedQueryKey(['omnisearch', paletteQuery]),
    queryFn: async () => {
      const q = paletteQuery.trim();
      if (!q) return { items: [], failedScopes: [] as string[] };
      const [partnersResult, usersResult, compsResult, activitiesResult] = await Promise.allSettled(
        [
          client.model<{ id: number; name: string }>('base.partner').searchRead({
            domain: [['name', 'ilike', `%${q}%`]],
            limit: 5,
          }),
          client.model<{ id: number; login: string }>('base.user').searchRead({
            domain: [['login', 'ilike', `%${q}%`]],
            limit: 5,
          }),
          client.model<{ id: number; name: string }>('base.company').searchRead({
            domain: [['name', 'ilike', `%${q}%`]],
            limit: 5,
          }),
          client
            .model<{
              id: number;
              summary: string;
              activity_type: string;
              resource_model: string;
              resource_id: number;
            }>('base.activity')
            .searchRead({
              domain: [['summary', 'ilike', `%${q}%`]],
              limit: 5,
            }),
        ]
      );

      const scopeEntries = [
        ['Partners', partnersResult],
        ['Users', usersResult],
        ['Companies', compsResult],
        ['Activities', activitiesResult],
      ] as const;
      const failedScopes: string[] = [];
      for (const [label, result] of scopeEntries) {
        if (result.status === 'rejected') failedScopes.push(label);
      }
      if (failedScopes.length === scopeEntries.length) {
        throw new Error('Record search is currently unavailable.');
      }

      const items: Array<{
        id: number;
        model: string;
        title: string;
        type: 'partner' | 'user' | 'company' | 'activity';
        targetUrl?: string;
      }> = [];

      if (partnersResult.status === 'fulfilled') {
        for (const p of partnersResult.value.records) {
          items.push({ id: p.id, model: 'base.partner', title: p.name, type: 'partner' });
        }
      }
      if (usersResult.status === 'fulfilled') {
        for (const u of usersResult.value.records) {
          items.push({ id: u.id, model: 'base.user', title: u.login, type: 'user' });
        }
      }
      if (compsResult.status === 'fulfilled') {
        for (const c of compsResult.value.records) {
          items.push({ id: c.id, model: 'base.company', title: c.name, type: 'company' });
        }
      }
      if (activitiesResult.status === 'fulfilled') {
        for (const a of activitiesResult.value.records) {
          items.push({
            id: a.id,
            model: 'base.activity',
            title: a.summary,
            type: 'activity',
            targetUrl: `/board/m/${a.resource_model}/${a.resource_id}`,
          });
        }
      }
      return { items, failedScopes };
    },
    enabled: paletteOpen && paletteQuery.trim().length >= 2,
  });
  const searchResults = searchQuery.data?.items;
  const searchFailedScopes = searchQuery.data?.failedScopes ?? [];

  const groups = useMemo(() => {
    const byGroup = new Map<string, ModelInfo[]>();
    for (const item of models ?? []) {
      const group = item.menu.group;
      byGroup.set(group, [...(byGroup.get(group) ?? []), item]);
    }
    return [...byGroup.entries()].map(
      ([group, items]) =>
        [group, items.sort((left, right) => left.menu.sequence - right.menu.sequence)] as [
          string,
          ModelInfo[],
        ]
    );
  }, [models]);

  const visibleGroups = useMemo(() => {
    if (developmentMode) return groups;
    return groups
      .map(
        ([group, items]) =>
          [group, items.filter((item) => !item.menu.developmentOnly)] as [string, ModelInfo[]]
      )
      .filter(([, items]) => items.length > 0);
  }, [developmentMode, groups]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement);

      if (isEditableTarget) return;

      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === '/' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <ToastHost theme={theme} />
      {/* Sidebar: scoped .dark tokens keep it ink-black with light ink in BOTH themes. */}
      <aside className="board-sidebar dark sticky top-0 hidden h-dvh flex-col border-r-4 border-ink bg-night text-ink lg:flex">
        <div className="relative flex items-center gap-3 border-b-2 border-dashed border-ink/20 px-4 py-4">
          <Logo compact decorative surface="dark" className="size-9 shrink-0" />
          <span className="font-display text-sm uppercase tracking-[0.16em] text-ink">
            MoonWitness
          </span>
        </div>
        <ModelNavigation
          groups={visibleGroups}
          isLoading={isLoading}
          canReadResearch={researchAccess}
          canEditStories={canEditStories}
          isWorkspaceDesktop={isWorkspaceDesktop}
        />
        {(isDesktop || !isWorkspaceDesktop) && (
          <div className="space-y-2 border-t-2 border-dashed border-ink/20 p-3">
            {isDesktop && (
              <Button
                type="button"
                onClick={toggleDesktopMode}
                aria-label={`Switch desktop mode (current: ${desktopMode === 'workspace' ? 'Workspace' : 'DX / Developer'})`}
                className="flex w-full items-center gap-3 border-2 border-ink/30 bg-transparent px-3 py-2 text-left font-mono text-xs uppercase tracking-wider text-ink-soft transition-colors hover:border-ink hover:text-ink"
              >
                {desktopMode === 'workspace' ? (
                  <ColumnsIcon className="size-4" />
                ) : (
                  <CodeIcon className="size-4" />
                )}
                {desktopMode === 'workspace' ? 'Mode: Workspace' : 'Mode: DX / Dev'}
              </Button>
            )}
            {!isWorkspaceDesktop && (
              <Button
                type="button"
                onClick={toggleDevelopmentMode}
                aria-pressed={developmentMode}
                className={cn(
                  'flex w-full items-center gap-3 border-2 px-3 py-2 text-left font-mono text-xs uppercase tracking-wider transition-colors',
                  developmentMode
                    ? 'border-primary bg-primary text-primary-foreground font-bold'
                    : 'border-ink/30 bg-transparent text-ink-soft hover:border-ink hover:text-ink'
                )}
              >
                <CodeIcon className="size-4" />
                {developmentMode ? 'Development Mode: On' : 'Development Mode'}
              </Button>
            )}
          </div>
        )}
        <div className="sidebar-zine-collage" aria-hidden="true">
          <DecorativeMotif kind="eye-target" className="sidebar-zine-eye" />
          <span className="sidebar-zine-note">
            <Doodle kind="bolt" className="size-3.5" /> +1 every day
          </span>
          <Doodle kind="crown" className="size-4 shrink-0 text-[var(--mw-yellow)]" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="board-topbar sticky top-0 z-20 flex min-w-0 items-center gap-1 border-b-2 border-ink bg-paper/90 px-3 py-3 backdrop-blur sm:gap-2 sm:px-4 lg:px-5 xl:gap-3 xl:px-6">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 lg:hidden"
                aria-label="Open model navigation"
              >
                <MenuIcon className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="board-sidebar dark w-[min(18rem,85vw)] gap-0 border-r-4 border-ink bg-night p-0 text-ink"
              aria-label="Model navigation"
            >
              <div className="flex items-center gap-3 border-b-2 border-dashed border-ink/20 px-4 py-4 pr-14">
                <Logo compact decorative surface="dark" className="size-9 shrink-0" />
                <span className="font-display text-sm uppercase tracking-[0.16em] text-ink">
                  MoonWitness
                </span>
              </div>
              <ModelNavigation
                groups={visibleGroups}
                isLoading={isLoading}
                canReadResearch={researchAccess}
                canEditStories={canEditStories}
                isWorkspaceDesktop={isWorkspaceDesktop}
                onNavigate={() => setMobileNavOpen(false)}
              />
              {(isDesktop || !isWorkspaceDesktop) && (
                <div className="space-y-2 border-t-2 border-dashed border-ink/20 p-3">
                  {isDesktop && (
                    <Button
                      type="button"
                      onClick={toggleDesktopMode}
                      aria-label={`Switch desktop mode (current: ${desktopMode === 'workspace' ? 'Workspace' : 'DX / Developer'})`}
                      className="flex w-full items-center gap-3 border-2 border-ink/30 bg-transparent px-3 py-2 text-left font-mono text-xs uppercase tracking-wider text-ink-soft transition-colors hover:border-ink hover:text-ink"
                    >
                      {desktopMode === 'workspace' ? (
                        <ColumnsIcon className="size-4" />
                      ) : (
                        <CodeIcon className="size-4" />
                      )}
                      {desktopMode === 'workspace' ? 'Mode: Workspace' : 'Mode: DX / Dev'}
                    </Button>
                  )}
                  {!isWorkspaceDesktop && (
                    <Button
                      type="button"
                      onClick={toggleDevelopmentMode}
                      aria-pressed={developmentMode}
                      className={cn(
                        'flex w-full items-center gap-3 border-2 px-3 py-2 text-left font-mono text-xs uppercase tracking-wider transition-colors',
                        developmentMode
                          ? 'border-primary bg-primary text-primary-foreground font-bold'
                          : 'border-ink/30 bg-transparent text-ink-soft hover:border-ink hover:text-ink'
                      )}
                    >
                      <CodeIcon className="size-4" />
                      {developmentMode ? 'Development Mode: On' : 'Development Mode'}
                    </Button>
                  )}
                </div>
              )}
              <div className="sidebar-zine-collage" aria-hidden="true">
                <DecorativeMotif kind="eye-target" className="sidebar-zine-eye" />
                <span className="sidebar-zine-note">
                  <Doodle kind="bolt" className="size-3.5" /> +1 every day
                </span>
                <Doodle kind="crown" className="size-4 shrink-0 text-[var(--mw-yellow)]" />
              </div>
            </SheetContent>
          </Sheet>

          {/* Omnisearch trigger button */}
          <Button
            id="open-command-palette"
            ref={commandPaletteTriggerRef}
            onClick={() => setPaletteOpen(true)}
            className="press flex h-10 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-none border-2 border-ink bg-paper-raised px-2 text-left text-sm text-ink-faint shadow-ink-sm sm:max-w-md sm:px-3 md:min-w-[9rem] xl:min-w-[11rem]"
          >
            <SearchIcon className="size-4 shrink-0 text-ink" strokeWidth={2.6} />
            <span className="truncate">Search records, models, commands…</span>
            <kbd className="ml-auto hidden shrink-0 border border-ink px-1.5 font-mono text-[11px] text-ink sm:block">
              Ctrl K
            </kbd>
          </Button>

          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 xl:gap-2">
            {isDesktop && <WorkspaceAssistantDrawer />}
            {!isWorkspaceDesktop && <DesktopHarnessDrawer />}
            {/* Tenant / Company Switcher */}
            {companies.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-w-0 gap-1.5 border-2 border-ink px-2 font-mono text-xs shadow-ink-sm xl:gap-2 xl:px-3"
                    aria-label={`Switch company. Current scope: ${currentCompany?.name ?? 'Global Scope'}`}
                    title={`Company scope: ${currentCompany?.name ?? 'Global Scope'}`}
                  >
                    <CompanyIcon className="size-3.5 shrink-0 text-yellow-readable" />
                    <span className="hidden xl:inline">Tenant:</span>
                    <span className="hidden max-w-[96px] truncate font-bold lg:inline xl:max-w-[120px]">
                      {currentCompany ? currentCompany.name : 'Global Scope'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 font-sans">
                  <DropdownMenuLabel className="font-display uppercase tracking-wider text-xs">
                    Multi-Tenant Scope
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleSelectCompany(undefined)}
                    className="flex items-center justify-between text-xs cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <GlobeIcon className="size-3.5 text-ink-faint" />
                      Global (All Companies)
                    </span>
                    {!activeCompanyId && <CheckIcon className="size-3.5 text-yellow-readable" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {companies.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => handleSelectCompany(c.id)}
                      className="flex items-center justify-between text-xs cursor-pointer"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <CompanyIcon className="size-3.5 text-ink-faint" />
                        {c.name}
                      </span>
                      {activeCompanyId === c.id && (
                        <CheckIcon className="size-3.5 text-yellow-readable" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Activity Notification Center */}
            <ActivityBell />
            <NotificationBell />
            <SoundToggle />

            {/* Keyboard Shortcuts Trigger */}
            <Button
              id="shortcuts-btn"
              variant="outline"
              size="icon"
              className="hidden lg:inline-flex"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Keyboard Shortcuts"
              title="Keyboard Shortcuts (Ctrl + /)"
            >
              <KeyboardIcon className="size-4" />
            </Button>

            {/* Theme Toggle */}
            <Button
              id="toggle-theme"
              variant="outline"
              size="icon"
              className="hidden sm:inline-flex"
              onClick={toggle}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </Button>

            {/* User Dropdown */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  id="user-menu"
                  variant="outline"
                  className="min-w-0 gap-1.5 px-2 normal-case xl:gap-2 xl:px-3"
                  aria-label={`User menu for ${user?.login ?? 'current user'}`}
                  title={`User menu for ${user?.login ?? 'current user'}`}
                >
                  <span className="grid size-6 shrink-0 place-items-center border-2 border-ink bg-primary font-display text-xs text-primary-foreground">
                    {user?.login.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="hidden max-w-[84px] truncate lg:inline xl:max-w-[140px]">
                    {user?.login}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  Signed in as <span className="font-bold">{user?.login}</span>
                  <span className="mt-1 block font-mono text-[11px] uppercase text-ink-faint">
                    {user?.role}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/board/profile" className="flex cursor-pointer items-center gap-2">
                    <UserIcon className="size-4" /> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/board/settings" className="flex cursor-pointer items-center gap-2">
                    <SettingsIcon className="size-4" /> Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem className="sm:hidden" onSelect={toggle}>
                  {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                  Toggle theme
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem id="logout" onSelect={() => void logout()}>
                  <LogoutIcon /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <DesktopUpdateBannerMount />

        <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 sm:py-8 sm:pb-8 lg:px-10">
          <div key={activeCompanyId ?? 'default-company'}>{children}</div>
        </main>
      </div>

      {/* Global Omnisearch Dialog */}
      <CommandDialog
        open={paletteOpen}
        onOpenChange={(open) => {
          setPaletteOpen(open);
          if (!open) requestAnimationFrame(() => commandPaletteTriggerRef.current?.focus());
        }}
      >
        <CommandInput
          placeholder="Search models or records (e.g. Acme, Alice, base.partner)…"
          value={paletteQuery}
          onValueChange={setPaletteQuery}
        />
        <CommandList>
          {searchQuery.isFetching ? (
            <div
              role="status"
              className="flex items-center gap-2 border-b border-ink/20 px-3 py-2 font-mono text-xs text-ink-soft"
            >
              <LoadingSpinner className="size-3.5" />
              <span>Searching records…</span>
            </div>
          ) : null}
          {searchQuery.isError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <span>Record search failed. Check your connection and try again.</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void searchQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : searchFailedScopes.length > 0 ? (
            <p
              role="status"
              className="border-b border-ink/20 bg-paper-raised px-3 py-2 font-mono text-[11px] text-ink-soft"
            >
              Partial record search: {searchFailedScopes.join(', ')} unavailable.
            </p>
          ) : null}
          <CommandEmpty>No matching models or records found.</CommandEmpty>

          {/* Direct Matching Records Section */}
          {searchResults && searchResults.length > 0 && (
            <CommandGroup heading="Direct Records">
              {searchResults.map((item) => {
                const ItemIcon =
                  item.type === 'partner'
                    ? PartnerIcon
                    : item.type === 'user'
                      ? UserIcon
                      : item.type === 'activity'
                        ? CalendarIcon
                        : CompanyIcon;

                return (
                  <CommandItem
                    key={`${item.model}-${item.id}`}
                    value={`${item.title} ${item.model} ${paletteQuery}`}
                    onSelect={() => {
                      setPaletteOpen(false);
                      setPaletteQuery('');
                      router.push(item.targetUrl ?? `/board/m/${item.model}/${item.id}`);
                    }}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <ItemIcon className="size-4 text-yellow-readable" />
                    <span className="font-bold">{item.title}</span>
                    <span className="ml-auto inline-flex items-center border border-ink/20 bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-faint">
                      {item.type} #{item.id}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {/* AI Mission Control Section */}
          {!isWorkspaceDesktop && (
            <CommandGroup heading="AI Mission Control">
              {AI_MISSION_CONTROL_ROUTES.map((route) => {
                const RouteIcon = route.icon;
                return (
                  <CommandItem
                    key={route.href}
                    value={`${route.label} ${route.href}`}
                    onSelect={() => {
                      setPaletteOpen(false);
                      setPaletteQuery('');
                      router.push(route.href);
                    }}
                  >
                    <RouteIcon /> {route.label}
                    <span
                      className="ml-auto max-w-[45%] truncate font-mono text-xs text-ink-faint"
                      title={route.href}
                    >
                      {route.href}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {/* System Modules Section */}
          {visibleGroups.map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((item) => {
                const Icon = modelIcon(item.model);
                return (
                  <CommandItem
                    key={item.model}
                    value={`${item.menu.label ?? modelLabel(item.model)} ${item.model}`}
                    onSelect={() => {
                      setPaletteOpen(false);
                      setPaletteQuery('');
                      router.push(`/board/m/${item.model}`);
                    }}
                  >
                    <Icon /> {item.menu.label ?? modelLabel(item.model)}
                    <span
                      className="ml-auto max-w-[45%] truncate font-mono text-xs text-ink-faint"
                      title={item.model}
                    >
                      {item.model}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>

      {/* Keyboard Shortcuts Cheatsheet Modal */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* First-Launch Desktop Experience Mode Picker */}
      {isDesktop && !desktopModeChosen && <ModePicker onSelect={setDesktopMode} />}

      {/* Centralized Desktop Log Console / Copy Diagnostics */}
      {isDesktop && <DesktopLogDrawer />}

      {/* Desktop Quick-Capture Modal & Offline Sync Indicator */}
      {isDesktop && <QuickCaptureModal />}
    </div>
  );
}
