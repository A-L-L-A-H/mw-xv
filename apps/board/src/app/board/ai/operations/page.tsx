'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
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
import { Toolbar } from '@moonwitness/ui/components/toolbar';
import {
  ActivityIcon,
  ClockIcon,
  PauseIcon,
  RefreshIcon,
  SecurityIcon,
  WarningIcon,
} from '@moonwitness/ui/icons';
import {
  formatMicrosAsUsd,
  useAiAgents,
  useAiGrants,
  useAiProviders,
  useAiRuns,
} from '@/components/ai/ai-api';
import {
  EmergencyConfirmModal,
  MissionControlShell,
  ProvenanceBadge,
} from '@/components/ai/mission-control-chrome';
import { client } from '@/lib/client';

type PendingEmergencyAction =
  | {
      readonly kind: 'emergency_stop';
      readonly title: string;
      readonly consequence: string;
      readonly endpoint: string;
      readonly method: 'POST' | 'PATCH';
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'pause_agent';
      readonly title: string;
      readonly consequence: string;
      readonly endpoint: string;
      readonly method: 'POST' | 'PATCH';
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'stop_run';
      readonly title: string;
      readonly consequence: string;
      readonly endpoint: string;
      readonly method: 'POST' | 'PATCH';
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'revoke_grant';
      readonly title: string;
      readonly consequence: string;
      readonly endpoint: string;
      readonly method: 'POST' | 'PATCH';
      readonly payload: Record<string, unknown>;
    }
  | {
      readonly kind: 'disable_provider';
      readonly title: string;
      readonly consequence: string;
      readonly endpoint: string;
      readonly method: 'POST' | 'PATCH';
      readonly payload: Record<string, unknown>;
    };

