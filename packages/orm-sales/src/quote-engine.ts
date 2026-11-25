import { BASIS_POINTS_TOTAL } from '@moonwitness/types';

export interface VolumePriceTier {
  /** Minimum quantity (inclusive) to qualify for this tier */
  minQuantity: number;
  /** Unit price in integer cents */
  unitPriceCents: number;
}

export interface QuoteLineInput {
  lineId: string;
  sku: string;
  description?: string;
  quantity: number;
  /** Base unit list price in integer cents */
  unitPriceCents: number;
  /** Unit cost (COGS) in integer cents for gross-margin floor guard */
  unitCostCents: number;
  /** Optional volume pricing tiers */
  volumeTiers?: readonly VolumePriceTier[];
  /** Optional line-level percentage discount in basis points (0..10000) */
  discountBps?: number;
  /** Optional line-level fixed discount in integer cents */
  discountAmountCents?: number;
  /** Tax category tag (defaults to 'standard') */
  taxCategory?: string;
  /** Whether this line is taxable (defaults to true) */
  taxable?: boolean;
}

export interface TaxRule {
  jurisdiction: string;
  /** Tax rate in basis points (e.g., 825 = 8.25%) */
  rateBps: number;
  /** If true, tax is computed on (taxableSubtotal + prior taxes) */
  compound?: boolean;
  /** Optional list of tax categories this rule applies to (omitted = all taxable lines) */
  appliesToCategories?: readonly string[];
}

export interface QuoteCompileInput {
  quoteId: string;
  customerId: string;
  currency: string;
  lines: readonly QuoteLineInput[];
  /** Optional quote-level percentage discount in basis points (0..10000) */
  quoteDiscountBps?: number;
  /** Optional quote-level fixed discount in integer cents */
  quoteDiscountCents?: number;
  /** Multi-jurisdiction tax rules evaluated in order */
  taxRules?: readonly TaxRule[];
  /** Minimum acceptable gross margin in basis points (e.g., 3000 = 30.00%) */
  minGrossMarginBps?: number;
  /** Optional per-line minimum gross margin in basis points */
  minLineGrossMarginBps?: number;
}

export interface CompiledQuoteLine {
  lineId: string;
  sku: string;
  description: string;
  quantity: number;
  appliedUnitPriceCents: number;
  unitCostCents: number;
  grossSubtotalCents: number;
  lineDiscountCents: number;
  allocatedQuoteDiscountCents: number;
  netSubtotalCents: number;
  totalCostCents: number;
  grossMarginCents: number;
  grossMarginBps: number;
  taxCategory: string;
  taxable: boolean;
}

export interface TaxBreakdownEntry {
  jurisdiction: string;
  rateBps: number;
  compound: boolean;
  taxableBaseCents: number;
  taxAmountCents: number;
}

export interface CompiledQuote {
  quoteId: string;
  customerId: string;
  currency: string;
  lines: CompiledQuoteLine[];
  grossSubtotalCents: number;
  lineDiscountTotalCents: number;
  quoteDiscountTotalCents: number;
  discountTotalCents: number;
  netSubtotalCents: number;
  totalCostCents: number;
  grossMarginCents: number;
  grossMarginBps: number;
  taxBreakdown: TaxBreakdownEntry[];
  taxTotalCents: number;
  grandTotalCents: number;
  requiresApproval: boolean;
  approvalReasons: string[];
}

export interface ProjectedOrderLinePayload {
  lineId: string;
  sku: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  netSubtotalCents: number;
}

export interface ProjectedOrderPayload {
  quoteId: string;
  customerId: string;
  currency: string;
  status: 'ready_to_confirm' | 'pending_approval';
  requiresApproval: boolean;
  approvalReasons: string[];
  lines: ProjectedOrderLinePayload[];
  subtotalCents: number;
  discountTotalCents: number;
  taxTotalCents: number;
  grandTotalCents: number;
  taxBreakdown: TaxBreakdownEntry[];
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function resolveTieredUnitPrice(
  baseUnitPriceCents: number,
  quantity: number,
  tiers?: readonly VolumePriceTier[]
): number {
  if (!tiers || tiers.length === 0) return baseUnitPriceCents;
  let matchedPrice = baseUnitPriceCents;
  let highestMinQty = -1;
  for (const tier of tiers) {
    assertNonNegativeInt(tier.minQuantity, 'tier.minQuantity');
    assertNonNegativeInt(tier.unitPriceCents, 'tier.unitPriceCents');
    if (quantity >= tier.minQuantity && tier.minQuantity > highestMinQty) {
      highestMinQty = tier.minQuantity;
      matchedPrice = tier.unitPriceCents;
    }
  }
  return matchedPrice;
}

/**
 * Largest-remainder integer cent allocation so sum(allocations) === totalAmountCents with zero drift.
 */
function allocateIntegerCents(totalAmountCents: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalAmountCents <= 0 || totalWeight <= 0) {
    return weights.map(() => 0);
  }

