import { describe, expect, it } from 'bun:test';
import { OrderToCashBridge } from '../src/order-to-cash-bridge.js';

describe('OrderToCashBridge', () => {
  it('posts a balanced double-entry journal for a sales invoice with tax and discount', () => {
    const bridge = new OrderToCashBridge();
    const record = bridge.postInvoice({
      invoiceId: 'INV-1001',
      kind: 'sales',
      customerId: 'CUST-42',
      currency: 'USD',
      issueDate: '2026-11-26',
      idempotencyKey: 'idem-inv-1001',
      lines: [
        {
          description: 'Enterprise License',
          quantity: 2,
          unitPriceMinor: 10000,
          discountMinor: 2000,
          taxRateBps: 1000,
        },
      ],
    });

    expect(record.subtotalMinor).toBe(20000);
    expect(record.discountMinor).toBe(2000);
    expect(record.netRevenueMinor).toBe(18000);
    expect(record.taxMinor).toBe(1800);
    expect(record.totalMinor).toBe(19800);
    expect(record.ledgerPosting.totalDebitMinor).toBe(19800);
    expect(record.ledgerPosting.totalCreditMinor).toBe(19800);
    expect(record.ledgerPosting.postings).toHaveLength(3);
  });

  it('returns the exact same record for duplicate idempotencyKey', () => {
    const bridge = new OrderToCashBridge();
    const first = bridge.postInvoice({
      invoiceId: 'SUB-2001',
      kind: 'subscription',
      customerId: 'CUST-99',
      currency: 'USD',
      issueDate: '2026-11-26',
      idempotencyKey: 'idem-sub-2001',
      lines: [
        {
          description: 'Pro Monthly',
          quantity: 1,
          unitPriceMinor: 4900,
          taxRateBps: 0,
        },
      ],
    });

    const second = bridge.postInvoice({
      invoiceId: 'SUB-2001',
      kind: 'subscription',
      customerId: 'CUST-99',
      currency: 'USD',
      issueDate: '2026-11-26',
      idempotencyKey: 'idem-sub-2001',
      lines: [
        {
          description: 'Pro Monthly',
          quantity: 1,
          unitPriceMinor: 4900,
          taxRateBps: 0,
        },
      ],
    });

    expect(second).toBe(first);
  });

  it('posts a balanced payment settlement and enforces idempotency', () => {
    const bridge = new OrderToCashBridge();
    const settlement = bridge.postPaymentSettlement({
      settlementId: 'SET-5001',
      invoiceId: 'INV-1001',
      settlementDate: '2026-11-26',
      amountMinor: 19800,
      idempotencyKey: 'idem-set-5001',
    });

    expect(settlement.ledgerPosting.totalDebitMinor).toBe(19800);
    expect(settlement.ledgerPosting.totalCreditMinor).toBe(19800);
    expect(settlement.ledgerPosting.postings).toEqual([
      {
        entryNo: 'O2C-SET-SET-5001',
        postingDate: '2026-11-26',
        accountCode: '1000',
        debitMinor: 19800,
        creditMinor: 0,
        netMinor: 19800,
      },
      {
        entryNo: 'O2C-SET-SET-5001',
        postingDate: '2026-11-26',
        accountCode: '1100',
        debitMinor: 0,
        creditMinor: 19800,
        netMinor: -19800,
      },
    ]);

    const duplicate = bridge.postPaymentSettlement({
      settlementId: 'SET-5001',
      invoiceId: 'INV-1001',
      settlementDate: '2026-11-26',
      amountMinor: 19800,
      idempotencyKey: 'idem-set-5001',
    });
    expect(duplicate).toBe(settlement);
  });
});
