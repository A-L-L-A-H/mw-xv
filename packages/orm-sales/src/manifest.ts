import { defineAddon, ref, seed } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import { SaleOrderState, SaleOrder, SaleOrderLine, SaleOrderTagLink } from './models/index.js';

export const manifest = defineAddon({
  name: 'sales',
  version: '1.0.0',
  depends: ['base', 'crm'],
  models: [SaleOrderState, SaleOrder, SaleOrderLine, SaleOrderTagLink],
  data: [
    seed(SaleOrderState, 'sale.state_draft', {
      company: ref('base.company_default'),
      name: 'Draft',
      sequence: 10,
      is_done: false,
      color: '#64748B',
    }),
    seed(SaleOrderState, 'sale.state_sent', {
      company: ref('base.company_default'),
      name: 'Sent',
      sequence: 20,
      is_done: false,
      color: '#3B82F6',
    }),
    seed(SaleOrderState, 'sale.state_done', {
      company: ref('base.company_default'),
      name: 'Done',
      sequence: 90,
      is_done: true,
      color: '#22C55E',
    }),
    seed(SaleOrderState, 'sale.state_cancel', {
      company: ref('base.company_default'),
      name: 'Cancel',
      sequence: 100,
      is_done: false,
      color: '#EF4444',
    }),
    seed(ModelAccess, 'sales.access_user_order_read', {
      group: ref('base.group_user'),
      model_name: SaleOrder.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'sales.access_user_order_line_read', {
      group: ref('base.group_user'),
      model_name: SaleOrderLine.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'sales.access_user_order_state_read', {
      group: ref('base.group_user'),
      model_name: SaleOrderState.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    }),
  ],
  menus: [
    {
      model: SaleOrder.modelName,
      label: 'Sale Orders',
      group: 'Sales',
      sequence: 10,
    },
    {
      model: SaleOrderLine.modelName,
      label: 'Order Lines',
      group: 'Sales',
      sequence: 15,
      developmentOnly: true,
    },
    {
      model: SaleOrderState.modelName,
      label: 'Order States',
      group: 'Sales',
      sequence: 25,
      developmentOnly: true,
    },
  ],
});
