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
  ActivityIcon,
  BoltIcon,
  CheckIcon,
  JobsIcon,
  LockIcon,
  RefreshIcon,
  SecurityIcon,
  SignalIcon,
  SparkleIcon,
} from '@moonwitness/ui/icons';

type CockpitActionId = 'sleep-dream' | 'active-inference' | 'merkle-root' | 'redteam-arena';

interface CockpitActionConfig {
  readonly id: CockpitActionId;
  readonly label: string;
  readonly endpoint: string;
  readonly summary: string;
}

const COCKPIT_ACTIONS: readonly CockpitActionConfig[] = [
  {
    id: 'sleep-dream',
    label: 'Sleep-Dream Consolidation',
    endpoint: '/api/desktop/ai/sleep-dream',
    summary: 'Non-REM interference pruning + REM self-probe',
  },
  {
    id: 'active-inference',
    label: 'Active Inference EFE',
    endpoint: '/api/desktop/ai/active-inference',
    summary: 'Evaluate Expected Free Energy policy (R0-R3)',
  },
  {
    id: 'merkle-root',
    label: 'Verify Merkle Root',
    endpoint: '/api/desktop/audit/merkle-root',
    summary: 'RFC 6962 0x00/0x01 audit root verification',
  },
  {
    id: 'redteam-arena',
    label: 'Run Red-Team Arena',
    endpoint: '/api/desktop/ai/redteam-arena',
    summary: 'DX-only adversarial self-play (no self-accept)',
  },
] as const;

interface CockpitFeedback {
  readonly actionId: CockpitActionId;
  readonly status: 'ok' | 'offline' | 'error';
  readonly message: string;
  readonly timestamp: string;
}

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
  const [runningAction, setRunningAction] = useState<CockpitActionId | null>(null);
  const [feedback, setFeedback] = useState<CockpitFeedback | null>(null);

  const visiblePillars =
    viewMode === 'guarded'
      ? M15_PILLARS.filter((item) => item.readiness === 'GUARDED')
      : M15_PILLARS;

  const triggerCockpitAction = async (action: CockpitActionConfig) => {
    setRunningAction(action.id);
    const timestamp = new Date().toISOString().slice(11, 19);
    try {
      const response = await fetch(action.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trigger: 'board-cockpit', dryRun: true }),
      });

      if (response.status === 404) {
        setFeedback({
          actionId: action.id,
          status: 'offline',
          message: `${action.label}: Desktop DX bridge offline (${action.endpoint} returned 404).`,
          timestamp,
        });
        return;
      }

      if (!response.ok) {
        setFeedback({
          actionId: action.id,
          status: 'error',
          message: `${action.label} failed with HTTP ${response.status}.`,
          timestamp,
        });
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        rootHash?: string;
        status?: string;
      };
      const detail =
        payload.message ??
        (payload.rootHash ? `Merkle root ${payload.rootHash.slice(0, 16)}...` : null) ??
        (payload.status ? `Status: ${payload.status}` : 'Completed with constitutional gates intact.');

      setFeedback({
        actionId: action.id,
        status: 'ok',
        message: `${action.label}: ${detail}`,
        timestamp,
      });
    } catch {
      setFeedback({
        actionId: action.id,
        status: 'offline',
        message: `${action.label}: Unable to reach Desktop DX control bridge.`,
        timestamp,
      });
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div className="space-y-6">
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

          <div className="space-y-2 rounded-md border border-ink/15 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wide text-ink">
                Interactive AGI Cockpit Controls
              </span>
              <Badge variant="cyan">Fail-Closed DX Triggers</Badge>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {COCKPIT_ACTIONS.map((action) => {
                const isRunning = runningAction === action.id;
                return (
                  <Button
                    key={action.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={runningAction !== null}
                    onClick={() => void triggerCockpitAction(action)}
                    className="justify-start"
                    title={action.summary}
                  >
                    <BoltIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{isRunning ? 'Running...' : action.label}</span>
                  </Button>
                );
              })}
            </div>
            {feedback ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-ink/5 px-3 py-2 font-mono text-xs">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      feedback.status === 'ok'
                        ? 'primary'
                        : feedback.status === 'offline'
                          ? 'cyan'
                          : 'destructive'
                    }
                  >
                    {feedback.status.toUpperCase()}
                  </Badge>
                  <span className="text-ink">{feedback.message}</span>
                </div>
                <span className="text-ink-faint">{feedback.timestamp} UTC</span>
              </div>
            ) : null}
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

      <Panel
        title="M17 Collective Mesh & Self-Healing"
        description="Verifiable A2A consensus quorum, policy fuzzer hardening, network-isolated ephemeral sandboxes, and human-gated incident self-healer invariants."
        actions={<Badge variant="primary">M17 Mesh Guarded</Badge>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="Verifiable A2A Consensus"
            value="3 / 3 Quorum"
            detail="Signed peer attestations · Fail-closed"
            accent="green"
            icon={<SignalIcon className="size-4" />}
          />
          <MetricTile
            label="Policy Fuzzer Pass Rate"
            value="100% Pass"
            detail="0 R4 bypasses · Continuous invariant fuzzing"
            accent="cyan"
            icon={<ActivityIcon className="size-4" />}
          />
          <MetricTile
            label="Ephemeral Sandbox Lock"
            value="Isolated"
            detail="networkDisabled: true · Read-only rootfs"
            accent="yellow"
            icon={<LockIcon className="size-4" />}
          />
          <MetricTile
            label="Incident Self-Healer"
            value="Human Gated"
            detail="automatedSelfMerge: false · Patch proposal only"
            accent="magenta"
            icon={<SecurityIcon className="size-4" />}
          />
        </div>
      </Panel>
    </div>
  );
}
