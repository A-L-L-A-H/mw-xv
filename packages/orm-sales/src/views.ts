import { defineView } from '@moonwitness/orm';
import { SaleOrder, SaleOrderLine, SaleOrderState, SaleOrderTagLink } from './models/index.js';

export const views = [
  defineView(SaleOrderState, {
    title: 'Sale Order States',
    list: {
      columns: ['sequence', 'name', 'is_done', 'color', 'company'],
      order: 'sequence asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Order State',
          columns: 2,
          fields: ['company', 'name', 'sequence', 'is_done', 'color'],
        },
      ],
    },
    search: { fields: ['name'] },
  }),
  defineView(SaleOrder, {
    title: 'Sale Orders',
    list: {
      columns: [
        'name',
        'partner',
        'state',
        'opportunity',
        'total_amount_minor',
        'currency',
        'assigned_to',
        'confirm_date',
      ],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Order Header',
          columns: 2,
          fields: ['name', 'company', 'partner', 'state', 'opportunity', 'assigned_to'],
        },
        {
          title: 'Commercials & Dates',
          columns: 2,
          fields: ['total_amount_minor', 'currency', 'deadline', 'confirm_date'],
        },
        {
          title: 'Description',
          fields: ['description'],
        },
      ],
    },
    search: {
      fields: ['name', 'description'],
      filters: [{ label: 'High Value (>= $50k)', domain: [['total_amount_minor', '>=', 5000000]] }],
      groupBy: [
        { label: 'State', field: 'state_id' },
        { label: 'Customer', field: 'partner_id' },
      ],
    },
    kanban: {
      groupBy: 'state_id',
      cardTitle: 'name',
      cardFields: ['partner_id', 'total_amount_minor', 'deadline'],
    },
  }),
  defineView(SaleOrderLine, {
    title: 'Sale Order Lines',
    list: {
      columns: [
        'order_id',
        'sequence',
        'name',
        'product',
        'quantity',
        'unit_price_minor',
        'discount_percent',
        'subtotal_minor',
      ],
      order: 'order_id asc, sequence asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Order Line',
          columns: 2,
          fields: [
            'order_id',
            'sequence',
            'name',
            'product',
            'quantity',
            'unit_price_minor',
            'discount_percent',
            'subtotal_minor',
          ],
        },
      ],
    },
    search: { fields: ['name', 'product'] },
  }),
  defineView(SaleOrderTagLink, {
    title: 'Sale Order Tag Links',
    list: { columns: ['tag', 'resource_model', 'resource_id'], order: 'id desc' },
    form: {
      sections: [{ title: 'Link', fields: ['tag', 'resource_model', 'resource_id'] }],
    },
    search: { fields: ['resource_model'] },
  }),
];
