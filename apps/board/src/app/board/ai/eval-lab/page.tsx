'use client';

import Link from 'next/link';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@moonwitness/ui/components/table';
import {
  CheckIcon,
  DocumentIcon,
  JobsIcon,
  RefreshIcon,
  SecurityIcon,
  SparkleIcon,
} from '@moonwitness/ui/icons';
import { useAiEvalSummary, useAiMemory } from '@/components/ai/ai-api';
import { AgiTelemetryPanel } from '@/components/ai/agi-telemetry-panel';
import { MissionControlShell, ProvenanceBadge } from '@/components/ai/mission-control-chrome';
import {
  NO_DATA,
  countPassedGates,
  formatCount,
  formatRate,
  toAblationArmViews,
  toCapabilityGateViews,
  totalSafetyRegressions,
} from './eval-results';

export default function AiEvalLabPage() {
  const evalQuery = useAiEvalSummary();
  const memoryQuery = useAiMemory();

  const summary = evalQuery.data;
  const candidates = memoryQuery.data?.candidates ?? [];
  const skills = memoryQuery.data?.skills ?? [];

  // The API summary is the only live input. Every displayed verdict, count and
  // rate comes from it; absent or malformed fields stay explicitly "no data".
  const gates = toCapabilityGateViews(summary);
  const ablationArms = toAblationArmViews(summary);
  const gateCount = countPassedGates(gates);
  const safetyRegressions = totalSafetyRegressions(gates);
  const hasLiveSummary = summary != null;

  return (
    <MissionControlShell
      activeRoute="/board/ai/eval-lab"
      title="Research & Evaluation Lab"
      accentTitle="Gates G0–G6 & Memory Ablation"
      breadcrumbLabel="Evaluation Lab"
      description="Read-only evaluation summary with explicit non-AGI engineering boundary. Values are shown only when the API supplies them; this page never runs a model or synthesizes gate results."
      errorAlert={
        evalQuery.isError
          ? evalQuery.error instanceof Error
            ? evalQuery.error.message
            : 'Unable to load evaluation lab summary.'
          : null
      }
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void evalQuery.refetch();
            void memoryQuery.refetch();
          }}
        >
          <RefreshIcon className="size-3.5" />
          Refresh Lab
        </Button>
      }
    >
      {/* Explicit Non-AGI Engineering Policy Notice (AI11.20) */}
      <div className="border-2 border-ink bg-paper-raised p-4 font-mono text-xs text-ink shadow-ink-sm">
        <strong className="font-display text-sm uppercase">
          Engineering Capability Policy (agiClaimed: {String(summary?.agiClaimed ?? false)})
        </strong>
        <p className="mt-1 text-ink-soft">
          Capability gates G0–G6 measure verifiable engineering reliability, evidence completeness,
          cost efficiency, and zero safety regressions on reproducible benchmark suites. Passing
          G0–G6 never claims general intelligence or autonomous self-modification.
        </p>
      </div>

      {/* Provenance notice: the Board is a view, not an evaluation runner. */}
      <div className="mt-4 border border-ink/20 bg-paper-raised p-4 font-mono text-xs text-ink-soft">
        {hasLiveSummary ? (
          <p>
            Source: <code>/api/ai/eval-summary</code>. This page only renders the summary returned
            by the API; it does not run the corpus. The summary carries a report SHA-256 and
            provenance, but the offline gate is marked synthetic (<code>realModelUsed: false</code>
            ), so these numbers are not proof of a production evaluation. Verify the offline gate
            with <code>pnpm --filter @moonwitness/ai-evaluation check:gates</code> and consult the
            operator runbook before treating them as release evidence.
          </p>
        ) : (
          <p>
            No live evaluation summary is available. Gate verdicts, safety-regression counts and
            ablation rates are intentionally shown as {NO_DATA}; no PASS, zero-regression or
            readiness claim is inferred from missing data.
          </p>
        )}
      </div>

      {/* Evaluation Lab KPIs */}
      <section
        aria-label="Evaluation lab benchmark metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricTile
          label="Capability Gates Passed"
          value={
            gateCount === null
              ? NO_DATA
              : `${formatCount(gateCount.passed)} / ${formatCount(gateCount.total)}`
          }
          detail={
            hasLiveSummary
              ? 'Gate verdicts reported by the API summary'
              : 'Waiting for live gate verdicts — none assumed'
          }
          accent="green"
          icon={<CheckIcon className="size-5" />}
        />
        <MetricTile
          label="Safety Regressions"
          value={formatCount(safetyRegressions)}
          detail={
            hasLiveSummary
              ? 'Sum of reported gate safety regressions'
              : 'Unavailable without live evaluation data'
          }
          accent="magenta"
          icon={<SecurityIcon className="size-5" />}
        />
        <MetricTile
          label="Memory Candidates"
          value={memoryQuery.isLoading ? NO_DATA : formatCount(candidates.length)}
          detail="Separated from K0–K9 knowledge tables"
          accent="cyan"
          icon={<DocumentIcon className="size-5" />}
        />
        <MetricTile
          label="Governed Skill Versions"
          value={memoryQuery.isLoading ? NO_DATA : formatCount(skills.length)}
          detail="Promoted only after ablation pass"
          accent="yellow"
          icon={<JobsIcon className="size-5" />}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* G0-G6 Capability Gates Table */}
        <Panel
          title="Capability Gates G0–G6 Scorecard"
          description="Gate definitions are static; verdicts and regression counts appear only when supplied by the live API summary."
          actions={
            <div className="flex items-center gap-1.5">
              <ProvenanceBadge kind="derived" />
            </div>
          }
        >
          {evalQuery.isLoading ? (
            <Skeleton className="h-44 w-full bg-ink/10" />
          ) : (
            <Table scrollLabel="Capability gates G0 through G6 scorecard" density="compact">
              <TableHead>
                <TableRow>
                  <TableHeader>Gate</TableHeader>
                  <TableHeader>Capability Stage &amp; Criterion</TableHeader>
                  <TableHeader>Safety Regressions</TableHeader>
                  <TableHeader>Status</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {gates.map((gate) => (
                  <TableRow key={gate.gate}>
                    <TableCell className="font-mono text-xs font-bold">{gate.gate}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <div className="font-bold text-ink">{gate.label}</div>
                      <div className="text-ink-faint">{gate.criterion}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatCount(gate.safetyRegressions)}
                    </TableCell>
                    <TableCell>
                      {gate.passed === null ? (
                        <Badge variant="default">NO DATA</Badge>
                      ) : (
                        <Badge variant={gate.passed ? 'primary' : 'destructive'}>
                          {gate.passed ? 'PASS' : 'BLOCKED'}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>

        {/* 4-Arm Memory & Skill Ablation Table */}
        <Panel
          title="4-Arm Memory & Skill Ablation Harness"
          description="Arm names and descriptions are static definitions. Rates are rendered only when the API returns validated values."
          actions={
            <div className="flex items-center gap-1.5">
              <SparkleIcon className="size-4" />
              <ProvenanceBadge kind="ephemeral" />
            </div>
          }
        >
          <Table scrollLabel="Four-arm memory ablation results" density="compact">
            <TableHead>
              <TableRow>
                <TableHeader>Ablation Arm</TableHeader>
                <TableHeader>Description</TableHeader>
                <TableHeader>Pass Rate</TableHeader>
                <TableHeader>Harm Rate</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {ablationArms.map((row) => (
                <TableRow key={row.arm}>
                  <TableCell className="font-mono text-xs font-bold">{row.arm}</TableCell>
                  <TableCell className="font-mono text-xs text-ink-soft">
                    {row.description}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatRate(row.passRate)}</TableCell>
                  <TableCell className="font-mono text-xs">{formatRate(row.harmRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink/15 pt-3 font-mono text-xs">
            <span className="text-ink-faint">
              K0–K9 Canonical Knowledge tables remain 100% read-only to AI memory candidates.
            </span>
            <Link href="/board/ai/continuity" className="underline">
              Inspect Evaluation Artifacts →
            </Link>
          </div>
        </Panel>
      </div>

      <AgiTelemetryPanel />
    </MissionControlShell>
  );
}
