import { sha256Canonical } from './canonical-json.js';
import { createRedactor } from './redaction.js';

export type DynamicAutonomyMode = 'standard' | 'require_extra_rtv_branches' | 'require_human_gate';

export type BoundedAutonomyTier = 'R0' | 'R1' | 'R2' | 'R3';

export interface EpistemicPredictionSample {
  readonly predictionId?: string;
  readonly predictedProbability: number;
  readonly outcome: 0 | 1 | boolean;
  readonly domain?: string;
}

export interface EpistemicCalibrationOptions {
  readonly numBins?: number;
}

export interface EpistemicCalibrationBin {
  readonly binIndex: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly sampleCount: number;
  readonly avgConfidence: number;
  readonly empiricalAccuracy: number;
  readonly calibrationGap: number;
}

export interface EpistemicCalibrationReport {
  readonly sampleCount: number;
  readonly invalidSampleCount: number;
  readonly brierScore: number;
  readonly ece: number;
  readonly avgConfidence: number;
  readonly empiricalAccuracy: number;
  readonly overconfidenceIndex: number;
  readonly signedCalibrationBias: number;
  readonly bins: readonly EpistemicCalibrationBin[];
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfAccept: false;
  readonly calibrationSha256: string;
}

export interface AutonomyPolicyThresholds {
  readonly minSamples?: number;
  readonly extraRtvEceThreshold?: number;
  readonly extraRtvBrierThreshold?: number;
  readonly extraRtvOverconfidenceThreshold?: number;
  readonly humanGateEceThreshold?: number;
  readonly humanGateBrierThreshold?: number;
  readonly humanGateOverconfidenceThreshold?: number;
}

