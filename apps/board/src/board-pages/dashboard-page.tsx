'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WarningIcon as AlertTriangle,
  CompanyIcon as Building2,
  CalendarIcon as Calendar,
  JobsIcon as Cpu,
  ExternalLinkIcon as ExternalLink,
  AddonIcon as Layers,
  AddIcon as Plus,
  RefreshIcon as RefreshCw,
  RefreshIcon as RotateCw,
  SignalIcon as Sparkles,
  DeleteIcon as Trash2,
} from '@moonwitness/ui/icons';
import { client } from '@/lib/client';
import { formatDateTime } from '@/lib/date-format';
import { readPreferences } from '@/lib/preferences';
import { scopedQueryKey } from '@/lib/query-scope';
import { useAuth } from '@/hooks/use-auth-context';
import { useModels } from '@/hooks/use-model';
import { modelIcon, modelLabel } from '@/lib/models';
import { DEVELOPMENT_MODE_EVENT, readDevelopmentMode } from '@/lib/navigation';
import {
  AccentMarker,
  AnimeActionLines,
  Doodle,
  GrungeDivider,
  LiveIndicator,
} from '@moonwitness/ui/components/effects';
import { Button } from '@moonwitness/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@moonwitness/ui/components/dialog';
import { CronSchedulerPanel } from '@/components/layout/cron-scheduler-panel';
import { DashboardKpiGrid } from '@/components/dashboard/kpi-grid';
import { cn } from '@/lib/utils';
import { BarChart } from '@moonwitness/ui/components/chart';
import { toast } from '@moonwitness/ui/components/toast';
import { jobsResourceState } from '@/lib/jobs-resource-state';

