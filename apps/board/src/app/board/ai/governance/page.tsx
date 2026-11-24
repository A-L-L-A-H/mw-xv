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
  CheckIcon,
  KeyIcon,
  LockIcon,
  RefreshIcon,
  SecurityIcon,
  WarningIcon,
} from '@moonwitness/ui/icons';
import {
  useAiAgents,
  useAiGovernanceApprovals,
  useAiGrants,
  useAiRuns,
} from '@/components/ai/ai-api';
import {
  EmergencyConfirmModal,
  MissionControlShell,
  ProvenanceBadge,
  RiskTierBadge,
} from '@/components/ai/mission-control-chrome';
import { client } from '@/lib/client';
import { RunApprovalPanel } from '../_components/cloud-agent-panels';

interface PendingGovernanceModalAction {
  readonly title: string;
  readonly consequence: string;
  readonly endpoint: string;
  readonly method: 'POST' | 'PATCH';
  readonly payload: Record<string, unknown>;
}

const RISK_TIER_CATALOG = [
  {
    tier: 'R0',
    autonomy: 'Autonomous Read-Only',
    scope: 'Repository read, approved knowledge search, metadata inspection',
    approval: 'ExecutionPolicy R0 grant',
  },
  {
    tier: 'R1',
    autonomy: 'Reversible Internal Draft',
    scope: 'Isolated worktree edit, candidate memory proposal, draft work note',
    approval: 'Scoped R1 capability grant',
  },
  {
    tier: 'R2',
    autonomy: 'Peer-Reviewed Internal Write',
    scope: 'Worktree branch commit, local test suite, workflow review submission',
    approval: 'Independent reviewer agent or operator',
  },
  {
    tier: 'R3',
    autonomy: 'Human-Approved External Effect',
    scope: 'Cloud provider egress, upstream sync push, high-impact transition',
    approval: 'Single-use human operator approval required',
  },
  {
    tier: 'R4',
    autonomy: 'Unconditionally Prohibited',
    scope: 'Raw secret read, privilege escalation, workspace escape, destructive commands',
    approval: 'Always blocked by deterministic policy engine',
  },
] as const;

function formatGrantLifecycleLabel(status: string): string {
  if (status === 'active') return 'active';
  if (status === 'expired') return 'expired';
  return 'terminated';
}

