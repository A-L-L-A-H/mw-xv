import { useMemo, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Checkbox } from '@moonwitness/ui/components/checkbox';
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
  CheckCircleIcon,
  CodeIcon,
  DocumentIcon,
  GlobeIcon,
  HistoryIcon,
  RefreshIcon,
  SignalIcon,
  SignalOffIcon,
  SparkleIcon,
  WarningIcon,
  WorkflowIcon,
} from '@moonwitness/ui/icons';
import { SessionInspectorSheet } from './session-inspector-sheet';
import type {
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
  status: ObservatorySessionStatus | 'up' | 'warn' | 'down' | 'pending' | 'blocked'
): 'default' | 'primary' | 'destructive' {
  if (status === 'running' || status === 'up') return 'primary';
  if (status === 'error' || status === 'down' || status === 'blocked') return 'destructive';
  return 'default';
}

export function DesktopObservatoryPage() {
  const { snapshot, connectionState, error, refreshNow, fetchSessionDetail } =
    useDesktopObservatoryStream();

  const [activeTab, setActiveTab] = useState('overview');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [selectedWave, setSelectedWave] = useState<string>('all');
  const [runtimeFilter, setRuntimeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [workspaceOnly, setWorkspaceOnly] = useState<boolean>(false);
  const [taskSearch, setTaskSearch] = useState<string>('');
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('all');
  const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<string>>(() => new Set());

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<ObservatorySessionDetailDto | null>(null);

  const activePlan = useMemo(() => {
    if (!snapshot || snapshot.plans.length === 0) return null;
    const effectiveId = selectedPlanId || snapshot.defaultPlanId || snapshot.plans[0]?.id;
    return snapshot.plans.find((plan) => plan.id === effectiveId) ?? snapshot.plans[0] ?? null;
  }, [selectedPlanId, snapshot]);

  const filteredSessions = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.sessions.filter((session) => {
      if (runtimeFilter !== 'all' && session.runtime !== runtimeFilter) return false;
      if (statusFilter === 'running' && session.status !== 'running') return false;
      if (statusFilter === 'recent' && session.status !== 'running' && session.status !== 'recent') {
        return false;
      }
      if (statusFilter === 'error' && !session.lastError) return false;
      if (workspaceOnly && !session.inCurrentWorkspace) return false;
      return true;
    });
  }, [runtimeFilter, snapshot, statusFilter, workspaceOnly]);

  const filteredTasks = useMemo(() => {
    if (!activePlan) return [];
    const query = taskSearch.trim().toLowerCase();
    return activePlan.tasks.filter((task) => {
      if (selectedWave !== 'all' && task.wave !== selectedWave) return false;
      if (taskStatusFilter === 'done' && !task.done) return false;
      if (taskStatusFilter === 'pending' && task.done) return false;
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

  if (!snapshot && error) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Agent Observatory"
          description="Unified real-time telemetry across Antigravity, Claude Code, Codex, Qoder, Gemini CLI, and Desktop sandboxes."
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
          description="Connecting to MoonWitness Desktop real-time observatory stream…"
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, idx) => (
            <Skeleton key={idx} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const vpsProbes = snapshot.probes.vps;
  const vpsUpCount = vpsProbes.filter((probe) => probe.status === 'up').length;
  const runtimeSplit = Object.entries(snapshot.summary.runtimeCounts)
    .map(([key, count]) => `${key}:${count}`)
    .join(' · ');

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title="Agent Observatory"
        accentTitle={connectionState === 'live' ? 'LIVE' : connectionState.toUpperCase()}
        description={`${snapshot.repoRoot} · git ${snapshot.git.branch}@${snapshot.git.head || '—'} · updated ${formatRelativeTime(snapshot.generatedAt)}`}
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
              Antigravity API: {snapshot.antigravityApiConnected ? 'connected' : 'fs-fallback'}
            </Badge>
            {snapshot.plans.length > 0 ? (
              <SelectField
                aria-label="Active execution plan"
                value={activePlan?.id ?? ''}
                onChange={(event) => {
                  setSelectedPlanId(event.target.value);
                  setSelectedWave('all');
                }}
                className="w-56 font-mono text-xs"
              >
                {snapshot.plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.id} ({plan.done}/{plan.total})
                  </option>
                ))}
              </SelectField>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshNow()}>
              <RefreshIcon className="size-3.5" />
              <span>Refresh</span>
            </Button>
          </div>
        }
      />

      {/* KPI Strip */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricTile
          label="Plan Progress"
          value={activePlan ? `${activePlan.done}/${activePlan.total} (${activePlan.percent}%)` : '0/0'}
          detail={
            activePlan?.nextTaskId
              ? `Next: ${activePlan.nextTaskId} — ${activePlan.nextTaskTitle}`
              : 'All tasks complete'
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
          detail={`${snapshot.summary.swarms} active swarm manifest(s)`}
          accent="violet"
          icon={<WorkflowIcon className="size-4" />}
        />
        <MetricTile
          label="Tokens Observed"
          value={formatCompactNumber(snapshot.summary.tokens.total)}
          detail={`in:${formatCompactNumber(snapshot.summary.tokens.input)} · cache:${formatCompactNumber(snapshot.summary.tokens.cached)} · out:${formatCompactNumber(snapshot.summary.tokens.output)}`}
          accent="yellow"
          icon={<SparkleIcon className="size-4" />}
        />
        <MetricTile
          label="VPS & Host Health"
          value={`${vpsUpCount}/${vpsProbes.length}`}
          detail={`RAM ${snapshot.host.memUsedGb}/${snapshot.host.memTotalGb}GB (${snapshot.host.memPct}%)`}
          accent="green"
          icon={<GlobeIcon className="size-4" />}
        />
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">
            Live Agents &amp; Activity ({snapshot.summary.totalSessions})
          </TabsTrigger>
          <TabsTrigger value="plan">
            Plan Micro-Tasks ({activePlan ? `${activePlan.done}/${activePlan.total}` : '0/0'})
          </TabsTrigger>
          <TabsTrigger value="swarms">
            Subagents &amp; Swarms ({snapshot.summary.subagents + snapshot.summary.swarms})
          </TabsTrigger>
          <TabsTrigger value="infra">
            Server, VPS &amp; Git ({vpsUpCount}/{vpsProbes.length})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: LIVE AGENTS & ACTIVITY */}
        <TabsContent value="overview" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.95fr)]">
          <Panel
            surface="paper"
            title="Auto-Discovered Coding Agents"
            description="Click any agent to open its live transcript and tool call inspector."
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SelectField
                aria-label="Filter by runtime"
                value={runtimeFilter}
                onChange={(event) => setRuntimeFilter(event.target.value)}
                className="w-44 font-mono text-xs"
              >
                <option value="all">All Runtimes</option>
                <option value="antigravity">Antigravity</option>
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
                className="w-40 font-mono text-xs"
              >
                <option value="all">All Status</option>
                <option value="running">Running</option>
                <option value="recent">Recent (&lt;15m)</option>
                <option value="error">Has Error</option>
              </SelectField>
              <Label className="inline-flex cursor-pointer items-center gap-2 font-mono text-xs">
                <Checkbox
                  checked={workspaceOnly}
                  onChange={(event) => setWorkspaceOnly(event.target.checked)}
                />
                <span>Current repo only</span>
              </Label>
            </div>

            {filteredSessions.length === 0 ? (
              <EmptyState
                title="No matching agent sessions"
                description="Adjust runtime or status filters to view discovered local coding agents."
              />
            ) : (
              <div className="space-y-2.5">
                {filteredSessions.map((session) => (
                  <div
                    key={`${session.runtime}-${session.id}`}
                    className="border-2 border-ink bg-paper-raised p-3 transition-colors hover:bg-ink/5"
                  >
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
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
                            This session
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

                    <p className="font-semibold text-ink">{session.title}</p>
                    <p className="truncate font-mono text-xs text-ink-faint">
                      {session.focus || session.lastTool || 'Idle'}
                    </p>
                    {session.lastError ? (
                      <p className="mt-1 flex items-center gap-1 font-mono text-xs text-destructive">
                        <WarningIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{session.lastError}</span>
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-ink-faint">
                      <span>model:{session.model}</span>
                      {session.branch ? <span>branch:{session.branch}</span> : null}
                      <span>steps:{session.steps}</span>
                      <span>tokens:{formatCompactNumber(session.tokens.total)}</span>
                      <span>id:{session.id.slice(0, 8)}</span>
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
                ))}
              </div>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel surface="paper" title="Live Unified Activity Feed">
              {snapshot.activityFeed.length === 0 ? (
                <EmptyState
                  title="Waiting for agent activity"
                  description="Tool calls, focus updates, and errors stream here in real time."
                />
              ) : (
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {snapshot.activityFeed.map((ev, idx) => (
                    <div
                      key={`${ev.sessionId}-${ev.at}-${idx}`}
                      className="border border-ink/25 bg-paper-raised p-2 font-mono text-xs"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-ink-faint">
                        <span className="truncate">
                          [{ev.runtimeLabel}] {ev.sessionTitle}
                        </span>
                        <span className="shrink-0">{formatRelativeTime(ev.at)}</span>
                      </div>
                      <p className="break-words text-ink">
                        <strong>{ev.tool || ev.kind}:</strong> {ev.summary}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              surface="paper"
              title="VPS Endpoints (Live Probe)"
              description={`Updated ${formatRelativeTime(snapshot.probes.updatedAt)}`}
            >
              <div className="space-y-2">
                {vpsProbes.map((probe) => (
                  <div
                    key={probe.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-ink/25 bg-paper-raised px-3 py-2 font-mono text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-ink">{probe.label}</span>
                      {probe.detail ? (
                        <span className="ml-2 text-ink-faint">{probe.detail}</span>
                      ) : null}
                    </div>
                    <Badge variant={statusBadgeVariant(probe.status)} className="font-mono text-[11px]">
                      {probe.httpCode ? `HTTP ${probe.httpCode}` : probe.status.toUpperCase()} ·{' '}
                      {probe.latencyMs ?? '—'}ms
                    </Badge>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </TabsContent>

        {/* TAB 2: PLAN MICRO-TASKS */}
        <TabsContent value="plan" className="space-y-4">
          {!activePlan ? (
            <EmptyState
              title="No workspace plans found"
              description="Add markdown checklists under .plan/ to track real-time execution progress."
            />
          ) : (
            <Panel
              surface="paper"
              title={activePlan.title}
              description={`${activePlan.done}/${activePlan.total} completed (${activePlan.percent}%) · ${activePlan.masterFile}`}
            >
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Input
                  type="search"
                  aria-label="Filter micro-tasks"
                  placeholder="Filter by ID, file, wave…"
                  value={taskSearch}
                  onChange={(event) => setTaskSearch(event.target.value)}
                  className="w-64 font-mono text-xs"
                />
                <SelectField
                  aria-label="Filter micro-task completion status"
                  value={taskStatusFilter}
                  onChange={(event) => setTaskStatusFilter(event.target.value)}
                  className="w-40 font-mono text-xs"
                >
                  <option value="all">All Tasks</option>
                  <option value="pending">Pending Only</option>
                  <option value="done">Completed Only</option>
                </SelectField>
                <Button
                  type="button"
                  variant={selectedWave === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedWave('all')}
                >
                  All Waves
                </Button>
                {activePlan.waves.map((wave) => (
                  <Button
                    key={wave.title}
                    type="button"
                    variant={selectedWave === wave.title ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedWave(wave.title)}
                  >
                    {wave.title.split('—')[0]?.trim()} ({wave.done}/{wave.total})
                  </Button>
                ))}
              </div>

              <div className="desktop-observatory-progress-track mb-4">
                <div
                  className="desktop-observatory-progress-fill"
                  style={{ width: `${Math.min(100, Math.max(0, activePlan.percent))}%` }}
                />
              </div>

              {filteredTasks.length === 0 ? (
                <EmptyState
                  title="No micro-tasks match filter"
                  description="Clear the search input or wave filter to view all plan tasks."
                />
              ) : (
                <div className="space-y-2">
                  {filteredTasks.map((task) => {
                    const isExpanded = expandedTaskIds.has(task.id);
                    const isNext = task.id === activePlan.nextTaskId;
                    return (
                      <div
                        key={task.id}
                        className="border-2 border-ink/30 bg-paper-raised p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Badge
                              variant={task.done ? 'primary' : isNext ? 'destructive' : 'default'}
                              className="font-mono text-xs"
                            >
                              {task.done ? 'DONE' : isNext ? 'NEXT' : 'PENDING'}
                            </Badge>
                            <span className="font-mono text-xs font-bold text-ink">{task.id}</span>
                            <span className="text-sm text-ink">{task.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {task.commitSha ? (
                              <Badge variant="primary" className="font-mono text-[11px]">
                                {task.commitSha}
                              </Badge>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => toggleTaskExpanded(task.id)}
                            >
                              {isExpanded ? 'Hide spec' : 'Spec'}
                            </Button>
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="mt-3 space-y-1.5 border-t border-dashed border-ink/25 pt-2.5 font-mono text-xs text-ink-faint">
                            <div>
                              <strong className="text-ink">Wave:</strong> {task.wave}
                            </div>
                            {task.ownerFiles ? (
                              <div>
                                <strong className="text-ink">Owner Files:</strong> {task.ownerFiles}
                              </div>
                            ) : null}
                            {task.dependsOn ? (
                              <div>
                                <strong className="text-ink">Depends On:</strong> {task.dependsOn}
                              </div>
                            ) : null}
                            {task.acceptance ? (
                              <div>
                                <strong className="text-ink">Acceptance:</strong> {task.acceptance}
                              </div>
                            ) : null}
                            {task.expected ? (
                              <div>
                                <strong className="text-ink">Expected:</strong> {task.expected}
                              </div>
                            ) : null}
                            {task.verify ? (
                              <div>
                                <strong className="text-ink">Verify:</strong> {task.verify}
                              </div>
                            ) : null}
                            {task.spec ? (
                              <div>
                                <strong className="text-ink">Spec:</strong> {task.spec}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}
        </TabsContent>

        {/* TAB 3: SUBAGENTS & SWARMS */}
        <TabsContent value="swarms" className="space-y-4">
          <Panel surface="paper" title="Swarm Boards & Manifests">
            {snapshot.swarms.length === 0 ? (
              <EmptyState
                title="No active swarm manifests"
                description="Swarm plans from Antigravity or .swarm/swarm.json appear here automatically."
              />
            ) : (
              <div className="space-y-3">
                {snapshot.swarms.map((swarm, idx) => (
                  <div
                    key={`${swarm.runtime}-${swarm.title}-${idx}`}
                    className="border-2 border-ink bg-paper-raised p-3"
                  >
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="primary" className="font-mono text-xs uppercase">
                        {swarm.runtime}
                      </Badge>
                      <span className="font-mono text-xs text-ink-faint">
                        {swarm.workers.length} worker(s)
                      </span>
                    </div>
                    <p className="font-semibold text-ink">{swarm.title}</p>
                    <p className="font-mono text-xs text-ink-faint">{swarm.line}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {swarm.workers.map((worker) => (
                        <Badge key={worker.name} variant="default" className="font-mono text-xs">
                          {worker.name}: {worker.task || worker.status || 'assigned'}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel surface="paper" title="Parent → Subagent Hierarchy">
            {parentsWithSubagents.length === 0 ? (
              <EmptyState
                title="No subagents discovered"
                description="Spawned subagents from Antigravity and Claude Code sessions appear here."
              />
            ) : (
              <div className="space-y-3">
                {parentsWithSubagents.map((parent) => (
                  <div
                    key={`${parent.runtime}-${parent.id}`}
                    className="border-2 border-ink bg-paper-raised p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="font-mono text-xs uppercase">
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
                        Inspect ({parent.subagents.length})
                      </Button>
                    </div>
                    <div className="space-y-1.5 border-l-2 border-ink/40 pl-3 font-mono text-xs">
                      {parent.subagents.map((sub) => (
                        <div
                          key={`${sub.id}-${sub.role}`}
                          className="flex flex-wrap items-center justify-between gap-2 border border-ink/20 bg-paper px-2.5 py-1.5"
                        >
                          <span>
                            <strong>{sub.role}</strong> ({sub.type} · {sub.model})
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

        {/* TAB 4: SERVER, VPS & GIT */}
        <TabsContent value="infra" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)]">
          <Panel
            surface="paper"
            title="Recent Git Commits"
            description={`branch ${snapshot.git.branch} · ${snapshot.git.dirtyCount} uncommitted change(s)`}
          >
            {snapshot.git.commits.length === 0 ? (
              <EmptyState
                title="No commits available"
                description="Git repository history is unavailable in the configured root."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SHA</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.git.commits.map((commit) => (
                    <TableRow key={commit.sha}>
                      <TableCell className="font-mono text-xs">{commit.sha}</TableCell>
                      <TableCell>
                        {commit.taskId ? (
                          <Badge variant="primary" className="font-mono text-[11px]">
                            {commit.taskId}
                          </Badge>
                        ) : (
                          <span className="font-mono text-xs text-ink-faint">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{commit.subject}</TableCell>
                      <TableCell className="font-mono text-xs text-ink-faint">
                        {formatRelativeTime(commit.at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel surface="paper" title="VPS Live Probes">
              <div className="space-y-2">
                {vpsProbes.map((probe) => (
                  <div
                    key={probe.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-ink/25 bg-paper-raised px-3 py-2 font-mono text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{probe.label}</div>
                      <div className="truncate text-ink-faint">{probe.url}</div>
                    </div>
                    <Badge variant={statusBadgeVariant(probe.status)} className="font-mono text-[11px]">
                      {probe.httpCode ? `HTTP ${probe.httpCode}` : probe.status.toUpperCase()} ·{' '}
                      {probe.latencyMs ?? '—'}ms
                    </Badge>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel
              surface="paper"
              title="Local Loopback Ports"
              description={`Host ${snapshot.host.hostname} (${snapshot.host.platform}) · ${snapshot.host.cpus} CPUs`}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {snapshot.probes.localPorts.map((lp) => (
                  <div
                    key={lp.port}
                    className="flex items-center justify-between border border-ink/25 bg-paper-raised px-3 py-2 font-mono text-xs"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {lp.open ? (
                        <CodeIcon className="size-3.5 text-ink" />
                      ) : (
                        <HistoryIcon className="size-3.5 text-ink-faint" />
                      )}
                      <span>{lp.label}</span>
                    </span>
                    <Badge variant={lp.open ? 'primary' : 'default'} className="font-mono text-[11px]">
                      {lp.open ? 'OPEN' : 'CLOSED'}
                    </Badge>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel surface="paper" title="Workspace Files">
              <div className="flex items-center gap-2 font-mono text-xs text-ink-faint">
                <DocumentIcon className="size-4 shrink-0 text-ink" />
                <span className="break-all">{snapshot.repoRoot}</span>
              </div>
            </Panel>
          </div>
        </TabsContent>
      </Tabs>

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
