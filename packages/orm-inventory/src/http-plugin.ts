import {
  requireAddonDb,
  requireAuth,
  type AddonHttpPlugin,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import {
  validateStockMove,
  applyStockMove,
  computeStockValuation,
  type StockMoveInput,
  type StockLevelRecord,
  type StockValuationInput,
} from './inventory-engine.js';
import type { StockMoveType } from './models/index.js';

const VALID_MOVE_TYPES: readonly StockMoveType[] = [
  'receipt',
  'delivery',
  'transfer',
  'adjustment',
];

export const inventoryHttpPlugin: AddonHttpPlugin = async (app) => {
  app.get('/api/inventory/warehouses', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    try {
      const db = requireAddonDb(req);
      const warehouses = await db('inventory_warehouses')
        .where({ company_id: auth.companyId })
        .orderBy('code', 'asc')
        .select('id', 'code', 'name', 'company_id', 'address', 'is_active');
      return reply.code(200).send({ success: true, data: warehouses });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/inventory/moves/validate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { moveNo, sku, moveType, quantity, sourceWarehouseCode, destWarehouseCode } = req.body;
    if (
      typeof moveNo !== 'string' ||
      typeof sku !== 'string' ||
      typeof moveType !== 'string' ||
      quantity === undefined
    ) {
      return reply.code(400).send({
        success: false,
        error: 'moveNo, sku, moveType, and quantity are required',
      });
    }

    if (!VALID_MOVE_TYPES.includes(moveType as StockMoveType)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid moveType. Must be one of: ${VALID_MOVE_TYPES.join(', ')}`,
      });
    }

    try {
      const move: StockMoveInput = {
        moveNo,
        sku,
        moveType: moveType as StockMoveType,
        quantity: Number(quantity),
        sourceWarehouseCode:
          typeof sourceWarehouseCode === 'string' ? sourceWarehouseCode : undefined,
        destWarehouseCode: typeof destWarehouseCode === 'string' ? destWarehouseCode : undefined,
      };
      const result = validateStockMove(move);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/inventory/moves/apply', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { levels, move } = req.body;
    if (!Array.isArray(levels) || !isRecord(move)) {
      return reply.code(400).send({
        success: false,
        error: 'levels array and move object are required',
      });
    }

    const { moveNo, sku, moveType, quantity, sourceWarehouseCode, destWarehouseCode } = move;
    if (
      typeof moveNo !== 'string' ||
      typeof sku !== 'string' ||
      typeof moveType !== 'string' ||
      quantity === undefined
    ) {
      return reply.code(400).send({
        success: false,
        error: 'move.moveNo, move.sku, move.moveType, and move.quantity are required',
      });
    }

    if (!VALID_MOVE_TYPES.includes(moveType as StockMoveType)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid moveType. Must be one of: ${VALID_MOVE_TYPES.join(', ')}`,
      });
    }

    try {
      const moveInput: StockMoveInput = {
        moveNo,
        sku,
        moveType: moveType as StockMoveType,
        quantity: Number(quantity),
        sourceWarehouseCode:
          typeof sourceWarehouseCode === 'string' ? sourceWarehouseCode : undefined,
        destWarehouseCode: typeof destWarehouseCode === 'string' ? destWarehouseCode : undefined,
      };
      const result = applyStockMove(levels as StockLevelRecord[], moveInput);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/inventory/valuation', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { levels } = req.body;
    if (!Array.isArray(levels)) {
      return reply.code(400).send({ success: false, error: 'levels array is required' });
    }

    try {
      const result = computeStockValuation(levels as StockValuationInput[]);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};

export const httpPlugin = inventoryHttpPlugin;
