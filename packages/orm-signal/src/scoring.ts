export interface SignalScoreInput {
  readonly keywordWeight: number;
  readonly recencyDecay: number;
  readonly sourceAuthority: number;
  readonly velocity: number;
}

export interface SignalScoreWeights {
  readonly keywordWeight: number;
  readonly recencyDecay: number;
  readonly sourceAuthority: number;
  readonly velocity: number;
}

export interface SignalFinalScore {
  readonly finalScore: number;
  readonly components: SignalScoreInput;
  readonly weights: SignalScoreWeights;
}

export const DEFAULT_SIGNAL_SCORE_WEIGHTS: SignalScoreWeights = {
  keywordWeight: 0.35,
  recencyDecay: 0.2,
  sourceAuthority: 0.2,
  velocity: 0.25,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function computeSignalFinalScore(
  input: SignalScoreInput,
  weights: Partial<SignalScoreWeights> = {}
): SignalFinalScore {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Signal score component ${key} must be a finite number`);
    }
  }
  const resolved: SignalScoreWeights = {
    keywordWeight: weights.keywordWeight ?? DEFAULT_SIGNAL_SCORE_WEIGHTS.keywordWeight,
    recencyDecay: weights.recencyDecay ?? DEFAULT_SIGNAL_SCORE_WEIGHTS.recencyDecay,
    sourceAuthority: weights.sourceAuthority ?? DEFAULT_SIGNAL_SCORE_WEIGHTS.sourceAuthority,
    velocity: weights.velocity ?? DEFAULT_SIGNAL_SCORE_WEIGHTS.velocity,
  };
  const weightSum = resolved.keywordWeight + resolved.recencyDecay + resolved.sourceAuthority + resolved.velocity;
  if (weightSum <= 0) throw new Error('Signal score weights must sum to a positive value');

  const finalScore =
    (clamp01(input.keywordWeight) * resolved.keywordWeight +
      clamp01(input.recencyDecay) * resolved.recencyDecay +
      clamp01(input.sourceAuthority) * resolved.sourceAuthority +
      clamp01(input.velocity) * resolved.velocity) /
    weightSum;

  return { finalScore, components: { ...input }, weights: resolved };
}

export const SIGNAL_ALERT_DEFAULT_THRESHOLD = 0.75;

export function shouldFireAlert(finalScore: number, threshold: number = SIGNAL_ALERT_DEFAULT_THRESHOLD): boolean {
  return Number.isFinite(finalScore) && finalScore >= threshold;
}
