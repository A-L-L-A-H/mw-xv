import { describe, expect, it } from 'vitest';
import {
  applyRepricing,
  resolveVariantPrice,
  parseRepricingRule,
  type VariantSelection,
  type RepricingRule,
} from '../src/pricing.js';

const sampleVariants: readonly VariantSelection[] = [
  {
    id: 101,
    product: 1,
    sku: 'DIG-EBOOK-0001-STD',
    attributes: { format: 'pdf', license: 'standard' },
    priceAdjustmentMinor: 0,
    stockQty: 100,
  },
  {
    id: 102,
    product: 1,
    sku: 'DIG-EBOOK-0001-PRO',
    attributes: { format: 'epub', license: 'pro', includesSource: true },
    priceAdjustmentMinor: 500,
    stockQty: 50,
  },
  {
    id: 103,
    product: 1,
    sku: 'DIG-EBOOK-0001-EDU',
    attributes: { format: 'pdf', license: 'educational' },
    priceAdjustmentMinor: -1000,
    stockQty: 200,
  },
];

describe('pricing: applyRepricing', () => {
  it('applies percentage discount only', () => {
    const rule: RepricingRule = { discountPercent: 20 };
    const result = applyRepricing(10000, null, rule);
    expect(result.newPriceMinor).toBe(8000);
    expect(result.appliedDiscountMinor).toBe(2000);
    expect(result.appliedMarkdownMinor).toBe(0);
    expect(result.costFloorClamped).toBe(false);
  });

  it('applies absolute markdown only', () => {
    const rule: RepricingRule = { markdownMinor: 1500 };
    const result = applyRepricing(10000, null, rule);
    expect(result.newPriceMinor).toBe(8500);
    expect(result.appliedDiscountMinor).toBe(0);
    expect(result.appliedMarkdownMinor).toBe(1500);
  });

  it('applies discount then markdown sequentially', () => {
    const rule: RepricingRule = { discountPercent: 10, markdownMinor: 500 };
    const result = applyRepricing(10000, null, rule);
    expect(result.newPriceMinor).toBe(8500);
    expect(result.appliedDiscountMinor).toBe(1000);
    expect(result.appliedMarkdownMinor).toBe(500);
  });

  it('clamps to cost floor when enabled', () => {
    const rule: RepricingRule = { discountPercent: 50, respectCostFloor: true };
    const result = applyRepricing(10000, 8000, rule);
    expect(result.newPriceMinor).toBe(8000);
    expect(result.costFloorClamped).toBe(true);
  });

  it('does not clamp when cost floor is disabled', () => {
    const rule: RepricingRule = { discountPercent: 50, respectCostFloor: false };
    const result = applyRepricing(10000, 8000, rule);
    expect(result.newPriceMinor).toBe(5000);
    expect(result.costFloorClamped).toBe(false);
  });

  it('never goes below zero', () => {
    const rule: RepricingRule = { markdownMinor: 20000 };
    const result = applyRepricing(5000, null, rule);
    expect(result.newPriceMinor).toBe(0);
  });

  it('truncates fractional results', () => {
    const rule: RepricingRule = { discountPercent: 33 };
    const result = applyRepricing(1000, null, rule);
    expect(result.appliedDiscountMinor).toBe(330);
    expect(result.newPriceMinor).toBe(670);
  });

  it('throws on negative base price', () => {
    const rule: RepricingRule = { discountPercent: 10 };
    expect(() => applyRepricing(-1, null, rule)).toThrow('basePriceMinor must be a non-negative finite number');
  });

  it('throws on invalid discount percent', () => {
    const rule: RepricingRule = { discountPercent: 150 };
    expect(() => applyRepricing(1000, null, rule)).toThrow('discountPercent must be a number between 0 and 100');
  });
});

describe('pricing: resolveVariantPrice', () => {
  it('returns base price when no variant SKU provided', () => {
    const result = resolveVariantPrice(10000, sampleVariants, undefined);
    expect(result.finalPriceMinor).toBe(10000);
    expect(result.variantId).toBeNull();
  });

  it('returns base price when empty string SKU provided', () => {
    const result = resolveVariantPrice(10000, sampleVariants, '');
    expect(result.finalPriceMinor).toBe(10000);
    expect(result.variantId).toBeNull();
  });

  it('resolves variant with zero adjustment', () => {
    const result = resolveVariantPrice(10000, sampleVariants, 'DIG-EBOOK-0001-STD');
    expect(result.variantId).toBe(101);
    expect(result.basePriceMinor).toBe(10000);
    expect(result.adjustmentMinor).toBe(0);
    expect(result.finalPriceMinor).toBe(10000);
  });

  it('resolves variant with positive adjustment', () => {
    const result = resolveVariantPrice(10000, sampleVariants, 'DIG-EBOOK-0001-PRO');
    expect(result.variantId).toBe(102);
    expect(result.adjustmentMinor).toBe(500);
    expect(result.finalPriceMinor).toBe(10500);
  });

  it('resolves variant with negative adjustment (discount)', () => {
    const result = resolveVariantPrice(10000, sampleVariants, 'DIG-EBOOK-0001-EDU');
    expect(result.variantId).toBe(103);
    expect(result.adjustmentMinor).toBe(-1000);
    expect(result.finalPriceMinor).toBe(9000);
  });

  it('clamps final price to zero if adjustment pushes below zero', () => {
    const cheapVariants: readonly VariantSelection[] = [
      { id: 201, product: 2, sku: 'CHEAP-001', attributes: {}, priceAdjustmentMinor: -5000, stockQty: 10 },
    ];
    const result = resolveVariantPrice(1000, cheapVariants, 'CHEAP-001');
    expect(result.finalPriceMinor).toBe(0);
  });

  it('throws when variant SKU not found', () => {
    expect(() => resolveVariantPrice(10000, sampleVariants, 'NOT-EXIST')).toThrow('Variant SKU not found: NOT-EXIST');
  });

  it('throws on negative product price', () => {
    expect(() => resolveVariantPrice(-100, sampleVariants, 'DIG-EBOOK-0001-STD')).toThrow('productPriceMinor must be a non-negative finite number');
  });
});

describe('pricing: parseRepricingRule', () => {
  it('parses complete rule object', () => {
    const rule = parseRepricingRule({ discountPercent: 15, markdownMinor: 250, respectCostFloor: true });
    expect(rule.discountPercent).toBe(15);
    expect(rule.markdownMinor).toBe(250);
    expect(rule.respectCostFloor).toBe(true);
  });

  it('parses partial rule object', () => {
    const rule = parseRepricingRule({ discountPercent: 10 });
    expect(rule.discountPercent).toBe(10);
    expect(rule.markdownMinor).toBeUndefined();
    expect(rule.respectCostFloor).toBeUndefined();
  });

  it('throws on non-object input', () => {
    expect(() => parseRepricingRule(null)).toThrow('rule must be an object');
    expect(() => parseRepricingRule([])).toThrow('rule must be an object');
    expect(() => parseRepricingRule('string')).toThrow('rule must be an object');
  });

  it('throws on invalid discountPercent type', () => {
    expect(() => parseRepricingRule({ discountPercent: '10%' })).toThrow('discountPercent must be a number');
  });

  it('throws on invalid markdownMinor type', () => {
    expect(() => parseRepricingRule({ markdownMinor: '500' })).toThrow('markdownMinor must be a number');
  });

  it('throws on invalid respectCostFloor type', () => {
    expect(() => parseRepricingRule({ respectCostFloor: 'true' })).toThrow('respectCostFloor must be a boolean');
  });
});