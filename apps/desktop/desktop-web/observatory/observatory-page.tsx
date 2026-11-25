import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Checkbox } from '@moonwitness/ui/components/checkbox';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@moonwitness/ui/components/command';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@moonwitness/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@moonwitness/ui/components/tabs';
import {
  ActivityIcon,
  BoltIcon,
  CheckCircleIcon,
  CodeIcon,
  DocumentIcon,
  DownloadIcon,
  GlobeIcon,
  HistoryIcon,
  ImageIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  SignalIcon,
  SignalOffIcon,
  SparkleIcon,
  VolumeIcon,
  VolumeOffIcon,
  WarningIcon,
  WorkflowIcon,
} from '@moonwitness/ui/icons';
import { portraitUrlForSession } from './canvas-palette';
import {
  CinemaFlowCanvas,
  type CinemaBackdropMode,
  type CinemaFlowCanvasHandle,
  type CinemaLayoutMode,
} from './cinema-flow-canvas';
import { PlanDagCanvas, type PlanDagCanvasHandle } from './plan-dag-canvas';
import { SessionInspectorSheet } from './session-inspector-sheet';
import {
  createObservatorySfxEngine,
  type ObservatoryIntensityLevel,
  type ObservatorySfxEngine,
} from './sfx-engine';
import {
  ActivitySpectrogramCanvas,
  NetworkRadarCanvas,
  TelemetryOscilloscopeCanvas,
} from './telemetry-canvases';
import type {
  ObservatoryGitCommitDetailDto,
  ObservatoryPlanDagState,
  ObservatoryProbeResultDto,
  ObservatoryRuntime,
  ObservatorySessionDetailDto,
  ObservatorySessionStatus,
} from './types';
import { useDesktopObservatoryStream } from './use-observatory-stream';

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(diffSec)) return '—';
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function statusBadgeVariant(
  status:
    | ObservatorySessionStatus
    | ObservatoryPlanDagState
    | 'up'
    | 'warn'
    | 'down'
    | 'pending'
    | 'blocked'
): 'default' | 'primary' | 'destructive' {
  if (status === 'running' || status === 'up' || status === 'active' || status === 'ready') {
    return 'primary';
  }
  if (status === 'error' || status === 'down' || status === 'blocked') {
    return 'destructive';
  }
  return 'default';
}

const TAB_ORDER = ['cinema', 'plan', 'telemetry', 'cast', 'squad', 'infra'] as const;

