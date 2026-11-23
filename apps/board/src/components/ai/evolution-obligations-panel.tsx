'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckIcon, RefreshIcon, SecurityIcon, SignalIcon } from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';

export interface EvolutionCandidateSummary {
  readonly candidateId: string;
  readonly artifactKind: 'ai.skill_version' | 'ai.memory_candidate';
  readonly title: string;
  readonly candidateOnly: true;
  readonly requiresHumanApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly contentSha256: string;
}

export interface EvolutionSynthesisResponse {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly candidates: readonly EvolutionCandidateSummary[];
  readonly synthesisSha256: string;
}

export interface AblationGateResponse {
  readonly candidateId: string;
  readonly totalCases: number;
  readonly baselinePassRate: number;
  readonly candidatePassRate: number;
  readonly passRateDelta: number;
  readonly regressionCount: number;
  readonly harmCount: number;
  readonly eligibleForWorkflowPromotion: boolean;
  readonly requiresHumanWorkflowApproval: true;
  readonly automatedPromotionAllowed: false;
  readonly gateSha256: string;
}

export interface ObligationProposalSummary {
  readonly proposalId: string;
  readonly obligationId: string;
  readonly status: 'drifted' | 'breached';
  readonly title: string;
  readonly summary: string;
  readonly advisoryOnly: true;
  readonly automatedSelfAccept: false;
  readonly reasonCodes: readonly string[];
}

export interface ObligationScanResponse {
  readonly companyId: number;
  readonly summary: {
    readonly totalEvaluated: number;
    readonly intact: number;
    readonly drifted: number;
    readonly breached: number;
    readonly skippedCrossCompany: number;
  };
  readonly proposals: readonly ObligationProposalSummary[];
  readonly reportSha256: string;
}

function statusBadgeVariant(
  status: 'intact' | 'drifted' | 'breached' | 'eligible' | 'blocked'
): 'cyan' | 'magenta' | 'destructive' | 'default' {
  if (status === 'intact' || status === 'eligible') return 'cyan';
  if (status === 'drifted') return 'magenta';
  if (status === 'breached' || status === 'blocked') return 'destructive';
  return 'default';
}