  const shares = weights.map((weight, index) => {
    const exactNumerator = totalAmountCents * weight;
    const floorShare = Math.floor(exactNumerator / totalWeight);
    const remainder = exactNumerator % totalWeight;
    return { index, floorShare, remainder };
  });

  const distributed = shares.reduce((acc, s) => acc + s.floorShare, 0);
  const leftover = totalAmountCents - distributed;

  const byRemainder = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.index - b.index;
  });

  const result = shares.map((s) => s.floorShare);
  for (let i = 0; i < leftover; i += 1) {
    result[byRemainder[i].index] += 1;
  }

  return result;
}

/**
 * Integer-cent quote-to-order pricing compiler with tiered volume pricing,
 * line + quote discounts, multi-jurisdiction taxes, and gross-margin floor guard.
 */
export function compileQuote(input: QuoteCompileInput): CompiledQuote {
  if (input.lines.length === 0) {
    throw new Error('Quote must contain at least one line item');
  }

  const preQuoteDiscountLines = input.lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Line ${line.lineId} quantity must be a positive integer`);
    }
    assertNonNegativeInt(line.unitPriceCents, `Line ${line.lineId} unitPriceCents`);
    assertNonNegativeInt(line.unitCostCents, `Line ${line.lineId} unitCostCents`);

    const appliedUnitPriceCents = resolveTieredUnitPrice(
      line.unitPriceCents,
      line.quantity,
      line.volumeTiers
    );
    const grossSubtotalCents = appliedUnitPriceCents * line.quantity;

    const bps = line.discountBps ?? 0;
    if (!Number.isInteger(bps) || bps < 0 || bps > BASIS_POINTS_TOTAL) {
      throw new Error(
        `Line ${line.lineId} discountBps must be an integer in 0..${BASIS_POINTS_TOTAL}`
      );
    }
    const fixedDiscount = line.discountAmountCents ?? 0;
    assertNonNegativeInt(fixedDiscount, `Line ${line.lineId} discountAmountCents`);

    const pctDiscountCents = Math.round((grossSubtotalCents * bps) / BASIS_POINTS_TOTAL);
    const lineDiscountCents = Math.min(grossSubtotalCents, pctDiscountCents + fixedDiscount);
    const afterLineDiscountCents = grossSubtotalCents - lineDiscountCents;

    return {
      line,
      appliedUnitPriceCents,
      grossSubtotalCents,
      lineDiscountCents,
      afterLineDiscountCents,
    };
  });

  const subtotalAfterLineDiscounts = preQuoteDiscountLines.reduce(
    (acc, item) => acc + item.afterLineDiscountCents,
    0
  );

  const quoteBps = input.quoteDiscountBps ?? 0;
  if (!Number.isInteger(quoteBps) || quoteBps < 0 || quoteBps > BASIS_POINTS_TOTAL) {
    throw new Error(`quoteDiscountBps must be an integer in 0..${BASIS_POINTS_TOTAL}`);
  }
  const quoteFixed = input.quoteDiscountCents ?? 0;
  assertNonNegativeInt(quoteFixed, 'quoteDiscountCents');

  const quoteDiscountTotalCents = Math.min(
    subtotalAfterLineDiscounts,
    Math.round((subtotalAfterLineDiscounts * quoteBps) / BASIS_POINTS_TOTAL) + quoteFixed
  );

  const quoteDiscountAllocations = allocateIntegerCents(
    quoteDiscountTotalCents,
    preQuoteDiscountLines.map((item) => item.afterLineDiscountCents)
  );

  const approvalReasons: string[] = [];

  const compiledLines: CompiledQuoteLine[] = preQuoteDiscountLines.map((item, idx) => {
    const allocatedQuoteDiscountCents = quoteDiscountAllocations[idx];
    const netSubtotalCents = item.afterLineDiscountCents - allocatedQuoteDiscountCents;
    const totalCostCents = item.line.unitCostCents * item.line.quantity;
    const grossMarginCents = netSubtotalCents - totalCostCents;
    const grossMarginBps =
      netSubtotalCents > 0
        ? Math.floor((grossMarginCents * BASIS_POINTS_TOTAL) / netSubtotalCents)
        : 0;

    if (input.minLineGrossMarginBps !== undefined && grossMarginBps < input.minLineGrossMarginBps) {
      approvalReasons.push(
        `Line ${item.line.lineId} gross margin ${grossMarginBps}bps is below floor ${input.minLineGrossMarginBps}bps`
      );
    }

    return {
      lineId: item.line.lineId,
      sku: item.line.sku,
      description: item.line.description ?? item.line.sku,
      quantity: item.line.quantity,
      appliedUnitPriceCents: item.appliedUnitPriceCents,
      unitCostCents: item.line.unitCostCents,
      grossSubtotalCents: item.grossSubtotalCents,
      lineDiscountCents: item.lineDiscountCents,
      allocatedQuoteDiscountCents,
      netSubtotalCents,
      totalCostCents,
      grossMarginCents,
      grossMarginBps,
      taxCategory: item.line.taxCategory ?? 'standard',
      taxable: item.line.taxable ?? true,
    };
  });

  const grossSubtotalCents = compiledLines.reduce((acc, l) => acc + l.grossSubtotalCents, 0);
  const lineDiscountTotalCents = compiledLines.reduce((acc, l) => acc + l.lineDiscountCents, 0);
  const discountTotalCents = lineDiscountTotalCents + quoteDiscountTotalCents;
  const netSubtotalCents = compiledLines.reduce((acc, l) => acc + l.netSubtotalCents, 0);
  const totalCostCents = compiledLines.reduce((acc, l) => acc + l.totalCostCents, 0);
  const grossMarginCents = netSubtotalCents - totalCostCents;
  const grossMarginBps =
    netSubtotalCents > 0
      ? Math.floor((grossMarginCents * BASIS_POINTS_TOTAL) / netSubtotalCents)
      : 0;

  if (input.minGrossMarginBps !== undefined && grossMarginBps < input.minGrossMarginBps) {
    approvalReasons.push(
      `Quote gross margin ${grossMarginBps}bps is below floor ${input.minGrossMarginBps}bps`
    );
  }

  const taxBreakdown: TaxBreakdownEntry[] = [];
  let runningTaxTotalCents = 0;

  for (const rule of input.taxRules ?? []) {
    if (!Number.isInteger(rule.rateBps) || rule.rateBps < 0) {
      throw new Error(`Tax rule ${rule.jurisdiction} rateBps must be a non-negative integer`);
    }
    const categorySet = rule.appliesToCategories ? new Set(rule.appliesToCategories) : null;
    const baseNetCents = compiledLines
      .filter((l) => l.taxable && (categorySet === null || categorySet.has(l.taxCategory)))
      .reduce((acc, l) => acc + l.netSubtotalCents, 0);

    const taxableBaseCents = rule.compound ? baseNetCents + runningTaxTotalCents : baseNetCents;
    const taxAmountCents = Math.round((taxableBaseCents * rule.rateBps) / BASIS_POINTS_TOTAL);
    runningTaxTotalCents += taxAmountCents;

    taxBreakdown.push({
      jurisdiction: rule.jurisdiction,
      rateBps: rule.rateBps,
      compound: Boolean(rule.compound),
      taxableBaseCents,
      taxAmountCents,
    });
  }

  const grandTotalCents = netSubtotalCents + runningTaxTotalCents;

  return {
    quoteId: input.quoteId,
    customerId: input.customerId,
    currency: input.currency,
    lines: compiledLines,
    grossSubtotalCents,
    lineDiscountTotalCents,
    quoteDiscountTotalCents,
    discountTotalCents,
    netSubtotalCents,
    totalCostCents,
    grossMarginCents,
    grossMarginBps,
    taxBreakdown,
    taxTotalCents: runningTaxTotalCents,
    grandTotalCents,
    requiresApproval: approvalReasons.length > 0,
    approvalReasons,
  };
}

/**
 * Projects a compiled quote into a deterministic order payload ready for persistence/confirmation.
 */
export function projectOrderPayload(compiled: CompiledQuote): ProjectedOrderPayload {
  return {
    quoteId: compiled.quoteId,
    customerId: compiled.customerId,
    currency: compiled.currency,
    status: compiled.requiresApproval ? 'pending_approval' : 'ready_to_confirm',
    requiresApproval: compiled.requiresApproval,
    approvalReasons: [...compiled.approvalReasons],
    lines: compiled.lines.map((line) => ({
      lineId: line.lineId,
      sku: line.sku,
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: line.appliedUnitPriceCents,
      discountCents: line.lineDiscountCents + line.allocatedQuoteDiscountCents,
      netSubtotalCents: line.netSubtotalCents,
    })),
    subtotalCents: compiled.netSubtotalCents,
    discountTotalCents: compiled.discountTotalCents,
    taxTotalCents: compiled.taxTotalCents,
    grandTotalCents: compiled.grandTotalCents,
    taxBreakdown: compiled.taxBreakdown.map((t) => ({ ...t })),
  };
}
