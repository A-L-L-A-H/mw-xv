import { defineView } from '@moonwitness/orm';
import {
  Subscription,
  SubscriptionInvoiceLine,
  SubscriptionPlan,
  SubscriptionTagLink,
} from './models/index.js';

export const views = [
  defineView(SubscriptionPlan, {
    title: 'Subscription Plans',
    list: {
      columns: [
        'name',
        'code',
        'amount_minor',
        'currency',
        'interval',
        'interval_count',
        'trial_days',
        'is_active',
      ],
      order: 'amount_minor asc, name asc',
    },
    form: {
      sections: [
        {
          title: 'Plan Definition',
          columns: 2,
          fields: [
            'name',
            'code',
            'company_id',
            'amount_minor',
            'currency',
            'interval',
            'interval_count',
            'trial_days',
            'is_active',
          ],
        },
        {
          title: 'Description',
          fields: ['description'],
        },
      ],
    },
    search: {
      fields: ['name', 'code', 'description'],
      filters: [{ label: 'Active Plans', domain: [['is_active', '=', true]] }],
    },
  }),
  defineView(Subscription, {
    title: 'Subscriptions',
    list: {
      columns: [
        'name',
        'partner_id',
        'plan_id',
        'state',
        'amount_minor',
        'currency',
        'start_date',
        'next_invoice_date',
      ],
      order: 'create_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['state', '=', 'active']] },
        { color: 'warning', domain: [['state', '=', 'paused']] },
        { color: 'danger', domain: [['state', '=', 'cancelled']] },
      ],
    },
    form: {
      header: { statusField: 'state' },
      sections: [
        {
          title: 'Subscription Contract',
          columns: 2,
          fields: [
            'name',
            'company_id',
            'partner_id',
            'plan_id',
            'sale_order_id',
            'state',
            'assigned_to_id',
          ],
        },
        {
          title: 'Billing Schedule',
          columns: 2,
          fields: ['amount_minor', 'currency', 'start_date', 'end_date', 'next_invoice_date'],
        },
        {
          title: 'Notes',
          fields: ['description'],
        },
      ],
    },
    search: {
      fields: ['name', 'description'],
      filters: [
        { label: 'Active', domain: [['state', '=', 'active']] },
        { label: 'Pending Activation', domain: [['state', '=', 'pending']] },
      ],
      groupBy: [{ label: 'State', field: 'state' }],
    },
  }),
  defineView(SubscriptionInvoiceLine, {
    title: 'Subscription Invoice Lines',
    list: {
      columns: [
        'subscription_id',
        'sequence',
        'name',
        'product',
        'quantity',
        'subtotal_minor',
        'invoice_date',
      ],
      order: 'subscription_id asc, sequence asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Invoice Line',
          columns: 2,
          fields: [
            'subscription_id',
            'sequence',
            'name',
            'product',
            'quantity',
            'unit_price_minor',
            'discount_percent',
            'subtotal_minor',
            'invoice_date',
          ],
        },
      ],
    },
    search: { fields: ['name', 'product'] },
  }),
  defineView(SubscriptionTagLink, {
    title: 'Subscription Tag Links',
    list: { columns: ['tag_id', 'resource_model', 'resource_id'], order: 'id desc' },
    form: {
      sections: [{ title: 'Link', fields: ['tag_id', 'resource_model', 'resource_id'] }],
    },
    search: { fields: ['resource_model'] },
  }),
];
