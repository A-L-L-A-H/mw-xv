import { describe, expect, it } from 'vitest';
import {
  BASIS_POINTS_TOTAL,
  INITIAL_WAQF_ASSETS,
  MINIMUM_HAUL_LUNAR_DAYS,
  ShariaMizanLedgerError,
  ZAKAT_RATE_DENOMINATOR,
  ZAKAT_RATE_NUMERATOR,
  assertDoubleEntryBalanced,
  assertWaqfAssetDispositionAllowed,
  auditMudharabahContract,
  auditMurabahahContract,
  buildInitialWaqfAssetRegistry,
  calculateCorporateZakat,
  checkDoubleEntryInvariant,
  checkWaqfAssetDisposition,
  findWaqfAsset,
} from '../src/index.js';
import type {
  CorporateZakatInput,
  DoubleEntryJournalInput,
  MudharabahContractInput,
  MurabahahContractInput,
} from '../src/sharia-mizan-ledger.js';

function balancedJournal(): DoubleEntryJournalInput {
  return {
    journalId: 'jurnal:zakat:2026-01',
    lines: [
      {
        id: 'jurnal:zakat:2026-01:baris-1',
        accountCode: 'KAS',
        debitMinorUnits: 250_000,
        creditMinorUnits: 0,
      },
      {
        id: 'jurnal:zakat:2026-01:baris-2',
        accountCode: 'UTANG-ZAKAT',
        debitMinorUnits: 0,
        creditMinorUnits: 250_000,
      },
    ],
  };
}

function zakatInput(): CorporateZakatInput {
  return {
    entityId: 'badan:usaha:mitra-nusantara',
    assessmentId: 'penilaian:zakat:2026:1124h',
    zakatableWealthMinorUnits: 1_000_000_000,
    nisabThresholdMinorUnits: 100_000_000,
    haulLunarDays: MINIMUM_HAUL_LUNAR_DAYS,
  };
}

function mudharabahInput(): MudharabahContractInput {
  return {
    contractId: 'akad:mudharabah:2026-001',
    capitalOwner: { id: 'pihak:pemodal:001', name: 'Yayasan Amal Nusantara' },
    entrepreneur: { id: 'pihak:usahawan:001', name: 'Koperasi Mandiri Sejahtera' },
    capitalMinorUnits: 500_000_000,
    capitalConveyed: true,
    capitalOwnerProfitShareBasisPoints: 4_000,
    entrepreneurProfitShareBasisPoints: 6_000,
    principalGuaranteed: false,
    lossAllocation: 'capital-owner-except-entrepreneur-misconduct',
    termStart: '2026-01-01T00:00:00.000Z',
    termEnd: '2026-12-31T00:00:00.000Z',
  };
}

function murabahahInput(): MurabahahContractInput {
  return {
    contractId: 'akad:murabahah:2026-001',
    seller: { id: 'pihak:penjual:001', name: 'PT Dagang Amanah' },
    buyer: { id: 'pihak:pembeli:001', name: 'CV Usaha Bersama' },
    assetDescription: 'Mesin cetak offset bekas dalam kondisi layak pakai',
    acquisitionCostMinorUnits: 120_000_000,
    disclosedMarginMinorUnits: 12_000_000,
    salePriceMinorUnits: 132_000_000,
    marginDisclosed: true,
    sellerOwnedBeforeSale: true,
    sellerPossessedBeforeSale: true,
    deferredPriceFixed: true,
    interestAdjustmentApplied: false,
    termStart: '2026-02-01T00:00:00.000Z',
    termEnd: '2027-01-31T00:00:00.000Z',
  };
}

