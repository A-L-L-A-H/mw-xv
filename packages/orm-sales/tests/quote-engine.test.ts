import { describe, expect, it } from 'vitest';
import { compileQuote, projectOrderPayload } from '../src/index.js';

describe('Quote-to-Order Pricing Compiler', () => {
  it('applies tiered volume pricing, line discounts, quote-level cent allocation, and multi-jurisdiction taxes with zero cent drift', () => {
    const compiled = compileQuote({
      quoteId: 'Q-1001',
      customerId: 'CUST-42',
      currency: 'USD',
      lines: [
        {
          lineId: 'L1',
          sku: 'SEAT-PRO',
          quantity: 25,
          unitPriceCents: 10_000,
          unitCostCents: 2_000,
          volumeTiers: [
            { minQuantity: 10, unitPriceCents: 9_000 },
            { minQuantity: 25, unitPriceCents: 8_000 },
          ],
          discountBps: 500, // 5% off 200_000 = 10_000 -> 190_000
          taxCategory: 'saas',
        },
        {
          lineId: 'L2',
          sku: 'ONBOARDING',
          quantity: 1,
          unitPriceCents: 100_000,
          unitCostCents: 30_000,
          discountAmountCents: 5_000, // -> 95_000
          taxCategory: 'services',
          taxable: false,
        },
      ],
      quoteDiscountCents: 10_000, // allocated proportionally across 190_000 and 95_000 (2:1)
      taxRules: [
        { jurisdiction: 'US-CA-STATE', rateBps: 725, appliesToCategories: ['saas'] },
        {
          jurisdiction: 'US-CA-LOCAL',
          rateBps: 100,
          compound: true,
          appliesToCategories: ['saas'],
        },
      ],
      minGrossMarginBps: 5000,
    });

    expect(compiled.lines[0].appliedUnitPriceCents).toBe(8_000);
    expect(compiled.grossSubtotalCents).toBe(300_000);
    expect(compiled.lineDiscountTotalCents).toBe(15_000);
    expect(compiled.quoteDiscountTotalCents).toBe(10_000);
    expect(compiled.netSubtotalCents).toBe(275_000);

    // Verify zero cent drift: sum of line net subtotals === quote net subtotal
    const sumLineNets = compiled.lines.reduce((acc, l) => acc + l.netSubtotalCents, 0);
    expect(sumLineNets).toBe(compiled.netSubtotalCents);

    // Line 1 net = 190_000 - 6_667 = 183_333; Line 2 net = 95_000 - 3_333 = 91_667
    expect(compiled.lines[0].netSubtotalCents).toBe(183_333);
    expect(compiled.lines[1].netSubtotalCents).toBe(91_667);

    // State tax: round(183_333 * 725 / 10000) = 13_292
    // Local compound tax: round((183_333 + 13_292) * 100 / 10000) = 1_966
    expect(compiled.taxBreakdown[0].taxAmountCents).toBe(13_292);
    expect(compiled.taxBreakdown[1].taxAmountCents).toBe(1_966);
    expect(compiled.taxTotalCents).toBe(15_258);
    expect(compiled.grandTotalCents).toBe(290_258);

    // Gross margin: (275_000 - 80_000) / 275_000 = 70.90% (7090 bps) >= 5000 bps
    expect(compiled.totalCostCents).toBe(80_000);
    expect(compiled.grossMarginCents).toBe(195_000);
    expect(compiled.grossMarginBps).toBe(7090);
    expect(compiled.requiresApproval).toBe(false);
    expect(compiled.approvalReasons).toEqual([]);

    const payload = projectOrderPayload(compiled);
    expect(payload.status).toBe('ready_to_confirm');
    expect(payload.grandTotalCents).toBe(290_258);
    expect(payload.lines).toHaveLength(2);
  });

  it('triggers gross-margin floor guard and marks order payload pending_approval when discount breaches floor', () => {
    const compiled = compileQuote({
      quoteId: 'Q-1002',
      customerId: 'CUST-99',
      currency: 'USD',
      lines: [
        {
          lineId: 'L1',
          sku: 'HW-GATEWAY',
          quantity: 2,
          unitPriceCents: 50_000,
          unitCostCents: 35_000,
          discountBps: 2500, // 25% off -> net 75_000, cost 70_000 -> margin 5_000 / 75_000 = 666 bps
        },
      ],
      minGrossMarginBps: 2000,
      minLineGrossMarginBps: 1500,
    });

    expect(compiled.requiresApproval).toBe(true);
    expect(compiled.approvalReasons).toHaveLength(2);
    expect(compiled.approvalReasons[0]).toContain('Line L1 gross margin');
    expect(compiled.approvalReasons[1]).toContain('Quote gross margin');

    const payload = projectOrderPayload(compiled);
    expect(payload.status).toBe('pending_approval');
    expect(payload.requiresApproval).toBe(true);
  });
});
