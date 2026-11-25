import { ISPRadiusSession, ISPSubscriber } from './models/index.js';
import { Subscription, SubscriptionInvoiceLine } from '@moonwitness/orm-subscription';

export interface MeteringResult {
  readonly processedSessions: number;
  readonly createdInvoiceLines: number;
  readonly totalAmountMinor: number;
}

export interface MeteringOptions {
  readonly companyId: number;
  readonly pricePerGbMinor?: number;
}

const BYTES_PER_GB = 1_073_741_824;

export async function meterSessionsToSubscriptionInvoices(
  options: MeteringOptions
): Promise<MeteringResult> {
  const pricePerGbMinor = options.pricePerGbMinor ?? 100;
  const sessions = await ISPRadiusSession.query()
    .where({ company_id: options.companyId, active: true })
    .whereNotNull('stop_time')
    .orderBy('id', 'asc');

  let createdInvoiceLines = 0;
  let totalAmountMinor = 0;

  for (const session of sessions) {
    if (!session.stop_time) continue;
    const subscriber = await ISPSubscriber.query().findOne({
      id: session.subscriber_id,
      company_id: options.companyId,
      active: true,
    });
    if (!subscriber?.subscription_id) continue;

    const subscription = await Subscription.query().findOne({
      id: subscriber.subscription_id,
      company_id: options.companyId,
      active: true,
    });
    if (!subscription) continue;

    const lineName = `ISP Usage · ${session.session_id}`;

    const totalOctets = (session.acct_input_octets ?? 0) + (session.acct_output_octets ?? 0);
    const billableGb = totalOctets > 0 ? Math.ceil(totalOctets / BYTES_PER_GB) : 0;
    const subtotalMinor = billableGb * pricePerGbMinor;

    // Check if invoice line already exists to maintain idempotency
    const existingLine = await SubscriptionInvoiceLine.query().findOne({
      subscription_id: subscription.id,
      name: lineName,
    });
    if (existingLine) continue;

    await SubscriptionInvoiceLine.query().insert({
      subscription_id: subscription.id,
      name: lineName,
      product: 'ISP-BANDWIDTH-GB',
      quantity: billableGb,
      unit_price_minor: pricePerGbMinor,
      discount_percent: 0,
      subtotal_minor: subtotalMinor,
      sequence: 50,
      invoice_date: session.stop_time.slice(0, 10),
    });

    createdInvoiceLines += 1;
    totalAmountMinor += subtotalMinor;
  }

  return {
    processedSessions: sessions.length,
    createdInvoiceLines,
    totalAmountMinor,
  };
}
