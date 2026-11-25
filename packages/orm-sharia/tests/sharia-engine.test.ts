import { describe, expect, it } from 'vitest';
import {
  calculateZakat,
  validateShariaContract,
  computeWaqfMerkle,
  appendWaqfMerkleEvent,
} from '../src/index.js';
import type { Knex } from 'knex';

const DB_MOCK = {} as unknown as Knex;

describe('Zakat Calculator', () => {
  it('computes nisab threshold from gold price at 85 grams and applies 2.5% rate when nisab met', async () => {
    const result = await calculateZakat(DB_MOCK, {
      companyId: 1,
      assessmentDate: '2026-01-01',
      hijriYear: 1447,
      zakatType: 'maal',
      assetCategory: 'cash',
      grossAssetsMinor: 2_000_000_000,
      deductibleLiabilitiesMinor: 500_000_000,
      nisabGoldPricePerGramMinor: 12_000_000,
    });

    expect(result.nisabThresholdMinor).toBe(1_020_000_000); // 85 * 12_000_000
    expect(result.netZakatableMinor).toBe(1_500_000_000);
    expect(result.nisabMet).toBe(true);
    expect(result.zakatRateBps).toBe(250);
    expect(result.zakatDueMinor).toBe(37_500_000); // 2.5% of 1_500_000_000
  });

  it('returns zero zakat when net zakatable assets fall below nisab', async () => {
    const result = await calculateZakat(DB_MOCK, {
      companyId: 1,
      assessmentDate: '2026-01-01',
      hijriYear: 1447,
      zakatType: 'trade',
      assetCategory: 'inventory',
      grossAssetsMinor: 900_000_000,
      deductibleLiabilitiesMinor: 100_000_000,
      nisabGoldPricePerGramMinor: 12_000_000,
    });

    expect(result.netZakatableMinor).toBe(800_000_000);
    expect(result.nisabMet).toBe(false);
    expect(result.zakatDueMinor).toBe(0);
  });

  it('supports custom zakat rate (rikaz 20%) overriding default', async () => {
    const result = await calculateZakat(DB_MOCK, {
      companyId: 1,
      assessmentDate: '2026-01-01',
      hijriYear: 1447,
      zakatType: 'rikaz',
      assetCategory: 'other',
      grossAssetsMinor: 1_000_000_000,
      deductibleLiabilitiesMinor: 0,
      nisabGoldPricePerGramMinor: 12_000_000,
      zakatRateBps: 2000,
    });

    expect(result.zakatRateBps).toBe(2000);
    expect(result.zakatDueMinor).toBe(200_000_000);
  });
});

describe('Sharia Contract Validator', () => {
  it('accepts a valid murabahah contract with positive profit margin and DSN-MUI reference', () => {
    const result = validateShariaContract({
      type: 'murabahah',
      assetValueMinor: 500_000_000,
      profitMarginMinor: 50_000_000,
      dsnMuiReference: 'DSN-MUI/FATWA/IV/2000',
      ribaFreeConfirmed: true,
      ghararFreeConfirmed: true,
    });

    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects murabahah without profit margin and mudharabah without profit sharing ratio', () => {
    const murabahah = validateShariaContract({
      type: 'murabahah',
      assetValueMinor: 500_000_000,
      dsnMuiReference: 'DSN-MUI/FATWA/IV/2000',
      ribaFreeConfirmed: true,
      ghararFreeConfirmed: true,
    });
    expect(murabahah.valid).toBe(false);
    expect(murabahah.violations.some((v) => v.includes('profit_margin_minor'))).toBe(true);

    const mudharabah = validateShariaContract({
      type: 'mudharabah',
      assetValueMinor: 500_000_000,
      financingAmountMinor: 100_000_000,
      dsnMuiReference: 'DSN-MUI/FATWA/VII/2004',
      ribaFreeConfirmed: true,
      ghararFreeConfirmed: true,
    });
    expect(mudharabah.valid).toBe(false);
    expect(mudharabah.violations.some((v) => v.includes('profit_sharing_ratio'))).toBe(true);
  });

  it('rejects contracts without riba-free or gharar-free confirmation and missing DSN-MUI reference', () => {
    const result = validateShariaContract({
      type: 'ijarah',
      assetValueMinor: 500_000_000,
      tenorMonths: 36,
      dsnMuiReference: '',
      ribaFreeConfirmed: false,
      ghararFreeConfirmed: false,
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toContain('Riba-free confirmation is required');
    expect(result.violations).toContain('Gharar-free confirmation is required');
    expect(result.violations).toContain('DSN-MUI reference is required');
  });
});

describe('Waqf Asset Merkle Trail', () => {
  it('computes deterministic merkle root from event trail and detects tampering on verify', async () => {
    const assetId = 1;
    const trailInput = [
      {
        event: 'acquisition',
        timestamp: '2024-01-01T00:00:00.000Z',
        valueMinor: 1_500_000_000,
        description: 'Cloud cluster funded',
      },
      {
        event: 'yield_distribution',
        timestamp: '2024-12-31T00:00:00.000Z',
        valueMinor: 180_000_000,
        description: 'Annual compute yield',
      },
    ] as const;

    const appended = await appendWaqfMerkleEvent(DB_MOCK, assetId, trailInput[0]);
    expect(appended.verified).toBe(true);
    expect(appended.trail).toHaveLength(1);
    expect(appended.trail[0].hash).toHaveLength(64);

    const appended2 = await appendWaqfMerkleEvent(DB_MOCK, assetId, trailInput[1]);
    expect(appended2.trail).toHaveLength(2);
    expect(appended2.merkleRoot).toHaveLength(64);

    const verified = await computeWaqfMerkle(DB_MOCK, { assetId, trail: appended2.trail });
    expect(verified.verified).toBe(true);
    expect(verified.merkleRoot).toBe(appended2.merkleRoot);

    const tampered = await computeWaqfMerkle(DB_MOCK, {
      assetId,
      trail: appended2.trail.map((node, idx) => (idx === 0 ? { ...node, valueMinor: 999 } : node)),
    });
    expect(tampered.verified).toBe(false);
    expect(tampered.merkleRoot).not.toBe(appended2.merkleRoot);
  });
});
