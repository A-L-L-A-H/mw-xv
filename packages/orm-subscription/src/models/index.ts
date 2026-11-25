import { defineModel, fields } from '@moonwitness/orm';
import { Tag } from '@moonwitness/orm-base';
import { TagLink } from '@moonwitness/orm-base';

export const SubscriptionPlan = defineModel('subscription.plan', {
  table: 'subscription_plans',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    code: fields.string({ required: true, unique: true }),
    description: fields.text({ label: 'Description' }),
    amount_minor: fields.integer({ required: true, label: 'Amount (minor units)' }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    interval: fields.string({
      required: true,
      default: 'monthly',
      values: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    }),
    interval_count: fields.integer({ required: true, default: 1 }),
    trial_days: fields.integer({ required: true, default: 0 }),
    is_active: fields.boolean({ required: true, default: true }),
    company_id: fields.integer({ label: 'Company' }),
    tags: fields.hasMany(TagLink, {
      foreignKey: 'resource_id',
      label: 'Tags',
    }),
  },
});

export const Subscription = defineModel('subscription.subscription', {
  table: 'subscription_subscriptions',
  order: 'create_date desc',
  fields: {
    name: fields.string({ required: true, unique: true }),
    partner_id: fields.integer({ required: true, label: 'Customer' }),
    company_id: fields.integer({ label: 'Company' }),
    plan_id: fields.integer({ required: true, label: 'Plan' }),
    sale_order_id: fields.integer({ label: 'Related Sale Order' }),
    state: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'pending', 'active', 'paused', 'cancelled', 'expired'],
      label: 'Status',
    }),
    currency: fields.string({ required: true, default: 'USD', label: 'Currency' }),
    amount_minor: fields.integer({ label: 'Amount (minor units)' }),
    start_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    end_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    next_invoice_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    description: fields.text({ label: 'Description' }),
    assigned_to_id: fields.integer({ label: 'Account Manager' }),
    tags: fields.hasMany(TagLink, {
      foreignKey: 'resource_id',
      label: 'Tags',
    }),
  },
});

export const SubscriptionInvoiceLine = defineModel('subscription.invoice_line', {
  table: 'subscription_invoice_lines',
  order: 'sequence asc, name asc',
  unique: [['subscription_id', 'name']],
  fields: {
    name: fields.string({ required: true }),
    subscription_id: fields.integer({ required: true, label: 'Subscription' }),
    product: fields.string({ required: true, label: 'Product' }),
    quantity: fields.integer({ required: true, default: 1 }),
    unit_price_minor: fields.integer({ label: 'Unit Price (minor units)' }),
    discount_percent: fields.integer({ required: true, default: 0 }),
    subtotal_minor: fields.integer({ label: 'Subtotal (minor units)' }),
    sequence: fields.integer({ required: true, default: 10 }),
    invoice_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  },
});

export const SubscriptionTagLink = defineModel('subscription.tag_link', {
  table: 'subscription_tag_links',
  order: 'id desc',
  unique: [['tag_id', 'resource_model', 'resource_id']],
  fields: {
    tag_id: fields.integer({ required: true }),
    resource_model: fields.string({
      required: true,
      pattern: '^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+$',
    }),
    resource_id: fields.integer({ required: true }),
  },
});
