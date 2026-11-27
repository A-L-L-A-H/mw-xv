export interface BusinessCockpitMetrics {
  readonly mrrMinor: number;
  readonly activeSubscribers: number;
  readonly paasTenants: number;
  readonly dunningOverdueCount: number;
  readonly paymentSuccessRatePercent: number;
  readonly coaDispatchHealthPercent: number;
}

export interface BusinessIncident {
  readonly id: string;
  readonly domain: 'isp' | 'paas' | 'payment';
  readonly severity: 'low' | 'medium' | 'high';
  readonly title: string;
  readonly description: string;
  readonly timestamp: string;
}

export function formatCockpitCurrency(amountMinor: number): string {
  return `Rp ${amountMinor.toLocaleString('id-ID')}`;
}

export function computeCockpitStatusBadge(
  metrics: BusinessCockpitMetrics
): { label: string; variant: 'default' | 'primary' | 'magenta' | 'cyan' | 'destructive' } {
  if (metrics.dunningOverdueCount > 50 || metrics.coaDispatchHealthPercent < 90) {
    return { label: 'Attention Required', variant: 'destructive' };
  }
  return { label: 'Operational Stable', variant: 'default' };
}

