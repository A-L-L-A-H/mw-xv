import type {
  ChurnRiskAssessment,
  ChurnRiskBand,
  ChurnRiskFactor,
  ChurnSignalInput,
} from './types.js';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function classifyChurnBand(score: number): ChurnRiskBand {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

export function recommendOfferCode(band: ChurnRiskBand): string | null {
  switch (band) {
    case 'critical':
      return 'RETENTION_VIP_30';
    case 'high':
      return 'RETENTION_SAVE_20';
    case 'medium':
      return 'RETENTION_CHECKIN_10';
    case 'low':
      return null;
  }
}

export function scoreChurnRisk(
  input: ChurnSignalInput,
  options?: { now?: () => string }
): ChurnRiskAssessment {
  const factors: ChurnRiskFactor[] = [];

  const inactiveDays = Math.max(0, Math.floor(input.daysSinceLastActive));
  if (inactiveDays >= 7) {
    const points =
      inactiveDays >= 30 ? 30 : inactiveDays >= 14 ? 20 : 10;
    factors.push({
      code: 'inactivity',
      label: 'Account inactivity',
      points,
      detail: `${inactiveDays} day(s) since last active session`,
    });
  }

  const overdueCount = Math.max(0, Math.floor(input.overdueInvoiceCount));
  if (overdueCount > 0) {
    const points = clamp(overdueCount * 12, 0, 25);
    factors.push({
      code: 'overdue_invoices',
      label: 'Overdue invoices',
      points,
      detail: `${overdueCount} unpaid overdue invoice(s)`,
    });
  }

  const failedPayments = Math.max(0, Math.floor(input.failedPaymentCount30d));
  if (failedPayments > 0) {
    const points = clamp(failedPayments * 8, 0, 15);
    factors.push({
      code: 'failed_payments',
      label: 'Failed payment attempts',
      points,
      detail: `${failedPayments} failed payment(s) in last 30d`,
    });
  }

  const openTickets = Math.max(0, Math.floor(input.openSupportTickets));
  const criticalTickets = Math.max(0, Math.floor(input.criticalSupportTickets));
  if (openTickets > 0 || criticalTickets > 0) {
    const points = clamp(openTickets * 3 + criticalTickets * 10, 0, 20);
    factors.push({
      code: 'support_friction',
      label: 'Support friction',
      points,
      detail: `${openTickets} open ticket(s), ${criticalTickets} critical`,
    });
  }

  if (Number.isFinite(input.usageDeltaPct) && input.usageDeltaPct <= -20) {
    const dropMagnitude = Math.abs(input.usageDeltaPct);
    const points = dropMagnitude >= 60 ? 20 : dropMagnitude >= 40 ? 15 : 10;
    factors.push({
      code: 'usage_drop',
      label: 'Usage contraction',
      points,
      detail: `${Math.round(dropMagnitude)}% usage drop vs 30d baseline`,
    });
  }

  if (typeof input.daysToRenewal === 'number' && Number.isFinite(input.daysToRenewal)) {
    if (input.daysToRenewal <= 14) {
      const points = input.daysToRenewal <= 0 ? 10 : 6;
      factors.push({
        code: 'renewal_proximity',
        label: 'Renewal window',
        points,
        detail:
          input.daysToRenewal <= 0
            ? `Renewal overdue by ${Math.abs(Math.floor(input.daysToRenewal))} day(s)`
            : `${Math.floor(input.daysToRenewal)} day(s) until renewal`,
      });
    }
  }

  const rawScore = factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = clamp(rawScore, 0, 100);
  const band = classifyChurnBand(score);
  const sortedFactors = [...factors].sort((a, b) => b.points - a.points);

  return {
    customerId: input.customerId,
    tenantId: input.tenantId,
    score,
    band,
    factors: sortedFactors,
    recommendedOfferCode: recommendOfferCode(band),
    evaluatedAt: options?.now ? options.now() : new Date().toISOString(),
  };
}