export function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: models, isLoading: modelsLoading } = useModels();
  const isAdmin = user?.role === 'superadmin' || user?.role === 'system';
  const [adminSubView, setAdminSubView] = useState<'telemetry' | 'crons'>('telemetry');
  const [developmentMode, setDevelopmentMode] = useState(readDevelopmentMode);

  useEffect(() => {
    const syncMode = (event: Event) =>
      setDevelopmentMode(
        event instanceof CustomEvent ? event.detail === true : readDevelopmentMode()
      );
    window.addEventListener(DEVELOPMENT_MODE_EVENT, syncMode);
    return () => window.removeEventListener(DEVELOPMENT_MODE_EVENT, syncMode);
  }, []);
  const visibleModels = models?.filter((model) => developmentMode || !model.menu.developmentOnly);
  const accessibleModels = new Set(models?.map((model) => model.model) ?? []);

  // Live Recent Audit Events (Admins)
  const { data: recentAudits, isLoading: auditsLoading } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'recent_audits']),
    queryFn: () =>
      client
        .model<{
          id: number;
          model: string;
          record_id: number;
          operation: string;
          actor_id?: number;
          changes?: string;
          create_date?: string;
        }>('base.audit_log')
        .searchRead({
          limit: 6,
          order: 'id desc',
        }),
    enabled: isAdmin,
  });

  // Admin Jobs Health & Telemetry Queries
  const {
    data: jobsHealth,
    isLoading: jobsHealthLoading,
    isError: jobsHealthError,
    refetch: refetchJobsHealth,
  } = useQuery({
    queryKey: scopedQueryKey(['admin', 'jobs', 'health']),
    queryFn: () =>
      client.request<{
        success: boolean;
        data: {
          queued: number;
          running: number;
          dead: number;
          outboxPending: number;
          outboxDead: number;
          oldestQueuedAt: string | null;
        };
      }>('/admin/jobs/health'),
    enabled: isAdmin,
    refetchInterval: 10000,
  });

  const {
    data: adminCrons,
    isLoading: cronsLoading,
    isError: cronsError,
    refetch: refetchCrons,
  } = useQuery({
    queryKey: scopedQueryKey(['admin', 'crons']),
    queryFn: () =>
      client.request<{
        success: boolean;
        data: Array<{
          id: number;
          code: string;
          name: string;
          handler: string;
          cron_expression: string;
          timezone: string;
          enabled: boolean;
          next_run_at: string | null;
          misfire_policy: string;
          concurrency_policy: string;
        }>;
      }>('/admin/crons'),
    enabled: isAdmin,
  });

  const [togglingCronId, setTogglingCronId] = useState<number | null>(null);
  const handleToggleCron = async (cronId: number, currentEnabled: boolean) => {
    try {
      setTogglingCronId(cronId);
      await client.request(`/admin/crons/${cronId}`, {
        method: 'PATCH',
        body: { enabled: !currentEnabled },
      });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'crons'] });
    } catch (err) {
      console.error('Failed to toggle cron:', err);
    } finally {
      setTogglingCronId(null);
    }
  };

  // Dead Letter Jobs & Outbox Event Queries (Admins)
  const {
    data: deadJobs,
    isLoading: deadJobsLoading,
    isError: deadJobsError,
    refetch: refetchDeadJobs,
  } = useQuery({
    queryKey: scopedQueryKey(['admin', 'jobs', 'dead']),
    queryFn: () =>
      client.request<{
        success: boolean;
        data: Array<{
          id: number;
          handler: string;
          status: string;
          attempts: number;
          max_attempts: number;
          available_at: string;
          create_date: string;
        }>;
      }>('/admin/jobs?status=dead&limit=20'),
    enabled: isAdmin,
  });

  const {
    data: deadOutbox,
    isLoading: deadOutboxLoading,
    isError: deadOutboxError,
    refetch: refetchDeadOutbox,
  } = useQuery({
    queryKey: scopedQueryKey(['admin', 'outbox', 'dead']),
    queryFn: () =>
      client.request<{
        success: boolean;
        data: Array<{
          id: number;
          event_type: string;
          aggregate_model: string;
          aggregate_id: number;
          attempts: number;
          max_attempts: number;
          last_error?: string;
          created_at: string;
        }>;
      }>('/admin/outbox?status=dead&limit=20'),
    enabled: isAdmin,
  });

  const [failuresModalOpen, setFailuresModalOpen] = useState(false);
  const [failureTab, setFailureTab] = useState<'jobs' | 'outbox'>('jobs');
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const jobsHealthState = jobsResourceState({
    isLoading: jobsHealthLoading,
    isError: jobsHealthError,
    hasData: jobsHealth?.data !== undefined,
  });
  const cronsState = jobsResourceState({
    isLoading: cronsLoading,
    isError: cronsError,
    hasData: adminCrons?.data !== undefined,
    isEmpty: adminCrons?.data?.length === 0,
  });
  const deadJobsState = jobsResourceState({
    isLoading: deadJobsLoading,
    isError: deadJobsError,
    hasData: deadJobs?.data !== undefined,
    isEmpty: deadJobs?.data?.length === 0,
  });
  const deadOutboxState = jobsResourceState({
    isLoading: deadOutboxLoading,
    isError: deadOutboxError,
    hasData: deadOutbox?.data !== undefined,
    isEmpty: deadOutbox?.data?.length === 0,
  });

  const handleRetryJob = async (jobId: number) => {
    try {
      setActionInProgressId(`retry-job-${jobId}`);
      await client.request(`/admin/jobs/${jobId}/retry`, { method: 'POST' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'jobs', 'health'] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to retry job');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleCancelJob = async (jobId: number) => {
    try {
      setActionInProgressId(`cancel-job-${jobId}`);
      await client.request(`/admin/jobs/${jobId}/cancel`, { method: 'POST' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'jobs', 'health'] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel job');
    } finally {
      setActionInProgressId(null);
    }
  };

  const handleRetryOutbox = async (eventId: number) => {
    try {
      setActionInProgressId(`retry-outbox-${eventId}`);
      await client.request(`/admin/outbox/${eventId}/retry`, { method: 'POST' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'outbox'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'jobs', 'health'] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to retry outbox event');
    } finally {
      setActionInProgressId(null);
    }
  };

  // Recent Planned Activities (Fallback for non-admins)
  const { data: recentActivities, isLoading: activitiesLoading } = useQuery({
    queryKey: scopedQueryKey(['kpi', 'recent_activities']),
    queryFn: () =>
      client
        .model<{
          id: number;
          summary: string;
          activity_type: string;
          deadline?: string;
          resource_model: string;
          resource_id: number;
        }>('base.activity')
        .searchRead({
          domain: [['state', '=', 'planned']],
          limit: 6,
          order: 'deadline asc',
        }),
    enabled: !isAdmin && accessibleModels.has('base.activity'),
  });

  return (
    <div className="space-y-8">
      {/* Command center masthead: operational copy stays HTML over shared artwork. */}
      <section className="dashboard-masthead">
        <Image
          src="/illustrations/board-masthead.webp"
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, calc(100vw - 16rem)"
          className="dashboard-masthead-art"
        />
        <div className="dashboard-masthead-shade" aria-hidden="true" />
        <AnimeActionLines
          direction="diagonal"
          density="light"
          className="dashboard-masthead-speedlines"
        />
        <div className="dashboard-masthead-ornaments" aria-hidden="true">
          <Doodle kind="sparkle" className="size-4 text-[var(--mw-signal-blue)]" />
          <Doodle kind="crown" className="size-5 text-[var(--mw-yellow)]" />
        </div>
        <div className="dashboard-masthead-copy">
          <div className="dashboard-masthead-kicker">
            <Sparkles className="size-3.5" aria-hidden="true" /> MoonWitness / Command Center
          </div>
          <h1 className="dashboard-masthead-title">
            <span>Command</span> <span className="dashboard-masthead-title-accent">center</span>
          </h1>
          <p className="dashboard-masthead-subtitle">
            <span>Welcome,</span>
            <AccentMarker>{user?.login}</AccentMarker>
            <span>— your workspace at a glance.</span>
          </p>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button asChild variant="magenta" treatment="brush" size="sm" className="gap-1.5">
              <Link href="/board/m/base.partner?create=1">
                <Plus className="size-4" /> New Partner
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5 shadow-ink">
              <Link href="/board/m/base.company?create=1">
                <Building2 className="size-4" /> New Company
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5 shadow-ink">
              <Link href="/board/m/base.activity?create=1">
                <Calendar className="size-4" /> Schedule Task
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Admin Subview Switcher */}
      {isAdmin && (
        <div className="flex items-center gap-2 border-b-2 border-ink pb-3">
          <div className="inline-flex border-2 border-ink bg-card p-1 shadow-ink-sm">
            <Button
              id="tab-telemetry-overview"
              type="button"
              onClick={() => setAdminSubView('telemetry')}
              className={cn(
                'px-4 py-1.5 font-display text-sm uppercase tracking-wider transition-colors',
                adminSubView === 'telemetry'
                  ? 'border-2 border-ink bg-primary text-primary-foreground font-bold shadow-[2px_2px_0_0_var(--ink)]'
                  : 'text-ink-soft hover:text-ink hover:bg-paper-raised'
              )}
            >
              Overview & Telemetry
            </Button>
            <Button
              id="tab-cron-scheduler"
              type="button"
              onClick={() => setAdminSubView('crons')}
              className={cn(
                'px-4 py-1.5 font-display text-sm uppercase tracking-wider transition-colors',
                adminSubView === 'crons'
                  ? 'border-2 border-ink bg-primary text-primary-foreground font-bold shadow-[2px_2px_0_0_var(--ink)]'
                  : 'text-ink-soft hover:text-ink hover:bg-paper-raised'
              )}
            >
              Cron Scheduler & Queue
            </Button>
          </div>
        </div>
      )}

      {adminSubView === 'crons' ? (
        <CronSchedulerPanel onOpenFailureTriage={() => setFailuresModalOpen(true)} />
      ) : (
        <>
          {/* KPI Counters Grid */}
          <DashboardKpiGrid accessibleModels={accessibleModels} />

          <GrungeDivider label="Live Signal Feed" tone="magenta" />

          {/* Live System Activity / Audit Pulse Feed */}
          <div className="ink-panel min-w-0 border-4 border-ink bg-paper p-4 shadow-ink space-y-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink pb-3">
              <div className="flex items-center gap-2">
                <LiveIndicator
                  active={
                    isAdmin
                      ? Boolean(
                          jobsHealth?.data &&
                          (jobsHealth.data.running > 0 || jobsHealth.data.queued > 0)
                        )
                      : (recentActivities?.records?.length ?? 0) > 0
                  }
                  label="Live Pulse"
                  variant="on-air"
                />
                <h2 className="font-display text-xl uppercase tracking-wider">
                  {isAdmin ? 'System Audit Ledger Events' : 'Upcoming Planned Activities'}
                </h2>
              </div>

              <span className="font-mono text-xs text-ink-faint">
                {isAdmin ? 'Showing latest mutation diffs' : 'Your scheduled milestones'}
              </span>
            </div>

            {isAdmin ? (
              auditsLoading ? (
                <div className="space-y-2">
                  <div className="h-12 border-2 border-ink/20 bg-card animate-pulse" />
                  <div className="h-12 border-2 border-ink/20 bg-card animate-pulse" />
                </div>
              ) : !recentAudits?.records || recentAudits.records.length === 0 ? (
                <p className="font-mono text-xs text-ink-faint py-4 text-center">
                  No recent audit records available.
                </p>
              ) : (
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {recentAudits.records.map((audit) => {
                    let parsedChanges: Record<string, unknown> | null = null;
                    if (audit.changes) {
                      try {
                        parsedChanges = JSON.parse(audit.changes);
                      } catch {
                        // Fallback
                      }
                    }
                    const changedFields = parsedChanges
                      ? Object.keys(parsedChanges).join(', ')
                      : '';

                    return (
                      <Link
                        key={audit.id}
                        href={`/board/m/${audit.model}/${audit.record_id}`}
                        className="dashboard-raw-card group min-w-0 overflow-hidden border-2 border-ink bg-card p-3 font-mono text-xs flex flex-col justify-between"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              'border px-1.5 py-0.5 text-[10px] font-bold uppercase',
                              audit.operation === 'create'
                                ? 'border-primary bg-primary text-primary-foreground'
                                : audit.operation === 'write'
                                  ? 'border-ink bg-ink text-paper'
                                  : 'border-destructive bg-destructive text-destructive-foreground'
                            )}
                          >
                            {audit.operation}
                          </span>
                          <span className="min-w-0 truncate text-right text-[10px] text-ink-faint">
                            {audit.create_date
                              ? formatDateTime(audit.create_date, 'time')
                              : `#${audit.id}`}
                          </span>
                        </div>

                        <div className="my-2 min-w-0">
                          <p className="font-bold text-ink truncate group-hover:text-yellow-readable transition-colors">
                            {audit.model} #{audit.record_id}
                          </p>
                          <p className="break-words text-[11px] text-ink-faint">
                            {changedFields ? `Modified: ${changedFields}` : 'System operation'}
                          </p>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-ink-faint border-t border-ink/10 pt-1.5">
                          <span>Actor #{audit.actor_id ?? 'system'}</span>
                          <span className="flex items-center gap-0.5 group-hover:underline">
                            Inspect <ExternalLink className="size-2.5" />
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )
            ) : activitiesLoading ? (
              <div className="h-12 border-2 border-ink/20 bg-card animate-pulse" />
            ) : !recentActivities?.records || recentActivities.records.length === 0 ? (
              <p className="font-mono text-xs text-ink-faint py-4 text-center">
                No planned activities at this time.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recentActivities.records.map((act) => (
                  <Link
                    key={act.id}
                    href={`/board/m/${act.resource_model}/${act.resource_id}`}
                    className="dashboard-raw-card group border-2 border-ink bg-card p-3 font-mono text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="border border-primary bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-yellow-readable">
                        {act.activity_type}
                      </span>
                      {act.deadline && (
                        <span className="text-[10px] text-ink-faint">Due: {act.deadline}</span>
                      )}
                    </div>
                    <p className="font-bold text-sm text-ink truncate mt-2 group-hover:text-yellow-readable">
                      {act.summary}
                    </p>
                    <p className="text-[11px] text-ink-faint mt-1">
                      On {act.resource_model} #{act.resource_id}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Background Jobs & Outbox Telemetry Panel (Admins Only) */}
          {isAdmin && (
            <div className="ink-panel border-4 border-ink bg-paper p-6 shadow-ink space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 border-2 border-ink bg-magenta/20 px-2.5 py-0.5 font-mono text-xs font-bold uppercase tracking-wider text-magenta-readable">
                    <Cpu className="size-3.5" /> Engine Telemetry
                  </div>
                  <h2 className="font-display text-xl uppercase tracking-wider">
                    Background Job Worker & Outbox
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {((jobsHealth?.data?.dead ?? 0) > 0 ||
                    (jobsHealth?.data?.outboxDead ?? 0) > 0) && (
                    <Button
                      size="sm"
                      onClick={() => setFailuresModalOpen(true)}
                      className="gap-1.5 font-mono text-xs border-2 border-destructive bg-destructive text-destructive-foreground shadow-ink hover:bg-destructive/90"
                    >
                      <AlertTriangle className="size-3.5" />
                      Triage Failures (
                      {(jobsHealth?.data?.dead ?? 0) + (jobsHealth?.data?.outboxDead ?? 0)})
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refetchJobsHealth()}
                    className="gap-1.5 font-mono text-xs border-2 shadow-ink"
                  >
                    <RefreshCw className={cn('size-3.5', jobsHealthLoading && 'animate-spin')} />
                    Refresh Worker
                  </Button>
                </div>
              </div>

              {(jobsHealthState === 'error' || jobsHealthState === 'unavailable') && (
                <p role="alert" className="font-mono text-xs text-destructive">
                  Live worker telemetry is unavailable. Refresh Worker to retry.
                </p>
              )}

              {/* Quick Metrics Cards */}
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                <div className="border-2 border-ink bg-card p-3 font-mono">
                  <div className="text-[10px] uppercase text-ink-faint">Queued Jobs</div>
                  <div className="text-2xl font-display font-bold mt-1">
                    {jobsHealthState === 'ready' ? jobsHealth?.data?.queued : '—'}
                  </div>
                </div>

                <div className="border-2 border-ink bg-card p-3 font-mono">
                  <div className="text-[10px] uppercase text-ink-faint flex items-center gap-1.5">
                    <span>Running</span>
                    {(jobsHealth?.data?.running ?? 0) > 0 && (
                      <span className="size-2 border border-ink bg-primary animate-pulse" />
                    )}
                  </div>
                  <div className="text-2xl font-display font-bold mt-1 text-yellow-readable">
                    {jobsHealthState === 'ready' ? jobsHealth?.data?.running : '—'}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFailureTab('jobs');
                    setFailuresModalOpen(true);
                  }}
                  className={cn(
                    'h-auto w-full flex-col items-stretch justify-start gap-0 border-2 border-ink bg-card p-3 text-left font-mono font-normal normal-case cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-ink',
                    (jobsHealth?.data?.dead ?? 0) > 0 && 'bg-destructive/10 border-destructive'
                  )}
                  title="Click to inspect failed jobs"
                >
                  <span className="text-[10px] uppercase text-ink-faint flex items-center justify-between">
                    <span>Dead Letter</span>
                    <ExternalLink className="size-2.5 opacity-60" />
                  </span>
                  <span
                    className={cn(
                      'text-2xl font-display font-bold mt-1 block',
                      (jobsHealth?.data?.dead ?? 0) > 0 ? 'text-destructive' : 'text-ink'
                    )}
                  >
                    {jobsHealthState === 'ready' ? jobsHealth?.data?.dead : '—'}
                  </span>
                </Button>

                <div className="border-2 border-ink bg-card p-3 font-mono">
                  <div className="text-[10px] uppercase text-ink-faint">Outbox Pending</div>
                  <div className="text-2xl font-display font-bold mt-1">
                    {jobsHealthState === 'ready' ? jobsHealth?.data?.outboxPending : '—'}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFailureTab('outbox');
                    setFailuresModalOpen(true);
                  }}
                  className={cn(
                    'h-auto w-full flex-col items-stretch justify-start gap-0 border-2 border-ink bg-card p-3 text-left font-mono font-normal normal-case cursor-pointer transition-transform hover:-translate-y-0.5 hover:shadow-ink',
                    (jobsHealth?.data?.outboxDead ?? 0) > 0 &&
                      'bg-destructive/10 border-destructive'
                  )}
                  title="Click to inspect failed outbox events"
                >
                  <span className="text-[10px] uppercase text-ink-faint flex items-center justify-between">
                    <span>Outbox Dead</span>
                    <ExternalLink className="size-2.5 opacity-60" />
                  </span>
                  <span
                    className={cn(
                      'text-2xl font-display font-bold mt-1 block',
                      (jobsHealth?.data?.outboxDead ?? 0) > 0 ? 'text-destructive' : 'text-ink'
                    )}
                  >
                    {jobsHealthState === 'ready' ? jobsHealth?.data?.outboxDead : '—'}
                  </span>
                </Button>
              </div>

              {jobsHealthState === 'ready' ? (
                <BarChart
                  title="Background job status distribution"
                  locale={readPreferences().language}
                  valueLabel="Jobs"
                  data={[
                    { label: 'Queued', value: jobsHealth?.data?.queued ?? 0 },
                    { label: 'Running', value: jobsHealth?.data?.running ?? 0 },
                    { label: 'Dead', value: jobsHealth?.data?.dead ?? 0 },
                    { label: 'Outbox pending', value: jobsHealth?.data?.outboxPending ?? 0 },
                    { label: 'Outbox dead', value: jobsHealth?.data?.outboxDead ?? 0 },
                  ]}
                  className="border-2 border-ink bg-card p-4 font-mono"
                />
              ) : jobsHealthState === 'loading' ? (
                <div
                  aria-label="Loading job telemetry"
                  className="h-36 border-2 border-ink/20 bg-card animate-pulse"
                />
              ) : null}

              {/* Scheduled Cron Tasks Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
                    <Layers className="size-3.5" /> Scheduled Crons & Automations
                  </span>
                  <span className="font-mono text-[10px] text-ink-faint">
                    {cronsState === 'ready' || cronsState === 'empty'
                      ? `${adminCrons?.data?.length ?? 0} registered jobs`
                      : cronsState === 'loading'
                        ? 'Loading'
                        : 'Unavailable'}
                  </span>
                </div>

                {cronsState === 'loading' ? (
                  <div className="h-14 border-2 border-ink/20 bg-card animate-pulse" />
                ) : cronsState === 'error' || cronsState === 'unavailable' ? (
                  <div
                    role="alert"
                    className="flex items-center justify-between border-2 border-destructive/40 p-3 font-mono text-xs"
                  >
                    <span>Scheduled cron data is unavailable.</span>
                    <Button size="sm" variant="outline" onClick={() => void refetchCrons()}>
                      Retry
                    </Button>
                  </div>
                ) : cronsState === 'empty' ? (
                  <p className="font-mono text-xs text-ink-faint py-3 text-center border-2 border-dashed border-ink/20">
                    No cron jobs registered.
                  </p>
                ) : (
                  <div className="divide-y-2 divide-ink border-2 border-ink bg-card">
                    {adminCrons?.data?.map((cron) => (
                      <div
                        key={cron.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-3 font-mono text-xs hover:bg-paper/40 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink text-sm">{cron.name}</span>
                            <span className="border border-ink/30 px-1 py-0.2 text-[10px] text-ink-faint">
                              {cron.code}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                            <span className="bg-ink/5 px-1.5 py-0.5 border border-ink/10">
                              {cron.cron_expression}
                            </span>
                            <span>•</span>
                            <span>Handler: {cron.handler}</span>
                            {cron.next_run_at && (
                              <>
                                <span>•</span>
                                <span>
                                  Next: {formatDateTime(cron.next_run_at, 'shortDateTime')}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <Button
                            size="sm"
                            variant={cron.enabled ? 'default' : 'outline'}
                            disabled={togglingCronId === cron.id}
                            onClick={() => void handleToggleCron(cron.id, cron.enabled)}
                            className={cn(
                              'h-7 px-2.5 text-[11px] font-bold uppercase tracking-wider',
                              cron.enabled
                                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                : 'text-ink-faint'
                            )}
                          >
                            {togglingCronId === cron.id
                              ? 'Updating...'
                              : cron.enabled
                                ? 'Active'
                                : 'Disabled'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <GrungeDivider label="Workspace Modules" tone="yellow" />

          {/* Available Models Grid */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl uppercase tracking-wider">Available Modules</h2>
              <Doodle kind="crown" className="size-6 text-yellow-readable rotate-12" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modelsLoading ? (
                Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="h-32 border-2 border-ink/20 bg-card p-6 animate-pulse" />
                ))
              ) : visibleModels?.length === 0 ? (
                <p className="text-ink-faint">No accessible models found for your role.</p>
              ) : (
                visibleModels?.map((m) => {
                  const Icon = modelIcon(m.model);
                  return (
                    <Link
                      key={m.model}
                      href={`/board/m/${m.model}`}
                      className="ink-panel dashboard-raw-card group relative block p-6"
                    >
                      <div className="flex items-start justify-between">
                        <div className="size-12 border-2 border-ink bg-paper flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          <Icon className="size-6" strokeWidth={2.4} />
                        </div>
                        <span className="font-mono text-xs text-ink-faint uppercase">
                          Table: {m.table}
                        </span>
                      </div>

                      <div className="mt-4">
                        <h3 className="font-display text-xl uppercase tracking-wide group-hover:text-yellow-readable transition-colors">
                          {m.menu.label ?? modelLabel(m.model)}
                        </h3>
                        <p className="font-mono text-xs text-ink-faint mt-0.5">{m.model}</p>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* Failure Triage & Recovery Modal */}
      <Dialog open={failuresModalOpen} onOpenChange={setFailuresModalOpen}>
        <DialogContent className="max-w-2xl font-sans">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="border-2 border-ink bg-destructive p-1 text-destructive-foreground shadow-[1px_1px_0_0_var(--ink)]">
                <AlertTriangle className="size-4" />
              </span>
              <DialogTitle className="font-display text-xl uppercase tracking-wider text-ink">
                Engine Failure Triage & Recovery
              </DialogTitle>
            </div>
            <DialogDescription className="font-mono text-xs text-ink-soft">
              Inspect dead-letter jobs, failed asynchronous transactions, and trigger recovery or
              cancellation.
            </DialogDescription>
          </DialogHeader>

          {/* Modal Tabs */}
          <div className="flex border-2 border-ink bg-paper font-mono text-xs">
            <Button
              type="button"
              onClick={() => setFailureTab('jobs')}
              className={cn(
                'flex-1 py-2 text-center font-bold uppercase transition-colors',
                failureTab === 'jobs' ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-paper-raised'
              )}
            >
              Dead Jobs (
              {deadJobsState === 'ready' || deadJobsState === 'empty'
                ? (deadJobs?.data?.length ?? 0)
                : '—'}
              )
            </Button>
            <Button
              type="button"
              onClick={() => setFailureTab('outbox')}
              className={cn(
                'flex-1 py-2 text-center font-bold uppercase transition-colors',
                failureTab === 'outbox'
                  ? 'bg-ink text-paper'
                  : 'text-ink-soft hover:bg-paper-raised'
              )}
            >
              Dead Outbox Events (
              {deadOutboxState === 'ready' || deadOutboxState === 'empty'
                ? (deadOutbox?.data?.length ?? 0)
                : '—'}
              )
            </Button>
          </div>

          {/* Tab Content */}
          <div className="max-h-80 overflow-y-auto space-y-2.5 font-mono text-xs pr-1">
            {failureTab === 'jobs' ? (
              deadJobsState === 'loading' ? (
                <div className="p-8 text-center text-ink-faint">Loading dead jobs...</div>
              ) : deadJobsState === 'error' || deadJobsState === 'unavailable' ? (
                <div
                  role="alert"
                  className="flex items-center justify-between border-2 border-destructive/40 p-3"
                >
                  <span>Dead job data is unavailable.</span>
                  <Button size="sm" variant="outline" onClick={() => void refetchDeadJobs()}>
                    Retry
                  </Button>
                </div>
              ) : deadJobsState === 'empty' ? (
                <div className="p-8 text-center border-2 border-dashed border-ink/20 text-ink-faint">
                  ✓ No dead jobs in the dead-letter queue. Engine healthy.
                </div>
              ) : (
                deadJobs?.data?.map((job) => (
                  <div
                    key={job.id}
                    className="border-2 border-ink bg-card p-3 shadow-ink-sm space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="border border-destructive bg-destructive/20 px-1.5 py-0.2 font-bold uppercase text-destructive text-[10px]">
                          DEAD
                        </span>
                        <span className="font-bold text-ink text-sm">Job #{job.id}</span>
                      </div>
                      <span className="text-[10px] text-ink-faint">
                        Attempts: {job.attempts} / {job.max_attempts}
                      </span>
                    </div>

                    <div className="text-[11px] text-ink-soft">
                      <p>
                        Handler: <span className="font-bold text-ink">{job.handler}</span>
                      </p>
                      <p className="text-ink-faint text-[10px] mt-0.5">
                        Created: {formatDateTime(job.create_date)}
                      </p>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-ink/10 pt-2">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={actionInProgressId !== null}
                        onClick={() => handleCancelJob(job.id)}
                        className="gap-1 hover:bg-ink hover:text-paper"
                      >
                        <Trash2 className="size-3" /> Cancel Job
                      </Button>
                      <Button
                        size="xs"
                        disabled={actionInProgressId !== null}
                        onClick={() => handleRetryJob(job.id)}
                        className="gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <RotateCw
                          className={cn(
                            'size-3',
                            actionInProgressId === `retry-job-${job.id}` && 'animate-spin'
                          )}
                        />
                        Retry Job
                      </Button>
                    </div>
                  </div>
                ))
              )
            ) : deadOutboxState === 'loading' ? (
              <div className="p-8 text-center text-ink-faint">Loading outbox events...</div>
            ) : deadOutboxState === 'error' || deadOutboxState === 'unavailable' ? (
              <div
                role="alert"
                className="flex items-center justify-between border-2 border-destructive/40 p-3"
              >
                <span>Dead outbox data is unavailable.</span>
                <Button size="sm" variant="outline" onClick={() => void refetchDeadOutbox()}>
                  Retry
                </Button>
              </div>
            ) : deadOutboxState === 'empty' ? (
              <div className="p-8 text-center border-2 border-dashed border-ink/20 text-ink-faint">
                ✓ No dead outbox events detected. All transactions published.
              </div>
            ) : (
              deadOutbox?.data?.map((event) => (
                <div
                  key={event.id}
                  className="border-2 border-ink bg-card p-3 shadow-ink-sm space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="border border-destructive bg-destructive/20 px-1.5 py-0.2 font-bold uppercase text-destructive text-[10px]">
                        OUTBOX DEAD
                      </span>
                      <span className="font-bold text-ink text-sm">Event #{event.id}</span>
                    </div>
                    <span className="text-[10px] text-ink-faint">
                      Attempts: {event.attempts} / {event.max_attempts}
                    </span>
                  </div>

                  <div className="text-[11px] text-ink-soft space-y-0.5">
                    <p>
                      Type: <span className="font-bold text-ink">{event.event_type}</span>
                    </p>
                    <p>
                      Target: {event.aggregate_model} #{event.aggregate_id}
                    </p>
                    {event.last_error && (
                      <p className="border border-destructive/30 bg-destructive/5 p-1 text-[10px] text-destructive truncate mt-1">
                        Error: {event.last_error}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 border-t border-ink/10 pt-2">
                    <Button
                      size="xs"
                      disabled={actionInProgressId !== null}
                      onClick={() => handleRetryOutbox(event.id)}
                      className="gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <RotateCw
                        className={cn(
                          'size-3',
                          actionInProgressId === `retry-outbox-${event.id}` && 'animate-spin'
                        )}
                      />
                      Retry Event
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