export function DesktopObservatoryPage() {
  const {
    snapshot,
    history,
    replayIndex,
    setReplayIndex,
    comboCount,
    cutInAlert,
    triggerCutIn,
    connectionState,
    error,
    refreshNow,
    fetchSessionDetail,
    fetchCommitDetail,
    runCustomProbe,
    downloadExport,
  } = useDesktopObservatoryStream();

  const cinemaRef = useRef<CinemaFlowCanvasHandle | null>(null);
  const dagRef = useRef<PlanDagCanvasHandle | null>(null);
  const sfxRef = useRef<ObservatorySfxEngine | null>(null);

  const [activeTab, setActiveTab] = useState<string>('cinema');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [selectedWave, setSelectedWave] = useState<string>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [planViewMode, setPlanViewMode] = useState<'split' | 'dag' | 'list'>('split');
  const [showCriticalPath, setShowCriticalPath] = useState<boolean>(true);
  const [taskSearch, setTaskSearch] = useState<string>('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('all');
  const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<string>>(() => new Set());

  // Cinema stage controls
  const [cinemaMode, setCinemaMode] = useState<CinemaLayoutMode>('warzone');
  const [cinemaBackdrop, setCinemaBackdrop] = useState<CinemaBackdropMode>('alley');
  const [chaosLevel, setChaosLevel] = useState<ObservatoryIntensityLevel>('riot');
  const [autoCam, setAutoCam] = useState<boolean>(false);
  const [showSubagents, setShowSubagents] = useState<boolean>(true);
  const [showTargets, setShowTargets] = useState<boolean>(true);
  const [showIdle, setShowIdle] = useState<boolean>(true);
  const [feedSearch, setFeedSearch] = useState<string>('');
  const [feedKind, setFeedKind] = useState<string>('all');

  // Audio controls
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(false);
  const [beatEnabled, setBeatEnabled] = useState<boolean>(false);

  // Cast roster controls
  const [agentSearch, setAgentSearch] = useState<string>('');
  const [runtimeFilter, setRuntimeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [agentSort, setAgentSort] = useState<'recent' | 'tokens' | 'steps' | 'subagents'>('recent');
  const [agentView, setAgentView] = useState<'cards' | 'table'>('cards');
  const [workspaceOnly, setWorkspaceOnly] = useState<boolean>(false);

  // Session Inspector Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<ObservatorySessionDetailDto | null>(null);

  // Git Commit Inspector & Custom VPS Probe
  const [commitDetail, setCommitDetail] = useState<ObservatoryGitCommitDetailDto | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [customProbeUrl, setCustomProbeUrl] = useState('');
  const [customProbeResult, setCustomProbeResult] = useState<ObservatoryProbeResultDto | null>(null);
  const [customProbeLoading, setCustomProbeLoading] = useState(false);
  const [customProbeError, setCustomProbeError] = useState<string | null>(null);

  // Quick-Jump Command Palette
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const engine = createObservatorySfxEngine();
    sfxRef.current = engine;
    return () => {
      engine.destroy();
      sfxRef.current = null;
    };
  }, []);

  useEffect(() => {
    sfxRef.current?.setSfxEnabled(sfxEnabled);
  }, [sfxEnabled]);

  useEffect(() => {
    sfxRef.current?.setBeatEnabled(beatEnabled);
  }, [beatEnabled]);

  useEffect(() => {
    sfxRef.current?.setIntensity(chaosLevel);
  }, [chaosLevel]);

  useEffect(() => {
    const onKeyDown = (evt: KeyboardEvent) => {
      if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'k') {
        evt.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const target = evt.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      const numIdx = Number(evt.key) - 1;
      if (numIdx >= 0 && numIdx < TAB_ORDER.length) {
        const nextTab = TAB_ORDER[numIdx];
        if (nextTab) setActiveTab(nextTab);
      } else if (evt.key.toLowerCase() === 'r') {
        void refreshNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [refreshNow]);

  const activePlan = useMemo(() => {
    if (!snapshot || snapshot.plans.length === 0) return null;
    const effectiveId = selectedPlanId || snapshot.defaultPlanId || snapshot.plans[0]?.id;
    return snapshot.plans.find((plan) => plan.id === effectiveId) ?? snapshot.plans[0] ?? null;
  }, [selectedPlanId, snapshot]);

  const inspectedTask = useMemo(() => {
    if (!activePlan) return null;
    if (selectedTaskId) {
      const exact = activePlan.tasks.find((task) => task.id === selectedTaskId);
      if (exact) return exact;
    }
    return (
      activePlan.tasks.find(
        (task) => task.dagState === 'active' || task.dagState === 'ready' || !task.done
      ) ??
      activePlan.tasks[0] ??
      null
    );
  }, [activePlan, selectedTaskId]);

  const filteredSessions = useMemo(() => {
    if (!snapshot) return [];
    const query = agentSearch.trim().toLowerCase();
    return snapshot.sessions
      .filter((session) => {
        if (runtimeFilter !== 'all' && session.runtime !== runtimeFilter) return false;
        if (statusFilter === 'running' && session.status !== 'running') return false;
        if (
          statusFilter === 'recent' &&
          session.status !== 'running' &&
          session.status !== 'recent'
        ) {
          return false;
        }
        if (statusFilter === 'error' && !session.lastError) return false;
        if (workspaceOnly && !session.inCurrentWorkspace) return false;
        if (
          query &&
          !`${session.title} ${session.focus} ${session.model} ${session.branch ?? ''} ${session.lastTool} ${session.id}`
            .toLowerCase()
            .includes(query)
        ) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (agentSort === 'tokens') return right.tokens.total - left.tokens.total;
        if (agentSort === 'steps') return right.steps - left.steps;
        if (agentSort === 'subagents') return right.subagents.length - left.subagents.length;
        return right.mtimeMs - left.mtimeMs;
      });
  }, [agentSearch, agentSort, runtimeFilter, snapshot, statusFilter, workspaceOnly]);

  const filteredFeed = useMemo(() => {
    if (!snapshot) return [];
    const query = feedSearch.trim().toLowerCase();
    return snapshot.activityFeed.filter((ev) => {
      if (feedKind !== 'all' && ev.kind !== feedKind) return false;
      if (
        query &&
        !`${ev.runtimeLabel} ${ev.sessionTitle} ${ev.tool} ${ev.summary}`
          .toLowerCase()
          .includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [feedKind, feedSearch, snapshot]);

  const filteredTasks = useMemo(() => {
    if (!activePlan) return [];
    const query = taskSearch.trim().toLowerCase();
    return activePlan.tasks.filter((task) => {
      if (selectedWave !== 'all' && task.wave !== selectedWave) return false;
      if (taskStatusFilter === 'done' && !task.done) return false;
      if (taskStatusFilter === 'pending' && task.done) return false;
      if (taskStatusFilter === 'ready' && task.dagState !== 'ready') return false;
      if (taskStatusFilter === 'active' && task.dagState !== 'active') return false;
      if (
        query &&
        !`${task.id} ${task.title} ${task.ownerFiles} ${task.wave}`.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [activePlan, selectedWave, taskSearch, taskStatusFilter]);

  const parentsWithSubagents = useMemo(
    () => (snapshot?.sessions ?? []).filter((session) => session.subagents.length > 0),
    [snapshot]
  );

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const handleOpenSession = async (runtime: ObservatoryRuntime, id: string) => {
    sfxRef.current?.play('pop');
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerError(null);
    setDrawerDetail(null);
    try {
      const detail = await fetchSessionDetail(runtime, id);
      setDrawerDetail(detail);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : 'Unable to load session detail');
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleInspectCommit = async (sha: string) => {
    sfxRef.current?.play('click');
    setActiveTab('infra');
    setCommitLoading(true);
    setCommitError(null);
    try {
      const detail = await fetchCommitDetail(sha);
      setCommitDetail(detail);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Unable to load commit diff stat');
    } finally {
      setCommitLoading(false);
    }
  };

  const handleRunCustomProbe = async () => {
    const trimmed = customProbeUrl.trim();
    if (!trimmed) return;
    sfxRef.current?.play('zap');
    setCustomProbeLoading(true);
    setCustomProbeError(null);
    try {
      const res = await runCustomProbe(trimmed);
      setCustomProbeResult(res);
    } catch (err) {
      setCustomProbeError(err instanceof Error ? err.message : 'Probe failed');
    } finally {
      setCustomProbeLoading(false);
    }
  };

  if (!snapshot && error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Agent Observatory"
          description="Unified real-time telemetry across Antigravity, OpenCode, Magpie Router, Claude Code, Codex, Qoder, Gemini CLI, and Desktop sandboxes."
        />
        <ErrorState
          title="Observatory stream unavailable"
          description={error}
          onRetry={() => void refreshNow()}
          headingLevel={2}
        />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader
          title="Agent Observatory"
          description="Connecting to MoonWitness Desktop v3 real-time observatory stream…"
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, idx) => (
            <Skeleton key={idx} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const vpsProbes = snapshot.probes.vps;
  const vpsUpCount = vpsProbes.filter((probe) => probe.status === 'up').length;
  const measuredLatencies = vpsProbes
    .map((probe) => probe.latencyMs)
    .filter((ms): ms is number => typeof ms === 'number');
  const avgVpsLatency =
    measuredLatencies.length > 0
      ? Math.round(measuredLatencies.reduce((a, b) => a + b, 0) / measuredLatencies.length)
      : 0;
  const runtimeSplit = Object.entries(snapshot.summary.runtimeCounts)
    .map(([key, count]) => `${key}:${count}`)
    .join(' · ');
  const activeSessions = snapshot.sessions.filter(
    (s) => s.status === 'running' || s.status === 'error'
  );
  const magpie = snapshot.magpie;
  const analytics = snapshot.analytics;
  const battle = snapshot.battle;
  const dirtyAreas = Object.entries(snapshot.git.dirtyByArea ?? {}).sort((a, b) => b[1] - a[1]);
  const aheadBehind =
    snapshot.git.ahead || snapshot.git.behind
      ? ` ↑${snapshot.git.ahead ?? 0}/↓${snapshot.git.behind ?? 0}`
      : '';
  const isReplaying = replayIndex !== null;

  return (
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden">
      <PageHeader
        title="Agent Observatory"
        accentTitle={isReplaying ? 'VHS REPLAY' : connectionState === 'live' ? 'LIVE v3' : connectionState.toUpperCase()}
        description={`${snapshot.repoRoot} · git ${snapshot.git.branch}@${snapshot.git.head || '—'}${aheadBehind} (${snapshot.git.dirtyCount} dirty) · ${formatRelativeTime(snapshot.generatedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={connectionState === 'live' ? 'primary' : 'destructive'}
              className="gap-1.5 font-mono text-xs uppercase"
            >
              {connectionState === 'live' ? (
                <SignalIcon className="size-3.5" />
              ) : (
                <SignalOffIcon className="size-3.5" />
              )}
              <span>SSE {connectionState}</span>
            </Badge>
            <Badge
              variant={snapshot.antigravityApiConnected ? 'primary' : 'default'}
              className="font-mono text-xs uppercase"
            >
              {snapshot.antigravityApiConnected ? 'AG-LIVE' : 'FS-LIVE'}
            </Badge>
            {magpie ? (
              <Badge
                variant={
                  magpie.rateLimit429 > 0
                    ? 'destructive'
                    : magpie.connected || magpie.totalRecentCalls > 0
                      ? 'primary'
                      : 'default'
                }
                className="font-mono text-xs uppercase"
              >
                {magpie.connected || magpie.totalRecentCalls > 0
                  ? `MAGPIE ${magpie.totalRecentCalls}c${magpie.rateLimit429 > 0 ? ` (${magpie.rateLimit429}×429)` : ''}`
                  : 'MAGPIE IDLE'}
              </Badge>
            ) : null}
            {comboCount > 0 ? (
              <Badge variant="primary" className="font-mono text-xs uppercase">
                COMBO x{comboCount}
              </Badge>
            ) : null}
            {snapshot.plans.length > 0 ? (
              <SelectField
                aria-label="Active execution plan"
                value={activePlan?.id ?? ''}
                onChange={(event) => {
                  setSelectedPlanId(event.target.value);
                  setSelectedWave('all');
                  setSelectedTaskId(null);
                }}
                className="w-52 font-mono text-xs"
              >
                {snapshot.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.id} ({plan.done}/{plan.total})
                  </option>
                ))}
              </SelectField>
            ) : null}
            <Button
              type="button"
              variant={sfxEnabled ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSfxEnabled((v) => !v)}
              aria-label="Toggle SFX audio"
            >
              {sfxEnabled ? <VolumeIcon className="size-3.5" /> : <VolumeOffIcon className="size-3.5" />}
              <span>SFX</span>
            </Button>
            <Button
              type="button"
              variant={beatEnabled ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBeatEnabled((v) => !v)}
              aria-label="Toggle breakbeat audio"
            >
              <PlayIcon className="size-3.5" />
              <span>Beat</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPaletteOpen(true)}
            >
              <SearchIcon className="size-3.5" />
              <span>Jump (Ctrl+K)</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void downloadExport('markdown')}
            >
              <DownloadIcon className="size-3.5" />
              <span>MD</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void downloadExport('json')}
            >
              <DownloadIcon className="size-3.5" />
              <span>JSON</span>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshNow()}>
              <RefreshIcon className="size-3.5" />
              <span>Refresh</span>
            </Button>
          </div>
        }
      />

      {/* Anime Cut-In Banner */}
      {cutInAlert ? (
        <div
          role="status"
          className={`desktop-observatory-cutin flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 font-mono text-xs ${
            cutInAlert.kind === 'error' ? 'desktop-observatory-cutin-error' : ''
          }`}
        >
          <div className="flex items-center gap-2">
            <BoltIcon className="size-4 shrink-0" />
            <strong className="uppercase tracking-wider">[{cutInAlert.tag}]</strong>
            <span className="font-display text-sm uppercase">{cutInAlert.headline}</span>
          </div>
          <span className="truncate">{cutInAlert.subtext}</span>
        </div>
      ) : null}

      {/* 6-Tile KPI Strip */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricTile
          label="Boss HP / Plan"
          value={
            activePlan
              ? `${activePlan.done}/${activePlan.total} (${activePlan.percent}%)`
              : '0/0'
          }
          detail={
            battle
              ? `BOSS HP ${battle.bossHpPct}% · ${battle.readyStrikeCount} ready / ${battle.bossShieldCount} locked`
              : activePlan?.nextTaskId
                ? `Next: ${activePlan.nextTaskId}`
                : 'All quests cleared'
          }
          accent="magenta"
          icon={<CheckCircleIcon className="size-4" />}
        />
        <MetricTile
          label="Coding Agents"
          value={`${snapshot.summary.runningSessions} / ${snapshot.summary.totalSessions}`}
          detail={runtimeSplit || 'No sessions discovered'}
          accent="cyan"
          icon={<ActivityIcon className="size-4" />}
        />
        <MetricTile
          label="Subagents & Swarms"
          value={`${snapshot.summary.subagents}`}
          detail={`${snapshot.summary.swarms} swarm(s) · ${snapshot.flowGraph?.nodes.length ?? 0} graph nodes`}
          accent="violet"
          icon={<WorkflowIcon className="size-4" />}
        />
        <MetricTile
          label="Tokens & Cache"
          value={formatCompactNumber(snapshot.summary.tokens.total)}
          detail={`${snapshot.summary.tokens.cacheHitPct ?? 0}% cache · in:${formatCompactNumber(snapshot.summary.tokens.input)} · out:${formatCompactNumber(snapshot.summary.tokens.output)}`}
          accent="yellow"
          icon={<SparkleIcon className="size-4" />}
        />
        <MetricTile
          label="Host Rig CPU/RAM"
          value={`${snapshot.host.cpuPct ?? 0}% CPU`}
          detail={`RAM ${snapshot.host.memUsedGb}/${snapshot.host.memTotalGb}GB (${snapshot.host.memPct}%)`}
          accent="green"
          icon={<CodeIcon className="size-4" />}
        />
        <MetricTile
          label="VPS & Errors"
          value={`${vpsUpCount}/${vpsProbes.length} UP`}
          detail={`${avgVpsLatency}ms avg · ${analytics?.errorLedger.length ?? 0} error(s)`}
          accent="magenta"
          icon={<GlobeIcon className="size-4" />}
        />
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="cinema">
            1. Cinema &amp; Flow ({snapshot.flowGraph?.nodes.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="plan">
            2. Quest Map ({activePlan ? `${activePlan.done}/${activePlan.total}` : '0/0'})
          </TabsTrigger>
          <TabsTrigger value="telemetry">
            3. Beat Lab ({analytics?.errorLedger.length ?? 0} err)
          </TabsTrigger>
          <TabsTrigger value="cast">
            4. Cast Roster ({snapshot.summary.totalSessions})
          </TabsTrigger>
          <TabsTrigger value="squad">
            5. Swarms ({snapshot.summary.subagents + snapshot.summary.swarms})
          </TabsTrigger>
          <TabsTrigger value="infra">
            6. City, VPS &amp; Git ({vpsUpCount}/{vpsProbes.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: CINEMA & LIVE NEURAL FLOW */}
        <TabsContent value="cinema" className="space-y-4">
          <Panel
            surface="paper"
            title={battle ? `Boss Warzone — ${battle.bossName}` : 'Living Multi-Agent Flow Cinema'}
            description="Drag nodes to pin, scroll to zoom, click any hero node to open its dossier, or fire an All-Out Clash."
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SelectField
                aria-label="Cinema formation"
                value={cinemaMode}
                onChange={(event) => setCinemaMode(event.target.value as CinemaLayoutMode)}
                className="w-36 font-mono text-xs"
              >
                <option value="warzone">Warzone</option>
                <option value="stage">Stage</option>
                <option value="pipeline">Pipeline</option>
                <option value="orbital">Orbital</option>
                <option value="lanes">Lanes</option>
              </SelectField>
              <SelectField
                aria-label="Stage backdrop"
                value={cinemaBackdrop}
                onChange={(event) => setCinemaBackdrop(event.target.value as CinemaBackdropMode)}
                className="w-36 font-mono text-xs"
              >
                <option value="alley">Riot Alley</option>
                <option value="arcade">Arcade Bench</option>
                <option value="grid">Tactical Grid</option>
              </SelectField>
              <SelectField
                aria-label="Chaos intensity"
                value={chaosLevel}
                onChange={(event) =>
                  setChaosLevel(event.target.value as ObservatoryIntensityLevel)
                }
                className="w-32 font-mono text-xs"
              >
                <option value="chill">CHILL</option>
                <option value="riot">RIOT</option>
                <option value="overdrive">OVERDRIVE</option>
              </SelectField>
              <Label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs">
                <Checkbox
                  checked={autoCam}
                  onChange={(event) => setAutoCam(event.target.checked)}
                />
                <span>Auto-Cam</span>
              </Label>
              <Label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs">
                <Checkbox
                  checked={showSubagents}
                  onChange={(event) => setShowSubagents(event.target.checked)}
                />
                <span>Subagents</span>
              </Label>
              <Label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs">
                <Checkbox
                  checked={showTargets}
                  onChange={(event) => setShowTargets(event.target.checked)}
                />
                <span>Targets</span>
              </Label>
              <Label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs">
                <Checkbox
                  checked={showIdle}
                  onChange={(event) => setShowIdle(event.target.checked)}
                />
                <span>Idle</span>
              </Label>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  cinemaRef.current?.triggerAllOutClash();
                  triggerCutIn({
                    tag: 'ALL-OUT CLASH',
                    headline: 'FULL SQUAD BARRAGE!!',
                    subtext: `${battle?.activeWarriors ?? 0} warriors striking ${battle?.bossName ?? 'Boss Core'}`,
                    kind: 'clash',
                  });
                }}
              >
                <BoltIcon className="size-3.5" />
                <span>All-Out Clash</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => cinemaRef.current?.fitView()}
              >
                Fit
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => cinemaRef.current?.resetPins()}
              >
                Unpin
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => cinemaRef.current?.savePng()}
              >
                <ImageIcon className="size-3.5" />
                <span>PNG</span>
              </Button>
            </div>

            <CinemaFlowCanvas
              ref={cinemaRef}
              flowGraph={snapshot.flowGraph}
              battle={snapshot.battle}
              mode={cinemaMode}
              backdrop={cinemaBackdrop}
              chaos={chaosLevel}
              autoCam={autoCam}
              showSubagents={showSubagents}
              showTargets={showTargets}
              showIdle={showIdle}
              onSelectAgent={(runtime, id) => void handleOpenSession(runtime, id)}
              onSelectPlanWave={(waveTitle) => {
                setSelectedWave(waveTitle);
                setActiveTab('plan');
              }}
              onPlaySfx={(name) => sfxRef.current?.play(name)}
            />

            {/* VHS Time-Travel Replay Scrubber */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-2 border-ink bg-paper-raised px-3 py-2 font-mono text-xs">
              <div className="flex items-center gap-2">
                <HistoryIcon className="size-4" />
                <span className="font-bold uppercase">VHS Time-Travel</span>
                <Badge variant={isReplaying ? 'destructive' : 'primary'} className="font-mono text-[11px]">
                  {isReplaying
                    ? `FRAME ${(replayIndex ?? 0) + 1}/${history.length} · ${formatRelativeTime(snapshot.generatedAt)}`
                    : `LIVE · ${history.length} frame(s) buffered`}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={history.length < 2 || replayIndex === 0}
                  onClick={() => {
                    const current = replayIndex ?? history.length - 1;
                    setReplayIndex(Math.max(0, current - 1));
                  }}
                >
                  Prev Frame
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isReplaying}
                  onClick={() => {
                    if (replayIndex === null) return;
                    if (replayIndex + 1 >= history.length - 1) setReplayIndex(null);
                    else setReplayIndex(replayIndex + 1);
                  }}
                >
                  Next Frame
                </Button>
                <Button
                  type="button"
                  variant={isReplaying ? 'default' : 'outline'}
                  size="sm"
                  disabled={!isReplaying}
                  onClick={() => setReplayIndex(null)}
                >
                  Snap to LIVE
                </Button>
              </div>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
            <Panel
              surface="paper"
              title={`Active On Stage (${activeSessions.length})`}
              description="Running or erroring agents currently driving workspace tools."
            >
              {activeSessions.length === 0 ? (
                <EmptyState
                  title="Heroes chilling on the rooftop"
                  description="No agents are currently running; inspect recent sessions in the Cast Roster tab."
                />
              ) : (
                <div className="space-y-2">
                  {activeSessions.slice(0, 8).map((session) => (
                    <div
                      key={`${session.runtime}-${session.id}`}
                      className="flex items-center justify-between gap-2 border-2 border-ink bg-paper-raised p-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <img
                          src={portraitUrlForSession(session.runtime, session.status)}
                          alt={session.runtimeLabel}
                          className="desktop-observatory-avatar size-9 shrink-0 border border-ink object-cover"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="default" className="font-mono text-[10px] uppercase">
                              {session.runtimeLabel}
                            </Badge>
                            <Badge
                              variant={statusBadgeVariant(session.status)}
                              className="font-mono text-[10px] uppercase"
                            >
                              {session.status}
                            </Badge>
                          </div>
                          <p className="truncate text-xs font-semibold text-ink">{session.title}</p>
                          <p className="truncate font-mono text-[11px] text-ink-faint">
                            {session.focus || session.lastTool || 'In action…'}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleOpenSession(session.runtime, session.id)}
                      >
                        Inspect
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel surface="paper" title="Live Unified Manga Activity Feed">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Filter live activity feed"
                  placeholder="Filter feed by runtime, tool, summary…"
                  value={feedSearch}
                  onChange={(event) => setFeedSearch(event.target.value)}
                  className="max-w-xs font-mono text-xs"
                />
                <SelectField
                  aria-label="Filter feed by event kind"
                  value={feedKind}
                  onChange={(event) => setFeedKind(event.target.value)}
                  className="w-36 font-mono text-xs"
                >
                  <option value="all">All Events</option>
                  <option value="tool">Tools</option>
                  <option value="focus">Focus</option>
                  <option value="subagent">Subagents</option>
                  <option value="swarm">Swarms</option>
                  <option value="error">Errors</option>
                  <option value="message">Messages</option>
                </SelectField>
              </div>
              {filteredFeed.length === 0 ? (
                <EmptyState
                  title="No matching activity events"
                  description="Tool calls, focus updates, Magpie routes, and errors stream here in real time."
                />
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {filteredFeed.slice(0, 45).map((ev, idx) => (
                    <div
                      key={`${ev.sessionId}-${ev.at}-${idx}`}
                      className="flex items-start justify-between gap-2 border border-ink/25 bg-paper-raised p-2 font-mono text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-ink-faint">
                          <Badge
                            variant={ev.kind === 'error' ? 'destructive' : 'default'}
                            className="font-mono text-[10px] uppercase"
                          >
                            {ev.runtimeLabel}
                          </Badge>
                          <span className="truncate font-semibold text-ink">{ev.sessionTitle}</span>
                          <span>· {formatRelativeTime(ev.at)}</span>
                        </div>
                        <p className="break-words text-ink">
                          <strong>[{ev.tool || ev.kind}]</strong> {ev.summary}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleOpenSession(ev.runtime, ev.sessionId)}
                      >
                        Open
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </TabsContent>

        {/* TAB 2: QUEST MAP (INTERACTIVE PLAN DAG + CHECKLIST) */}
        <TabsContent value="plan" className="space-y-4">
          {!activePlan ? (
            <EmptyState
              title="No workspace plans found"
              description="Add markdown checklists under .plan/ to track real-time execution DAGs."
            />
          ) : (
            <>
              <Panel
                surface="paper"
                title={activePlan.title}
                description={
                  activePlan.dag
                    ? `${activePlan.done}/${activePlan.total} (${activePlan.percent}%) · active:${activePlan.dag.stats.active} · ready:${activePlan.dag.stats.ready} · locked:${activePlan.dag.stats.blocked} · critical chain:${activePlan.dag.criticalPathIds.length}`
                    : `${activePlan.masterFile} · ${activePlan.done}/${activePlan.total} (${activePlan.percent}%)`
                }
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <SelectField
                    aria-label="Quest map view layout"
                    value={planViewMode}
                    onChange={(event) =>
                      setPlanViewMode(event.target.value as 'split' | 'dag' | 'list')
                    }
                    className="w-36 font-mono text-xs"
                  >
                    <option value="split">Split DAG + List</option>
                    <option value="dag">DAG Canvas Only</option>
                    <option value="list">Checklist Only</option>
                  </SelectField>
                  <Label className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs">
                    <Checkbox
                      checked={showCriticalPath}
                      onChange={(event) => setShowCriticalPath(event.target.checked)}
                    />
                    <span>Highlight Boss Critical Path</span>
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => dagRef.current?.fitView()}
                  >
                    Fit DAG
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => dagRef.current?.savePng()}
                  >
                    <ImageIcon className="size-3.5" />
                    <span>PNG</span>
                  </Button>
                </div>

                {planViewMode !== 'list' ? (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.9fr)]">
                    <PlanDagCanvas
                      ref={dagRef}
                      plan={activePlan}
                      selectedTaskId={inspectedTask?.id ?? null}
                      showCriticalPath={showCriticalPath}
                      onSelectTask={(taskId) => {
                        setSelectedTaskId(taskId);
                        sfxRef.current?.play('click');
                      }}
                    />

                    <div className="space-y-3 border-2 border-ink bg-paper-raised p-3 font-mono text-xs">
                      {!inspectedTask ? (
                        <EmptyState
                          title="Select a Quest Node"
                          description="Click any micro-task node in the DAG map to inspect dependencies and verify gates."
                        />
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="primary" className="font-mono text-xs">
                              {inspectedTask.id}
                            </Badge>
                            <Badge
                              variant={statusBadgeVariant(
                                inspectedTask.dagState ?? (inspectedTask.done ? 'done' : 'blocked')
                              )}
                              className="font-mono text-[11px] uppercase"
                            >
                              {inspectedTask.dagState ?? (inspectedTask.done ? 'done' : 'pending')}
                            </Badge>
                            {inspectedTask.commitSha ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void handleInspectCommit(inspectedTask.commitSha!)}
                              >
                                {inspectedTask.commitSha}
                              </Button>
                            ) : null}
                          </div>
                          <p className="font-sans text-sm font-bold text-ink">
                            {inspectedTask.title}
                          </p>
                          <p className="text-ink-faint">{inspectedTask.wave}</p>

                          <div>
                            <p className="mb-1 text-[11px] font-bold uppercase text-ink-faint">
                              Prerequisites
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {(inspectedTask.depIds ?? []).length > 0 ? (
                                inspectedTask.depIds?.map((depId) => (
                                  <Button
                                    key={depId}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSelectedTaskId(depId)}
                                  >
                                    ← {depId}
                                  </Button>
                                ))
                              ) : (
                                <span className="text-ink-faint">Root Quest</span>
                              )}
                            </div>
                          </div>

                          <div>
                            <p className="mb-1 text-[11px] font-bold uppercase text-ink-faint">
                              Unlocks Next
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {(inspectedTask.dependents ?? []).length > 0 ? (
                                inspectedTask.dependents?.slice(0, 8).map((childId) => (
                                  <Button
                                    key={childId}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSelectedTaskId(childId)}
                                  >
                                    → {childId}
                                  </Button>
                                ))
                              ) : (
                                <span className="text-ink-faint">Terminal Boss Node</span>
                              )}
                            </div>
                          </div>

                          {inspectedTask.ownerFiles ? (
                            <div>
                              <p className="text-[11px] font-bold uppercase text-ink-faint">
                                Owner Files
                              </p>
                              <p className="break-all text-ink">{inspectedTask.ownerFiles}</p>
                            </div>
                          ) : null}
                          {inspectedTask.verify ? (
                            <div>
                              <p className="text-[11px] font-bold uppercase text-ink-faint">
                                Verify Gate
                              </p>
                              <p className="break-all text-ink">{inspectedTask.verify}</p>
                            </div>
                          ) : null}
                          {inspectedTask.acceptance ? (
                            <div>
                              <p className="text-[11px] font-bold uppercase text-ink-faint">
                                Acceptance
                              </p>
                              <p className="text-ink">{inspectedTask.acceptance}</p>
                            </div>
                          ) : null}
                          {inspectedTask.spec ? (
                            <div>
                              <p className="text-[11px] font-bold uppercase text-ink-faint">
                                Exact Spec
                              </p>
                              <p className="text-ink">{inspectedTask.spec}</p>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </Panel>

              {planViewMode !== 'dag' ? (
                <Panel surface="paper" title="Chapter Waves & Micro-Task Checklist">
                  <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Button
                      type="button"
                      variant={selectedWave === 'all' ? 'default' : 'outline'}
                      onClick={() => setSelectedWave('all')}
                      className="h-auto flex-col items-start gap-1 py-2.5 text-left"
                    >
                      <span className="font-mono text-xs font-bold uppercase">All Waves</span>
                      <span className="font-mono text-[11px]">
                        {activePlan.done}/{activePlan.total} ({activePlan.percent}%)
                      </span>
                    </Button>
                    {activePlan.waves.map((wave) => (
                      <Button
                        key={wave.title}
                        type="button"
                        variant={selectedWave === wave.title ? 'default' : 'outline'}
                        onClick={() => setSelectedWave(wave.title)}
                        className="h-auto flex-col items-start gap-1 py-2.5 text-left"
                      >
                        <span className="w-full truncate font-mono text-xs font-bold">
                          {wave.title}
                        </span>
                        <span className="font-mono text-[11px]">
                          {wave.done}/{wave.total} ({wave.percent}%)
                        </span>
                        <div className="desktop-observatory-progress-track">
                          <div
                            className="desktop-observatory-progress-fill"
                            style={{ width: `${wave.percent}%` }}
                          />
                        </div>
                      </Button>
                    ))}
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <Input
                      aria-label="Filter micro-tasks"
                      placeholder="Filter tasks (e.g. D01, M01, owner file)…"
                      value={taskSearch}
                      onChange={(event) => setTaskSearch(event.target.value)}
                      className="max-w-xs font-mono text-xs"
                    />
                    <SelectField
                      aria-label="Filter micro-task status"
                      value={taskStatusFilter}
                      onChange={(event) => setTaskStatusFilter(event.target.value)}
                      className="w-40 font-mono text-xs"
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active Now</option>
                      <option value="ready">Ready to Run</option>
                      <option value="pending">Pending</option>
                      <option value="done">Done</option>
                    </SelectField>
                  </div>

                  {filteredTasks.length === 0 ? (
                    <EmptyState
                      title="No matching micro-tasks"
                      description="Clear your wave or keyword filters to see all plan items."
                    />
                  ) : (
                    <div className="space-y-2">
                      {filteredTasks.map((task) => {
                        const expanded = expandedTaskIds.has(task.id);
                        const state = task.dagState ?? (task.done ? 'done' : 'pending');
                        return (
                          <div
                            key={task.id}
                            className="border-2 border-ink bg-paper-raised p-3 text-sm"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <Badge
                                  variant={statusBadgeVariant(state)}
                                  className="font-mono text-[11px] uppercase"
                                >
                                  {state}
                                </Badge>
                                <span className="font-mono font-bold text-ink">{task.id}</span>
                                <span className="font-medium text-ink">{task.title}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {task.commitSha ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleInspectCommit(task.commitSha!)}
                                  >
                                    {task.commitSha}
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedTaskId(task.id)}
                                >
                                  DAG Focus
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => toggleTaskExpanded(task.id)}
                                >
                                  {expanded ? 'Hide Spec' : 'Details'}
                                </Button>
                              </div>
                            </div>

                            {expanded ? (
                              <div className="mt-3 space-y-1.5 border-t border-dashed border-ink/25 pt-2.5 font-mono text-xs text-ink-faint">
                                <p>
                                  <strong className="text-ink">Wave:</strong> {task.wave}
                                </p>
                                {task.ownerFiles ? (
                                  <p>
                                    <strong className="text-ink">Owner Files:</strong>{' '}
                                    {task.ownerFiles}
                                  </p>
                                ) : null}
                                {task.dependsOn ? (
                                  <p>
                                    <strong className="text-ink">Depends On:</strong>{' '}
                                    {task.dependsOn}
                                  </p>
                                ) : null}
                                {task.acceptance ? (
                                  <p>
                                    <strong className="text-ink">Acceptance:</strong>{' '}
                                    {task.acceptance}
                                  </p>
                                ) : null}
                                {task.expected ? (
                                  <p>
                                    <strong className="text-ink">Expected:</strong> {task.expected}
                                  </p>
                                ) : null}
                                {task.verify ? (
                                  <p>
                                    <strong className="text-ink">Verify:</strong> {task.verify}
                                  </p>
                                ) : null}
                                {task.spec ? (
                                  <p>
                                    <strong className="text-ink">Spec:</strong> {task.spec}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Panel>
              ) : null}
            </>
          )}
        </TabsContent>

        {/* TAB 3: BEAT LAB & TELEMETRY */}
        <TabsContent value="telemetry" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel surface="paper" title="Host & Fleet Oscilloscope">
              <TelemetryOscilloscopeCanvas history={snapshot.telemetryHistory ?? []} />
            </Panel>
            <Panel surface="paper" title="60m Event Spectrogram">
              <ActivitySpectrogramCanvas analytics={analytics} />
            </Panel>
            <Panel surface="paper" title="VPS Latency & Cache Radar">
              <NetworkRadarCanvas probes={vpsProbes} analytics={analytics} />
            </Panel>
          </div>

          {/* Magpie Hyper-Router Panel */}
          <Panel
            surface="paper"
            title="Magpie Hyper-Router Gateway"
            description={
              magpie && (magpie.connected || magpie.totalRecentCalls > 0)
                ? `${magpie.connected ? 'ONLINE' : 'STANDBY'} ${magpie.addr ?? ''}${magpie.version ? ` v${magpie.version}` : ''} · ${magpie.totalRecentCalls} calls (${magpie.okCalls} ok, ${magpie.rateLimit429}×429, ${magpie.errorCalls} err) · avg ${magpie.avgLatencyMs}ms / ttft ${magpie.avgTtftMs}ms${magpie.memoryStats ? ` · mem ${magpie.memoryStats.recalled}/${magpie.memoryStats.searches} recall` : ''}`
                : 'Magpie gateway not detected on host (~/.config/magpie)'
            }
          >
            {!magpie || (!magpie.connected && magpie.totalRecentCalls === 0) ? (
              <EmptyState
                title="Magpie Router standby"
                description="Start local Magpie gateway or run routed agent sessions to see per-provider latency, 429 shields, and live route hops."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="space-y-2.5">
                  <p className="font-mono text-xs font-bold uppercase text-ink-faint">
                    Provider Routing Breakdown
                  </p>
                  {magpie.providers.length === 0 ? (
                    <p className="font-mono text-xs text-ink-faint">
                      Gateway online — awaiting route traffic.
                    </p>
                  ) : (
                    (() => {
                      const maxCalls = Math.max(1, ...magpie.providers.map((p) => p.calls));
                      return magpie.providers.map((prov) => {
                        const pct = Math.max(4, Math.round((prov.calls / maxCalls) * 100));
                        return (
                          <div key={prov.provider} className="space-y-1 font-mono text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span>
                                <Badge variant="primary" className="mr-1.5 font-mono text-[10px]">
                                  {prov.provider}
                                </Badge>
                                <span className="text-ink-faint">
                                  {prov.models.slice(0, 2).join(', ')}
                                </span>
                              </span>
                              <span>
                                {prov.calls}c · {formatCompactNumber(prov.tokens)} tok ·{' '}
                                {prov.avgMs}ms
                                {prov.rateLimits > 0 ? (
                                  <Badge variant="destructive" className="ml-1.5 font-mono text-[10px]">
                                    {prov.rateLimits}×429
                                  </Badge>
                                ) : null}
                              </span>
                            </div>
                            <div className="desktop-observatory-progress-track">
                              <div
                                className={
                                  prov.rateLimits > 0
                                    ? 'desktop-observatory-progress-fill-violet'
                                    : 'desktop-observatory-progress-fill-cyan'
                                }
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      });
                    })()
                  )}
                </div>

                <div className="space-y-2">
                  <p className="font-mono text-xs font-bold uppercase text-ink-faint">
                    Recent Route Hops (Last 2h)
                  </p>
                  <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                    {magpie.recentRoutes.length === 0 ? (
                      <p className="font-mono text-xs text-ink-faint">No route hops recorded.</p>
                    ) : (
                      magpie.recentRoutes.slice(0, 15).map((hop, idx) => (
                        <div
                          key={`${hop.at}-${hop.provider}-${idx}`}
                          className="border border-ink/25 bg-paper-raised p-2 font-mono text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              <strong>{hop.agent}</strong> → {hop.provider}
                            </span>
                            <Badge
                              variant={hop.status >= 400 ? 'destructive' : 'default'}
                              className="font-mono text-[10px]"
                            >
                              HTTP {hop.status} · {hop.ms}ms ({hop.ttftMs}ms ttft)
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-ink-faint">
                            {hop.model} · {formatCompactNumber(hop.tokens)} tok
                            {hop.cached > 0 ? ` (${formatCompactNumber(hop.cached)} cached)` : ''} ·{' '}
                            {formatRelativeTime(hop.at)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel surface="paper" title="Runtime Power & Cache Hit Ratio">
              {(analytics?.runtimeBreakdown ?? []).length === 0 ? (
                <EmptyState title="No runtime telemetry" description="Waiting for active sessions." />
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const rows = analytics?.runtimeBreakdown ?? [];
                    const maxTok = Math.max(1, ...rows.map((r) => r.totalTokens));
                    return rows.map((row) => {
                      const pct = Math.max(4, Math.round((row.totalTokens / maxTok) * 100));
                      return (
                        <div key={row.runtime} className="space-y-1 font-mono text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              <Badge variant="default" className="mr-1.5 font-mono text-[10px] uppercase">
                                {row.label}
                              </Badge>
                              {row.running}/{row.sessions} active · {row.subagents} subagents
                            </span>
                            <span>
                              {formatCompactNumber(row.totalTokens)} tok ·{' '}
                              <strong>{row.cacheHitPct}% cache</strong>
                            </span>
                          </div>
                          <div className="desktop-observatory-progress-track">
                            <div
                              className="desktop-observatory-progress-fill"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </Panel>

            <Panel surface="paper" title="Top Tools & Models">
              {(analytics?.toolFrequency ?? []).length === 0 ? (
                <EmptyState title="No tool calls captured" description="Tool telemetry appears automatically." />
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const tools = (analytics?.toolFrequency ?? []).slice(0, 8);
                    const maxCalls = Math.max(1, ...tools.map((t) => t.calls));
                    return tools.map((tool) => {
                      const pct = Math.max(4, Math.round((tool.calls / maxCalls) * 100));
                      return (
                        <div key={tool.name} className="space-y-1 font-mono text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              <strong>{tool.name}</strong>{' '}
                              <span className="text-ink-faint">({tool.runtimes.join(', ')})</span>
                            </span>
                            <span>
                              {tool.calls} hits
                              {tool.errors > 0 ? (
                                <Badge variant="destructive" className="ml-1.5 font-mono text-[10px]">
                                  {tool.errors} err
                                </Badge>
                              ) : null}
                            </span>
                          </div>
                          <div className="desktop-observatory-progress-track">
                            <div
                              className="desktop-observatory-progress-fill-violet"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}
                  {(analytics?.modelBreakdown ?? []).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 border-t border-dashed border-ink/25 pt-2.5">
                      {analytics?.modelBreakdown.slice(0, 8).map((m) => (
                        <Badge key={`${m.runtime}-${m.model}`} variant="default" className="font-mono text-[11px]">
                          {m.model} · {formatCompactNumber(m.tokens)} tok ({m.sessions})
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </Panel>
          </div>

          <Panel
            surface="paper"
            title={`Bonk Error Ledger (${analytics?.errorLedger.length ?? 0})`}
            description="Click any error entry to inspect the full agent transcript."
          >
            {(analytics?.errorLedger ?? []).length === 0 ? (
              <EmptyState
                title="Zero errors in ledger"
                description="All monitored coding agents are executing cleanly."
              />
            ) : (
              <div className="space-y-2">
                {analytics?.errorLedger.map((entry, idx) => (
                  <div
                    key={`${entry.sessionId}-${entry.at}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-2 border-ink bg-paper-raised p-2.5 font-mono text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="destructive" className="font-mono text-[10px] uppercase">
                          {entry.runtimeLabel}
                        </Badge>
                        <strong className="text-ink">{entry.sessionTitle}</strong>
                        <span className="text-ink-faint">· {formatRelativeTime(entry.at)}</span>
                      </div>
                      <p className="break-words text-destructive">
                        [{entry.tool}] {entry.message}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleOpenSession(entry.runtime, entry.sessionId)}
                    >
                      Inspect
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </TabsContent>

        {/* TAB 4: CAST ROSTER (SEARCH + FILTER + SORT + CARDS/TABLE) */}
        <TabsContent value="cast" className="space-y-4">
          <Panel
            surface="paper"
            title="Auto-Discovered Coding Agent Cast"
            description="Unified fleet across Antigravity, OpenCode SQLite, Magpie Router, Claude Code, Codex, Qoder, Gemini CLI, and Desktop Sandboxes."
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Input
                aria-label="Search coding agents"
                placeholder="Search title, model, focus, branch…"
                value={agentSearch}
                onChange={(event) => setAgentSearch(event.target.value)}
                className="w-56 font-mono text-xs"
              />
              <SelectField
                aria-label="Filter by runtime"
                value={runtimeFilter}
                onChange={(event) => setRuntimeFilter(event.target.value)}
                className="w-40 font-mono text-xs"
              >
                <option value="all">All Runtimes</option>
                <option value="antigravity">Antigravity</option>
                <option value="opencode">OpenCode</option>
                <option value="magpie">Magpie Router</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="qoder">Qoder</option>
                <option value="gemini-cli">Gemini CLI</option>
                <option value="desktop-worktree">Desktop Sandbox</option>
              </SelectField>
              <SelectField
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-36 font-mono text-xs"
              >
                <option value="all">All Status</option>
                <option value="running">Running</option>
                <option value="recent">Recent (&lt;15m)</option>
                <option value="error">Has Error</option>
              </SelectField>
              <SelectField
                aria-label="Sort agents"
                value={agentSort}
                onChange={(event) =>
                  setAgentSort(event.target.value as 'recent' | 'tokens' | 'steps' | 'subagents')
                }
                className="w-36 font-mono text-xs"
              >
                <option value="recent">Sort: Recent</option>
                <option value="tokens">Sort: Tokens</option>
                <option value="steps">Sort: Steps</option>
                <option value="subagents">Sort: Subagents</option>
              </SelectField>
              <Label className="inline-flex cursor-pointer items-center gap-2 font-mono text-xs">
                <Checkbox
                  checked={workspaceOnly}
                  onChange={(event) => setWorkspaceOnly(event.target.checked)}
                />
                <span>Current repo only</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAgentView((v) => (v === 'cards' ? 'table' : 'cards'))}
              >
                {agentView === 'cards' ? 'Table View' : 'Card View'}
              </Button>
            </div>

            {filteredSessions.length === 0 ? (
              <EmptyState
                title="No matching agent sessions"
                description="Adjust runtime, search, or status filters to view discovered local coding agents."
              />
            ) : agentView === 'table' ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Runtime</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mission</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Moves</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Sidekicks</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSessions.map((session) => (
                    <TableRow key={`${session.runtime}-${session.id}`}>
                      <TableCell>
                        <Badge variant="default" className="font-mono text-[11px] uppercase">
                          {session.runtimeLabel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusBadgeVariant(session.status)}
                          className="font-mono text-[11px] uppercase"
                        >
                          {session.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-ink">{session.title}</p>
                        <p className="max-w-xs truncate font-mono text-xs text-ink-faint">
                          {session.focus || session.lastTool || 'Idle'}
                        </p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{session.model}</TableCell>
                      <TableCell className="font-mono text-xs">{session.steps}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatCompactNumber(session.tokens.total)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {session.subagents.length}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleOpenSession(session.runtime, session.id)}
                        >
                          Inspect
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {filteredSessions.map((session) => {
                  const tokSum = Math.max(
                    1,
                    session.tokens.input + session.tokens.cached + session.tokens.output
                  );
                  const inPct = Math.round((session.tokens.input / tokSum) * 100);
                  const cachePct = Math.round((session.tokens.cached / tokSum) * 100);
                  const outPct = Math.max(0, 100 - inPct - cachePct);
                  return (
                    <div
                      key={`${session.runtime}-${session.id}`}
                      className="border-2 border-ink bg-paper-raised p-3 transition-colors hover:bg-ink/5"
                    >
                      <div className="flex gap-3">
                        <img
                          src={portraitUrlForSession(session.runtime, session.status)}
                          alt={session.runtimeLabel}
                          className="desktop-observatory-avatar size-14 shrink-0 border-2 border-ink object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="default" className="font-mono text-[11px] uppercase">
                                {session.runtimeLabel}
                              </Badge>
                              <Badge
                                variant={statusBadgeVariant(session.status)}
                                className="font-mono text-[11px] uppercase"
                              >
                                {session.status}
                              </Badge>
                              {session.isCurrentSession ? (
                                <Badge variant="primary" className="font-mono text-[11px] uppercase">
                                  Star Hero
                                </Badge>
                              ) : null}
                              {session.swarmWorkers > 0 ? (
                                <Badge variant="default" className="font-mono text-[11px]">
                                  Swarm: {session.swarmWorkers}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-ink-faint">
                                {formatRelativeTime(session.updatedAt)}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void handleOpenSession(session.runtime, session.id)}
                              >
                                Inspect
                              </Button>
                            </div>
                          </div>

                          <p className="truncate font-semibold text-ink">{session.title}</p>
                          <p className="truncate font-mono text-xs text-ink-faint">
                            {session.focus || session.lastTool || 'Idle'}
                          </p>
                          {session.lastError ? (
                            <p className="mt-1 flex items-center gap-1 font-mono text-xs text-destructive">
                              <WarningIcon className="size-3.5 shrink-0" />
                              <span className="truncate">{session.lastError}</span>
                            </p>
                          ) : null}

                          <div
                            className="desktop-observatory-tok-bar mt-2"
                            title="Tokens: input / cache / output"
                          >
                            <span
                              className="desktop-observatory-tok-in"
                              style={{ width: `${inPct}%` }}
                            />
                            <span
                              className="desktop-observatory-tok-cache"
                              style={{ width: `${cachePct}%` }}
                            />
                            <span
                              className="desktop-observatory-tok-out"
                              style={{ width: `${outPct}%` }}
                            />
                          </div>

                          <div className="mt-1.5 flex flex-wrap gap-3 font-mono text-[11px] text-ink-faint">
                            <span>model:{session.model}</span>
                            {session.branch ? <span>branch:{session.branch}</span> : null}
                            {typeof session.cost === 'number' && session.cost > 0 ? (
                              <span>cost:${session.cost.toFixed(3)}</span>
                            ) : null}
                            <span>moves:{session.steps}</span>
                            <span>tok:{formatCompactNumber(session.tokens.total)}</span>
                          </div>

                          {session.subagents.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1 border-t border-dashed border-ink/20 pt-2">
                              {session.subagents.slice(0, 5).map((sub) => (
                                <Badge
                                  key={`${sub.id}-${sub.role}`}
                                  variant="default"
                                  className="font-mono text-[11px]"
                                >
                                  {sub.role}
                                </Badge>
                              ))}
                              {session.subagents.length > 5 ? (
                                <Badge variant="default" className="font-mono text-[11px]">
                                  +{session.subagents.length - 5} more
                                </Badge>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </TabsContent>

        {/* TAB 5: SUBAGENTS & SWARMS */}
        <TabsContent value="squad" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel surface="paper" title="Active Swarm Manifests & Boards">
            {snapshot.swarms.length === 0 ? (
              <EmptyState
                title="No active swarms detected"
                description="Swarm boards appear automatically when Antigravity /swarm or .swarm/swarm.json is active."
              />
            ) : (
              <div className="space-y-3">
                {snapshot.swarms.map((swarm, idx) => (
                  <div
                    key={`${swarm.runtime}-${swarm.title}-${idx}`}
                    className="border-2 border-ink bg-paper-raised p-3"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <Badge variant="primary" className="font-mono text-[11px] uppercase">
                        {swarm.runtime}
                      </Badge>
                      <span className="font-mono text-xs text-ink-faint">
                        {swarm.workers.length} worker(s)
                      </span>
                    </div>
                    <p className="font-semibold text-ink">{swarm.title}</p>
                    {swarm.line ? (
                      <p className="mt-0.5 text-xs text-ink-faint">{swarm.line}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {swarm.workers.map((worker) => (
                        <Badge
                          key={`${worker.name}-${worker.task}`}
                          variant="default"
                          className="font-mono text-[11px]"
                        >
                          {worker.name}: {worker.task || worker.status || 'active'}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel surface="paper" title="Parent -> Sidekick Delegation Tree">
            {parentsWithSubagents.length === 0 ? (
              <EmptyState
                title="No subagent delegations recorded"
                description="Spawned subagents across Antigravity, OpenCode, Magpie, and Claude Code appear here."
              />
            ) : (
              <div className="space-y-3">
                {parentsWithSubagents.map((parent) => (
                  <div
                    key={`${parent.runtime}-${parent.id}`}
                    className="border-2 border-ink bg-paper-raised p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="default" className="font-mono text-[11px] uppercase">
                          {parent.runtimeLabel}
                        </Badge>
                        <span className="font-semibold text-ink">{parent.title}</span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleOpenSession(parent.runtime, parent.id)}
                      >
                        Inspect Parent
                      </Button>
                    </div>
                    <div className="space-y-1.5 border-l-2 border-ink/40 pl-3 font-mono text-xs">
                      {parent.subagents.map((sub) => (
                        <div
                          key={`${sub.id}-${sub.role}`}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <span>
                            <strong>{sub.role}</strong>{' '}
                            <span className="text-ink-faint">
                              ({sub.type} · {sub.model})
                            </span>
                          </span>
                          <span className="text-ink-faint">{formatRelativeTime(sub.at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </TabsContent>

        {/* TAB 6: CITY, VPS & GIT RADAR */}
        <TabsContent value="infra" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel
              surface="paper"
              title="Git Commit Reel"
              description={`Branch ${snapshot.git.branch} · ${snapshot.git.dirtyCount} dirty · ${snapshot.git.stashCount ?? 0} stash · diff ${snapshot.git.diffStat?.filesChanged ?? 0} files (+${snapshot.git.diffStat?.insertions ?? 0}/-${snapshot.git.diffStat?.deletions ?? 0})`}
            >
              {snapshot.git.commits.length === 0 ? (
                <EmptyState
                  title="No git commits found"
                  description="Repository commit history appears here when a git workspace is active."
                />
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {snapshot.git.commits.map((commit) => (
                    <div
                      key={commit.sha}
                      className="flex items-start justify-between gap-2 border border-ink/25 bg-paper-raised p-2 font-mono text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <strong className="text-ink">{commit.sha}</strong>
                          {commit.taskId ? (
                            <Badge variant="primary" className="font-mono text-[10px]">
                              {commit.taskId}
                            </Badge>
                          ) : null}
                          <span className="text-ink-faint">
                            · {commit.author} · {formatRelativeTime(commit.at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-ink">{commit.subject}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleInspectCommit(commit.sha)}
                      >
                        Diff Stat
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              surface="paper"
              title={commitDetail ? `Commit Inspector — ${commitDetail.sha}` : 'Commit Diff Stat Inspector'}
              description="Click any commit SHA in the Git Reel or Quest Map to inspect changed files."
            >
              {commitLoading ? (
                <Skeleton className="h-44 w-full" />
              ) : commitError ? (
                <ErrorState title="Commit inspection failed" description={commitError} headingLevel={3} />
              ) : !commitDetail ? (
                <EmptyState
                  title="No commit selected"
                  description="Click Diff Stat on any commit to inspect author metadata and per-file +/- stats."
                />
              ) : (
                <div className="space-y-3 font-mono text-xs">
                  <div className="max-h-36 overflow-y-auto border border-ink/25 bg-paper-raised p-2 whitespace-pre-wrap text-ink">
                    {commitDetail.header}
                  </div>
                  <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                    {commitDetail.changedFiles.map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center justify-between gap-2 border border-ink/20 bg-paper-raised px-2.5 py-1.5"
                      >
                        <span className="truncate text-ink">{file.path}</span>
                        <span className="shrink-0 text-ink-faint">
                          +{file.added} / -{file.removed}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel surface="paper" title="Dirty Workspace Zones & Files">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {dirtyAreas.length > 0 ? (
                  dirtyAreas.map(([area, count]) => (
                    <Badge key={area} variant="default" className="font-mono text-xs">
                      {area}: {count}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="primary" className="font-mono text-xs">
                    Working tree clean
                  </Badge>
                )}
              </div>
              {(snapshot.git.dirtyFiles ?? []).length === 0 ? (
                <EmptyState title="Clean working tree" description="Zero uncommitted file modifications." />
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1 font-mono text-xs">
                  {snapshot.git.dirtyFiles?.slice(0, 40).map((file) => (
                    <div
                      key={`${file.code}-${file.path}`}
                      className="flex items-center justify-between gap-2 border border-ink/20 bg-paper-raised px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge
                          variant={file.status === 'deleted' ? 'destructive' : 'default'}
                          className="font-mono text-[10px]"
                        >
                          {file.code}
                        </Badge>
                        <span className="truncate text-ink">{file.path}</span>
                      </span>
                      <span className="shrink-0 text-ink-faint">{file.area}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              surface="paper"
              title="Interactive VPS & HTTP Probe Console"
              description="Run an on-demand SSRF-guarded HTTP GET probe or inspect monitored endpoints."
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Custom HTTP probe URL"
                  placeholder="https://apps.moonwitness.biz.id/readyz"
                  value={customProbeUrl}
                  onChange={(event) => setCustomProbeUrl(event.target.value)}
                  className="min-w-0 flex-1 font-mono text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={customProbeLoading || !customProbeUrl.trim()}
                  onClick={() => void handleRunCustomProbe()}
                >
                  {customProbeLoading ? 'Probing…' : 'Probe URL'}
                </Button>
              </div>

              {customProbeError ? (
                <p className="mb-3 font-mono text-xs text-destructive">{customProbeError}</p>
              ) : null}
              {customProbeResult ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-2 border-ink bg-paper-raised px-3 py-2 font-mono text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-ink">{customProbeResult.url}</p>
                    {customProbeResult.detail ? (
                      <p className="text-ink-faint">{customProbeResult.detail}</p>
                    ) : null}
                  </div>
                  <Badge
                    variant={statusBadgeVariant(customProbeResult.status)}
                    className="font-mono text-[11px]"
                  >
                    {customProbeResult.httpCode
                      ? `HTTP ${customProbeResult.httpCode}`
                      : customProbeResult.status.toUpperCase()}{' '}
                    · {customProbeResult.latencyMs ?? '—'}ms
                  </Badge>
                </div>
              ) : null}

              <div className="space-y-2">
                {vpsProbes.map((probe) => (
                  <div
                    key={probe.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-ink/25 bg-paper-raised px-3 py-2 font-mono text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{probe.label}</p>
                      <p className="truncate text-ink-faint">{probe.url}</p>
                    </div>
                    <Badge
                      variant={statusBadgeVariant(probe.status)}
                      className="font-mono text-[11px]"
                    >
                      {probe.httpCode ? `HTTP ${probe.httpCode}` : probe.status.toUpperCase()} ·{' '}
                      {probe.latencyMs ?? '—'}ms
                    </Badge>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel surface="paper" title="Localhost Port Towers (127.0.0.1)">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Port</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.probes.localPorts.map((portItem) => (
                    <TableRow key={portItem.port}>
                      <TableCell className="font-mono text-xs">{portItem.label}</TableCell>
                      <TableCell className="font-mono text-xs">{portItem.port}</TableCell>
                      <TableCell>
                        <Badge
                          variant={portItem.open ? 'primary' : 'default'}
                          className="font-mono text-[11px] uppercase"
                        >
                          {portItem.open ? 'OPEN' : 'CLOSED'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>

            <Panel surface="paper" title="Host Rig Diagnostics">
              <div className="space-y-2 font-mono text-xs">
                <div className="flex items-center justify-between border border-ink/25 bg-paper-raised px-3 py-2">
                  <span className="text-ink-faint">Hostname / OS</span>
                  <span className="font-semibold text-ink">
                    {snapshot.host.hostname} · {snapshot.host.platform}/{snapshot.host.arch ?? 'x64'}
                  </span>
                </div>
                <div className="flex items-center justify-between border border-ink/25 bg-paper-raised px-3 py-2">
                  <span className="text-ink-faint">CPU Engine</span>
                  <span className="font-semibold text-ink">
                    {snapshot.host.cpus} cores · {snapshot.host.cpuModel ?? 'CPU'}
                  </span>
                </div>
                <div className="flex items-center justify-between border border-ink/25 bg-paper-raised px-3 py-2">
                  <span className="text-ink-faint">Live CPU Usage</span>
                  <Badge variant="primary" className="font-mono text-[11px]">
                    {snapshot.host.cpuPct ?? 0}%
                  </Badge>
                </div>
                <div className="flex items-center justify-between border border-ink/25 bg-paper-raised px-3 py-2">
                  <span className="text-ink-faint">Memory Tank</span>
                  <span className="font-semibold text-ink">
                    {snapshot.host.memUsedGb} / {snapshot.host.memTotalGb} GB ({snapshot.host.memPct}
                    %)
                  </span>
                </div>
                <div className="flex items-center justify-between border border-ink/25 bg-paper-raised px-3 py-2">
                  <span className="text-ink-faint">Sidecar Uptime / Telemetry Frames</span>
                  <span className="font-semibold text-ink">
                    {snapshot.host.uptimeSec}s · {snapshot.telemetryHistory?.length ?? 0} frames
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        </TabsContent>
      </Tabs>

      {/* Quick-Jump Command Palette (Ctrl+K) */}
      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="Observatory Quick-Jump"
        description="Jump to any tab, coding agent session, plan micro-task, or git commit."
      >
        <CommandInput placeholder="Jump to agent, task ID (e.g. D01), commit, or tab…" />
        <CommandList>
          <CommandEmpty>No matching agents, tasks, or commits.</CommandEmpty>
          <CommandGroup heading="Views">
            <CommandItem
              onSelect={() => {
                setActiveTab('cinema');
                setPaletteOpen(false);
              }}
            >
              <BoltIcon className="size-4" />
              <span>Cinema &amp; Neural Flow Warzone</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setActiveTab('plan');
                setPaletteOpen(false);
              }}
            >
              <WorkflowIcon className="size-4" />
              <span>Quest Map (Interactive Plan DAG)</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setActiveTab('telemetry');
                setPaletteOpen(false);
              }}
            >
              <ActivityIcon className="size-4" />
              <span>Beat Lab &amp; Magpie Telemetry</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setActiveTab('cast');
                setPaletteOpen(false);
              }}
            >
              <SparkleIcon className="size-4" />
              <span>Cast Roster (All Runtimes)</span>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setActiveTab('infra');
                setPaletteOpen(false);
              }}
            >
              <GlobeIcon className="size-4" />
              <span>City, VPS Probe &amp; Git Radar</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Coding Agents">
            {snapshot.sessions.slice(0, 12).map((session) => (
              <CommandItem
                key={`${session.runtime}-${session.id}`}
                onSelect={() => {
                  setPaletteOpen(false);
                  void handleOpenSession(session.runtime, session.id);
                }}
              >
                <CodeIcon className="size-4" />
                <span>
                  [{session.runtimeLabel}] {session.title}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          {activePlan ? (
            <CommandGroup heading="Plan Tasks">
              {activePlan.tasks.slice(0, 14).map((task) => (
                <CommandItem
                  key={task.id}
                  onSelect={() => {
                    setSelectedTaskId(task.id);
                    setActiveTab('plan');
                    setPaletteOpen(false);
                  }}
                >
                  <DocumentIcon className="size-4" />
                  <span>
                    {task.id} — {task.title}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandGroup heading="Git Commits">
            {snapshot.git.commits.slice(0, 8).map((commit) => (
              <CommandItem
                key={commit.sha}
                onSelect={() => {
                  setPaletteOpen(false);
                  void handleInspectCommit(commit.sha);
                }}
              >
                <HistoryIcon className="size-4" />
                <span>
                  {commit.sha} — {commit.subject}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <SessionInspectorSheet
        open={drawerOpen}
        loading={drawerLoading}
        error={drawerError}
        detail={drawerDetail}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
