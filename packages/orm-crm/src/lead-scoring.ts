import { BASIS_POINTS_TOTAL } from '@moonwitness/types';

export type LeadTier = 'hot' | 'warm' | 'cold';

export interface LeadSignals {
  /** 0..100 normalized company/firmographic fit score */
  firmographicFit: number;
  /** 0..100 normalized engagement score (emails opened, site visits, replies) */
  engagement: number;
  /** 0..100 normalized buying intent score (demo request, pricing page, RFP) */
  buyingIntent: number;
  /** 0..100 normalized budget alignment score */
  budgetFit: number;
  /** 0..100 normalized timeline urgency score */
  timelineUrgency: number;
  /** Optional bonus/penalty adjustments (-100..100), e.g. executive sponsor or competitor */
  adjustments?: Record<string, number>;
}

export interface LeadScoringWeights {
  firmographicFit: number;
  engagement: number;
  buyingIntent: number;
  budgetFit: number;
  timelineUrgency: number;
}

export interface LeadTierThresholds {
  hotMinScore: number;
  warmMinScore: number;
}

export interface LeadScoreBreakdown {
  firmographicFit: number;
  engagement: number;
  buyingIntent: number;
  budgetFit: number;
  timelineUrgency: number;
  adjustmentTotal: number;
}

export interface LeadScoreResult {
  score: number;
  tier: LeadTier;
  breakdown: LeadScoreBreakdown;
}

export const DEFAULT_LEAD_SCORING_WEIGHTS: Readonly<LeadScoringWeights> = {
  firmographicFit: 20,
  engagement: 25,
  buyingIntent: 30,
  budgetFit: 15,
  timelineUrgency: 10,
};

export const DEFAULT_LEAD_TIER_THRESHOLDS: Readonly<LeadTierThresholds> = {
  hotMinScore: 75,
  warmMinScore: 45,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Deterministic multi-signal lead scoring engine (0..100) with hot/warm/cold tiering.
 */
export function scoreLead(
  signals: LeadSignals,
  weights: LeadScoringWeights = DEFAULT_LEAD_SCORING_WEIGHTS,
  thresholds: LeadTierThresholds = DEFAULT_LEAD_TIER_THRESHOLDS
): LeadScoreResult {
  const totalWeight =
    weights.firmographicFit +
    weights.engagement +
    weights.buyingIntent +
    weights.budgetFit +
    weights.timelineUrgency;

  if (totalWeight <= 0) {
    throw new Error('Lead scoring weights must sum to a positive number');
  }

  const firmographicContribution =
    (clamp(signals.firmographicFit, 0, 100) * weights.firmographicFit) / totalWeight;
  const engagementContribution =
    (clamp(signals.engagement, 0, 100) * weights.engagement) / totalWeight;
  const buyingIntentContribution =
    (clamp(signals.buyingIntent, 0, 100) * weights.buyingIntent) / totalWeight;
  const budgetContribution = (clamp(signals.budgetFit, 0, 100) * weights.budgetFit) / totalWeight;
  const timelineContribution =
    (clamp(signals.timelineUrgency, 0, 100) * weights.timelineUrgency) / totalWeight;

  const adjustmentTotal = signals.adjustments
    ? Object.values(signals.adjustments).reduce(
        (acc, val) => acc + (Number.isFinite(val) ? val : 0),
        0
      )
    : 0;

  const rawScore =
    firmographicContribution +
    engagementContribution +
    buyingIntentContribution +
    budgetContribution +
    timelineContribution +
    adjustmentTotal;

  const score = Math.round(clamp(rawScore, 0, 100));
  const tier: LeadTier =
    score >= thresholds.hotMinScore ? 'hot' : score >= thresholds.warmMinScore ? 'warm' : 'cold';

  return {
    score,
    tier,
    breakdown: {
      firmographicFit: Math.round(firmographicContribution * 100) / 100,
      engagement: Math.round(engagementContribution * 100) / 100,
      buyingIntent: Math.round(buyingIntentContribution * 100) / 100,
      budgetFit: Math.round(budgetContribution * 100) / 100,
      timelineUrgency: Math.round(timelineContribution * 100) / 100,
      adjustmentTotal,
    },
  };
}

export interface PipelineDeal {
  id: string;
  stage: string;
  /** Deal value in integer cents */
  amountCents: number;
  /** Optional deal-specific probability override in basis points (0..10000) */
  probabilityBps?: number;
  ownerId?: string;
  lastActivityAt?: string | number | Date;
}

export interface StageForecast {
  stage: string;
  dealCount: number;
  stageProbabilityBps: number;
  grossAmountCents: number;
  weightedAmountCents: number;
}

export interface PipelineForecastResult {
  totalDeals: number;
  totalGrossCents: number;
  totalWeightedCents: number;
  byStage: StageForecast[];
}

export const DEFAULT_STAGE_PROBABILITIES_BPS: Readonly<Record<string, number>> = {
  new: 1000,
  qualified: 2500,
  proposal: 5000,
  negotiation: 7500,
  won: BASIS_POINTS_TOTAL,
  lost: 0,
};

/**
 * Deterministic weighted pipeline revenue forecast by stage probability using integer cents.
 */
export function forecastPipelineRevenue(
  deals: readonly PipelineDeal[],
  stageProbabilitiesBps: Readonly<Record<string, number>> = DEFAULT_STAGE_PROBABILITIES_BPS
): PipelineForecastResult {
  const stageMap = new Map<
    string,
    {
      dealCount: number;
      grossAmountCents: number;
      weightedAmountCents: number;
      stageProbabilityBps: number;
    }
  >();

  let totalDeals = 0;
  let totalGrossCents = 0;
  let totalWeightedCents = 0;

  for (const deal of deals) {
    if (!Number.isInteger(deal.amountCents) || deal.amountCents < 0) {
      throw new Error(`Deal ${deal.id} amountCents must be a non-negative integer`);
    }

    const defaultBps = stageProbabilitiesBps[deal.stage] ?? 0;
    const effectiveBps = clamp(
      deal.probabilityBps !== undefined ? Math.round(deal.probabilityBps) : defaultBps,
      0,
      BASIS_POINTS_TOTAL
    );
    const weightedCents = Math.round((deal.amountCents * effectiveBps) / BASIS_POINTS_TOTAL);

    totalDeals += 1;
    totalGrossCents += deal.amountCents;
    totalWeightedCents += weightedCents;

    const existing = stageMap.get(deal.stage);
    if (existing) {
      existing.dealCount += 1;
      existing.grossAmountCents += deal.amountCents;
      existing.weightedAmountCents += weightedCents;
    } else {
      stageMap.set(deal.stage, {
        dealCount: 1,
        grossAmountCents: deal.amountCents,
        weightedAmountCents: weightedCents,
        stageProbabilityBps: defaultBps,
      });
    }
  }

  const byStage: StageForecast[] = Array.from(stageMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stage, stats]) => ({
      stage,
      ...stats,
    }));

  return {
    totalDeals,
    totalGrossCents,
    totalWeightedCents,
    byStage,
  };
}

