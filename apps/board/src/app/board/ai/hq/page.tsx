'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { CharacterDisplay } from '@moonwitness/ui/components/character-stage';
import { FilterFacetBar, type FilterFacet } from '@moonwitness/ui/components/filter-facet-bar';
import { Input } from '@moonwitness/ui/components/input';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { SpeechBubble } from '@moonwitness/ui/components/speech-bubble';
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
  CompanyIcon,
  DocumentIcon,
  RefreshIcon,
  SecurityIcon,
  UsersIcon,
} from '@moonwitness/ui/icons';
import {
  useAiAgents,
  useAiObligations,
  useAiRuns,
  useAiWorkContracts,
} from '@/components/ai/ai-api';
import { MissionControlShell, ProvenanceBadge } from '@/components/ai/mission-control-chrome';

export default function AiCompanyHqPage() {
  const agentsQuery = useAiAgents();
  const contractsQuery = useAiWorkContracts();
  const runsQuery = useAiRuns();
  const obligationsQuery = useAiObligations();

  const [searchText, setSearchText] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);

  const agents = agentsQuery.data ?? [];
  const contracts = contractsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const obligations = obligationsQuery.data ?? [];

  const searchNorm = searchText.trim().toLowerCase();
  const filteredAgents = agents.filter((agent) => {
    if (roleFilter !== 'all' && agent.role_template !== roleFilter) return false;
    if (statusFilter !== 'all' && agent.status !== statusFilter) return false;
    if (!searchNorm) return true;
    const label = `${agent.name ?? ''} ${agent.code} ${agent.role_template}`.toLowerCase();
    return label.includes(searchNorm);
  });

  const activeAgent =
    filteredAgents.find((agent) => agent.id === selectedAgentId) ?? filteredAgents[0] ?? null;

  const activeAgentsCount = agents.filter((a) => a.status === 'active').length;
  const acceptedContractsCount = contracts.filter((c) => c.status === 'accepted').length;
  const inFlightRunsCount = runs.filter(
    (r) => r.status === 'running' || r.status === 'pending'
  ).length;
  const dueObligationsCount = obligations.filter(
    (o) => o.status === 'open' || o.status === 'reverification_due'
  ).length;

  const activeFacets: FilterFacet[] = [
    ...(searchText.trim() ? [{ id: 'search', label: 'Search', value: searchText.trim() }] : []),
    ...(roleFilter !== 'all' ? [{ id: 'role', label: 'Role', value: roleFilter }] : []),
    ...(statusFilter !== 'all' ? [{ id: 'status', label: 'Status', value: statusFilter }] : []),
  ];

  const kuroExpression = agentsQuery.isError
    ? 'surprised'
    : inFlightRunsCount > 0
      ? 'determined'
      : dueObligationsCount > 0
        ? 'curious'
        : 'happy';

  const handleRefreshAll = () => {
    void agentsQuery.refetch();
    void contractsQuery.refetch();
    void runsQuery.refetch();
    void obligationsQuery.refetch();
  };

  return (
    <MissionControlShell
      activeRoute="/board/ai/hq"
      title="Company HQ"
      accentTitle="& Agent Registry"
      breadcrumbLabel="Company HQ"
      description="Organization overview, governed service-principal agents, reporting hierarchy, and full drill-down into work contracts, durable runs, and evidence."
      errorAlert={
        agentsQuery.isError
          ? agentsQuery.error instanceof Error
            ? agentsQuery.error.message
            : 'Unable to load company AI agent registry.'
          : null
      }
      actions={
        <Button type="button" variant="outline" size="sm" onClick={handleRefreshAll}>
          <RefreshIcon className="size-3.5" />
          Refresh HQ
        </Button>
      }
    >
      {/* KPI Overview Tiles with Provenance Badges */}
      <section
        aria-label="Company AI organization metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricTile
          label="Registered AI Agents"
          value={String(agents.length)}
          detail={`${activeAgentsCount} active service principals`}
          accent="magenta"
          icon={<UsersIcon className="size-5" />}
        />
        <MetricTile
          label="Work Contracts"
          value={String(contracts.length)}
          detail={`${acceptedContractsCount} accepted via PCW review`}
          accent="cyan"
          icon={<CompanyIcon className="size-5" />}
        />
        <MetricTile
          label="Durable Agent Runs"
          value={String(runs.length)}
          detail={`${inFlightRunsCount} active or queued runs`}
          accent="yellow"
          icon={<ActivityIcon className="size-5" />}
        />
        <MetricTile
          label="Open Obligations"
          value={String(dueObligationsCount)}
          detail={`${obligations.length} total continuity records`}
          accent="green"
          icon={<DocumentIcon className="size-5" />}
        />
      </section>

      {/* Multi-Facet Filter Toolbar */}
      <Toolbar
        aria-label="Filter AI agents"
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="hq-agent-search">
              Search AI agents
            </label>
            <Input
              id="hq-agent-search"
              type="search"
              data-filter="agent-search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Filter agents by code, name, or role…"
              className="w-full sm:w-64"
            />
            <label className="sr-only" htmlFor="hq-role-filter">
              Filter by role template
            </label>
            <SelectField
              id="hq-role-filter"
              data-filter="role-template"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="all">All Role Templates</option>
              <option value="planner">Planner</option>
              <option value="manager">Manager</option>
              <option value="researcher">Researcher</option>
              <option value="builder">Builder</option>
              <option value="reviewer">Reviewer</option>
            </SelectField>
            <label className="sr-only" htmlFor="hq-status-filter">
              Filter by lifecycle status
            </label>
            <SelectField
              id="hq-status-filter"
              data-filter="agent-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All Lifecycle States</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="paused">Paused</option>
              <option value="disabled">Disabled</option>
              <option value="retired">Retired</option>
            </SelectField>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/board/ai/mission-control"
              className="inline-flex items-center gap-1.5 border-2 border-ink bg-paper px-3 py-1.5 font-mono text-xs uppercase hover:bg-ink/10"
            >
              Task Graph →
            </Link>
            <Link
              href="/board/ai/operations"
              className="inline-flex items-center gap-1.5 border-2 border-ink bg-paper px-3 py-1.5 font-mono text-xs uppercase hover:bg-ink/10"
            >
              Live Runs →
            </Link>
          </div>
        }
      />

      <FilterFacetBar
        facets={activeFacets}
        onFacetRemove={(facetId) => {
          if (facetId === 'search') setSearchText('');
          else if (facetId === 'role') setRoleFilter('all');
          else if (facetId === 'status') setStatusFilter('all');
        }}
      >
        {activeFacets.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setSearchText('');
              setRoleFilter('all');
              setStatusFilter('all');
            }}
          >
            Clear all
          </Button>
        ) : null}
      </FilterFacetBar>

      <div className="flex flex-col gap-3 border-2 border-ink bg-paper p-3 shadow-ink-sm sm:flex-row sm:items-center">
        <CharacterDisplay characterId="kuro-signal" expression={kuroExpression} size="sm" />
        <SpeechBubble
          speaker="Kuro Signal · AI Ops Companion"
          tail="left"
          variant={dueObligationsCount > 0 ? 'shout' : 'speech'}
        >
          {agentsQuery.isError
            ? 'Registry telemetry interrupted. Retry HQ sync to inspect active service principals.'
            : `${activeAgentsCount} active service principal(s), ${inFlightRunsCount} in-flight run(s), and ${dueObligationsCount} open obligation(s).`}
        </SpeechBubble>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Agent Registry Table */}
        <Panel
          title="Governed Agent Registry"
          description="Service-principal agents scoped to the active company context."
          actions={<ProvenanceBadge kind="persisted" />}
        >
          {agentsQuery.isLoading ? (
            <Skeleton className="h-40 w-full bg-ink/10" />
          ) : (
            <Table scrollLabel="Governed AI agents table" density="compact">
              <TableHead>
                <TableRow>
                  <TableHeader>Code &amp; Name</TableHeader>
                  <TableHeader>Role Template</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Provenance</TableHeader>
                  <TableHeader>Drill-Down</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredAgents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="font-mono text-xs text-ink-soft">
                      No AI agents match the current company or filter criteria. Use the drill-down
                      links to inspect Mission Control contracts or Governance grants.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAgents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell>
                        <div className="font-bold text-ink">
                          {agent.display_name ?? agent.name ?? agent.code}
                        </div>
                        <div className="font-mono text-xs text-ink-faint">{agent.code}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs uppercase">
                        {agent.role_template}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            agent.is_emergency_stopped
                              ? 'destructive'
                              : agent.status === 'active'
                                ? 'primary'
                                : 'default'
                          }
                        >
                          {agent.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ProvenanceBadge kind="persisted" />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedAgentId(agent.id)}
                          >
                            Inspect
                          </Button>
                          <Link
                            href={`/board/ai/mission-control?agent=${agent.id}`}
                            className="inline-flex items-center border-2 border-ink bg-paper px-2 py-1 font-mono text-xs uppercase hover:bg-ink/10"
                          >
                            Contracts
                          </Link>
                          <Link
                            href={`/board/ai/operations?agent=${agent.id}`}
                            className="inline-flex items-center border-2 border-ink bg-paper px-2 py-1 font-mono text-xs uppercase hover:bg-ink/10"
                          >
                            Runs
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

        {/* Agent Profile & Hierarchy Drill-Down Inspector */}
        <Panel
          title="Agent Profile & Hierarchy Drill-Down"
          description="Company → Team → Agent → Work Contract → Run → Evidence chain."
          actions={<ProvenanceBadge kind="derived" />}
        >
          {activeAgent ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-2 font-mono text-xs">
                <div className="border-b border-ink/15 pb-2">
                  <dt className="text-ink-faint uppercase">Display Name</dt>
                  <dd className="text-sm font-bold text-ink">
                    {activeAgent.display_name ?? activeAgent.name ?? activeAgent.code}
                  </dd>
                </div>
                <div className="border-b border-ink/15 pb-2">
                  <dt className="text-ink-faint uppercase">Agent Code</dt>
                  <dd className="text-ink">{activeAgent.code}</dd>
                </div>
                <div className="border-b border-ink/15 pb-2">
                  <dt className="text-ink-faint uppercase">Role Template</dt>
                  <dd className="uppercase text-ink">{activeAgent.role_template}</dd>
                </div>
                <div className="border-b border-ink/15 pb-2">
                  <dt className="text-ink-faint uppercase">Organization Binding</dt>
                  <dd className="text-ink">
                    Dept #{activeAgent.department_id ?? '—'} · Team #{activeAgent.team_id ?? '—'} ·
                    Reports to #{activeAgent.reports_to_agent_id ?? 'Root'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint uppercase">Telemetry Stream</dt>
                  <dd className="mt-1 flex items-center gap-2">
                    <ProvenanceBadge kind="ephemeral" />
                    <span>Heartbeat idle / ready</span>
                  </dd>
                </div>
              </dl>

              <div className="space-y-2 border-t-2 border-ink pt-3">
                <p className="font-mono text-xs uppercase text-ink-faint">Full Drill-Down Chain</p>
                <ul className="space-y-1.5 font-mono text-xs">
                  <li>
                    <Link
                      href={`/board/ai/mission-control?agent=${activeAgent.id}`}
                      className="inline-flex items-center gap-1.5 text-ink underline hover:text-magenta"
                    >
                      1. Assigned Work Contracts (
                      {contracts.filter((c) => c.assigned_agent_id === activeAgent.id).length}) →
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={`/board/ai/operations?agent=${activeAgent.id}`}
                      className="inline-flex items-center gap-1.5 text-ink underline hover:text-magenta"
                    >
                      2. Durable Agent Runs (
                      {runs.filter((r) => r.agent_id === activeAgent.id).length}) →
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={`/board/ai/continuity?agent=${activeAgent.id}`}
                      className="inline-flex items-center gap-1.5 text-ink underline hover:text-magenta"
                    >
                      3. SHA-256 Evidence &amp; Obligations →
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={`/board/ai/governance?agent=${activeAgent.id}`}
                      className="inline-flex items-center gap-1.5 text-ink underline hover:text-magenta"
                    >
                      <SecurityIcon className="size-3.5" />
                      4. Scoped Capability Grants →
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-3 font-mono text-xs text-ink-soft">
              <p>
                Select an agent or follow the canonical drill-down chain across the company
                workforce:
              </p>
              <ul className="space-y-1.5">
                <li>
                  <Link href="/board/ai/mission-control" className="underline">
                    Inspect Work Contracts &amp; Task Graph →
                  </Link>
                </li>
                <li>
                  <Link href="/board/ai/operations" className="underline">
                    Inspect Live Operations &amp; Run Timeline →
                  </Link>
                </li>
                <li>
                  <Link href="/board/ai/continuity" className="underline">
                    Inspect Evidence Artifacts &amp; Obligations →
                  </Link>
                </li>
                <li>
                  <Link href="/board/ai/governance" className="underline">
                    Inspect Capability Grants &amp; Risk Tiers →
                  </Link>
                </li>
              </ul>
            </div>
          )}
        </Panel>
      </div>
    </MissionControlShell>
  );
}
