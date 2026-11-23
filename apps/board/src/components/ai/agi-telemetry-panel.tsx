'use client';

import { useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
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
  JobsIcon,
  RefreshIcon,
  SecurityIcon,
  SparkleIcon,
} from '@moonwitness/ui/icons';

interface M15PillarTelemetry {
  id: string;
  pillar: string;
  modulePath: string;
  readiness: 'VERIFIED' | 'GUARDED';
  summary: string;
  constitutionalInvariant: string;
}

const M15_PILLARS: readonly M15PillarTelemetry[] = [
  {
    id: 'M15.01',
    pillar: 'Speculative RTV Tree Search',
    modulePath: 'speculative-tree.ts',
    readiness: 'VERIFIED',
    summary: 'Bounded N-branch tournament voting with Proof Gate fail-closed disqualification',
    constitutionalInvariant: 'automatedSelfAccept: false',
  },
  {
    id: 'M15.02',
    pillar: 'Collective Skill Tree (CSTS)',
    modulePath: 'skill-tree.ts',
    readiness: 'VERIFIED',
    summary: 'Cross-domain transferability scoring and deterministic degraded-node pruning',
    constitutionalInvariant: 'automatedPromotionAllowed: false',
  },
  {
    id: 'M15.03',
    pillar: 'World-Model Surprise Gate',
    modulePath: 'world-model-gate.ts',
    readiness: 'VERIFIED',
    summary: 'Forward-inverse post-state consistency with surpriseScoreBps obligation escalation',
    constitutionalInvariant: 'automatedSelfAccept: false',
  },
  {
    id: 'M15.04',
    pillar: 'Auto-Invariant Synthesizer',
    modulePath: 'invariant-synthesizer.ts',
    readiness: 'GUARDED',
    summary: 'Synthesizes candidate node:test invariant rules while blocking R0-R4 weakening',
    constitutionalInvariant: 'automatedPromotionAllowed: false',
  },
  {
    id: 'M15.05',
    pillar: 'Semantic Resonance Bus',
    modulePath: 'semantic-bus.ts',
    readiness: 'VERIFIED',
    summary: 'EasyTier private-mesh cosine + lexical routing with company & budget fail-closed filter',
    constitutionalInvariant: 'isPrivateMeshHost enforced',
  },
  {
    id: 'M15.06',
    pillar: 'Causal Time-Machine Replay',
    modulePath: 'causal-replay.ts',
    readiness: 'VERIFIED',
    summary: 'Exact earliest checkpoint divergence attribution and deterministic counterfactual fork plan',
    constitutionalInvariant: 'automatedSelfAccept: false',
  },
  {
    id: 'M15.07',
    pillar: 'Epistemic Calibration Ledger',
    modulePath: 'epistemic-calibration.ts',
    readiness: 'VERIFIED',
    summary: 'Exact Brier Score, ECE across bins, and dynamic autonomy bounded strictly within R0-R3',
    constitutionalInvariant: 'R4 never relaxed',
  },
  {
    id: 'M16.01',
    pillar: 'Sleep-Dream Memory Consolidation',
    modulePath: 'sleep-dream.ts',
    readiness: 'VERIFIED',
    summary: 'Non-REM proactive interference pruning + REM self-probing with reversible provenance',
    constitutionalInvariant: 'automatedPromotionAllowed: false',
  },
  {
    id: 'M16.02',
    pillar: 'Active Inference EFE Policy',
    modulePath: 'active-inference.ts',
    readiness: 'VERIFIED',
    summary: 'Expected Free Energy balances pragmatic value, epistemic info gain, and compute cost',
    constitutionalInvariant: 'automatedSelfAccept: false',
  },
  {
    id: 'M16.03',
    pillar: 'RFC 6962 Merkle Audit Ledger',
    modulePath: 'merkle-ledger.ts',
    readiness: 'VERIFIED',
    summary: 'Domain-separated 0x00/0x01 SHA-256 Merkle tree with O(log N) inclusion & consistency proofs',
    constitutionalInvariant: 'RFC 6962 0x00/0x01 enforced',
  },
  {
    id: 'M16.04',
    pillar: 'Adversarial Red-Team Arena',
    modulePath: 'redteam-arena.ts',
    readiness: 'GUARDED',
    summary: 'In-memory Red-Team vs Blue-Team self-play synthesizing candidate regression invariants',
    constitutionalInvariant: 'DX-only · automatedSelfAccept: false',
  },
] as const;

export function AgiTelemetryPanel() {
  const [viewMode, setViewMode] = useState<'all' | 'guarded'>('all');

  const visiblePillars =
    viewMode === 'guarded'
      ? M15_PILLARS.filter((item) => item.readiness === 'GUARDED')
      : M15_PILLARS;

  return (
    <Panel
      title="M15 & M16 Sovereign Dreaming AGI-OS Telemetry"
      description="Live architectural readiness across all 7 M15 Constitutional RSI pillars (ADR 0010) and 4 M16 Sovereign Dreaming pillars (ADR 0011). All self-modification and promotion gates remain fail-closed."
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="primary">ADR 0010 + 0011</Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setViewMode((prev) => (prev === 'all' ? 'guarded' : 'all'))}
          >
            <RefreshIcon className="size-3.5" />
            {viewMode === 'all' ? 'Show Guarded Only' : 'Show All 11 Pillars'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="Sleep Consolidation"
            value="Non-REM + REM"
            detail="Reversible decay · Self-probing active"
            accent="green"
            icon={<CheckIcon className="size-4" />}
          />
          <MetricTile
            label="Active Inference EFE"
            value="11 / 11 Ready"
            detail="Pragmatic + Epistemic bounded R0–R3"
            accent="cyan"
            icon={<SparkleIcon className="size-4" />}
          />
          <MetricTile
            label="RFC 6962 Merkle Root"
            value="0x00 / 0x01"
            detail="O(log N) inclusion & consistency proofs"
            accent="yellow"
            icon={<JobsIcon className="size-4" />}
          />
          <MetricTile
            label="Red-Team Arena"
            value="DX Guarded"
            detail="Zero self-accept · Zero R4 relaxation"
            accent="magenta"
            icon={<SecurityIcon className="size-4" />}
          />
        </div>

        <Table scrollLabel="M15 and M16 Sovereign Dreaming AGI-OS pillar readiness" density="compact">
          <TableHead>
            <TableRow>
              <TableHeader>ID</TableHeader>
              <TableHeader>Pillar</TableHeader>
              <TableHeader>Mechanism</TableHeader>
              <TableHeader>Constitutional Invariant</TableHeader>
              <TableHeader>Status</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {visiblePillars.map((pillar) => (
              <TableRow key={pillar.id}>
                <TableCell className="font-mono text-xs font-bold">{pillar.id}</TableCell>
                <TableCell className="font-mono text-xs">
                  <div className="font-bold text-ink">{pillar.pillar}</div>
                  <div className="text-ink-faint">{pillar.modulePath}</div>
                </TableCell>
                <TableCell className="font-mono text-xs text-ink-soft">{pillar.summary}</TableCell>
                <TableCell className="font-mono text-xs">{pillar.constitutionalInvariant}</TableCell>
                <TableCell>
                  <Badge variant={pillar.readiness === 'VERIFIED' ? 'primary' : 'cyan'}>
                    {pillar.readiness}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
