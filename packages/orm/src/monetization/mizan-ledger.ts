import type {
  JournalEntry,
  JournalLine,
  MizanAccountConfig,
  MizanJournalBatch,
  MizanLedgerInput,
  ReserveCalculationBase,
} from './types.js';

export const PPH_FINAL_UMKM_BPS = 50; // 0.50%
export const ZAKAT_MAAL_BPS = 250; // 2.50%

const DEFAULT_ACCOUNTS: Required<MizanAccountConfig> = {
  cashClearingCode: '1110',
  cashClearingName: 'Cash & Payment Gateway Clearing',
  gatewayFeeCode: '5110',
  gatewayFeeName: 'Payment Gateway Fee Expense',
  revenueCode: '4100',
  revenueName: 'Operating Revenue',
  pphExpenseCode: '5210',
  pphExpenseName: 'PPh Final 0.5% UMKM Tax Expense',
  pphReserveCode: '2110',
  pphReserveName: 'PPh Final 0.5% UMKM Tax Reserve Payable',
  zakatExpenseCode: '5220',
  zakatExpenseName: 'Zakat Maal 2.5% Allocation Expense',
  zakatReserveCode: '2120',
  zakatReserveName: 'Zakat Maal 2.5% Reserve Payable',
};

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer (received ${String(value)}).`);
  }
}

/**
 * Calculates reserve amounts from basis points (1 bps = 0.01%) using exact integer arithmetic.
 */
export function calculateBasisPointsAmount(
  baseAmount: number,
  bps: number,
  roundingMode: 'half-up' | 'floor' | 'trunc' = 'half-up'
): number {
  assertNonNegativeInteger(baseAmount, 'baseAmount');
  assertNonNegativeInteger(bps, 'bps');

  const numerator = baseAmount * bps;
  if (roundingMode === 'half-up') {
    return Math.floor((numerator + 5000) / 10000);
  }
  return Math.floor(numerator / 10000);
}

/**
 * Computes total debits, total credits, and verifies strict double-entry balance.
 */
export function summarizeJournalBalance(lines: readonly JournalLine[]): {
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
} {
  let totalDebits = 0;
  let totalCredits = 0;

  for (const line of lines) {
    assertNonNegativeInteger(line.amount, `line(${line.accountCode}).amount`);
    if (line.side === 'debit') {
      totalDebits += line.amount;
    } else {
      totalCredits += line.amount;
    }
  }

  return {
    totalDebits,
    totalCredits,
    balanced: totalDebits === totalCredits,
  };
}

function buildBalancedEntry(params: {
  entryId: string;
  entryType: JournalEntry['entryType'];
  referenceId: string;
  postedAt: string;
  currency: string;
  lines: JournalLine[];
}): JournalEntry {
  const summary = summarizeJournalBalance(params.lines);
  if (!summary.balanced) {
    throw new Error(
      `Unbalanced journal entry ${params.entryId}: debits=${summary.totalDebits} credits=${summary.totalCredits}`
    );
  }
  return { ...params, ...summary };
}

function buildRevenueLines(params: {
  referenceId: string;
  grossAmount: number;
  gatewayFee: number;
  currency: string;
  coa: Required<MizanAccountConfig>;
}): JournalLine[] {
  const { referenceId, grossAmount, gatewayFee, currency, coa } = params;
  const lines: JournalLine[] = [];
  const netClearingAmount = grossAmount - gatewayFee;
  if (netClearingAmount > 0) {
    lines.push({
      accountCode: coa.cashClearingCode,
      accountName: coa.cashClearingName,
      side: 'debit',
      amount: netClearingAmount,
      currency,
      memo: `Settlement clearing for ${referenceId}`,
    });
  }
  if (gatewayFee > 0) {
    lines.push({
      accountCode: coa.gatewayFeeCode,
      accountName: coa.gatewayFeeName,
      side: 'debit',
      amount: gatewayFee,
      currency,
      memo: `Payment gateway fee for ${referenceId}`,
    });
  }
  if (grossAmount > 0) {
    lines.push({
      accountCode: coa.revenueCode,
      accountName: coa.revenueName,
      side: 'credit',
      amount: grossAmount,
      currency,
      memo: `Gross operating revenue for ${referenceId}`,
    });
  }
  return lines;
}

function buildReserveEntry(params: {
  entryId: string;
  entryType: 'pph_final_umkm_reserve' | 'zakat_maal_reserve';
  referenceId: string;
  postedAt: string;
  currency: string;
  amount: number;
  expenseCode: string;
  expenseName: string;
  reserveCode: string;
  reserveName: string;
  memoLabel: string;
}): JournalEntry {
  return buildBalancedEntry({
    entryId: params.entryId,
    entryType: params.entryType,
    referenceId: params.referenceId,
    postedAt: params.postedAt,
    currency: params.currency,
    lines: [
      {
        accountCode: params.expenseCode,
        accountName: params.expenseName,
        side: 'debit',
        amount: params.amount,
        currency: params.currency,
        memo: `${params.memoLabel} expense for ${params.referenceId}`,
      },
      {
        accountCode: params.reserveCode,
        accountName: params.reserveName,
        side: 'credit',
        amount: params.amount,
        currency: params.currency,
        memo: `${params.memoLabel} payable for ${params.referenceId}`,
      },
    ],
  });
}

function resolveZakatBase(
  grossAmount: number,
  gatewayFee: number,
  pphFinalAmount: number,
  mode: ReserveCalculationBase
): number {
  if (mode === 'net_after_fee') return Math.max(0, grossAmount - gatewayFee);
  if (mode === 'net_after_tax') return Math.max(0, grossAmount - gatewayFee - pphFinalAmount);
  return grossAmount;
}

function appendReserveEntries(params: {
  entries: JournalEntry[];
  referenceId: string;
  postedAt: string;
  currency: string;
  pphFinalAmount: number;
  zakatMaalAmount: number;
  coa: Required<MizanAccountConfig>;
}): void {
  const { entries, referenceId, postedAt, currency, pphFinalAmount, zakatMaalAmount, coa } = params;
  if (pphFinalAmount > 0) {
    entries.push(
      buildReserveEntry({
        entryId: `${referenceId}:pph05`,
        entryType: 'pph_final_umkm_reserve',
        referenceId,
        postedAt,
        currency,
        amount: pphFinalAmount,
        expenseCode: coa.pphExpenseCode,
        expenseName: coa.pphExpenseName,
        reserveCode: coa.pphReserveCode,
        reserveName: coa.pphReserveName,
        memoLabel: 'PPh Final 0.5% UMKM reserve',
      })
    );
  }
  if (zakatMaalAmount > 0) {
    entries.push(
      buildReserveEntry({
        entryId: `${referenceId}:zakat25`,
        entryType: 'zakat_maal_reserve',
        referenceId,
        postedAt,
        currency,
        amount: zakatMaalAmount,
        expenseCode: coa.zakatExpenseCode,
        expenseName: coa.zakatExpenseName,
        reserveCode: coa.zakatReserveCode,
        reserveName: coa.zakatReserveName,
        memoLabel: 'Zakat Maal 2.5% allocation',
      })
    );
  }
}

/**
 * Generates balanced Mizan double-entry journal postings for settled revenue,
 * auto-posting PPh Final 0.5% UMKM tax reserve and 2.5% Zakat Maal reserve entries.
 */
export function generateMizanSettlementEntries(input: MizanLedgerInput): MizanJournalBatch {
  if (!input.referenceId) {
    throw new Error('Mizan ledger input requires a non-empty referenceId.');
  }
  const grossAmount = input.grossAmount;
  const gatewayFee = input.gatewayFee ?? 0;
  assertNonNegativeInteger(grossAmount, 'grossAmount');
  assertNonNegativeInteger(gatewayFee, 'gatewayFee');
  if (gatewayFee > grossAmount) {
    throw new RangeError('gatewayFee cannot exceed grossAmount.');
  }

  const currency = input.currency ?? 'IDR';
  const postedAt = input.postedAt ?? new Date().toISOString();
  const roundingMode = input.roundingMode ?? 'half-up';
  const coa: Required<MizanAccountConfig> = { ...DEFAULT_ACCOUNTS, ...(input.accounts ?? {}) };

  const pphFinalAmount = calculateBasisPointsAmount(grossAmount, PPH_FINAL_UMKM_BPS, roundingMode);
  const zakatBase = resolveZakatBase(grossAmount, gatewayFee, pphFinalAmount, input.zakatBase ?? 'gross');
  const zakatMaalAmount = calculateBasisPointsAmount(zakatBase, ZAKAT_MAAL_BPS, roundingMode);

  const entries: JournalEntry[] = [
    buildBalancedEntry({
      entryId: `${input.referenceId}:rev`,
      entryType: 'revenue_recognition',
      referenceId: input.referenceId,
      postedAt,
      currency,
      lines: buildRevenueLines({
        referenceId: input.referenceId,
        grossAmount,
        gatewayFee,
        currency,
        coa,
      }),
    }),
  ];

  appendReserveEntries({
    entries,
    referenceId: input.referenceId,
    postedAt,
    currency,
    pphFinalAmount,
    zakatMaalAmount,
    coa,
  });

  const consolidatedLines = entries.flatMap((entry) => entry.lines);
  return {
    referenceId: input.referenceId,
    currency,
    postedAt,
    grossAmount,
    gatewayFee,
    pphFinalAmount,
    zakatMaalAmount,
    netRetainedAmount: grossAmount - gatewayFee - pphFinalAmount - zakatMaalAmount,
    entries,
    consolidatedLines,
    ...summarizeJournalBalance(consolidatedLines),
  };
}
