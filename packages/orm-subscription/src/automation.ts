import { SaleOrder, SaleOrderLine } from '@moonwitness/orm-sales';
import { Subscription, SubscriptionInvoiceLine, SubscriptionPlan } from './models/index.js';

export type SubscriptionInstance = InstanceType<typeof Subscription>;

export interface CreateSubscriptionFromOrderOptions {
  readonly companyId?: number;
  readonly planId?: number;
  readonly state?: 'pending' | 'active';
}

export interface SubscriptionLifecycleOptions {
  readonly companyId?: number;
}

export async function createSubscriptionFromSaleOrder(
  saleOrderId: number,
  options: CreateSubscriptionFromOrderOptions = {}
): Promise<SubscriptionInstance> {
  const saleOrder = await SaleOrder.query()
    .findById(saleOrderId)
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    });

  if (!saleOrder) {
    throw new Error(`SaleOrder #${saleOrderId} not found`);
  }

  const existing = await Subscription.query()
    .where({ sale_order_id: saleOrder.id })
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    })
    .first();

  if (existing) {
    return existing;
  }

  let plan: InstanceType<typeof SubscriptionPlan> | undefined;
  if (options.planId) {
    plan = await SubscriptionPlan.query().findById(options.planId);
  }
  if (!plan) {
    const plans = await SubscriptionPlan.query()
      .where({ is_active: true })
      .orderBy('amount_minor', 'desc');
    plan = plans[0];
  }

  if (!plan) {
    throw new Error('No active subscription plan found');
  }

  const year = new Date().getFullYear();
  const count = await Subscription.query().resultSize();
  const subName = `SUB-${year}-${String(count + 1).padStart(4, '0')}`;
  const nowIso = new Date().toISOString().slice(0, 10);
  const nextYearIso = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const amountMinor = saleOrder.total_amount_minor ?? plan.amount_minor;

  const subscription = await Subscription.query().insertAndFetch({
    name: subName,
    partner_id: saleOrder.partner_id,
    company_id: saleOrder.company_id ?? options.companyId,
    plan_id: plan.id,
    sale_order_id: saleOrder.id,
    state: options.state ?? 'active',
    currency: saleOrder.currency ?? plan.currency ?? 'USD',
    amount_minor: amountMinor,
    start_date: nowIso,
    next_invoice_date: nextYearIso,
    assigned_to_id: saleOrder.assigned_to_id,
    description: `Subscription automatically created from Sale Order ${saleOrder.name}`,
  });

  const lines = await SaleOrderLine.query()
    .where({ order_id: saleOrder.id })
    .orderBy('sequence', 'asc');
  if (lines.length > 0) {
    for (const line of lines) {
      await SubscriptionInvoiceLine.query().insert({
        subscription_id: subscription.id,
        name: line.name,
        product: line.product,
        quantity: line.quantity,
        unit_price_minor: line.unit_price_minor ?? plan.amount_minor,
        discount_percent: line.discount_percent,
        subtotal_minor: line.subtotal_minor ?? plan.amount_minor,
        sequence: line.sequence,
        invoice_date: nowIso,
      });
    }
  } else {
    await SubscriptionInvoiceLine.query().insert({
      subscription_id: subscription.id,
      name: `${plan.name} Platform Line`,
      product: plan.code,
      quantity: 1,
      unit_price_minor: plan.amount_minor,
      discount_percent: 0,
      subtotal_minor: plan.amount_minor,
      sequence: 10,
      invoice_date: nowIso,
    });
  }

  return subscription;
}

export async function activateSubscription(
  subscriptionId: number,
  options: SubscriptionLifecycleOptions = {}
): Promise<SubscriptionInstance> {
  const subscription = await Subscription.query()
    .findById(subscriptionId)
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    });

  if (!subscription) {
    throw new Error(`Subscription #${subscriptionId} not found`);
  }

  return Subscription.query().patchAndFetchById(subscription.id, {
    state: 'active',
  });
}

export async function suspendSubscription(
  subscriptionId: number,
  options: SubscriptionLifecycleOptions = {}
): Promise<SubscriptionInstance> {
  const subscription = await Subscription.query()
    .findById(subscriptionId)
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    });

  if (!subscription) {
    throw new Error(`Subscription #${subscriptionId} not found`);
  }

  return Subscription.query().patchAndFetchById(subscription.id, {
    state: 'paused',
  });
}
