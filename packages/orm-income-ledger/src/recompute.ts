import { Context } from '@moonwitness/orm';
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
  stream: IncomeStream,
  period: string,
): Promise<{
  revenueMinor: number;
  costMinor: number;
  netMinor: number;
  mrrMinor: number;
  arrMinor: number;
  runwayMonths: number | null;
}> {
  const { start, end } = periodBounds(period);
  const entries = await ctx
    .query(IncomeEntry)
    .where('streamId', stream.id)
    .andWhere('occurredAt', '>=', start)
    .andWhere('occurredAt', '<', end);

  const revenueResult = await entries.clone().andWhere('kind', 'revenue').sum('netMinor as total');
  const costResult = await entries.clone().andWhereIn('kind', ['cost', 'fee', 'tax']).sum('amountMinor as total');

  const rev = Number(revenueResult?.[0]?.total ?? 0);
  const cost = Number(costResult?.[0]?.total ?? 0);
  const netMinor = rev - cost;

  const mrrMinor = stream.kind === 'saas' && stream.status === 'live' ? stream.goalMonthlyMinor : 0;
  const arrMinor = mrrMinor * 12;

  let runwayMonths: number | null = null;
  if (netMinor > 0 && stream.goalMonthlyMinor > 0) {
    runwayMonths = Math.floor(stream.goalMonthlyMinor / netMinor);
  }

  return { revenueMinor: rev, costMinor: cost, netMinor, mrrMinor, arrMinor, runwayMonths };
}

export async function recomputeMetrics(ctx: Context, period?: string): Promise<void> {
  const streams = await ctx.query(IncomeStream).where('status', '!=', 'dead');
  const targetPeriod = period ?? periodKey(new Date());

  for (const stream of streams) {
    const metrics = await computeStreamMetrics(ctx, stream, targetPeriod);
    await ctx
      .query(IncomeMetric)
      .insert({
        streamId: stream.id,
        period: targetPeriod,
        revenueMinor: metrics.revenueMinor,
        costMinor: metrics.costMinor,
        netMinor: metrics.netMinor,
        mrrMinor: metrics.mrrMinor,
        arrMinor: metrics.arrMinor,
        runwayMonths: metrics.runwayMonths,
        computedAt: new Date(),
      })
      .onConflict(['streamId', 'period'])
      .merge({
        revenueMinor: metrics.revenueMinor,
        costMinor: metrics.costMinor,
        netMinor: metrics.netMinor,
        mrrMinor: metrics.mrrMinor,
        arrMinor: metrics.arrMinor,
        runwayMonths: metrics.runwayMonths,
        computedAt: new Date(),
      });
  }
}