import { defineAddon, ref, seed } from '@moonwitness/orm';
import {
  Warehouse,
  InventoryItem,
  StockMove,
  StockLevel,
} from './models/index.js';
import { httpPlugin } from './http-plugin.js';

export const manifest = defineAddon({
  name: 'inventory',
  version: '1.0.0',
  depends: ['base'],
  models: [Warehouse, InventoryItem, StockMove, StockLevel],
  httpPlugins: [httpPlugin],
  data: [
    seed(Warehouse, 'inventory.warehouse_main', {
      code: 'WH-MAIN',
      name: 'Main Warehouse',
      company: ref('base.company_default'),
      is_active: true,
    }),
  ],
});
