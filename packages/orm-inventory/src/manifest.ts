import { defineAddon, ref, seed } from '@moonwitness/orm';
import {
  Warehouse,
  InventoryItem,
  StockMove,
  StockLevel,
} from './models/index.js';

export const manifest = defineAddon({
  name: 'inventory',
  version: '1.0.0',
  depends: ['base'],
  models: [Warehouse, InventoryItem, StockMove, StockLevel],
  data: [
    seed(Warehouse, 'inventory.warehouse_main', {
      code: 'WH-MAIN',
      name: 'Main Warehouse',
      company: ref('base.company_default'),
      is_active: true,
    }),
  ],
});
