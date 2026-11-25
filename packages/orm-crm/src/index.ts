export { manifest } from './manifest.js';
export { crmSeedManifest } from './seed-manifest.js';
export { crmHttpPlugin } from './http-plugin.js';
export { LeadStage, Lead, Opportunity, LeadTagLink } from './models/index.js';
export {
  DEFAULT_LEAD_SCORING_WEIGHTS,
  DEFAULT_LEAD_TIER_THRESHOLDS,
  DEFAULT_STAGE_PROBABILITIES_BPS,
  DEFAULT_STALE_DEAL_RULE,
  scoreLead,
  forecastPipelineRevenue,
  detectStaleDeals,
  type LeadTier,
  type LeadSignals,
  type LeadScoringWeights,
  type LeadTierThresholds,
  type LeadScoreBreakdown,
  type LeadScoreResult,
  type PipelineDeal,
  type StageForecast,
  type PipelineForecastResult,
  type EscalationSeverity,
  type StaleDealRule,
  type StaleDealEscalation,
} from './lead-scoring.js';