export type EscalationSeverity = 'warning' | 'critical' | 'executive';

export interface StaleDealRule {
  /** Max inactive days before warning escalation */
  warningDays: number;
  /** Max inactive days before critical escalation */
  criticalDays: number;
  /** Max inactive days before executive escalation */
  executiveDays: number;
}

export interface StaleDealEscalation {
  dealId: string;
  stage: string;
  ownerId: string | undefined;
  amountCents: number;
  inactiveDays: number;
  overdueDays: number;
  severity: EscalationSeverity;
}

export const DEFAULT_STALE_DEAL_RULE: Readonly<StaleDealRule> = {
  warningDays: 7,
  criticalDays: 14,
  executiveDays: 30,
};

const SEVERITY_RANK: Readonly<Record<EscalationSeverity, number>> = {
  executive: 3,
  critical: 2,
  warning: 1,
};

const MS_PER_DAY = 86_400_000;

function toEpochMs(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return parsed;
}

/**
 * Deterministic stale-deal escalation detector.
 * Ignores closed stages ('won', 'lost') by default unless explicitly configured.
 */
export function detectStaleDeals(
  deals: readonly PipelineDeal[],
  asOf: string | number | Date,
  options: {
    defaultRule?: StaleDealRule;
    stageRules?: Readonly<Record<string, StaleDealRule>>;
    closedStages?: readonly string[];
  } = {}
): StaleDealEscalation[] {
  const asOfMs = toEpochMs(asOf);
  const defaultRule = options.defaultRule ?? DEFAULT_STALE_DEAL_RULE;
  const stageRules = options.stageRules ?? {};
  const closedSet = new Set(options.closedStages ?? ['won', 'lost']);

  const escalations: StaleDealEscalation[] = [];

  for (const deal of deals) {
    if (closedSet.has(deal.stage)) continue;
    if (deal.lastActivityAt === undefined) continue;

    const lastMs = toEpochMs(deal.lastActivityAt);
    const elapsedMs = Math.max(0, asOfMs - lastMs);
    const inactiveDays = Math.floor(elapsedMs / MS_PER_DAY);
    const rule = stageRules[deal.stage] ?? defaultRule;

    let severity: EscalationSeverity | null = null;
    if (inactiveDays >= rule.executiveDays) {
      severity = 'executive';
    } else if (inactiveDays >= rule.criticalDays) {
      severity = 'critical';
    } else if (inactiveDays >= rule.warningDays) {
      severity = 'warning';
    }

    if (severity !== null) {
      escalations.push({
        dealId: deal.id,
        stage: deal.stage,
        ownerId: deal.ownerId,
        amountCents: deal.amountCents,
        inactiveDays,
        overdueDays: inactiveDays - rule.warningDays,
        severity,
      });
    }
  }

  return escalations.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
    if (b.amountCents !== a.amountCents) return b.amountCents - a.amountCents;
    return a.dealId.localeCompare(b.dealId);
  });
}
