import { seed, ref } from '@moonwitness/orm';
import { PaymentGatewayConnector, WebhookEndpoint } from './models.js';

const defaultCompanyRef = ref('base.company_default');

export const seedData = [
  seed(PaymentGatewayConnector, 'orm-integration.payment_gateway_stripe_default', {
    company: defaultCompanyRef,
    gateway: 'stripe',
    name: 'Stripe Default',
    config_json: JSON.stringify({
      apiVersion: '2024-04-10',
    }),
    webhook_secret_ref: 'MW_WEBHOOK_SECRET_C1_STRIPE',
    enabled: true,
    is_default: true,
  }),
  
  seed(PaymentGatewayConnector, 'orm-integration.payment_gateway_xendit_default', {
    company: defaultCompanyRef,
    gateway: 'xendit',
    name: 'Xendit Default',
    config_json: JSON.stringify({
      isProduction: false,
    }),
    webhook_secret_ref: 'MW_WEBHOOK_SECRET_C1_XENDIT',
    enabled: true,
    is_default: false,
  }),
  
  seed(PaymentGatewayConnector, 'orm-integration.payment_gateway_midtrans_default', {
    company: defaultCompanyRef,
    gateway: 'midtrans',
    name: 'Midtrans Default',
    config_json: JSON.stringify({
      isProduction: false,
    }),
    webhook_secret_ref: 'MW_WEBHOOK_SECRET_C1_MIDTRANS',
    enabled: true,
    is_default: false,
  }),
  
  seed(WebhookEndpoint, 'orm-integration.endpoint_stripe_webhook', {
    company: defaultCompanyRef,
    name: 'Stripe Webhook',
    url: 'https://api.example.com/webhooks/stripe',
    event_types: JSON.stringify([
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'charge.refunded',
      'payout.paid',
    ]),
    secret_ref: 'MW_WEBHOOK_SECRET_C1_STRIPE',
    enabled: true,
  }),
  
  seed(WebhookEndpoint, 'orm-integration.endpoint_xendit_webhook', {
    company: defaultCompanyRef,
    name: 'Xendit Webhook',
    url: 'https://api.example.com/webhooks/xendit',
    event_types: JSON.stringify([
      'invoice.paid',
      'invoice.expired',
      'payout.completed',
      'payout.failed',
    ]),
    secret_ref: 'MW_WEBHOOK_SECRET_C1_XENDIT',
    enabled: true,
  }),
  
  seed(WebhookEndpoint, 'orm-integration.endpoint_midtrans_webhook', {
    company: defaultCompanyRef,
    name: 'Midtrans Webhook',
    url: 'https://api.example.com/webhooks/midtrans',
    event_types: JSON.stringify([
      'settlement',
      'deny',
      'cancel',
      'expire',
      'refund',
    ]),
    secret_ref: 'MW_WEBHOOK_SECRET_C1_MIDTRANS',
    enabled: true,
  }),
];

export async function seedPaymentGateways(knex: any): Promise<void> {
  for (const s of seedData) {
    await s(knex);
  }
}