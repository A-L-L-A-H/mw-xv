export interface RepricingRule {
  /** Percentage discount applied to base price (0..100), e.g. 10 = -10%. */
  discountPercent?: number;
  /** Absolute markdown applied to base price, in minor units (may be negative for markup). */
  markdownMinor?: number;
  /** If true, ensures resulting price never falls below cost_minor. */
  respectCostFloor?: boolean;
}

export interface RepricingOutcome {
  basePriceMinor: number;
  newPriceMinor: number;
  appliedDiscountMinor: number;
  appliedMarkdownMinor: number;
  costFloorClamped: boolean;
}

export interface VariantSelection {
  id: number;
  product: number;
  sku: string;
  attributes: Record<string, unknown>;
  priceAdjustmentMinor: number;
  stockQty: number;
}

export interface ResolvedVariantPrice {
  productId: number;
  variantId: number | null;
  basePriceMinor: number;
  adjustmentMinor: number;
  finalPriceMinor: number;
}

function toInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * Deterministic repricing engine: applies percentage discount then absolute
 * markdown against a base price, with optional cost floor.
 */
export function applyRepricing(
  basePriceMinor: number,
  costMinor: number | null | undefined,
  rule: RepricingRule
): RepricingOutcome {
  if (!Number.isFinite(basePriceMinor) || basePriceMinor < 0) {
    throw new Error('basePriceMinor must be a non-negative finite number');
  }

  const base = Math.trunc(basePriceMinor);
  const cost =
    typeof costMinor === 'number' && Number.isFinite(costMinor) ? Math.trunc(costMinor) : null;

  const discountPercent = rule.discountPercent ?? 0;
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new Error('discountPercent must be a number between 0 and 100');
  }

  const markdownMinor = rule.markdownMinor ?? 0;
  if (!Number.isFinite(markdownMinor)) {
    throw new Error('markdownMinor must be a finite number');
  }

  const appliedDiscountMinor = Math.trunc((base * discountPercent) / 100);
  const appliedMarkdownMinor = Math.trunc(markdownMinor);

  let next = base - appliedDiscountMinor - appliedMarkdownMinor;
  let costFloorClamped = false;

  if (rule.respectCostFloor && cost !== null && next < cost) {
    next = cost;
    costFloorClamped = true;
  }

  if (next < 0) {
    next = 0;
  }

  return {
    basePriceMinor: base,
    newPriceMinor: next,
    appliedDiscountMinor,
    appliedMarkdownMinor,
    costFloorClamped,
  };
}

/**
 * Resolves the effective sell price for a product variant: base product price
 * plus the variant's price adjustment. When no variant matches, resolves the
 * product's base price.
 */
export function resolveVariantPrice(
  productPriceMinor: number,
  variants: readonly VariantSelection[],
  variantSku: string | null | undefined
): ResolvedVariantPrice {
  if (!Number.isFinite(productPriceMinor) || productPriceMinor < 0) {
    throw new Error('productPriceMinor must be a non-negative finite number');
  }

  const base = Math.trunc(productPriceMinor);
  const requestedSku = typeof variantSku === 'string' ? variantSku.trim() : '';

  if (!requestedSku) {
    return {
      productId: -1,
      variantId: null,
      basePriceMinor: base,
      adjustmentMinor: 0,
      finalPriceMinor: base,
    };
  }

  const match = variants.find((v) => v.sku === requestedSku);
  if (!match) {
    throw new Error(`Variant SKU not found: ${requestedSku}`);
  }

  const adjustment = Math.trunc(match.priceAdjustmentMinor);
  const final = Math.max(0, base + adjustment);

  return {
    productId: match.product,
    variantId: match.id,
    basePriceMinor: base,
    adjustmentMinor: adjustment,
    finalPriceMinor: final,
  };
}

export function parseRepricingRule(payload: unknown): RepricingRule {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('rule must be an object');
  }
  const record = payload as Record<string, unknown>;
  const rule: RepricingRule = {};

  if (record.discountPercent !== undefined) {
    const parsed = toInteger(record.discountPercent);
    if (parsed === null) throw new Error('discountPercent must be a number');
    rule.discountPercent = parsed;
  }
  if (record.markdownMinor !== undefined) {
    const parsed = toInteger(record.markdownMinor);
    if (parsed === null) throw new Error('markdownMinor must be a number');
    rule.markdownMinor = parsed;
  }
  if (record.respectCostFloor !== undefined) {
    if (typeof record.respectCostFloor !== 'boolean') {
      throw new Error('respectCostFloor must be a boolean');
    }
    rule.respectCostFloor = record.respectCostFloor;
  }

  return rule;
}
