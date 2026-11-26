import type { StockMoveType } from './models/index.js';

export interface StockMoveInput {
  readonly moveNo: string;
  readonly sku: string;
  readonly moveType: StockMoveType;
  readonly quantity: number;
  readonly sourceWarehouseCode?: string;
  readonly destWarehouseCode?: string;
}

export interface StockMoveValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface StockLevelRecord {
  readonly warehouseCode: string;
  readonly sku: string;
  readonly quantityOnHand: number;
  readonly quantityReserved: number;
}

export interface StockLevelUpdateResult {
  readonly levels: readonly StockLevelRecord[];
}

export interface StockValuationInput {
  readonly sku: string;
  readonly quantityOnHand: number;
  readonly unitCostMinor: number;
}

export interface StockValuationResult {
  readonly totalUnits: number;
  readonly totalValueMinor: number;
}

export function validateStockMove(move: StockMoveInput): StockMoveValidationResult {
  const errors: string[] = [];

  if (!move.sku.trim()) {
    errors.push('sku is required');
  }
  if (!Number.isInteger(move.quantity) || move.quantity <= 0) {
    errors.push('quantity must be a positive integer');
  }

  if (move.moveType === 'receipt' && !move.destWarehouseCode?.trim()) {
    errors.push('receipt requires destWarehouseCode');
  }
  if (move.moveType === 'delivery' && !move.sourceWarehouseCode?.trim()) {
    errors.push('delivery requires sourceWarehouseCode');
  }
  if (move.moveType === 'transfer') {
    if (!move.sourceWarehouseCode?.trim() || !move.destWarehouseCode?.trim()) {
      errors.push('transfer requires both sourceWarehouseCode and destWarehouseCode');
    } else if (move.sourceWarehouseCode === move.destWarehouseCode) {
      errors.push('transfer sourceWarehouseCode and destWarehouseCode must differ');
    }
  }
  if (move.moveType === 'adjustment' && !move.destWarehouseCode?.trim()) {
    errors.push('adjustment requires destWarehouseCode');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function applyStockMove(
  levels: readonly StockLevelRecord[],
  move: StockMoveInput
): StockLevelUpdateResult {
  const validation = validateStockMove(move);
  if (!validation.valid) {
    throw new Error(`Invalid stock move '${move.moveNo}': ${validation.errors.join('; ')}`);
  }

  const next = new Map<string, StockLevelRecord>();
  for (const level of levels) {
    next.set(`${level.warehouseCode}::${level.sku}`, { ...level });
  }

  const adjustWarehouse = (warehouseCode: string, delta: number): void => {
    const key = `${warehouseCode}::${move.sku}`;
    const current = next.get(key) ?? {
      warehouseCode,
      sku: move.sku,
      quantityOnHand: 0,
      quantityReserved: 0,
    };
    const updatedQty = current.quantityOnHand + delta;
    if (updatedQty < 0) {
      throw new Error(
        `Insufficient stock for SKU '${move.sku}' in warehouse '${warehouseCode}': available=${current.quantityOnHand}, requested=${Math.abs(delta)}`
      );
    }
    next.set(key, {
      ...current,
      quantityOnHand: updatedQty,
    });
  };

  if (move.moveType === 'receipt' && move.destWarehouseCode) {
    adjustWarehouse(move.destWarehouseCode, move.quantity);
  } else if (move.moveType === 'delivery' && move.sourceWarehouseCode) {
    adjustWarehouse(move.sourceWarehouseCode, -move.quantity);
  } else if (move.moveType === 'transfer' && move.sourceWarehouseCode && move.destWarehouseCode) {
    adjustWarehouse(move.sourceWarehouseCode, -move.quantity);
    adjustWarehouse(move.destWarehouseCode, move.quantity);
  } else if (move.moveType === 'adjustment' && move.destWarehouseCode) {
    adjustWarehouse(move.destWarehouseCode, move.quantity);
  }

  return {
    levels: Array.from(next.values()),
  };
}

export function computeStockValuation(
  levels: readonly StockValuationInput[]
): StockValuationResult {
  let totalUnits = 0;
  let totalValueMinor = 0;

  for (const level of levels) {
    totalUnits += level.quantityOnHand;
    totalValueMinor += level.quantityOnHand * level.unitCostMinor;
  }

  return {
    totalUnits,
    totalValueMinor,
  };
}
