import { describe, expect, it } from 'vitest';
import {
  detectStaleDeals,
  forecastPipelineRevenue,
  scoreLead,
  type PipelineDeal,
} from '../src/index.js';

describe('Lead Scoring Engine', () => {
  it('computes deterministic multi-signal score and hot/warm/cold tiers', () => {
    const hot = scoreLead({
      firmographicFit: 90,
      engagement: 85,
      buyingIntent: 95,
      budgetFit: 80,
      timelineUrgency: 70,
    });
    // (90*20 + 85*25 + 95*30 + 80*15 + 70*10) / 100 = (1800+2125+2850+1200+700)/100 = 86.75 -> 87
    expect(hot.score).toBe(87);
    expect(hot.tier).toBe('hot');

    const warm = scoreLead({
      firmographicFit: 60,
      engagement: 50,
      buyingIntent: 55,
      budgetFit: 50,
      timelineUrgency: 40,
    });
    expect(warm.score).toBe(53);
    expect(warm.tier).toBe('warm');

    const cold = scoreLead({
      firmographicFit: 20,
      engagement: 15,
      buyingIntent: 10,
      budgetFit: 25,
      timelineUrgency: 10,
    });
    expect(cold.score).toBe(16);
    expect(cold.tier).toBe('cold');
  });

  it('clamps out-of-range signals and applies adjustments cleanly to 0..100', () => {
    const maxed = scoreLead({
      firmographicFit: 150,
      engagement: 100,
      buyingIntent: 100,
      budgetFit: 100,
      timelineUrgency: 100,
      adjustments: { execSponsor: 25 },
    });
    expect(maxed.score).toBe(100);
    expect(maxed.tier).toBe('hot');

    const floored = scoreLead({
      firmographicFit: -50,
      engagement: 10,
      buyingIntent: 10,
      budgetFit: 0,
      timelineUrgency: 0,
      adjustments: { competitorLocked: -40 },
    });
    expect(floored.score).toBe(0);
    expect(floored.tier).toBe('cold');
  });
});

describe('Weighted Pipeline Revenue Forecast', () => {
  it('calculates exact integer-cent gross and weighted revenue by stage', () => {
    const deals: PipelineDeal[] = [
      { id: 'd-1', stage: 'qualified', amountCents: 100_000 }, // 25% -> 25_000
      { id: 'd-2', stage: 'proposal', amountCents: 200_000 }, // 50% -> 100_000
      { id: 'd-3', stage: 'negotiation', amountCents: 400_000 }, // 75% -> 300_000
      { id: 'd-4', stage: 'proposal', amountCents: 100_000, probabilityBps: 6000 }, // override 60% -> 60_000
      { id: 'd-5', stage: 'lost', amountCents: 500_000 }, // 0% -> 0
    ];

    const forecast = forecastPipelineRevenue(deals);
    expect(forecast.totalDeals).toBe(5);
    expect(forecast.totalGrossCents).toBe(1_300_000);
    expect(forecast.totalWeightedCents).toBe(485_000);

    const proposal = forecast.byStage.find((s) => s.stage === 'proposal');
    expect(proposal).toEqual({
      stage: 'proposal',
      dealCount: 2,
      stageProbabilityBps: 5000,
      grossAmountCents: 300_000,
      weightedAmountCents: 160_000,
    });
  });

  it('rejects non-integer or negative deal amounts', () => {
    expect(() => forecastPipelineRevenue([{ id: 'bad', stage: 'new', amountCents: 12.5 }])).toThrow(
      /non-negative integer/
    );
  });
});

describe('Stale-Deal Escalation Detector', () => {
  it('detects warning, critical, and executive escalations sorted by severity and ignores closed stages', () => {
    const asOf = '2026-06-30T00:00:00Z';
    const deals: PipelineDeal[] = [
      {
        id: 'fresh',
        stage: 'qualified',
        amountCents: 50_000,
        lastActivityAt: '2026-06-28T00:00:00Z',
      },
      {
        id: 'warn-1',
        stage: 'qualified',
        amountCents: 80_000,
        lastActivityAt: '2026-06-20T00:00:00Z',
        ownerId: 'rep-1',
      },
      {
        id: 'crit-1',
        stage: 'proposal',
        amountCents: 150_000,
        lastActivityAt: '2026-06-10T00:00:00Z',
        ownerId: 'rep-2',
      },
      {
        id: 'exec-1',
        stage: 'negotiation',
        amountCents: 500_000,
        lastActivityAt: '2026-05-20T00:00:00Z',
        ownerId: 'rep-3',
      },
      {
        id: 'closed-won',
        stage: 'won',
        amountCents: 900_000,
        lastActivityAt: '2026-01-01T00:00:00Z',
      },
    ];

    const escalations = detectStaleDeals(deals, asOf);
    expect(escalations).toHaveLength(3);
    expect(escalations.map((e) => [e.dealId, e.severity])).toEqual([
      ['exec-1', 'executive'],
      ['crit-1', 'critical'],
      ['warn-1', 'warning'],
    ]);
    expect(escalations[0].inactiveDays).toBe(41);
    expect(escalations[1].inactiveDays).toBe(20);
    expect(escalations[2].inactiveDays).toBe(10);
  });
});