export default function AiLiveOperationsPage() {
  const queryClient = useQueryClient();
  const runsQuery = useAiRuns();
  const agentsQuery = useAiAgents();
  const grantsQuery = useAiGrants();
  const providersQuery = useAiProviders();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');

  const [pendingAction, setPendingAction] = useState<PendingEmergencyAction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const runs = runsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const grants = grantsQuery.data ?? [];
  const providers = providersQuery.data ?? [];

  const searchNorm = searchQuery.trim().toLowerCase();
  const filteredRuns = runs.filter((run) => {
    if (statusFilter !== 'all' && run.status !== statusFilter) return false;
    if (agentFilter !== 'all' && String(run.agent_id) !== agentFilter) return false;
    if (providerFilter !== 'all' && String(run.provider_profile_id) !== providerFilter) {
      return false;
    }
    if (!searchNorm) return true;
    const hay = `${run.correlation_id} ${run.status} ${run.checkpoint_cursor ?? ''}`.toLowerCase();
    return hay.includes(searchNorm);
  });

  const totalTokens = runs.reduce(
    (acc, r) => acc + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0
  );
  const totalCostMicros = runs.reduce((acc, r) => acc + (r.estimated_cost_micros ?? 0), 0);

  const openConfirmModal = (action: PendingEmergencyAction) => {
    setActionError(null);
    setActionNotice(null);
    setPendingAction(action);
  };

  const handleConfirmEmergencyAction = async () => {
    if (!pendingAction) return;
    setIsSubmitting(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await client.request(pendingAction.endpoint, {
        method: pendingAction.method,
        body: pendingAction.payload,
      });
      setPendingAction(null);
      setActionNotice(`Server confirmed ${pendingAction.title} and recorded audit log entry.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ai'] }),
        runsQuery.refetch(),
        agentsQuery.refetch(),
        grantsQuery.refetch(),
        providersQuery.refetch(),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Server rejected privileged operation.';
      setActionError(msg);
      setPendingAction(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const firstAgentId = agents[0]?.id ?? 1;
  const firstGrantId = grants[0]?.id ?? 1;
  const firstRunId = runs[0]?.id ?? 1;
  const firstProviderId = providers[0]?.id ?? 1;

  return (
    <MissionControlShell
      activeRoute="/board/ai/operations"
      title="Live Operations"
      accentTitle="& Emergency Controls"
      breadcrumbLabel="Live Operations"
      description="Durable job and agent run timeline, fencing tokens, checkpoint cursors, and non-optimistic emergency operator controls."
      errorAlert={actionError}
      successNotice={actionNotice}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void runsQuery.refetch();
            void agentsQuery.refetch();
          }}
        >
          <RefreshIcon className="size-3.5" />
          Refresh Timeline
        </Button>
      }
    >
      {/* Run & Telemetry KPIs */}
      <section
        aria-label="Live operations metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricTile
          label="Durable Agent Runs"
          value={String(runs.length)}
          detail="Persisted ai.agent_run records"
          accent="magenta"
          icon={<ActivityIcon className="size-5" />}
        />
        <MetricTile
          label="In-Flight / Pending"
          value={String(
            runs.filter((r) => r.status === 'running' || r.status === 'pending').length
          )}
          detail="Ephemeral worker lease heartbeats"
          accent="cyan"
          icon={<ClockIcon className="size-5" />}
        />
        <MetricTile
          label="Cumulative Tokens"
          value={String(totalTokens)}
          detail="Derived input + output token sum"
          accent="yellow"
          icon={<SecurityIcon className="size-5" />}
        />
        <MetricTile
          label="Estimated Run Cost"
          value={formatMicrosAsUsd(totalCostMicros)}
          detail="Derived micro-USD accounting"
          accent="green"
          icon={<WarningIcon className="size-5" />}
        />
      </section>

      {/* Operator Emergency Control Deck (AI9.11, AI9.17, AI9.24) */}
      <Panel
        title="Operator Emergency Control Deck"
        description="Privileged actions require explicit confirmation and wait for non-optimistic server verification."
        actions={<ProvenanceBadge kind="persisted" />}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() =>
              openConfirmModal({
                kind: 'emergency_stop',
                title: 'Emergency Stop Company Dispatch',
                consequence:
                  'Immediately blocks new dispatches across the active company, pauses active agents, and requests cooperative cancellation on in-flight jobs.',
                endpoint: '/api/ai/emergency-stop',
                method: 'POST',
                payload: {
                  reason: 'Operator triggered company emergency stop from Live Operations',
                  revoke_grants: false,
                },
              })
            }
          >
            <WarningIcon className="size-3.5" />
            Emergency Stop
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openConfirmModal({
                kind: 'pause_agent',
                title: `Pause Agent #${firstAgentId}`,
                consequence:
                  'Transitions the target agent to paused state so it cannot claim new work contracts or job leases until resumed.',
                endpoint: `/api/ai/agents/${firstAgentId}`,
                method: 'PATCH',
                payload: { status: 'paused' },
              })
            }
          >
            <PauseIcon className="size-3.5" />
            Pause Agent
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openConfirmModal({
                kind: 'revoke_grant',
                title: `Revoke Grant #${firstGrantId}`,
                consequence:
                  'Revokes the capability grant at the gateway while preserving immutable audit history. Active runs recheck grant validity before every tool call.',
                endpoint: `/api/ai/grants/${firstGrantId}/revoke`,
                method: 'POST',
                payload: { reason: 'Operator emergency grant revocation' },
              })
            }
          >
            <SecurityIcon className="size-3.5" />
            Revoke Grant
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openConfirmModal({
                kind: 'stop_run',
                title: `Stop Run #${firstRunId}`,
                consequence:
                  'Signals cooperative cancellation on the durable job and transitions the agent run to cancelled at the next safe checkpoint.',
                endpoint: `/api/ai/runs/${firstRunId}/cancel`,
                method: 'POST',
                payload: { reason: 'Operator cancelled run from Live Operations' },
              })
            }
          >
            Stop Run
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openConfirmModal({
                kind: 'disable_provider',
                title: `Disable Provider #${firstProviderId}`,
                consequence:
                  'Disables the model provider profile so the classification router immediately blocks new calls to this endpoint.',
                endpoint: `/api/ai/providers/${firstProviderId}`,
                method: 'PATCH',
                payload: { enabled: false },
              })
            }
          >
            Disable Provider
          </Button>
        </div>
      </Panel>

      {/* Multi-Facet Filter Toolbar */}
      <Toolbar
        aria-label="Filter durable agent runs"
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="ops-run-search">
              Search runs by correlation ID
            </label>
            <Input
              id="ops-run-search"
              type="search"
              data-filter="run-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter runs by correlation ID or checkpoint…"
              className="w-full sm:w-64"
            />

            <label className="sr-only" htmlFor="ops-status-filter">
              Filter by run status
            </label>
            <SelectField
              id="ops-status-filter"
              data-filter="run-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All Run Statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </SelectField>

            <label className="sr-only" htmlFor="ops-agent-filter">
              Filter by agent
            </label>
            <SelectField
              id="ops-agent-filter"
              data-filter="run-agent"
              value={agentFilter}
              onChange={(event) => setAgentFilter(event.target.value)}
            >
              <option value="all">All Agents</option>
              {agents.map((agent) => (
                <option key={agent.id} value={String(agent.id)}>
                  {agent.display_name ?? agent.name ?? agent.code}
                </option>
              ))}
            </SelectField>

            <label className="sr-only" htmlFor="ops-provider-filter">
              Filter by provider
            </label>
            <SelectField
              id="ops-provider-filter"
              data-filter="run-provider"
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
            >
              <option value="all">All Providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={String(provider.id)}>
                  {provider.name} ({provider.kind})
                </option>
              ))}
            </SelectField>
          </div>
        }
        actions={
          <Link
            href="/board/ai/continuity"
            className="inline-flex items-center border-2 border-ink bg-paper px-3 py-1.5 font-mono text-xs uppercase hover:bg-ink/10"
          >
            Inspect Artifacts →
          </Link>
        }
      />

      {/* Run & Job Timeline Table */}
      <Panel
        title="Durable Job & Agent Run Timeline"
        description="Correlated with @moonwitness/jobs worker leases, monotonic fencing tokens, and token accounting."
        actions={
          <div className="flex items-center gap-1.5">
            <ProvenanceBadge kind="persisted" />
            <ProvenanceBadge kind="derived" />
            <ProvenanceBadge kind="ephemeral" />
          </div>
        }
      >
        {runsQuery.isLoading ? (
          <Skeleton className="h-44 w-full bg-ink/10" />
        ) : (
          <Table scrollLabel="Live operations agent run timeline" density="compact">
            <TableHead>
              <TableRow>
                <TableHeader>Run &amp; Correlation ID</TableHeader>
                <TableHeader>Contract &amp; Agent</TableHeader>
                <TableHeader>Fencing &amp; Checkpoint</TableHeader>
                <TableHeader>Tokens &amp; Cost</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Provenance</TableHeader>
                <TableHeader>Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRuns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="font-mono text-xs text-ink-soft">
                    No agent runs recorded for the current filter selection. Drill down from{' '}
                    <Link href="/board/ai/mission-control" className="underline">
                      Mission Control
                    </Link>{' '}
                    or inspect{' '}
                    <Link href="/board/ai/continuity" className="underline">
                      Evidence &amp; Continuity
                    </Link>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                filteredRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs">
                      <div className="font-bold text-ink">
                        Run #{run.id} {run.job_id ? `(Job #${run.job_id})` : ''}
                      </div>
                      <div className="break-all text-ink-faint">{run.correlation_id}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>Contract #{run.work_contract_id}</div>
                      <div className="text-ink-faint">Agent #{run.agent_id}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>
                        Token #{run.fencing_token} · Steps {run.step_count}
                      </div>
                      <div className="text-ink-faint">
                        {run.checkpoint_cursor ?? 'checkpoint:initial'}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>
                        {run.input_tokens} in / {run.output_tokens} out ({run.token_source})
                      </div>
                      <div className="text-ink-faint">
                        {formatMicrosAsUsd(run.estimated_cost_micros)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          run.status === 'completed'
                            ? 'primary'
                            : run.status === 'failed' || run.status === 'cancelled'
                              ? 'destructive'
                              : 'default'
                        }
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ProvenanceBadge
                        kind={run.status === 'running' ? 'ephemeral' : 'persisted'}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/board/ai/continuity?run=${run.id}`}
                          className="inline-flex items-center border-2 border-ink bg-paper px-2 py-1 font-mono text-xs uppercase hover:bg-ink/10"
                        >
                          Evidence
                        </Link>
                        {(run.status === 'running' || run.status === 'pending') && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              openConfirmModal({
                                kind: 'stop_run',
                                title: `Stop Run #${run.id}`,
                                consequence:
                                  'Requests cooperative cancellation on the underlying durable job and halts execution.',
                                endpoint: `/api/ai/runs/${run.id}/cancel`,
                                method: 'POST',
                                payload: { reason: 'Operator cancelled run' },
                              })
                            }
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Panel>

      <EmergencyConfirmModal
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        title={pendingAction?.title ?? 'Confirm Operator Action'}
        consequence={
          pendingAction?.consequence ??
          'This privileged action requires server confirmation before taking effect.'
        }
        isPending={isSubmitting}
        errorAlert={actionError}
        onConfirm={handleConfirmEmergencyAction}
      />
    </MissionControlShell>
  );
}