export default function AiGovernancePage() {
  const queryClient = useQueryClient();
  const grantsQuery = useAiGrants();
  const approvalsQuery = useAiGovernanceApprovals();
  const agentsQuery = useAiAgents();
  const runsQuery = useAiRuns();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [pendingAction, setPendingAction] = useState<PendingGovernanceModalAction | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const grants = grantsQuery.data ?? [];
  const approvals = approvalsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];

  const searchNorm = searchQuery.trim().toLowerCase();
  const filteredGrants = grants.filter((grant) => {
    const normalizedStatus = formatGrantLifecycleLabel(grant.status);
    if (statusFilter !== 'all' && normalizedStatus !== statusFilter) return false;
    if (!searchNorm) return true;
    return `${grant.capability} ${grant.agent_id} ${normalizedStatus}`
      .toLowerCase()
      .includes(searchNorm);
  });

  const targetGrantId = grants[0]?.id ?? 1;

  const openGovernanceModal = (action: PendingGovernanceModalAction) => {
    setActionError(null);
    setActionNotice(null);
    setPendingAction(action);
  };

  const handleConfirmGovernanceAction = async () => {
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
      setActionNotice(`Server confirmed ${pendingAction.title} and persisted audit log entry.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ai'] }),
        grantsQuery.refetch(),
        approvalsQuery.refetch(),
        agentsQuery.refetch(),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Server rejected governance operation.';
      setActionError(message);
      setPendingAction(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MissionControlShell
      activeRoute="/board/ai/governance"
      title="Governance, Grants"
      accentTitle="& Risk Tiers R0–R4"
      breadcrumbLabel="Governance & Grants"
      description="Time-bounded capability grants, deterministic R0–R4 risk-tier policy matrix, workflow approval queue, and non-optimistic emergency revocation controls."
      errorAlert={actionError}
      successNotice={actionNotice}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void grantsQuery.refetch();
            void approvalsQuery.refetch();
          }}
        >
          <RefreshIcon className="size-3.5" />
          Refresh Governance
        </Button>
      }
    >
      {/* Governance KPIs */}
      <section
        aria-label="Governance and capability grant metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricTile
          label="Active Capability Grants"
          value={String(grants.filter((g) => g.status === 'active').length)}
          detail="Persisted time-bounded grants"
          accent="magenta"
          icon={<KeyIcon className="size-5" />}
        />
        <MetricTile
          label="Total Issued Grants"
          value={String(grants.length)}
          detail="Derived company grant ledger"
          accent="cyan"
          icon={<SecurityIcon className="size-5" />}
        />
        <MetricTile
          label="Workflow Approvals"
          value={String(approvals.length)}
          detail="Independent review queue"
          accent="yellow"
          icon={<CheckIcon className="size-5" />}
        />
        <MetricTile
          label="Governed Agents"
          value={String(agents.length)}
          detail="Ephemeral gateway enforcement"
          accent="green"
          icon={<LockIcon className="size-5" />}
        />
      </section>

      {/* Non-Optimistic Emergency Governance Controls */}
      <Panel
        title="Emergency Governance & Revocation Controls"
        description="Privileged policy actions require explicit operator confirmation and wait for server persistence before updating UI state."
        actions={<ProvenanceBadge kind="persisted" />}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() =>
              openGovernanceModal({
                title: 'Emergency Stop Company Dispatch',
                consequence:
                  'Blocks new run dispatches across the company, pauses active agents, and requests cooperative cancellation on in-flight jobs.',
                endpoint: '/api/ai/emergency-stop',
                method: 'POST',
                payload: {
                  reason: 'Operator triggered emergency stop from Governance console',
                  revoke_grants: true,
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
              openGovernanceModal({
                title: `Revoke Capability Grant #${targetGrantId}`,
                consequence:
                  'Terminates the capability grant at the gateway without deleting historical audit records.',
                endpoint: `/api/ai/grants/${targetGrantId}/revoke`,
                method: 'POST',
                payload: {
                  reason: 'Operator triggered grant revocation from Governance console',
                },
              })
            }
          >
            <SecurityIcon className="size-3.5" />
            Revoke Capability Grant
          </Button>
        </div>
      </Panel>

      {/* Filter Bar */}
      <Toolbar
        aria-label="Filter capability grants"
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="gov-grant-search">
              Search capability grants
            </label>
            <Input
              id="gov-grant-search"
              type="search"
              data-filter="grant-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter grants by capability or agent ID…"
              className="w-full sm:w-64"
            />
            <label className="sr-only" htmlFor="gov-grant-status">
              Filter by grant state
            </label>
            <SelectField
              id="gov-grant-status"
              data-filter="grant-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All Grant States</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="terminated">Terminated</option>
            </SelectField>
          </div>
        }
        actions={
          <Link
            href="/board/ai/operations"
            className="inline-flex items-center border-2 border-ink bg-paper px-3 py-1.5 font-mono text-xs uppercase hover:bg-ink/10"
          >
            Live Operations →
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Capability Grants Table */}
        <Panel
          title="Scoped Capability Grants Ledger"
          description="Execution-time capability grants scoped to company, agent, work contract, policy version, and call quota."
          actions={
            <div className="flex items-center gap-1.5">
              <ProvenanceBadge kind="persisted" />
              <ProvenanceBadge kind="derived" />
              <ProvenanceBadge kind="ephemeral" />
            </div>
          }
        >
          {grantsQuery.isLoading ? (
            <Skeleton className="h-40 w-full bg-ink/10" />
          ) : (
            <Table scrollLabel="Scoped capability grants table" density="compact">
              <TableHead>
                <TableRow>
                  <TableHeader>Grant &amp; Capability</TableHeader>
                  <TableHeader>Agent &amp; Contract</TableHeader>
                  <TableHeader>Policy &amp; Quota</TableHeader>
                  <TableHeader>Expiry</TableHeader>
                  <TableHeader>State</TableHeader>
                  <TableHeader>Action</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredGrants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="font-mono text-xs text-ink-soft">
                      No capability grants match the current filter. Use Emergency Governance
                      Controls above to test policy revocation gates.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredGrants.map((grant) => {
                    const stateLabel = formatGrantLifecycleLabel(grant.status);
                    return (
                      <TableRow key={grant.id}>
                        <TableCell className="font-mono text-xs">
                          <div className="font-bold text-ink">Grant #{grant.id}</div>
                          <div className="text-ink-faint">{grant.capability}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div>Agent #{grant.agent_id}</div>
                          <div className="text-ink-faint">
                            Contract #{grant.work_contract_id ?? 'Any'}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div>Policy v{grant.policy_version}</div>
                          <div className="text-ink-faint">
                            Max {grant.max_calls_per_run} calls/run
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{grant.expires_at}</TableCell>
                        <TableCell>
                          <Badge variant={stateLabel === 'active' ? 'primary' : 'default'}>
                            {stateLabel}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              openGovernanceModal({
                                title: `Revoke Capability Grant #${grant.id}`,
                                consequence: `Terminates grant #${grant.id} (${grant.capability}) for Agent #${grant.agent_id}.`,
                                endpoint: `/api/ai/grants/${grant.id}/revoke`,
                                method: 'POST',
                                payload: {
                                  reason: 'Operator revoked capability grant',
                                },
                              })
                            }
                          >
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </Panel>

        {/* Deterministic R0-R4 Risk Tier Matrix */}
        <Panel
          title="Deterministic Risk Tiers (R0–R4)"
          description="Enforced outside model prompts at the capability gateway."
          actions={<ProvenanceBadge kind="persisted" />}
        >
          <Table scrollLabel="Risk tier policy matrix" density="compact">
            <TableHead>
              <TableRow>
                <TableHeader>Tier</TableHeader>
                <TableHeader>Autonomy &amp; Scope</TableHeader>
                <TableHeader>Gate Rule</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {RISK_TIER_CATALOG.map((row) => (
                <TableRow key={row.tier}>
                  <TableCell>
                    <RiskTierBadge tier={row.tier} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <div className="font-bold text-ink">{row.autonomy}</div>
                    <div className="text-ink-faint">{row.scope}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.approval}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>

      {/* Workflow Approval Queue */}
      <Panel
        title="Workflow Approval & Separation-of-Duties Queue"
        description="Workers and requesting principals cannot self-approve work contracts or R2/R3 promotions."
        actions={<ProvenanceBadge kind="persisted" />}
      >
        <Table scrollLabel="Governance workflow approval queue" density="compact">
          <TableHead>
            <TableRow>
              <TableHeader>Workflow Instance</TableHeader>
              <TableHeader>Resource</TableHeader>
              <TableHeader>Current State</TableHeader>
              <TableHeader>Revision</TableHeader>
              <TableHeader>Status</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {approvals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="font-mono text-xs text-ink-soft">
                  No pending governance workflow approvals in the current company queue.
                </TableCell>
              </TableRow>
            ) : (
              approvals.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs font-bold">Instance #{item.id}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.resource_model} #{item.resource_id}
                  </TableCell>
                  <TableCell className="font-mono text-xs uppercase">
                    {item.current_state}
                  </TableCell>
                  <TableCell className="font-mono text-xs">r{item.revision}</TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'completed' ? 'primary' : 'default'}>
                      {item.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>

      <RunApprovalPanel
        runs={(runsQuery.data ?? []) as never}
        onChanged={() => {
          void runsQuery.refetch();
          void approvalsQuery.refetch();
        }}
      />

      <EmergencyConfirmModal
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        title={pendingAction?.title ?? 'Confirm Governance Action'}
        consequence={
          pendingAction?.consequence ??
          'Privileged governance mutations require server confirmation before updating state.'
        }
        isPending={isSubmitting}
        errorAlert={actionError}
        onConfirm={handleConfirmGovernanceAction}
      />
    </MissionControlShell>
  );
}
