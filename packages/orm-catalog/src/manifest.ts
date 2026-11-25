import { defineAddon, ref, seed } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import { Product, ProductChannel, ProductVariant } from './models/index.js';
import { views } from './views.js';
import { catalogHttpPlugin } from './http-plugin.js';

export const manifest = defineAddon({
  name: 'catalog',
  version: '1.0.0',
  displayName: 'Product Catalog',
  category: 'Commerce',
  summary: 'Products, variants, and marketplace channel listings.',
  depends: ['base'],
  models: [Product, ProductVariant, ProductChannel],
  httpPlugins: [catalogHttpPlugin],
  data: [
    seed(Product, 'catalog.product_ebook_launch_authority', {
      company: ref('base.company_default'),
      sku: 'DIG-EBOOK-0001',
      name: 'Launch Authority: Indie Software Playbook (eBook)',
      description:
        'Digitally delivered ebook covering go-to-market strategy for independent software products.',
      kind: 'digital',
      price_minor: 2400,
      currency: 'USD',
      cost_minor: 0,
      is_active: false,
    }),
    seed(Product, 'catalog.product_dashboard_ui_kit', {
      company: ref('base.company_default'),
      sku: 'DIG-TEMPLATE-0001',
      name: 'Observability Dashboard Figma Template',
      description:
        'Editable template pack of monitoring dashboard layouts, charts, and empty-state components.',
      kind: 'digital',
      price_minor: 4900,
      currency: 'USD',
      cost_minor: 0,
      is_active: false,
    }),
    seed(Product, 'catalog.product_orm_video_course', {
      company: ref('base.company_default'),
      sku: 'DIG-COURSE-0001',
      name: 'Query Planning Masterclass Video Course',
      description: 'Recorded course with hands-on query planner walkthroughs and indexing labs.',
      kind: 'digital',
      price_minor: 12900,
      currency: 'USD',
      cost_minor: 0,
      is_active: false,
    }),
    seed(ModelAccess, 'catalog.access_user_product', {
      group: ref('base.group_user'),
      model_name: Product.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'catalog.access_user_product_variant', {
      group: ref('base.group_user'),
      model_name: ProductVariant.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'catalog.access_user_product_channel', {
      group: ref('base.group_user'),
      model_name: ProductChannel.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
  ],
  views,
  menus: [
    {
      model: Product.modelName,
      label: 'Products',
      group: 'Catalog',
      sequence: 10,
    },
    {
      model: ProductVariant.modelName,
      label: 'Variants',
      group: 'Catalog',
      sequence: 20,
    },
    {
      model: ProductChannel.modelName,
      label: 'Channels',
      group: 'Catalog',
      sequence: 25,
      developmentOnly: true,
    },
  ],
});
