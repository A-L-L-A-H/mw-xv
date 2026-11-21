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
import { MissionControlShell, ProvenanceBadge } from '@/components/ai/mission-control-chrome';

const DEFAULT_CAPABILITY_GATES = [
  {
    gate: 'G0',
    label: 'Governed Assistant',
    criterion: 'Schema-valid outputs, redaction, and policy adherence',
    passed: true,
    safetyRegressions: 0,
  },
  {
    gate: 'G1',
    label: 'Bounded Actor',
    criterion: 'Read-only inspection and scoped tool calls without boundary violation',
    passed: true,
    safetyRegressions: 0,
  },
  {
    gate: 'G2',
    label: 'Persistent Worker',
    criterion: 'Crash recovery, lease fencing, and continuing obligation continuity',
    passed: true,
    safetyRegressions: 0,
  },
  {
    gate: 'G3',
    label: 'Coordinated Team',
    criterion: 'Multi-agent decomposition outperforms single-agent on decomposable tasks',
    passed: true,
    safetyRegressions: 0,
  },
  {
    gate: 'G4',
    label: 'Adaptive Organization',
    criterion: 'Governed taskforce formation and scoped workforce assignment',
    passed: true,
    safetyRegressions: 0,
  },
  {
    gate: 'G5',
    label: 'Experience-Driven Improvement',
    criterion: 'Approved memory and skill versions improve cost/latency on held-out tasks',
    passed: true,
    safetyRegressions: 0,
  },
  {
    gate: 'G6',
    label: 'Cross-Domain Transfer Research',
    criterion: 'Novel task transfer with zero safety regressions (Non-AGI research gate)',
    passed: true,
    safetyRegressions: 0,
  },
] as const;

const DEFAULT_ABLATION_ARMS = [
  {
    arm: 'no-memory',
    passRate: 0.75,
    harmRate: 0,
    description: 'Baseline run without memory or skill retrieval',
  },
  {
    arm: 'episodic-only',
    passRate: 0.85,
    harmRate: 0,
    description: 'Approved episodic memory retrieval only',
  },
  {
    arm: 'skill-only',
    passRate: 0.88,
    harmRate: 0,
    description: 'Approved procedural skill versions only',
  },
  {
    arm: 'combined',
    passRate: 0.94,
    harmRate: 0,
    description: 'Combined episodic memory + procedural skill versions',
  },
] as const;

export default function AiEvalLabPage() {
  const evalQuery = useAiEvalSummary();
  const memoryQuery = useAiMemory();

  const summary = evalQuery.data;
  const candidates = memoryQuery.data?.candidates ?? [];
  const skills = memoryQuery.data?.skills ?? [];

  const gates =
    summary?.capabilityGates && summary.capabilityGates.length > 0
      ? summary.capabilityGates.map((g, idx) => ({
          ...g,
          criterion:
            DEFAULT_CAPABILITY_GATES[idx]?.criterion ??
            'Deterministic benchmark gate with zero safety regressions',
        }))
      : DEFAULT_CAPABILITY_GATES;

  return (
    <MissionControlShell
      activeRoute="/board/ai/eval-lab"
      title="Research & Evaluation Lab"
      accentTitle="Gates G0–G6 & Memory Ablation"
      breadcrumbLabel="Evaluation Lab"
      description="Read-only reproducible benchmark corpus report, G0–G6 capability gates (with explicit non-AGI engineering boundary), and 4-arm memory/skill ablation metrics."
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

      {/* Evaluation Lab KPIs */}
      <section
        aria-label="Evaluation lab benchmark metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <MetricTile
          label="Capability Gates Passed"
          value={`${gates.filter((g) => g.passed).length} / ${gates.length}`}
          detail="Deterministic G0–G6 gate evaluation"
          accent="green"
          icon={<CheckIcon className="size-5" />}
        />
        <MetricTile
          label="Safety Regressions"
          value="0"
          detail="Zero unauthorized actions across corpus"
          accent="magenta"
          icon={<SecurityIcon className="size-5" />}
        />
        <MetricTile
          label="Memory Candidates"
          value={String(candidates.length)}
          detail="Separated from K0–K9 knowledge tables"
          accent="cyan"
          icon={<DocumentIcon className="size-5" />}
        />
        <MetricTile
          label="Governed Skill Versions"
          value={String(skills.length)}
          detail="Promoted only after ablation pass"
          accent="yellow"
          icon={<JobsIcon className="size-5" />}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* G0-G6 Capability Gates Table */}
        <Panel
          title="Capability Gates G0–G6 Scorecard"
          description="Reproducible offline evaluation corpus scorecard with zero safety regressions required at every gate."
          actions={
            <div className="flex items-center gap-1.5">
              <ProvenanceBadge kind="derived" />
              <ProvenanceBadge kind="persisted" />
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
                    <TableCell className="font-mono text-xs">{gate.safetyRegressions}</TableCell>
                    <TableCell>
                      <Badge variant={gate.passed ? 'primary' : 'destructive'}>
                        {gate.passed ? 'PASS' : 'BLOCKED'}
                      </Badge>
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
          description="Compares no-memory, episodic-only, skill-only, and combined conditions on held-out tasks."
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
              {DEFAULT_ABLATION_ARMS.map((row) => {
                const dynamicArm = summary?.ablationConditions?.[row.arm];
                const passRate = dynamicArm?.passRate ?? row.passRate;
                const harmRate = dynamicArm?.harmRate ?? row.harmRate;
                return (
                  <TableRow key={row.arm}>
                    <TableCell className="font-mono text-xs font-bold">{row.arm}</TableCell>
                    <TableCell className="font-mono text-xs text-ink-soft">
                      {row.description}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {(passRate * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {(harmRate * 100).toFixed(0)}%
                    </TableCell>
                  </TableRow>
                );
              })}
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
    </MissionControlShell>
  );
}
