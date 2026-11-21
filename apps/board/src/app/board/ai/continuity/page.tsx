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
  CheckIcon,
  ClockIcon,
  DocumentIcon,
  HistoryIcon,
  RefreshIcon,
  SecurityIcon,
} from '@moonwitness/ui/icons';
import { useAiArtifacts, useAiObligations, useAiWorkContracts } from '@/components/ai/ai-api';
import { MissionControlShell, ProvenanceBadge } from '@/components/ai/mission-control-chrome';

export default function AiContinuityPage() {
  const artifactsQuery = useAiArtifacts();
  const obligationsQuery = useAiObligations();
  const contractsQuery = useAiWorkContracts();

  const [searchQuery, setSearchQuery] = useState('');
  const [artifactStatusFilter, setArtifactStatusFilter] = useState('all');
  const [obligationStatusFilter, setObligationStatusFilter] = useState('all');
  const [selectedArtifactId, setSelectedArtifactId] = useState<number | null>(null);

  const artifacts = artifactsQuery.data ?? [];
  const obligations = obligationsQuery.data ?? [];
  const contracts = contractsQuery.data ?? [];

  const searchNorm = searchQuery.trim().toLowerCase();
  const filteredArtifacts = artifacts.filter((artifact) => {
    if (artifactStatusFilter !== 'all' && artifact.verification_status !== artifactStatusFilter) {
      return false;
    }
    if (!searchNorm) return true;
    const hay =
      `${artifact.storage_key} ${artifact.sha256} ${artifact.artifact_kind}`.toLowerCase();
    return hay.includes(searchNorm);
  });

  const filteredObligations = obligations.filter((obligation) => {
    if (obligationStatusFilter !== 'all' && obligation.status !== obligationStatusFilter) {
      return false;
    }
    if (!searchNorm) return true;
    const hay =
      `${obligation.code} ${obligation.required_evidence} ${obligation.trigger_kind} ${obligation.status}`.toLowerCase();
    return hay.includes(searchNorm);
  });

  const activeArtifact =
    filteredArtifacts.find((a) => a.id === selectedArtifactId) ?? filteredArtifacts[0] ?? null;

  return (
    <MissionControlShell
      activeRoute="/board/ai/continuity"
      title="Evidence & Continuity"
      accentTitle="SHA-256 & Obligation Ledger"
      breadcrumbLabel="Evidence & Continuity"
      description="Proof-Carrying Work (PCW) artifact manifest inspector, cryptographic SHA-256 digest verification, and continuing obligation re-verification timeline."
      errorAlert={
        artifactsQuery.isError
          ? artifactsQuery.error instanceof Error
            ? artifactsQuery.error.message
            : 'Unable to load evidence artifacts.'
          : null
      }
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void artifactsQuery.refetch();
            void obligationsQuery.refetch();
            void contractsQuery.refetch();
          }}
        >
          <RefreshIcon className="size-3.5" />
          Refresh Ledger
        </Button>
      }
    >
      {/* Evidence & Continuity Metrics */}
      <section
        aria-label="Evidence and continuity metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricTile
          label="Evidence Artifacts"
          value={String(artifacts.length)}
          detail="Persisted SHA-256 artifact manifests"
          accent="magenta"
          icon={<DocumentIcon className="size-5" />}
        />
        <MetricTile
          label="Accepted Evidence"
          value={String(artifacts.filter((a) => a.verification_status === 'accepted').length)}
          detail="Derived independent reviewer sign-off"
          accent="green"
          icon={<CheckIcon className="size-5" />}
        />
        <MetricTile
          label="Continuing Obligations"
          value={String(obligations.length)}
          detail="Persisted post-acceptance obligations"
          accent="cyan"
          icon={<HistoryIcon className="size-5" />}
        />
        <MetricTile
          label="Re-verification Due"
          value={String(
            obligations.filter((o) => o.status === 'open' || o.status === 'reverification_due')
              .length
          )}
          detail="Ephemeral trigger watch status"
          accent="yellow"
          icon={<ClockIcon className="size-5" />}
        />
      </section>

      {/* Filter Toolbar */}
      <Toolbar
        aria-label="Filter evidence artifacts and obligations"
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="continuity-search">
              Search artifacts and obligations
            </label>
            <Input
              id="continuity-search"
              type="search"
              data-filter="continuity-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter by SHA-256 digest, storage key, or obligation code…"
              className="w-full sm:w-72"
            />

            <label className="sr-only" htmlFor="artifact-status-filter">
              Filter by artifact verification status
            </label>
            <SelectField
              id="artifact-status-filter"
              data-filter="artifact-status"
              value={artifactStatusFilter}
              onChange={(event) => setArtifactStatusFilter(event.target.value)}
            >
              <option value="all">All Evidence Statuses</option>
              <option value="proposed">Proposed</option>
              <option value="produced">Produced</option>
              <option value="checked">Checked</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="superseded">Superseded</option>
            </SelectField>

            <label className="sr-only" htmlFor="obligation-status-filter">
              Filter by obligation status
            </label>
            <SelectField
              id="obligation-status-filter"
              data-filter="obligation-status"
              value={obligationStatusFilter}
              onChange={(event) => setObligationStatusFilter(event.target.value)}
            >
              <option value="all">All Obligation States</option>
              <option value="open">Open</option>
              <option value="reverification_due">Re-verification Due</option>
              <option value="satisfied">Satisfied</option>
              <option value="superseded">Superseded</option>
              <option value="retired">Retired</option>
            </SelectField>
          </div>
        }
        actions={
          <Link
            href="/board/ai/mission-control"
            className="inline-flex items-center border-2 border-ink bg-paper px-3 py-1.5 font-mono text-xs uppercase hover:bg-ink/10"
          >
            Work Contracts ({contracts.length}) →
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* SHA-256 Evidence Artifact Table */}
        <Panel
          title="Cryptographic Evidence Artifact Manifests"
          description="Immutable storage keys verified against AttachmentStorage SHA-256 digests."
          actions={<ProvenanceBadge kind="persisted" />}
        >
          {artifactsQuery.isLoading ? (
            <Skeleton className="h-40 w-full bg-ink/10" />
          ) : (
            <Table scrollLabel="Evidence artifact manifests table" density="compact">
              <TableHead>
                <TableRow>
                  <TableHeader>Storage Key &amp; Kind</TableHeader>
                  <TableHeader>SHA-256 Digest</TableHeader>
                  <TableHeader>Contract &amp; Run</TableHeader>
                  <TableHeader>Verification</TableHeader>
                  <TableHeader>Provenance</TableHeader>
                  <TableHeader>Inspect</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredArtifacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="font-mono text-xs text-ink-soft">
                      No evidence artifacts recorded yet for this company scope.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredArtifacts.map((artifact) => (
                    <TableRow key={artifact.id}>
                      <TableCell className="font-mono text-xs">
                        <div className="font-bold text-ink">{artifact.artifact_kind}</div>
                        <div className="break-all text-ink-faint">{artifact.storage_key}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <span className="break-all" title={artifact.sha256}>
                          {artifact.sha256.slice(0, 16)}…
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div>Contract #{artifact.work_contract_id}</div>
                        <div className="text-ink-faint">
                          Run #{artifact.agent_run_id ?? '—'} · {artifact.size_bytes} B
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            artifact.verification_status === 'accepted'
                              ? 'primary'
                              : artifact.verification_status === 'rejected'
                                ? 'destructive'
                                : 'default'
                          }
                        >
                          {artifact.verification_status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ProvenanceBadge kind="persisted" />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedArtifactId(artifact.id)}
                        >
                          Inspect
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Panel>

        {/* Source & Evidence Digest Inspector */}
        <Panel
          title="Accepted Evidence & Source Inspector"
          description="Cryptographic provenance and source commit bindings for auditability."
          actions={<SecurityIcon className="size-4" />}
        >
          {activeArtifact ? (
            <dl className="grid grid-cols-1 gap-2.5 font-mono text-xs">
              <div className="border-b border-ink/15 pb-2">
                <dt className="text-ink-faint uppercase">Storage Key (UUID)</dt>
                <dd className="break-all font-bold text-ink">{activeArtifact.storage_key}</dd>
              </div>
              <div className="border-b border-ink/15 pb-2">
                <dt className="text-ink-faint uppercase">Full SHA-256 Digest</dt>
                <dd className="break-all text-ink">{activeArtifact.sha256}</dd>
              </div>
              <div className="border-b border-ink/15 pb-2">
                <dt className="text-ink-faint uppercase">Artifact Kind &amp; MIME</dt>
                <dd className="text-ink">
                  {activeArtifact.artifact_kind} · {activeArtifact.mime_type} (
                  {activeArtifact.size_bytes} bytes)
                </dd>
              </div>
              <div className="border-b border-ink/15 pb-2">
                <dt className="text-ink-faint uppercase">Data Classification</dt>
                <dd className="text-ink">{activeArtifact.data_classification}</dd>
              </div>
              <div>
                <dt className="text-ink-faint uppercase">Source Commit / Release Ref</dt>
                <dd className="break-all text-ink">
                  {activeArtifact.source_sha ??
                    activeArtifact.knowledge_release_ref ??
                    'verified-workspace-tree'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="font-mono text-xs text-ink-soft">
              Select an evidence artifact row to inspect its 64-character SHA-256 digest and
              independent review timestamp.
            </p>
          )}
        </Panel>
      </div>

      {/* Continuing Obligation Timeline Ledger */}
      <Panel
        title="Continuing Obligation & Re-verification Timeline"
        description="Accepted contracts emit continuing obligations that reopen when watched code, sources, policies, or timers change."
        actions={
          <div className="flex items-center gap-1.5">
            <ProvenanceBadge kind="persisted" />
            <ProvenanceBadge kind="derived" />
            <ProvenanceBadge kind="ephemeral" />
          </div>
        }
      >
        {obligationsQuery.isLoading ? (
          <Skeleton className="h-36 w-full bg-ink/10" />
        ) : (
          <Table scrollLabel="Continuing obligations timeline table" density="compact">
            <TableHead>
              <TableRow>
                <TableHeader>Obligation Code</TableHeader>
                <TableHeader>Origin Contract</TableHeader>
                <TableHeader>Trigger Kind</TableHeader>
                <TableHeader>Required Evidence</TableHeader>
                <TableHeader>Watched Scope</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Provenance</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredObligations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="font-mono text-xs text-ink-soft">
                    No continuing obligations recorded for the current filter selection.
                  </TableCell>
                </TableRow>
              ) : (
                filteredObligations.map((obligation) => (
                  <TableRow key={obligation.id}>
                    <TableCell className="font-mono text-xs font-bold text-ink">
                      {obligation.code}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/board/ai/mission-control?contract=${obligation.origin_contract_id}`}
                        className="underline"
                      >
                        Contract #{obligation.origin_contract_id}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs uppercase">
                      {obligation.trigger_kind}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {obligation.required_evidence}
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {obligation.scope_json}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          obligation.status === 'satisfied'
                            ? 'primary'
                            : obligation.status === 'reverification_due'
                              ? 'destructive'
                              : 'default'
                        }
                      >
                        {obligation.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ProvenanceBadge kind="persisted" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Panel>
    </MissionControlShell>
  );
}
