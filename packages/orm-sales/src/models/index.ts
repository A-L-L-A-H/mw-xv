import { defineModel, fields } from '@moonwitness/orm';
import { Partner } from '@moonwitness/orm-base';
import { Company } from '@moonwitness/orm-base';
import { Currency } from '@moonwitness/orm-base';
import { User } from '@moonwitness/orm-base';
import { Tag } from '@moonwitness/orm-base';
import { TagLink } from '@moonwitness/orm-base';
import { Opportunity } from '@moonwitness/orm-crm';

export const SaleOrderState = defineModel('sale.order_state', {
  table: 'sale_order_states',
  order: 'sequence asc, name asc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    sequence: fields.integer({ required: true, default: 10 }),
    is_done: fields.boolean({ required: true, default: false }),
    color: fields.string({ pattern: '^#[0-9A-Fa-f]{6}$', default: '#64748B', label: 'Color' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
  },
});

export const SaleOrder = defineModel('sale.order', {
  table: 'sale_orders',
  order: 'create_date desc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    partner: fields.belongsTo(Partner, { required: true, label: 'Customer' }),
    company: fields.belongsTo(Company, { label: 'Company' }),
    state: fields.belongsTo(SaleOrderState, { required: true, label: 'Stage' }),
    opportunity: fields.belongsTo(Opportunity, { label: 'Related Opportunity' }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    description: fields.text({ label: 'Description' }),
    assigned_to: fields.belongsTo(User, { label: 'Salesperson' }),
    deadline: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    confirm_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    total_amount_minor: fields.integer({ label: 'Total Amount (minor units)' }),
    tags: fields.hasMany(TagLink, {
      foreignKey: 'resource_id',
      label: 'Tags',
    }),
  },
});

export const SaleOrderLine = defineModel('sale.order_line', {
  table: 'sale_order_lines',
  order: 'sequence asc, name asc',
  fields: {
    name: fields.string({ required: true }),
    order_id: fields.integer({ required: true, label: 'Order' }),
    product: fields.string({ required: true, label: 'Product' }),
    quantity: fields.integer({ required: true, default: 1 }),
    unit_price_minor: fields.integer({ label: 'Unit Price (minor units)' }),
    discount_percent: fields.integer({ required: true, default: 0 }),
    subtotal_minor: fields.integer({ label: 'Subtotal (minor units)' }),
    sequence: fields.integer({ required: true, default: 10 }),
  },
});

export const SaleOrderTagLink = defineModel('sale.order_tag_link', {
  table: 'sale_order_tag_links',
  order: 'id desc',
  unique: [['tag', 'resource_model', 'resource_id']],
  fields: {
    tag: fields.belongsTo(Tag, { required: true }),
    resource_model: fields.string({
      required: true,
      pattern: '^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$',
    }),
    resource_id: fields.integer({ required: true }),
  },
});
