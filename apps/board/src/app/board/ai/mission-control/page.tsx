'use client';

import { useState } from 'react';
import Link from 'next/link';
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
  CheckIcon,
  DocumentIcon,
  RefreshIcon,
  SparkleIcon,
  WorkflowIcon,
} from '@moonwitness/ui/icons';
import { useAiAgents, useAiArtifacts, useAiRuns, useAiWorkContracts } from '@/components/ai/ai-api';
import {
  MissionControlShell,
  ProvenanceBadge,
  RiskTierBadge,
} from '@/components/ai/mission-control-chrome';
import { InteractiveSessionPanel } from '@/components/ai/interactive-session-panel';
import { BoardTelemetryPanel } from '@/components/ai/telemetry-panels';
import { RunScopePanel } from '../_components/cloud-agent-panels';

export default function AiMissionControlPage() {
  const contractsQuery = useAiWorkContracts();
  const agentsQuery = useAiAgents();
  const runsQuery = useAiRuns();
  const artifactsQuery = useAiArtifacts();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [classificationFilter, setClassificationFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);

  const contracts = contractsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const artifacts = artifactsQuery.data ?? [];

  const agentMap = new Map(agents.map((a) => [a.id, a.display_name ?? a.name ?? a.code]));

  const searchNorm = searchQuery.trim().toLowerCase();
  const filteredContracts = contracts.filter((contract) => {
    if (statusFilter !== 'all' && contract.status !== statusFilter) return false;
    if (riskFilter !== 'all' && contract.risk_tier !== riskFilter) return false;
    if (classificationFilter !== 'all' && contract.data_classification !== classificationFilter) {
      return false;
    }
    if (agentFilter !== 'all' && String(contract.assigned_agent_id ?? '') !== agentFilter) {
      return false;
    }
    if (!searchNorm) return true;
    const hay = `${contract.code} ${contract.title} ${contract.objective}`.toLowerCase();
    return hay.includes(searchNorm);
  });

  const activeContract =
    filteredContracts.find((c) => c.id === selectedContractId) ?? filteredContracts[0] ?? null;

  const contractRuns = activeContract
    ? runs.filter((r) => r.work_contract_id === activeContract.id)
    : [];

  const contractArtifacts = activeContract
    ? artifacts.filter((a) => a.work_contract_id === activeContract.id)
    : [];

  return (
    <MissionControlShell
      activeRoute="/board/ai/mission-control"
      title="Mission Control"
      accentTitle="Task & PCW Graph"
      breadcrumbLabel="Mission Control"
      description="Project and work contract dependency graph, acceptance criteria status, multi-facet filtering, and accessible keyboard navigation."
      errorAlert={
        contractsQuery.isError
          ? contractsQuery.error instanceof Error
            ? contractsQuery.error.message
            : 'Unable to load work contracts.'
          : null
      }
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void contractsQuery.refetch();
            void runsQuery.refetch();
            void artifactsQuery.refetch();
          }}
        >
          <RefreshIcon className="size-3.5" />
          Refresh Graph
        </Button>
      }
    >
      {/* Multi-Facet Provenance Metrics */}
      <section
        aria-label="Mission Control contract rollups"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricTile
          label="Total Work Contracts"
          value={String(contracts.length)}
          detail="Persisted ORM work contracts"
          accent="magenta"
          icon={<WorkflowIcon className="size-5" />}
        />
        <MetricTile
          label="Accepted (PCW Verified)"
          value={String(contracts.filter((c) => c.status === 'accepted').length)}
          detail="Derived independent review rollup"
          accent="green"
          icon={<CheckIcon className="size-5" />}
        />
        <MetricTile
          label="Running / In Review"
          value={String(
            contracts.filter((c) => c.status === 'running' || c.status === 'in_review').length
          )}
          detail="Ephemeral active worker leases"
          accent="cyan"
          icon={<ActivityIcon className="size-5" />}
        />
        <MetricTile
          label="Linked Evidence Bundles"
          value={String(artifacts.length)}
          detail="SHA-256 verified artifact manifests"
          accent="yellow"
          icon={<DocumentIcon className="size-5" />}
        />
      </section>

      {/* Multi-Facet Filter Bar (Company, Agent, Risk Tier, State, Classification, Search) */}
      <Toolbar
        aria-label="Multi-facet work contract filters"
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="mc-search">
              Search work contracts
            </label>
            <Input
              id="mc-search"
              type="search"
              data-filter="contract-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search contracts by code, title, objective…"
              className="w-full sm:w-60"
            />

            <label className="sr-only" htmlFor="mc-status-filter">
              Filter by contract status
            </label>
            <SelectField
              id="mc-status-filter"
              data-filter="contract-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All Contract States</option>
              <option value="draft">Draft</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="in_review">In Review</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
              <option value="failed">Failed</option>
            </SelectField>

            <label className="sr-only" htmlFor="mc-risk-filter">
              Filter by risk tier
            </label>
            <SelectField
              id="mc-risk-filter"
              data-filter="risk-tier"
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value)}
            >
              <option value="all">All Risk Tiers (R0–R4)</option>
              <option value="R0">R0 · Read-Only</option>
              <option value="R1">R1 · Local Scoped Write</option>
              <option value="R2">R2 · Branch / Service</option>
              <option value="R3">R3 · Human Approval</option>
              <option value="R4">R4 · Prohibited</option>
            </SelectField>

            <label className="sr-only" htmlFor="mc-classification-filter">
              Filter by data classification
            </label>
            <SelectField
              id="mc-classification-filter"
              data-filter="data-classification"
              value={classificationFilter}
              onChange={(event) => setClassificationFilter(event.target.value)}
            >
              <option value="all">All Classifications</option>
              <option value="local_only">local_only</option>
              <option value="cloud_eligible">cloud_eligible</option>
              <option value="restricted">restricted</option>
            </SelectField>

            <label className="sr-only" htmlFor="mc-agent-filter">
              Filter by assigned agent
            </label>
            <SelectField
              id="mc-agent-filter"
              data-filter="assigned-agent"
              value={agentFilter}
              onChange={(event) => setAgentFilter(event.target.value)}
            >
              <option value="all">All Assigned Agents</option>
              {agents.map((agent) => (
                <option key={agent.id} value={String(agent.id)}>
                  {agent.display_name ?? agent.name ?? agent.code}
                </option>
              ))}
            </SelectField>
          </div>
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setRiskFilter('all');
              setClassificationFilter('all');
              setAgentFilter('all');
            }}
          >
            Reset Filters
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Accessible Keyboard-Navigable Task Graph Table */}
        <Panel
          title="Work Contract & Delegation Graph (Keyboard Accessible)"
          description="Accessible tabular representation of parent/child work contracts, risk tiers, and state provenance."
          actions={
            <div className="flex items-center gap-1.5">
              <ProvenanceBadge kind="persisted" />
              <ProvenanceBadge kind="derived" />
              <ProvenanceBadge kind="ephemeral" />
            </div>
          }
        >
          {contractsQuery.isLoading ? (
            <Skeleton className="h-44 w-full bg-ink/10" />
          ) : (
            <Table scrollLabel="Mission Control work contracts table" density="compact">
              <TableHead>
                <TableRow>
                  <TableHeader>Contract</TableHeader>
                  <TableHeader>Agent &amp; Depth</TableHeader>
                  <TableHeader>Risk &amp; Class</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Provenance</TableHeader>
                  <TableHeader>Drill-Down</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredContracts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="font-mono text-xs text-ink-soft">
                      No work contracts match the active filter facets. Navigate to{' '}
                      <Link href="/board/ai/operations" className="underline">
                        Live Operations
                      </Link>{' '}
                      or{' '}
                      <Link href="/board/ai/continuity" className="underline">
                        Evidence &amp; Continuity
                      </Link>
                      .
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredContracts.map((contract) => (
                    <TableRow key={contract.id}>
                      <TableCell>
                        <div className="font-bold text-ink">{contract.title}</div>
                        <div className="font-mono text-xs text-ink-faint">{contract.code}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div>
                          {contract.assigned_agent_id
                            ? (agentMap.get(contract.assigned_agent_id) ??
                              `Agent #${contract.assigned_agent_id}`)
                            : 'Unassigned'}
                        </div>
                        <div className="text-ink-faint">
                          Depth L{contract.delegation_depth ?? 0}
                          {contract.parent_contract_id
                            ? ` · Parent #${contract.parent_contract_id}`
                            : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <RiskTierBadge tier={contract.risk_tier} />
                          <Badge className="font-mono text-[10px]">
                            {contract.data_classification}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            contract.status === 'accepted'
                              ? 'primary'
                              : contract.status === 'failed' || contract.status === 'rejected'
                                ? 'destructive'
                                : 'default'
                          }
                        >
                          {contract.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ProvenanceBadge
                          kind={
                            contract.status === 'running'
                              ? 'ephemeral'
                              : contract.status === 'accepted'
                                ? 'persisted'
                                : 'derived'
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedContractId(contract.id)}
                          >
                            Focus
                          </Button>
                          <Link
                            href={`/board/ai/operations?contract=${contract.id}`}
                            className="inline-flex items-center border-2 border-ink bg-paper px-2 py-1 font-mono text-xs uppercase hover:bg-ink/10"
                          >
                            Runs
                          </Link>
                          <Link
                            href={`/board/ai/continuity?contract=${contract.id}`}
                            className="inline-flex items-center border-2 border-ink bg-paper px-2 py-1 font-mono text-xs uppercase hover:bg-ink/10"
                          >
                            Evidence
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Panel>

        {/* Contract Acceptance Criteria & Evidence Inspector */}
        <Panel
          title="Proof-Carrying Work (PCW) Criteria Inspector"
          description="Acceptance criteria cannot be marked accepted without verified evidence and independent review."
          actions={<SparkleIcon className="size-4" />}
        >
          {activeContract ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-2 font-mono text-xs">
                <div className="border-b border-ink/15 pb-2">
                  <dt className="text-ink-faint uppercase">Selected Contract</dt>
                  <dd className="text-sm font-bold text-ink">
                    {activeContract.title} ({activeContract.code})
                  </dd>
                </div>
                <div className="border-b border-ink/15 pb-2">
                  <dt className="text-ink-faint uppercase">Objective</dt>
                  <dd className="text-ink">{activeContract.objective}</dd>
                </div>
                <div className="border-b border-ink/15 pb-2">
                  <dt className="text-ink-faint uppercase">Separation of Duties</dt>
                  <dd className="text-ink">
                    Worker #{activeContract.assigned_agent_id ?? '—'} · Reviewer #
                    {activeContract.reviewer_agent_id ?? 'Independent Required'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint uppercase">Linked Runs &amp; Artifacts</dt>
                  <dd className="text-ink">
                    {contractRuns.length} durable runs · {contractArtifacts.length} SHA-256
                    artifacts
                  </dd>
                </div>
              </dl>

              <div className="space-y-2 border-t-2 border-ink pt-3">
                <p className="font-mono text-xs uppercase text-ink-faint">
                  Acceptance Criteria ({activeContract.criteria?.length ?? 0})
                </p>
                {activeContract.criteria && activeContract.criteria.length > 0 ? (
                  <ul className="space-y-2 font-mono text-xs">
                    {activeContract.criteria.map((criterion) => (
                      <li
                        key={criterion.id}
                        className="flex items-center justify-between gap-2 border border-ink/20 bg-paper-raised p-2"
                      >
                        <div>
                          <div className="font-bold text-ink">{criterion.title}</div>
                          <div className="text-ink-faint">
                            {criterion.code} · {criterion.verification_method}
                          </div>
                        </div>
                        <Badge variant={criterion.status === 'accepted' ? 'primary' : 'default'}>
                          {criterion.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-mono text-xs text-ink-soft">
                    No acceptance criteria attached to this work contract yet.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-ink/15 pt-3">
                <Link
                  href={`/board/ai/operations?contract=${activeContract.id}`}
                  className="inline-flex items-center border-2 border-ink bg-paper px-2.5 py-1 font-mono text-xs uppercase hover:bg-ink/10"
                >
                  Inspect Run Timeline →
                </Link>
                <Link
                  href={`/board/ai/continuity?contract=${activeContract.id}`}
                  className="inline-flex items-center border-2 border-ink bg-paper px-2.5 py-1 font-mono text-xs uppercase hover:bg-ink/10"
                >
                  Inspect Evidence Digests →
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2 font-mono text-xs text-ink-soft">
              <p>Select a work contract to inspect its locked PCW acceptance criteria.</p>
              <ul className="space-y-1">
                <li>
                  <Link href="/board/ai/hq" className="underline">
                    Return to Company HQ →
                  </Link>
                </li>
                <li>
                  <Link href="/board/ai/continuity" className="underline">
                    Open Evidence &amp; Obligation Ledger →
                  </Link>
                </li>
              </ul>
            </div>
          )}
        </Panel>

        <RunScopePanel contract={activeContract} />
      </div>

      <InteractiveSessionPanel
        agents={agents}
        contracts={contracts}
        initialContractId={activeContract?.id}
      />

      <BoardTelemetryPanel />
    </MissionControlShell>
  );
}