describe('Sharia and Mizan ledger primitives', () => {
  it('checks the double-entry invariant and rejects invalid journal structure', () => {
    const result = checkDoubleEntryInvariant(balancedJournal());
    expect(result).toMatchObject({
      journalId: 'jurnal:zakat:2026-01',
      balanced: true,
      totalDebitMinorUnits: 250_000,
      totalCreditMinorUnits: 250_000,
      differenceMinorUnits: 0,
      lineCount: 2,
    });
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(() => assertDoubleEntryBalanced(balancedJournal())).not.toThrow();

    const unbalanced = balancedJournal();
    unbalanced.lines[1].creditMinorUnits = 249_999;
    const failed = checkDoubleEntryInvariant(unbalanced);
    expect(failed.balanced).toBe(false);
    expect(failed.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'unbalanced-journal' })])
    );
    expect(() => assertDoubleEntryBalanced(unbalanced)).toThrow(ShariaMizanLedgerError);

    const malformed = balancedJournal();
    malformed.lines[0].debitMinorUnits = 1.5;
    expect(() => checkDoubleEntryInvariant(malformed)).toThrow(/safe integer/i);
  });

  it('calculates corporate zakat at 2.5 percent with haul and nisab gates', () => {
    expect(ZAKAT_RATE_NUMERATOR / ZAKAT_RATE_DENOMINATOR).toBe(0.025);
    const due = calculateCorporateZakat(zakatInput());
    expect(due).toMatchObject({
      status: 'due',
      haulCompleted: true,
      nisabMet: true,
      dueMinorUnits: 25_000_000,
    });
    expect(due.rate.percent).toBe('2.5');

    const belowNisab = calculateCorporateZakat({
      ...zakatInput(),
      zakatableWealthMinorUnits: 99_999_999,
    });
    expect(belowNisab.status).toBe('below-nisab');
    expect(belowNisab.dueMinorUnits).toBe(0);

    const haulIncomplete = calculateCorporateZakat({ ...zakatInput(), haulLunarDays: 353 });
    expect(haulIncomplete.status).toBe('haul-incomplete');
    expect(haulIncomplete.dueMinorUnits).toBe(0);

    const rounded = calculateCorporateZakat({
      ...zakatInput(),
      zakatableWealthMinorUnits: 101,
      nisabThresholdMinorUnits: 100,
    });
    expect(rounded.dueMinorUnits).toBe(2);
  });

  it('audits mudharabah contracts for profit split, capital, and loss allocation', () => {
    expect(auditMudharabahContract(mudharabahInput())).toMatchObject({
      contractType: 'mudharabah',
      compliant: true,
      issues: [],
    });

    const invalid = mudharabahInput();
    invalid.capitalOwnerProfitShareBasisPoints = BASIS_POINTS_TOTAL;
    invalid.capitalConveyed = false;
    invalid.principalGuaranteed = true;
    invalid.lossAllocation = 'capital-owner';
    invalid.entrepreneur.id = invalid.capitalOwner.id;
    const audit = auditMudharabahContract(invalid);
    expect(audit.compliant).toBe(false);
    expect(audit.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'invalid-party',
        'invalid-amount',
        'profit-split-mismatch',
        'principal-guarantee',
      ])
    );
  });

  it('audits murabahah contracts for price, disclosure, possession, and interest', () => {
    expect(auditMurabahahContract(murabahahInput())).toMatchObject({
      contractType: 'murabahah',
      compliant: true,
      issues: [],
    });

    const invalid = murabahahInput();
    invalid.salePriceMinorUnits = 130_000_000;
    invalid.marginDisclosed = false;
    invalid.sellerOwnedBeforeSale = false;
    invalid.sellerPossessedBeforeSale = false;
    invalid.deferredPriceFixed = false;
    invalid.interestAdjustmentApplied = true;
    const audit = auditMurabahahContract(invalid);
    expect(audit.compliant).toBe(false);
    expect(audit.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'price-mismatch',
        'undisclosed-margin',
        'missing-ownership',
        'missing-possession',
        'unfixed-price',
        'interest-adjustment',
      ])
    );
  });

  it('builds a deterministic perpetual waqf registry and blocks every disposition', () => {
    const registry = buildInitialWaqfAssetRegistry();
    expect(registry.assets).toEqual(INITIAL_WAQF_ASSETS);
    expect(registry.assets).toHaveLength(4);
    expect(Object.isFrozen(registry.assetsById)).toBe(true);
    expect(registry.assets.every((asset) => asset.perpetual)).toBe(true);

    const asset = findWaqfAsset(registry, INITIAL_WAQF_ASSETS[0].id);
    expect(asset).toBe(INITIAL_WAQF_ASSETS[0]);
    expect(findWaqfAsset(registry, 'mw:waqf-asset:absent')).toBeUndefined();
    expect(checkWaqfAssetDisposition(asset!, 'sale')).toMatchObject({
      allowed: false,
      code: 'waqf-disposition-forbidden',
    });
    expect(() => assertWaqfAssetDispositionAllowed(asset!, 'mortgage')).toThrow(
      ShariaMizanLedgerError
    );
  });
});
