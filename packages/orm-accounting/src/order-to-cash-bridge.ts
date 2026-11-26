import {
  postJournalEntry,
  type JournalEntryInput,
  type JournalLineInput,
  type LedgerPostingResult,
} from './accounting-engine.js';

export type InvoiceKind = 'sales' | 'subscription';

export interface OrderToCashAccountMap {
  readonly accountsReceivableCode: string;
  readonly revenueCode: string;
  readonly taxPayableCode: string;
  readonly cashCode: string;
}

export const DEFAULT_ORDER_TO_CASH_ACCOUNTS: OrderToCashAccountMap = {
  accountsReceivableCode: '1100',
  revenueCode: '4000',
  taxPayableCode: '2200',
  cashCode: '1000',
};

export interface InvoiceLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly discountMinor?: number;
  readonly taxRateBps?: number;
  readonly revenueAccountCode?: string;
}

export interface OrderToCashInvoiceInput {
  readonly invoiceId: string;
  readonly kind: InvoiceKind;
  readonly customerId: string;
  readonly currency: string;
  readonly issueDate: string;
  readonly idempotencyKey: string;
  readonly lines: readonly InvoiceLineItem[];
  readonly accounts?: Partial<OrderToCashAccountMap>;
}

export interface OrderToCashLedgerRecord {
  readonly idempotencyKey: string;
  readonly invoiceId: string;
  readonly kind: InvoiceKind;
  readonly customerId: string;
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly netRevenueMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly journalEntry: JournalEntryInput;
  readonly ledgerPosting: LedgerPostingResult;
}

export interface PaymentSettlementInput {
  readonly settlementId: string;
  readonly invoiceId: string;
  readonly settlementDate: string;
  readonly amountMinor: number;
  readonly idempotencyKey: string;
  readonly accounts?: Partial<OrderToCashAccountMap>;
}

export interface PaymentSettlementRecord {
  readonly idempotencyKey: string;
  readonly settlementId: string;
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly journalEntry: JournalEntryInput;
  readonly ledgerPosting: LedgerPostingResult;
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (!value.trim()) {
    throw new Error(`${fieldName} is required`);
  }
}

function resolveAccounts(overrides?: Partial<OrderToCashAccountMap>): OrderToCashAccountMap {
  return {
    accountsReceivableCode:
      overrides?.accountsReceivableCode ?? DEFAULT_ORDER_TO_CASH_ACCOUNTS.accountsReceivableCode,
    revenueCode: overrides?.revenueCode ?? DEFAULT_ORDER_TO_CASH_ACCOUNTS.revenueCode,
    taxPayableCode: overrides?.taxPayableCode ?? DEFAULT_ORDER_TO_CASH_ACCOUNTS.taxPayableCode,
    cashCode: overrides?.cashCode ?? DEFAULT_ORDER_TO_CASH_ACCOUNTS.cashCode,
  };
}

/**
 * Deterministic order-to-cash-to-ledger bridge converting invoices and payment
 * settlements into balanced double-entry journal postings with idempotency.
 */
export class OrderToCashBridge {
  private readonly invoiceRecords = new Map<string, OrderToCashLedgerRecord>();
  private readonly settlementRecords = new Map<string, PaymentSettlementRecord>();

