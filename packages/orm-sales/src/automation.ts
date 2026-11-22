import { Opportunity } from '@moonwitness/orm-crm';
import { SaleOrder, SaleOrderLine, SaleOrderState } from './models/index.js';

export type SaleOrderInstance = InstanceType<typeof SaleOrder>;

export interface ConvertOpportunityOptions {
  readonly companyId?: number;
  readonly name?: string;
  readonly salespersonId?: number;
}

export interface ConfirmSaleOrderOptions {
  readonly companyId?: number;
  readonly confirmDate?: string;
}

export async function convertOpportunityToSaleOrder(
  opportunityId: number,
  options: ConvertOpportunityOptions = {}
): Promise<SaleOrderInstance> {
  const opportunity = await Opportunity.query()
    .findById(opportunityId)
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    });

  if (!opportunity) {
    throw new Error(`Opportunity #${opportunityId} not found`);
  }

  const existingOrder = await SaleOrder.query()
    .where({ opportunity_id: opportunity.id })
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    })
    .first();

  if (existingOrder) {
    return existingOrder;
  }

  const draftState = await SaleOrderState.query()
    .where({ is_done: false })
    .orderBy('sequence', 'asc')
    .first();

  if (!draftState) {
    throw new Error('No draft sales order state configured');
  }

  const year = new Date().getFullYear();
  const count = await SaleOrder.query().resultSize();
  const orderName = options.name?.trim() || `SO-${year}-${String(count + 1).padStart(4, '0')}`;

  const amountMinor = opportunity.expected_revenue_minor ?? 0;

  const saleOrder = await SaleOrder.query().insertAndFetch({
    name: orderName,
    partner_id: opportunity.partner_id,
    company_id: opportunity.company_id ?? options.companyId,
    state_id: draftState.id,
    opportunity_id: opportunity.id,
    currency: opportunity.currency ?? 'USD',
    description: opportunity.description ?? `Order generated from ${opportunity.name}`,
    assigned_to_id: options.salespersonId ?? opportunity.assigned_to_id,
    deadline: opportunity.deadline,
    total_amount_minor: amountMinor,
  });

  if (amountMinor > 0) {
    await SaleOrderLine.query().insert({
      name: opportunity.name,
      order_id: saleOrder.id,
      product: 'MW-SERVICE-CONTRACT',
      quantity: 1,
      unit_price_minor: amountMinor,
      discount_percent: 0,
      subtotal_minor: amountMinor,
      sequence: 10,
    });
  }

  return saleOrder;
}

export async function confirmSaleOrder(
  saleOrderId: number,
  options: ConfirmSaleOrderOptions = {}
): Promise<SaleOrderInstance> {
  const saleOrder = await SaleOrder.query()
    .findById(saleOrderId)
    .modify((builder) => {
      if (typeof options.companyId === 'number') builder.where('company_id', options.companyId);
    });

  if (!saleOrder) {
    throw new Error(`SaleOrder #${saleOrderId} not found`);
  }

  const confirmedState =
    (await SaleOrderState.query().where({ name: 'Confirmed' }).first()) ??
    (await SaleOrderState.query().where({ sequence: 30 }).first()) ??
    (await SaleOrderState.query().where({ is_done: false }).orderBy('sequence', 'desc').first());

  if (!confirmedState) {
    throw new Error('No confirmed sales order state configured');
  }

  const confirmDate = options.confirmDate ?? new Date().toISOString().slice(0, 10);

  return SaleOrder.query().patchAndFetchById(saleOrder.id, {
    state_id: confirmedState.id,
    confirm_date: confirmDate,
  });
}
