import type { Knex } from 'knex';
import { ErpLedgerConnector } from './connectors/erp-ledger.js';
import {
  PaymentGatewayConnector,
  PaymentIntentRecord,
  RefundRecord,
  PayoutReconciliationRecord,
  type Gateway,
} from './connectors/payment-gateways.js';
import { WebhookEndpoint } from './models.js';

export const INTEGRATION_SEED_VERSION = '1.0.0';

export interface ErpLedgerConnectorSeed {
  readonly name: string;
  readonly erpType: 'accurate' | 'odoo' | 'sap' | 'custom';
  readonly config: Readonly<Record<string, string | number | boolean>>;
  readonly enabled: boolean;
}

export interface PaymentGatewayConnectorSeed {
  readonly gateway: Gateway;
  readonly name: string;
  readonly config: Readonly<Record<string, string | number | boolean>>;
  readonly webhookSecretRef: string;
  readonly enabled: boolean;
  readonly isDefault: boolean;
}

export interface WebhookEndpointSeed {
  readonly name: string;
  readonly url: string;
  readonly eventTypes: readonly string[];
  readonly secretRef: string;
  readonly enabled: boolean;
}

export interface IntegrationSeedBundle {
  readonly version: string;
  readonly erpLedgerConnectors: readonly ErpLedgerConnectorSeed[];
  readonly paymentGatewayConnectors: readonly PaymentGatewayConnectorSeed[];
  readonly webhookEndpoints: readonly WebhookEndpointSeed[];
}

export interface IntegrationSeedExecutionResult {
  readonly companyId: number;
  readonly erpConnectorsTotal: number;
  readonly gatewayConnectorsTotal: number;
  readonly webhookEndpointsTotal: number;
  readonly insertedErpConnectors: number;
  readonly insertedGatewayConnectors: number;
  readonly insertedWebhookEndpoints: number;
}

export interface SeedIntegrationDataOptions {
  readonly companyId?: number;
}

const WEBHOOK_SECRET_PATTERN = /^MW_WEBHOOK_SECRET_C[1-9][0-9]*_[A-Z0-9_]{1,100}$/;

const ERP_CONNECTOR_SEEDS: readonly ErpLedgerConnectorSeed[] = [
  {
    name: 'Accurate Online',
    erpType: 'accurate',
    config: {
      apiBaseUrl: 'https://api.accurate.id',
      databaseId: 'MW-DEFAULT-DB',
    },
    enabled: true,
  },
  {
    name: 'Odoo Community',
    erpType: 'odoo',
    config: {
      jsonRpcUrl: 'https://odoo.example.internal/jsonrpc',
      database: 'moonwitness',
    },
    enabled: false,
  },
  {
    name: 'SAP S/4HANA',
    erpType: 'sap',
    config: {
      odataBaseUrl: 'https://sap-gw.example.internal/sap/opu/odata/sap',
      companyCode: '1000',
    },
    enabled: false,
  },
];

const PAYMENT_GATEWAY_SEEDS: readonly PaymentGatewayConnectorSeed[] = [
  {
    gateway: 'stripe',
    name: 'Stripe Default',
    config: {
      apiVersion: '2024-04-10',
    },
    webhookSecretRef: 'MW_WEBHOOK_SECRET_C1_STRIPE',
    enabled: true,
    isDefault: true,
  },
  {
    gateway: 'xendit',
    name: 'Xendit Default',
    config: {
      isProduction: false,
    },
    webhookSecretRef: 'MW_WEBHOOK_SECRET_C1_XENDIT',
    enabled: true,
    isDefault: false,
  },
  {
    gateway: 'midtrans',
    name: 'Midtrans Default',
    config: {
      isProduction: false,
    },
    webhookSecretRef: 'MW_WEBHOOK_SECRET_C1_MIDTRANS',
    enabled: true,
    isDefault: false,
  },
];