export function EvolutionObligationsPanel() {
  const [synthesis, setSynthesis] = useState<EvolutionSynthesisResponse | null>(null);
  const [ablation, setAblation] = useState<AblationGateResponse | null>(null);
  const [obligationScan, setObligationScan] = useState<ObligationScanResponse | null>(null);

  const synthesizeMutation = useMutation({
    mutationFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: EvolutionSynthesisResponse;
      }>('/api/ai/evolution/synthesize', {
        method: 'POST',
        body: {
          runId: 'run-continuity-check',
          workContractId: 'wc-continuity-audit',
          proofGatePassed: true,
          checks: [
            { name: 'proof-gate-v2', passed: true, summary: 'Verified deterministic evidence' },
          ],
          diffSummary: 'Verified continuity run candidate extraction',
          lessons: ['Preserve deterministic SHA-256 verification before workflow promotion'],
        },
      });
      return response.data;
    },
    onSuccess: (data) => {
      setSynthesis(data);
      toast.success(
        `Synthesized ${data.candidates.length} candidate proposal(s) (human approval required).`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Evolution synthesis failed.');
    },
  });

  const ablationMutation = useMutation({
    mutationFn: async (candidateId: string) => {
      const response = await client.request<{
        success: boolean;
        data: AblationGateResponse;
      }>('/api/ai/evolution/evaluate-ablation', {
        method: 'POST',
        body: {
          candidateId,
          baselineResults: [
            { caseId: 'eval-core-01', passed: true },
            { caseId: 'eval-transfer-02', passed: false },
          ],
          candidateResults: [
            { caseId: 'eval-core-01', passed: true },
            { caseId: 'eval-transfer-02', passed: true },
          ],
        },
      });
      return response.data;
    },
    onSuccess: (data) => {
      setAblation(data);
      toast.success(
        data.eligibleForWorkflowPromotion
          ? `Ablation gate passed (+${Math.round(data.passRateDelta * 100)}%). Ready for workflow review.`
          : 'Ablation gate blocked promotion.'
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Ablation gate evaluation failed.');
    },
  });

  const obligationScanMutation = useMutation({
    mutationFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: ObligationScanResponse;
      }>('/api/ai/obligations/scan', {
        method: 'POST',
        body: {
          obligations: [],
          worldSnapshot: {
            observedAt: new Date().toISOString(),
          },
        },
      });
      return response.data;
    },
    onSuccess: (data) => {
      setObligationScan(data);
      toast.success(
        `Obligation drift scan complete (${data.summary.breached} breached, ${data.summary.drifted} drifted).`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Obligation drift scan failed.');
    },
  });

  const candidateCount = synthesis?.candidates.length ?? 0;
  const firstCandidateId = synthesis?.candidates[0]?.candidateId ?? 'candidate-preview-01';
  const ablationDeltaLabel = ablation
    ? `${ablation.passRateDelta >= 0 ? '+' : ''}${Math.round(ablation.passRateDelta * 100)}%`
    : '—';
  const driftAlertCount = obligationScan
    ? obligationScan.summary.drifted + obligationScan.summary.breached
    : 0;

  return (
    <Panel className="space-y-6 border-primary/20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <SecurityIcon className="size-5 text-primary" />
            <h2 className="text-base font-semibold tracking-tight">
              Evolution &amp; Obligation Continuity
            </h2>
            <Badge variant="default">Candidate-Only</Badge>
            <Badge variant="cyan">Human Approval Required</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Deterministic candidate synthesis, ablation gating, and world-state obligation drift
            monitoring. Automated self-promotion is disabled.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={synthesizeMutation.isPending}
            onClick={() => synthesizeMutation.mutate()}
          >
            <RefreshIcon className="size-3.5" />
            Synthesize Candidates
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={ablationMutation.isPending}
            onClick={() => ablationMutation.mutate(firstCandidateId)}
          >
            <CheckIcon className="size-3.5" />
            Run Ablation Gate
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={obligationScanMutation.isPending}
            onClick={() => obligationScanMutation.mutate()}
          >
            <SignalIcon className="size-3.5" />
            Scan Obligations
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Candidate Proposals"
          value={String(candidateCount)}
          icon={<RefreshIcon className="size-4 text-primary" />}
        />
        <MetricTile
          label="Ablation Gate Delta"
          value={ablationDeltaLabel}
          icon={<CheckIcon className="size-4 text-primary" />}
        />
        <MetricTile
          label="Obligation Drift Alerts"
          value={String(driftAlertCount)}
          icon={<SignalIcon className="size-4 text-primary" />}
        />
      </div>

      {synthesis && synthesis.candidates.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Candidate Evolution Proposals
          </div>
          <div className="space-y-2">
            {synthesis.candidates.map((candidate) => (
              <div
                key={candidate.candidateId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-medium">{candidate.title}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {candidate.artifactKind} · sha256:{candidate.contentSha256.slice(0, 12)}
                  </div>
                </div>
                <Badge variant="default">Human Review</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {ablation && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs">
          <div className="space-y-0.5">
            <div className="font-medium">Ablation Gate · {ablation.candidateId}</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              reg={ablation.regressionCount} · harm={ablation.harmCount} · sha256:
              {ablation.gateSha256.slice(0, 12)}
            </div>
          </div>
          <Badge
            variant={statusBadgeVariant(
              ablation.eligibleForWorkflowPromotion ? 'eligible' : 'blocked'
            )}
          >
            {ablation.eligibleForWorkflowPromotion ? 'Workflow Eligible' : 'Blocked'}
          </Badge>
        </div>
      )}

      {obligationScan && obligationScan.proposals.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Obligation Drift Alerts
          </div>
          <div className="space-y-2">
            {obligationScan.proposals.map((proposal) => (
              <div
                key={proposal.proposalId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-medium">{proposal.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {proposal.reasonCodes.join(', ')}
                  </div>
                </div>
                <Badge variant={statusBadgeVariant(proposal.status)}>{proposal.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
