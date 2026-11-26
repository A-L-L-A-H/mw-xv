import { describe, expect, it } from 'vitest';
import {
  validateStockMove,
  applyStockMove,
  computeStockValuation,
  inventorySeedManifest,
} from '../src/index.js';

describe('orm-inventory', () => {
  it('validates receipt, delivery, and transfer stock moves', () => {
    expect(
      validateStockMove({
        moveNo: 'SM-001',
        sku: 'SKU-100',
        moveType: 'receipt',
        quantity: 25,
        destWarehouseCode: 'WH-MAIN',
      }).valid
    ).toBe(true);

    expect(
      validateStockMove({
        moveNo: 'SM-002',
        sku: 'SKU-100',
        moveType: 'transfer',
        quantity: 5,
        sourceWarehouseCode: 'WH-MAIN',
        destWarehouseCode: 'WH-MAIN',
      }).valid
    ).toBe(false);
  });

  it('applies receipt and transfer moves and rejects insufficient stock', () => {
    const afterReceipt = applyStockMove([], {
      moveNo: 'SM-001',
      sku: 'SKU-100',
      moveType: 'receipt',
      quantity: 20,
      destWarehouseCode: 'WH-MAIN',
    });

    const afterTransfer = applyStockMove(afterReceipt.levels, {
      moveNo: 'SM-002',
      sku: 'SKU-100',
      moveType: 'transfer',
      quantity: 8,
      sourceWarehouseCode: 'WH-MAIN',
      destWarehouseCode: 'WH-EAST',
    });

    const main = afterTransfer.levels.find((l) => l.warehouseCode === 'WH-MAIN');
    const east = afterTransfer.levels.find((l) => l.warehouseCode === 'WH-EAST');
    expect(main?.quantityOnHand).toBe(12);
    expect(east?.quantityOnHand).toBe(8);

    expect(() =>
      applyStockMove(afterTransfer.levels, {
        moveNo: 'SM-003',
        sku: 'SKU-100',
        moveType: 'delivery',
        quantity: 50,
        sourceWarehouseCode: 'WH-MAIN',
      })
    ).toThrow(/Insufficient stock/);
  });

  it('computes stock valuation and exposes inventorySeedManifest', () => {
    const valuation = computeStockValuation([
      { sku: 'SKU-100', quantityOnHand: 12, unitCostMinor: 1500 },
      { sku: 'SKU-200', quantityOnHand: 5, unitCostMinor: 3000 },
    ]);

    expect(valuation.totalUnits).toBe(17);
    expect(valuation.totalValueMinor).toBe(33000);
    expect(inventorySeedManifest.seedVersion).toBe('1.0.0');
    expect(inventorySeedManifest.dependencies).toContain('orm-base');
  });
});
