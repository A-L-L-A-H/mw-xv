export interface JournalLineEntry {
  readonly accountCode: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
  readonly label: string;
}

export interface JournalEntry {
  readonly entryNo: string;
  readonly postingDate: string;
  readonly lines: readonly JournalLineEntry[];
}

export interface OrderToCashAccountMap {
  readonly accountsReceivableCode: string;
  readonly revenueCode: string;
  readonly taxPayableCode: string;
  readonly cashCode: string;
  readonly zakatExpenseCode?: string;
  readonly zakatPayableCode?: string;
}

export const DEFAULT_ISP_ACCOUNTS: OrderToCashAccountMap = {
  accountsReceivableCode: '1100',
  revenueCode: '4000',
  taxPayableCode: '2200',
  cashCode: '1000',
  zakatExpenseCode: '6900',
  zakatPayableCode: '2900',
};

export interface IspInvoiceInput {
  readonly invoiceId: string;
  readonly subscriberId: string | number;
  readonly username: string;
  readonly amountMinor: number;
  readonly taxRateBps?: number;
  readonly issueDate: string;
  readonly idempotencyKey: string;
  readonly isShariaCompliant?: boolean;
}

export interface IspPaymentSettlementInput {
  readonly settlementId: string;
  readonly invoiceId: string;
  readonly username: string;
  readonly amountMinor: number;
  readonly settlementDate: string;
  readonly idempotencyKey: string;
  readonly calculateZakat?: boolean;
  readonly zakatBps?: number; // e.g. 250 bps = 2.5%
}

export interface IspLedgerPostingRecord {
  readonly idempotencyKey: string;
  readonly referenceId: string;
  readonly journalEntry: JournalEntry;
  readonly totalDebitMinor: number;
  readonly totalCreditMinor: number;
  readonly isBalanced: boolean;
  readonly isShariaCompliant: boolean;
  readonly zakatMinor?: number;
}

export class OrderToCashBridge {
  private readonly ledger = new Map<string, IspLedgerPostingRecord>();
  private readonly accounts: OrderToCashAccountMap;

  constructor(accounts: Partial<OrderToCashAccountMap> = {}) {
    this.accounts = { ...DEFAULT_ISP_ACCOUNTS, ...accounts };
  }

  public postInvoice(input: IspInvoiceInput): IspLedgerPostingRecord {
    if (!input.idempotencyKey) throw new Error('idempotencyKey is required');
    const existing = this.ledger.get(input.idempotencyKey);
    if (existing) return existing;

    const taxRateBps = input.taxRateBps ?? 1100; // 11% PPN standard
    const netRevenue = Math.round((input.amountMinor * 10000) / (10000 + taxRateBps));
    const taxMinor = input.amountMinor - netRevenue;

    const lines: JournalLineEntry[] = [
      {
        accountCode: this.accounts.accountsReceivableCode,
        debitMinor: input.amountMinor,
        creditMinor: 0,
        label: `ISP AR for subscriber ${input.username} inv ${input.invoiceId}`,
      },
      {
        accountCode: this.accounts.revenueCode,
        debitMinor: 0,
        creditMinor: netRevenue,
        label: `ISP Subscription Revenue inv ${input.invoiceId}`,
      },
    ];

    if (taxMinor > 0) {
      lines.push({
        accountCode: this.accounts.taxPayableCode,
        debitMinor: 0,
        creditMinor: taxMinor,
        label: `PPN Keluaran inv ${input.invoiceId}`,
      });
    }

    const journalEntry: JournalEntry = {
      entryNo: `JE-INV-${input.invoiceId}`,
      postingDate: input.issueDate,
      lines,
    };

    const record: IspLedgerPostingRecord = {
      idempotencyKey: input.idempotencyKey,
      referenceId: input.invoiceId,
      journalEntry,
      totalDebitMinor: input.amountMinor,
      totalCreditMinor: input.amountMinor,
      isBalanced: true,
      isShariaCompliant: Boolean(input.isShariaCompliant),
    };

    this.ledger.set(input.idempotencyKey, record);
    return record;
  }

  public postSettlement(input: IspPaymentSettlementInput): IspLedgerPostingRecord {
    if (!input.idempotencyKey) throw new Error('idempotencyKey is required');
    const existing = this.ledger.get(input.idempotencyKey);
    if (existing) return existing;

    const lines: JournalLineEntry[] = [
      {
        accountCode: this.accounts.cashCode,
        debitMinor: input.amountMinor,
        creditMinor: 0,
        label: `Cash received for subscriber ${input.username} inv ${input.invoiceId}`,
      },
      {
        accountCode: this.accounts.accountsReceivableCode,
        debitMinor: 0,
        creditMinor: input.amountMinor,
        label: `AR cleared for subscriber ${input.username} inv ${input.invoiceId}`,
      },
    ];

    let zakatMinor = 0;
    if (input.calculateZakat) {
      const zakatBps = input.zakatBps ?? 250; // 2.5% standard Sharia zakat mal
      zakatMinor = Math.round((input.amountMinor * zakatBps) / 10000);
      if (zakatMinor > 0 && this.accounts.zakatExpenseCode && this.accounts.zakatPayableCode) {
        lines.push(
          {
            accountCode: this.accounts.zakatExpenseCode,
            debitMinor: zakatMinor,
            creditMinor: 0,
            label: `Zakat Mal Expense (2.5%) for ${input.invoiceId}`,
          },
          {
            accountCode: this.accounts.zakatPayableCode,
            debitMinor: 0,
            creditMinor: zakatMinor,
            label: `Zakat Mal Payable for ${input.invoiceId}`,
          }
        );
      }
    }

    const totalDebit = input.amountMinor + zakatMinor;
    const totalCredit = input.amountMinor + zakatMinor;

    const journalEntry: JournalEntry = {
      entryNo: `JE-PAY-${input.settlementId}`,
      postingDate: input.settlementDate,
      lines,
    };

    const record: IspLedgerPostingRecord = {
      idempotencyKey: input.idempotencyKey,
      referenceId: input.settlementId,
      journalEntry,
      totalDebitMinor: totalDebit,
      totalCreditMinor: totalCredit,
      isBalanced: true,
      isShariaCompliant: true,
      zakatMinor: zakatMinor > 0 ? zakatMinor : undefined,
    };

    this.ledger.set(input.idempotencyKey, record);
    return record;
  }
}
