import { defineView } from '@moonwitness/orm';
import { Product, ProductChannel, ProductVariant } from './models/index.js';

export const views = [
  defineView(Product, {
    title: 'Products',
    list: {
      columns: [
        'sku',
        'name',
        'kind',
        'price_minor',
        'currency',
        'is_active',
        'company',
      ],
      order: 'create_date desc, id desc',
      decorations: [
        { color: 'success', domain: [['is_active', '=', true]] },
        { color: 'danger', domain: [['is_active', '=', false]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Product Overview',
          columns: 2,
          fields: ['name', 'sku', 'kind', 'company', 'price_minor', 'currency', 'cost_minor', 'is_active', 'parent'],
        },
        {
          title: 'Logistics',
          columns: 2,
          fields: ['weight_g', 'dimensions'],
        },
        {
          title: 'Notes & Media',
          fields: ['description', 'images', 'metadata'],
        },
      ],
    },
    search: {
      fields: ['name', 'sku', 'description'],
      filters: [
        { label: 'Active', domain: [['is_active', '=', true]] },
        { label: 'Digital Products', domain: [['kind', '=', 'digital']] },
      ],
      groupBy: [
        { label: 'Kind', field: 'kind' },
        { label: 'Company', field: 'company_id' },
      ],
    },
    kanban: {
      groupBy: 'kind',
      cardTitle: 'name',
      cardFields: ['sku', 'price_minor', 'currency', 'is_active'],
      badgeField: 'kind',
    },
  }),
  defineView(ProductVariant, {
    title: 'Product Variants',
    list: {
      columns: [
        'product',
        'sku',
        'price_adjustment_minor',
        'stock_qty',
        'company',
      ],
      order: 'id asc',
    },
    form: {
      sections: [
        {
          title: 'Variant',
          columns: 2,
          fields: ['product', 'sku', 'attributes', 'price_adjustment_minor', 'stock_qty', 'company'],
        },
      ],
    },
    search: {
      fields: ['sku'],
      groupBy: [{ label: 'Product', field: 'product_id' }],
    },
  }),
  defineView(ProductChannel, {
    title: 'Product Channels',
    list: {
      columns: [
        'product',
        'marketplace_ref',
        'platform_listing_id',
        'status',
        'company',
      ],
      order: 'id asc',
      decorations: [{ color: 'success', domain: [['status', '=', 'active']] }],
    },
    form: {
      sections: [
        {
          title: 'Channel Listing',
          columns: 2,
          fields: [
            'product',
            'marketplace_ref',
            'platform_listing_id',
            'status',
            'sync_config',
            'company',
          ],
        },
      ],
    },
    search: {
      fields: ['platform_listing_id', 'marketplace_ref'],
      filters: [{ label: 'Active Listings', domain: [['status', '=', 'active']] }],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Product', field: 'product_id' },
      ],
    },
  }),
];
