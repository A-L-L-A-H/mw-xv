import { defineAddon, defineView, ref, seed } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import { WebhookDelivery, WebhookEndpoint } from './models.js';
import { PaymentGatewayConnector } from './connectors/payment-gateways.js';

const defaultCompanyRef = ref('base.company_default');

const adminModels = [WebhookEndpoint, WebhookDelivery, PaymentGatewayConnector] as const;

export const manifest = defineAddon({
  name: 'orm-integration',
  version: '1.0.0',
  depends: ['base', 'jobs'],
  models: [...adminModels],
  data: [
    seed(WebhookEndpoint, 'orm-integration.endpoint_example_disabled', {
      company: defaultCompanyRef,
      name: 'Example disabled webhook',
      url: 'https://example.invalid/moonwitness-webhook',
      event_types: '["base.partner.updated"]',
      secret_ref: 'MW_WEBHOOK_SECRET_C1_EXAMPLE',
      enabled: false,
    }),
    seed(WebhookEndpoint, 'orm-integration.endpoint_demo_crm_pipeline', {
      company: defaultCompanyRef,
      name: 'Demo disabled CRM webhook',
      url: 'https://example.invalid/webhooks/crm',
      event_types: '["crm.lead.qualified","crm.opportunity.won"]',
      secret_ref: 'MW_WEBHOOK_SECRET_C1_CRM_DEMO',
      enabled: false,
    }),
    seed(WebhookEndpoint, 'orm-integration.endpoint_demo_project_events', {
      company: defaultCompanyRef,
      name: 'Demo disabled project milestone webhook',
      url: 'https://example.invalid/webhooks/projects',
      event_types: '["project.task.completed","project.milestone.reached"]',
      secret_ref: 'MW_WEBHOOK_SECRET_C1_PROJECT_DEMO',
      enabled: false,
    }),
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
      event_types: JSON.stringify(['settlement', 'deny', 'cancel', 'expire', 'refund']),
      secret_ref: 'MW_WEBHOOK_SECRET_C1_MIDTRANS',
      enabled: true,
    }),
    ...adminModels.map((model) =>
      seed(
        ModelAccess,
        `orm-integration.access_superadmin_${model.modelName.replaceAll('.', '_')}`,
        {
          group: ref('base.group_superadmin'),
          model_name: model.modelName,
          read: true,
          create: true,
          write: true,
          unlink: true,
        }
      )
    ),
  ],
  views: [
    defineView(WebhookEndpoint, {
      title: 'Webhook Endpoints',
      list: { columns: ['name', 'company', 'enabled'], order: 'name asc' },
      form: {
        sections: [
          {
            title: 'Endpoint',
            fields: ['name', 'company', 'url', 'event_types', 'secret_ref', 'enabled'],
          },
        ],
      },
      search: { fields: ['name'] },
    }),
    defineView(WebhookDelivery, {
      title: 'Webhook Deliveries',
      list: {
        columns: ['endpoint', 'company', 'event_type', 'status', 'attempts', 'response_status'],
      },
      form: {
        sections: [
          {
            title: 'Delivery',
            fields: [
              'endpoint',
              'event_type',
              'status',
              'attempts',
              'response_status',
              'delivered_at',
            ],
          },
        ],
      },
      search: { fields: ['event_type'] },
    }),
  ],
  menus: [
    {
      model: WebhookEndpoint.modelName,
      label: 'Webhook Endpoints',
      group: 'Technical',
      sequence: 490,
      developmentOnly: true,
    },
    {
      model: WebhookDelivery.modelName,
      label: 'Webhook Deliveries',
      group: 'Technical',
      sequence: 491,
      developmentOnly: true,
    },
  ],
});
