import { defineAddon, ref, seed } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import { SubscriptionPlan, Subscription, SubscriptionInvoiceLine, SubscriptionTagLink } from './models/index.js';

export const manifest = defineAddon({
  name: 'subscription',
  version: '1.0.0',
  depends: ['base', 'sales'],
  models: [SubscriptionPlan, Subscription, SubscriptionInvoiceLine, SubscriptionTagLink],
  data: [
    seed(SubscriptionPlan, 'subscription.plan_monthly_basic', {
      company_id: 1,
      name: 'Basic Monthly',
      code: 'basic-monthly',
      description: 'Basic monthly plan',
      amount_minor: 9900,
      currency: 'USD',
      interval: 'monthly',
      interval_count: 1,
      trial_days: 7,
      is_active: true,
    }),
    seed(SubscriptionPlan, 'subscription.plan_monthly_pro', {
      company_id: 1,
      name: 'Pro Monthly',
      code: 'pro-monthly',
      description: 'Professional monthly plan',
      amount_minor: 29900,
      currency: 'USD',
      interval: 'monthly',
      interval_count: 1,
      trial_days: 14,
      is_active: true,
    }),
    seed(ModelAccess, 'subscription.access_user_plan_read', {
      group: ref('base.group_user'),
      model_name: SubscriptionPlan.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    }),
    seed(ModelAccess, 'subscription.access_user_subscription_read', {
      group: ref('base.group_user'),
      model_name: Subscription.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
    seed(ModelAccess, 'subscription.access_user_invoice_line_read', {
      group: ref('base.group_user'),
      model_name: SubscriptionInvoiceLine.modelName,
      read: true,
      create: true,
      write: true,
      unlink: false,
    }),
  ],
  menus: [
    {
      model: SubscriptionPlan.modelName,
      label: 'Subscription Plans',
      group: 'Subscription',
      sequence: 10,
    },
    {
      model: Subscription.modelName,
      label: 'Subscriptions',
      group: 'Subscription',
      sequence: 20,
    },
    {
      model: SubscriptionInvoiceLine.modelName,
      label: 'Invoice Lines',
      group: 'Subscription',
      sequence: 25,
      developmentOnly: true,
    },
  ],
});
