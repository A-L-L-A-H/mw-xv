import { defineModel, fields } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';

export type InventoryUom = 'unit' | 'kg' | 'liter' | 'box' | 'pallet';
export type StockMoveType = 'receipt' | 'delivery' | 'transfer' | 'adjustment';
export type StockMoveStatus = 'draft' | 'done' | 'cancelled';

export const Warehouse = defineModel('inventory.warehouse', {
  table: 'inventory_warehouses',
  order: 'code asc',
  fields: {
    code: fields.string({ required: true, unique: true, label: 'Warehouse Code' }),
    name: fields.string({ required: true, label: 'Warehouse Name' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    address: fields.text({ label: 'Address' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const InventoryItem = defineModel('inventory.item', {
  table: 'inventory_items',
  order: 'sku asc',
  fields: {
    sku: fields.string({ required: true, unique: true, label: 'SKU' }),
    name: fields.string({ required: true, label: 'Item Name' }),
    category: fields.string({ label: 'Category' }),
    uom: fields.string({
      required: true,
      default: 'unit',
      values: ['unit', 'kg', 'liter', 'box', 'pallet'],
      label: 'Unit of Measure',
    }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    unit_cost_minor: fields.integer({ required: true, default: 0, label: 'Unit Cost (minor units)' }),
    reorder_point: fields.integer({ required: true, default: 0, label: 'Reorder Point' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const StockMove = defineModel('inventory.stock_move', {
  table: 'inventory_stock_moves',
  order: 'move_date desc',
  fields: {
    move_no: fields.string({ required: true, unique: true, label: 'Move No' }),
    item: fields.belongsTo(InventoryItem, { required: true, label: 'Item' }),
    source_warehouse: fields.belongsTo(Warehouse, { label: 'Source Warehouse' }),
    dest_warehouse: fields.belongsTo(Warehouse, { label: 'Destination Warehouse' }),
    move_type: fields.string({
      required: true,
      values: ['receipt', 'delivery', 'transfer', 'adjustment'],
      label: 'Move Type',
    }),
    quantity: fields.integer({ required: true, label: 'Quantity' }),
    status: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'done', 'cancelled'],
      label: 'Status',
    }),
    move_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Move Date',
    }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    reference: fields.string({ label: 'Reference' }),
  },
});

export const StockLevel = defineModel('inventory.stock_level', {
  table: 'inventory_stock_levels',
  order: 'id asc',
  fields: {
    warehouse: fields.belongsTo(Warehouse, { required: true, label: 'Warehouse' }),
    item: fields.belongsTo(InventoryItem, { required: true, label: 'Item' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    quantity_on_hand: fields.integer({ required: true, default: 0, label: 'On Hand' }),
    quantity_reserved: fields.integer({ required: true, default: 0, label: 'Reserved' }),
    quantity_available: fields.integer({ required: true, default: 0, label: 'Available' }),
  },
});