export interface DynamicAutonomyPolicy {
  readonly mode: DynamicAutonomyMode;
  readonly maxAutonomyTier: BoundedAutonomyTier;
  readonly extraRtvBranches: number;
  readonly r4HumanGateLocked: true;
  readonly automatedPromotionAllowed: false;
  readonly automatedSelfAccept: false;
  readonly reasons: readonly string[];
  readonly calibrationSha256: string;
  readonly policySha256: string;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeOutcome(outcome: 0 | 1 | boolean): number | null {
  if (outcome === true || outcome === 1) {
    return 1;
  }
  if (outcome === false || outcome === 0) {
    return 0;
  }
  return null;
}

export function computeEpistemicCalibration(
  predictions: readonly EpistemicPredictionSample[],
  options: EpistemicCalibrationOptions = {}
): EpistemicCalibrationReport {
  const redactor = createRedactor();
  const numBins =
    options.numBins !== undefined && Number.isInteger(options.numBins) && options.numBins > 0
      ? options.numBins
      : 10;

  const validSamples: Array<{
    readonly predictionId: string;
    readonly domain: string;
    readonly p: number;
    readonly y: number;
  }> = [];
  let invalidSampleCount = 0;

  for (let i = 0; i < predictions.length; i += 1) {
    const sample = predictions[i];
    if (!sample) {
      invalidSampleCount += 1;
      continue;
    }
    const p = sample.predictedProbability;
    const y = normalizeOutcome(sample.outcome);
    if (!Number.isFinite(p) || p < 0 || p > 1 || y === null) {
      invalidSampleCount += 1;
      continue;
    }
    validSamples.push({
      predictionId: redactor.redactString(sample.predictionId ?? `pred-${i}`).trim(),
      domain: redactor.redactString(sample.domain ?? 'general').trim(),
      p,
      y,
    });
  }

  const sampleCount = validSamples.length;
  if (sampleCount === 0) {
    const emptyBins: EpistemicCalibrationBin[] = Array.from({ length: numBins }, (_, index) => ({
      binIndex: index,
      lowerBound: roundMetric(index / numBins),
      upperBound: roundMetric((index + 1) / numBins),
      sampleCount: 0,
      avgConfidence: 0,
      empiricalAccuracy: 0,
      calibrationGap: 0,
    }));

    const calibrationSha256 = sha256Canonical({
      sampleCount: 0,
      invalidSampleCount,
      brierScore: 1,
      ece: 1,
      overconfidenceIndex: 1,
      bins: emptyBins,
      automatedPromotionAllowed: false as const,
      automatedSelfAccept: false as const,
    });

    return {
      sampleCount: 0,
      invalidSampleCount,
      brierScore: 1,
      ece: 1,
      avgConfidence: 0,
      empiricalAccuracy: 0,
      overconfidenceIndex: 1,
      signedCalibrationBias: 0,
      bins: emptyBins,
      automatedPromotionAllowed: false,
      automatedSelfAccept: false,
      calibrationSha256,
    };
  }

  let brierSum = 0;
  let confidenceSum = 0;
  let accuracySum = 0;

  const binBuckets: Array<Array<{ readonly p: number; readonly y: number }>> = Array.from(
    { length: numBins },
    () => []
  );

  for (const sample of validSamples) {
    const diff = sample.p - sample.y;
    brierSum += diff * diff;
    confidenceSum += sample.p;
    accuracySum += sample.y;

    const rawBinIndex = Math.floor(sample.p * numBins);
    const binIndex = Math.min(numBins - 1, Math.max(0, rawBinIndex));
    binBuckets[binIndex]?.push(sample);
  }

  const brierScore = roundMetric(brierSum / sampleCount);
  const avgConfidence = roundMetric(confidenceSum / sampleCount);
  const empiricalAccuracy = roundMetric(accuracySum / sampleCount);
  const signedCalibrationBias = roundMetric(avgConfidence - empiricalAccuracy);
  const overconfidenceIndex = roundMetric(Math.max(0, avgConfidence - empiricalAccuracy));

  let eceSum = 0;
  const bins: EpistemicCalibrationBin[] = binBuckets.map((bucket, binIndex) => {
    const lowerBound = roundMetric(binIndex / numBins);
    const upperBound = roundMetric((binIndex + 1) / numBins);
    if (bucket.length === 0) {
      return {
        binIndex,
        lowerBound,
        upperBound,
        sampleCount: 0,
        avgConfidence: 0,
        empiricalAccuracy: 0,
        calibrationGap: 0,
      };
    }

    const binConfidence = bucket.reduce((acc, item) => acc + item.p, 0) / bucket.length;
    const binAccuracy = bucket.reduce((acc, item) => acc + item.y, 0) / bucket.length;
    const gap = Math.abs(binConfidence - binAccuracy);
    eceSum += (bucket.length / sampleCount) * gap;

    return {
      binIndex,
      lowerBound,
      upperBound,
      sampleCount: bucket.length,
      avgConfidence: roundMetric(binConfidence),
      empiricalAccuracy: roundMetric(binAccuracy),
      calibrationGap: roundMetric(gap),
    };
  });

  const ece = roundMetric(eceSum);
  const calibrationSha256 = sha256Canonical({
    sampleCount,
    invalidSampleCount,
    brierScore,
    ece,
    avgConfidence,
    empiricalAccuracy,
    overconfidenceIndex,
    signedCalibrationBias,
    bins,
    automatedPromotionAllowed: false as const,
    automatedSelfAccept: false as const,
  });

  return {
    sampleCount,
    invalidSampleCount,
    brierScore,
    ece,
    avgConfidence,
    empiricalAccuracy,
    overconfidenceIndex,
    signedCalibrationBias,
    bins,
    automatedPromotionAllowed: false,
    automatedSelfAccept: false,
    calibrationSha256,
  };
}

export function deriveDynamicAutonomyPolicy(
  calibration: EpistemicCalibrationReport,
  options: AutonomyPolicyThresholds = {}
): DynamicAutonomyPolicy {
  const minSamples = options.minSamples ?? 5;
  const extraRtvEceThreshold = options.extraRtvEceThreshold ?? 0.08;
  const extraRtvBrierThreshold = options.extraRtvBrierThreshold ?? 0.16;
  const extraRtvOverconfidenceThreshold = options.extraRtvOverconfidenceThreshold ?? 0.08;
  const humanGateEceThreshold = options.humanGateEceThreshold ?? 0.15;
  const humanGateBrierThreshold = options.humanGateBrierThreshold ?? 0.25;
  const humanGateOverconfidenceThreshold = options.humanGateOverconfidenceThreshold ?? 0.15;

  const reasons: string[] = [];
  let mode: DynamicAutonomyMode = 'standard';
  let maxAutonomyTier: BoundedAutonomyTier = 'R3';
  let extraRtvBranches = 0;

  if (calibration.sampleCount < minSamples) {
    reasons.push(
      `Insufficient calibration samples (${calibration.sampleCount} < ${minSamples}); fail-closed to human gate.`
    );
    mode = 'require_human_gate';
  }
  if (calibration.ece >= humanGateEceThreshold) {
    reasons.push(`ECE ${calibration.ece} reached human-gate threshold ${humanGateEceThreshold}.`);
    mode = 'require_human_gate';
  }
  if (calibration.brierScore >= humanGateBrierThreshold) {
    reasons.push(
      `Brier score ${calibration.brierScore} reached human-gate threshold ${humanGateBrierThreshold}.`
    );
    mode = 'require_human_gate';
  }
  if (calibration.overconfidenceIndex >= humanGateOverconfidenceThreshold) {
    reasons.push(
      `Overconfidence index ${calibration.overconfidenceIndex} reached human-gate threshold ${humanGateOverconfidenceThreshold}.`
    );
    mode = 'require_human_gate';
  }

  if (mode === 'require_human_gate') {
    maxAutonomyTier = 'R1';
    extraRtvBranches = 2;
  } else {
    if (calibration.ece >= extraRtvEceThreshold) {
      reasons.push(`ECE ${calibration.ece} reached extra-RTV threshold ${extraRtvEceThreshold}.`);
      mode = 'require_extra_rtv_branches';
    }
    if (calibration.brierScore >= extraRtvBrierThreshold) {
      reasons.push(
        `Brier score ${calibration.brierScore} reached extra-RTV threshold ${extraRtvBrierThreshold}.`
      );
      mode = 'require_extra_rtv_branches';
    }
    if (calibration.overconfidenceIndex >= extraRtvOverconfidenceThreshold) {
      reasons.push(
        `Overconfidence index ${calibration.overconfidenceIndex} reached extra-RTV threshold ${extraRtvOverconfidenceThreshold}.`
      );
      mode = 'require_extra_rtv_branches';
    }

    if (mode === 'require_extra_rtv_branches') {
      maxAutonomyTier = 'R2';
      extraRtvBranches = 1;
    } else {
      reasons.push('Calibration within nominal R0-R3 autonomy bounds.');
    }
  }

  const policySha256 = sha256Canonical({
    mode,
    maxAutonomyTier,
    extraRtvBranches,
    r4HumanGateLocked: true as const,
    automatedPromotionAllowed: false as const,
    automatedSelfAccept: false as const,
    reasons,
    calibrationSha256: calibration.calibrationSha256,
  });

  return {
    mode,
    maxAutonomyTier,
    extraRtvBranches,
    r4HumanGateLocked: true,
    automatedPromotionAllowed: false,
    automatedSelfAccept: false,
    reasons,
    calibrationSha256: calibration.calibrationSha256,
    policySha256,
  };
}