const WEBHOOK_ENDPOINT_SEEDS: readonly WebhookEndpointSeed[] = [
  {
    name: 'Stripe Webhook',
    url: 'https://api.example.com/webhooks/stripe',
    eventTypes: [
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'charge.refunded',
      'payout.paid',
    ],
    secretRef: 'MW_WEBHOOK_SECRET_C1_STRIPE',
    enabled: true,
  },
  {
    name: 'Xendit Webhook',
    url: 'https://api.example.com/webhooks/xendit',
    eventTypes: ['invoice.paid', 'invoice.expired', 'payout.completed', 'payout.failed'],
    secretRef: 'MW_WEBHOOK_SECRET_C1_XENDIT',
    enabled: true,
  },
  {
    name: 'Midtrans Webhook',
    url: 'https://api.example.com/webhooks/midtrans',
    eventTypes: ['settlement', 'deny', 'cancel', 'expire', 'refund'],
    secretRef: 'MW_WEBHOOK_SECRET_C1_MIDTRANS',
    enabled: true,
  },
  {
    name: 'Example disabled webhook',
    url: 'https://example.invalid/moonwitness-webhook',
    eventTypes: ['base.partner.updated'],
    secretRef: 'MW_WEBHOOK_SECRET_C1_EXAMPLE',
    enabled: false,
  },
];

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildIntegrationSeedBundle(): IntegrationSeedBundle {
  return {
    version: INTEGRATION_SEED_VERSION,
    erpLedgerConnectors: deepClone(ERP_CONNECTOR_SEEDS),
    paymentGatewayConnectors: deepClone(PAYMENT_GATEWAY_SEEDS),
    webhookEndpoints: deepClone(WEBHOOK_ENDPOINT_SEEDS),
  };
}

async function resolveSeedCompanyId(
  db: Knex,
  options: SeedIntegrationDataOptions
): Promise<number> {
  if (options.companyId !== undefined) {
    return options.companyId;
  }
  const companyTable = 'companies';
  const hasTable = await db.schema.hasTable(companyTable);
  if (!hasTable) {
    throw new Error(`Cannot resolve seed company: table '${companyTable}' does not exist`);
  }
  const existing = await db(companyTable).orderBy('id').first('id');
  if (!existing) {
    throw new Error('Cannot resolve seed company: no company rows exist');
  }
  const id = Number((existing as Record<string, unknown>).id);
  if (!Number.isFinite(id)) {
    throw new Error('Cannot resolve seed company: company row has no numeric id');
  }
  return id;
}

export async function seedIntegrationData(
  db: Knex,
  options: SeedIntegrationDataOptions = {},
  bundle: IntegrationSeedBundle = buildIntegrationSeedBundle()
): Promise<IntegrationSeedExecutionResult> {
  for (const endpoint of bundle.webhookEndpoints) {
    if (!WEBHOOK_SECRET_PATTERN.test(endpoint.secretRef)) {
      throw new Error(`Invalid webhook secret ref in seed: ${endpoint.secretRef}`);
    }
  }
  const companyId = await resolveSeedCompanyId(db, options);
  const counts = {
    companyId,
    erpConnectorsTotal: bundle.erpLedgerConnectors.length,
    gatewayConnectorsTotal: bundle.paymentGatewayConnectors.length,
    webhookEndpointsTotal: bundle.webhookEndpoints.length,
    insertedErpConnectors: 0,
    insertedGatewayConnectors: 0,
    insertedWebhookEndpoints: 0,
  };

  await db.transaction(async (trx) => {
    for (const connector of bundle.erpLedgerConnectors) {
      const existing = await trx(ErpLedgerConnector.tableName)
        .where({ name: connector.name, company_id: companyId })
        .first('id');
      if (existing) continue;
      await trx(ErpLedgerConnector.tableName).insert({
        company_id: companyId,
        name: connector.name,
        erp_type: connector.erpType,
        config: JSON.stringify(connector.config),
        chart_of_accounts: '[]',
        enabled: connector.enabled ? 1 : 0,
      });
      counts.insertedErpConnectors += 1;
    }

    for (const gateway of bundle.paymentGatewayConnectors) {
      const existing = await trx(PaymentGatewayConnector.tableName)
        .where({ gateway: gateway.gateway, company_id: companyId })
        .first('id');
      if (existing) continue;
      await trx(PaymentGatewayConnector.tableName).insert({
        company_id: companyId,
        gateway: gateway.gateway,
        name: gateway.name,
        config_json: JSON.stringify(gateway.config),
        webhook_secret_ref: gateway.webhookSecretRef,
        enabled: gateway.enabled ? 1 : 0,
        is_default: gateway.isDefault ? 1 : 0,
      });
      counts.insertedGatewayConnectors += 1;
    }

    for (const endpoint of bundle.webhookEndpoints) {
      const existing = await trx(WebhookEndpoint.tableName)
        .where({ url: endpoint.url, company_id: companyId })
        .first('id');
      if (existing) continue;
      await trx(WebhookEndpoint.tableName).insert({
        company_id: companyId,
        name: endpoint.name,
        url: endpoint.url,
        event_types: JSON.stringify([...endpoint.eventTypes]),
        secret_ref: endpoint.secretRef,
        enabled: endpoint.enabled ? 1 : 0,
      });
      counts.insertedWebhookEndpoints += 1;
    }
  });

  return counts;
}
