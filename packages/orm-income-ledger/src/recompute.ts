import type { Context } from './context.js';
import { IncomeEntry, IncomeMetric, IncomeStream } from './models.js';

function periodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodBounds(period: string): { start: Date; end: Date } {
  const [year, month] = period.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

async function computeStreamMetrics(
  ctx: Context,
  stream: InstanceType<typeof IncomeStream>,
  period: string
): Promise<{
  revenue_minor: number;
  cost_minor: number;
  net_minor: number;
  mrr_minor: number;
  arr_minor: number;
  runway_months: number | null;
}> {
  const { start, end } = periodBounds(period);
  const entries = ctx
    .query(IncomeEntry)
    .where('stream_id', stream.id)
    .andWhere('occurred_at', '>=', start)
    .andWhere('occurred_at', '<', end);

  const revenueResult = await entries.clone().andWhere('kind', 'revenue').sum('net_minor as total');
  const costResult = await entries
    .clone()
    .whereIn('kind', ['cost', 'fee', 'tax'])
    .sum('amount_minor as total');

  const rev = Number(
    (revenueResult[0] as unknown as Record<string, unknown> | undefined)?.total ?? 0
  );
  const cost = Number(
    (costResult[0] as unknown as Record<string, unknown> | undefined)?.total ?? 0
  );
  const net_minor = rev - cost;

  const mrr_minor =
    stream.kind === 'saas' && stream.status === 'live' ? stream.goal_monthly_minor : 0;
  const arr_minor = mrr_minor * 12;

  let runway_months: number | null = null;
  if (net_minor > 0 && stream.goal_monthly_minor > 0) {
    runway_months = Math.floor(stream.goal_monthly_minor / net_minor);
  }

  return { revenue_minor: rev, cost_minor: cost, net_minor, mrr_minor, arr_minor, runway_months };
}

export async function recomputeMetrics(ctx: Context, period?: string): Promise<void> {
  const streams = await ctx.query(IncomeStream).where('status', '!=', 'dead');
  const targetPeriod = period ?? periodKey(new Date());

  for (const stream of streams) {
    const metrics = await computeStreamMetrics(ctx, stream, targetPeriod);
    await ctx
      .query(IncomeMetric)
      .insert({
        stream_id: stream.id,
        period: targetPeriod,
        revenue_minor: metrics.revenue_minor,
        cost_minor: metrics.cost_minor,
        net_minor: metrics.net_minor,
        mrr_minor: metrics.mrr_minor,
        arr_minor: metrics.arr_minor,
        runway_months: metrics.runway_months,
        computed_at: new Date().toISOString(),
      })
      .onConflict(['stream_id', 'period'])
      .merge({
        revenue_minor: metrics.revenue_minor,
        cost_minor: metrics.cost_minor,
        net_minor: metrics.net_minor,
        mrr_minor: metrics.mrr_minor,
        arr_minor: metrics.arr_minor,
        runway_months: metrics.runway_months,
        computed_at: new Date().toISOString(),
      });
  }
}