  public postInvoice(input: OrderToCashInvoiceInput): OrderToCashLedgerRecord {
    assertNonEmpty(input.idempotencyKey, 'idempotencyKey');
    const existing = this.invoiceRecords.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    assertNonEmpty(input.invoiceId, 'invoiceId');
    assertNonEmpty(input.customerId, 'customerId');
    assertNonEmpty(input.currency, 'currency');
    assertNonEmpty(input.issueDate, 'issueDate');
    if (input.lines.length === 0) {
      throw new Error('Invoice must contain at least one line item');
    }

    const accounts = resolveAccounts(input.accounts);
    const revenueByAccount = new Map<string, number>();

    let subtotalMinor = 0;
    let discountMinor = 0;
    let netRevenueMinor = 0;
    let taxMinor = 0;

    for (const [index, line] of input.lines.entries()) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        throw new Error(`Line ${index + 1}: quantity must be a positive number`);
      }
      if (!Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) {
        throw new Error(`Line ${index + 1}: unitPriceMinor must be a non-negative integer`);
      }
      const lineDiscount = line.discountMinor ?? 0;
      if (!Number.isInteger(lineDiscount) || lineDiscount < 0) {
        throw new Error(`Line ${index + 1}: discountMinor must be a non-negative integer`);
      }
      const taxRateBps = line.taxRateBps ?? 0;
      if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
        throw new Error(`Line ${index + 1}: taxRateBps must be an integer between 0 and 10000`);
      }

      const lineGross = Math.round(line.quantity * line.unitPriceMinor);
      const lineNet = lineGross - lineDiscount;
      if (lineNet < 0) {
        throw new Error(`Line ${index + 1}: discountMinor cannot exceed gross line amount`);
      }
      const lineTax = Math.round((lineNet * taxRateBps) / 10000);

      subtotalMinor += lineGross;
      discountMinor += lineDiscount;
      netRevenueMinor += lineNet;
      taxMinor += lineTax;

      const revenueCode = line.revenueAccountCode?.trim() || accounts.revenueCode;
      revenueByAccount.set(revenueCode, (revenueByAccount.get(revenueCode) ?? 0) + lineNet);
    }

    const totalMinor = netRevenueMinor + taxMinor;
    const lines: JournalLineInput[] = [
      {
        accountCode: accounts.accountsReceivableCode,
        debitMinor: totalMinor,
        creditMinor: 0,
        label: `AR ${input.kind} invoice ${input.invoiceId}`,
      },
    ];

    const sortedRevenueAccounts = Array.from(revenueByAccount.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    for (const [accountCode, amount] of sortedRevenueAccounts) {
      if (amount > 0) {
        lines.push({
          accountCode,
          debitMinor: 0,
          creditMinor: amount,
          label: `Revenue ${input.kind} invoice ${input.invoiceId}`,
        });
      }
    }

    if (taxMinor > 0) {
      lines.push({
        accountCode: accounts.taxPayableCode,
        debitMinor: 0,
        creditMinor: taxMinor,
        label: `Tax payable invoice ${input.invoiceId}`,
      });
    }

    const journalEntry: JournalEntryInput = {
      entryNo: `O2C-INV-${input.invoiceId}`,
      postingDate: input.issueDate,
      lines,
    };
    const ledgerPosting = postJournalEntry(journalEntry);

    const record: OrderToCashLedgerRecord = {
      idempotencyKey: input.idempotencyKey,
      invoiceId: input.invoiceId,
      kind: input.kind,
      customerId: input.customerId,
      currency: input.currency,
      subtotalMinor,
      discountMinor,
      netRevenueMinor,
      taxMinor,
      totalMinor,
      journalEntry,
      ledgerPosting,
    };

    this.invoiceRecords.set(input.idempotencyKey, record);
    return record;
  }

  public postPaymentSettlement(input: PaymentSettlementInput): PaymentSettlementRecord {
    assertNonEmpty(input.idempotencyKey, 'idempotencyKey');
    const existing = this.settlementRecords.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    assertNonEmpty(input.settlementId, 'settlementId');
    assertNonEmpty(input.invoiceId, 'invoiceId');
    assertNonEmpty(input.settlementDate, 'settlementDate');
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error('amountMinor must be a positive integer');
    }

    const accounts = resolveAccounts(input.accounts);
    const journalEntry: JournalEntryInput = {
      entryNo: `O2C-SET-${input.settlementId}`,
      postingDate: input.settlementDate,
      lines: [
        {
          accountCode: accounts.cashCode,
          debitMinor: input.amountMinor,
          creditMinor: 0,
          label: `Cash receipt ${input.settlementId} for ${input.invoiceId}`,
        },
        {
          accountCode: accounts.accountsReceivableCode,
          debitMinor: 0,
          creditMinor: input.amountMinor,
          label: `AR settlement ${input.settlementId} for ${input.invoiceId}`,
        },
      ],
    };
    const ledgerPosting = postJournalEntry(journalEntry);

    const record: PaymentSettlementRecord = {
      idempotencyKey: input.idempotencyKey,
      settlementId: input.settlementId,
      invoiceId: input.invoiceId,
      amountMinor: input.amountMinor,
      journalEntry,
      ledgerPosting,
    };

    this.settlementRecords.set(input.idempotencyKey, record);
    return record;
  }
}
