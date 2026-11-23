import { createHmac, timingSafeEqual, createSign, createVerify } from 'node:crypto';
import { defineModel, fields } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';

export type Gateway = 'stripe' | 'xendit' | 'midtrans';

export interface PaymentIntentRequest {
  readonly amount: number;
  readonly currency: string;
  readonly companyId: number;
  readonly customerId: string;
  readonly orderId: string;
  readonly description?: string;
  readonly metadata?: Record<string, string>;
  readonly paymentMethodTypes?: string[];
  readonly captureMethod?: 'automatic' | 'manual';
  readonly returnUrl?: string;
  readonly cancelUrl?: string;
}

export interface PaymentIntentResponse {
  readonly id: string;
  readonly clientSecret?: string;
  readonly status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'succeeded'
    | 'canceled';
  readonly amount: number;
  readonly currency: string;
  readonly gateway: Gateway;
  readonly nextAction?: {
    readonly type: 'redirect_to_url';
    readonly redirectToUrl: { readonly url: string };
  };
}

export interface RefundRequest {
  readonly paymentIntentId: string;
  readonly amount?: number;
  readonly reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
  readonly metadata?: Record<string, string>;
}

export interface RefundResponse {
  readonly id: string;
  readonly paymentIntentId: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: 'pending' | 'succeeded' | 'failed' | 'canceled';
  readonly reason?: string;
  readonly gateway: Gateway;
}

export interface PayoutRecord {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: 'pending' | 'paid' | 'failed' | 'canceled';
  readonly arrivedAt?: string;
  readonly failureCode?: string;
  readonly gateway: Gateway;
}

export interface ReconciliationResult {
  readonly matched: number;
  readonly unmatchedGateway: PayoutRecord[];
  readonly unmatchedLocal: {
    readonly id: string;
    readonly amount: number;
    readonly currency: string;
  }[];
  readonly discrepancies: {
    readonly gateway: PayoutRecord;
    readonly local: { readonly id: string; readonly amount: number };
    readonly difference: number;
  }[];
}

export interface StripeConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly apiVersion: string;
}

export interface XenditConfig {
  readonly secretKey: string;
  readonly webhookToken: string;
  readonly isProduction: boolean;
}

export interface MidtransConfig {
  readonly serverKey: string;
  readonly clientKey: string;
  readonly isProduction: boolean;
  readonly merchantId?: string;
}

export type PaymentGatewayConfig = StripeConfig | XenditConfig | MidtransConfig;

function assertGateway(
  config: PaymentGatewayConfig,
  expected: Gateway
): asserts config is Extract<PaymentGatewayConfig, { [key in Gateway]: unknown }> {
  const key =
    expected === 'stripe' ? 'secretKey' : expected === 'xendit' ? 'secretKey' : 'serverKey';
  if (!(key in config)) {
    throw new Error(`Invalid config for gateway ${expected}`);
  }
}

function generateIdempotencyKey(companyId: number, orderId: string): string {
  return `mw:${companyId}:${orderId}`;
}

export function buildStripePaymentIntent(
  request: PaymentIntentRequest,
  config: StripeConfig
): PaymentIntentResponse {
  assertGateway(config, 'stripe');

  const amountCents = Math.round(request.amount * 100);
  const paymentMethodTypes = request.paymentMethodTypes ?? ['card'];

  const clientSecret = `pi_${request.orderId}_secret_${Buffer.from(
    JSON.stringify({
      amount: amountCents,
      currency: request.currency.toLowerCase(),
      customer: request.customerId,
      metadata: { ...request.metadata, orderId: request.orderId },
    })
  ).toString('base64url')}`;

  return {
    id: `pi_${request.orderId}`,
    clientSecret,
    status: 'requires_payment_method',
    amount: request.amount,
    currency: request.currency,
    gateway: 'stripe',
  };
}

export function buildXenditPaymentIntent(
  request: PaymentIntentRequest,
  config: XenditConfig
): PaymentIntentResponse {
  assertGateway(config, 'xendit');

  const externalId = `xnd_${request.orderId}`;
  const callbackUrl = request.returnUrl ?? '';

  return {
    id: externalId,
    clientSecret: undefined,
    status: 'requires_action',
    amount: request.amount,
    currency: request.currency,
    gateway: 'xendit',
    nextAction: {
      type: 'redirect_to_url',
      redirectToUrl: { url: `https://checkout.xendit.co/v1/${externalId}` },
    },
  };
}

export function buildMidtransPaymentIntent(
  request: PaymentIntentRequest,
  config: MidtransConfig
): PaymentIntentResponse {
  assertGateway(config, 'midtrans');

  const orderId = `mid_${request.orderId}`;
  const grossAmount = Math.round(request.amount * 100);

  const snapToken = `snap-${orderId}-${Buffer.from(
    JSON.stringify({
      transaction_details: { order_id: orderId, gross_amount: grossAmount },
      customer_details: { id: request.customerId },
    })
  ).toString('base64url')}`;

  return {
    id: orderId,
    clientSecret: snapToken,
    status: 'requires_action',
    amount: request.amount,
    currency: request.currency,
    gateway: 'midtrans',
    nextAction: {
      type: 'redirect_to_url',
      redirectToUrl: { url: `https://app.sandbox.midtrans.com/snap/v1/transactions/${snapToken}` },
    },
  };
}

export function buildPaymentIntent(
  request: PaymentIntentRequest,
  gateway: Gateway,
  config: PaymentGatewayConfig
): PaymentIntentResponse {
  switch (gateway) {
    case 'stripe':
      return buildStripePaymentIntent(request, config as StripeConfig);
    case 'xendit':
      return buildXenditPaymentIntent(request, config as XenditConfig);
    case 'midtrans':
      return buildMidtransPaymentIntent(request, config as MidtransConfig);
    default:
      throw new Error(`Unsupported gateway: ${gateway}`);
  }
}

export function signRefundPayload(
  request: RefundRequest,
  gateway: Gateway,
  secret: string
): string {
  const payload = JSON.stringify({
    paymentIntentId: request.paymentIntentId,
    amount: request.amount,
    reason: request.reason,
    metadata: request.metadata,
  });

  switch (gateway) {
    case 'stripe': {
      return createHmac('sha256', secret).update(payload).digest('hex');
    }
    case 'xendit': {
      return createHmac('sha256', secret).update(payload).digest('hex');
    }
    case 'midtrans': {
      const sign = createSign('SHA256');
      sign.update(payload);
      sign.end();
      return sign.sign(secret, 'base64');
    }
    default: {
      throw new Error(`Unsupported gateway for refund signing: ${gateway}`);
    }
  }
}

export function verifyRefundSignature(
  gateway: Gateway,
  secret: string,
  request: RefundRequest,
  signature: string
): boolean {
  const expected = signRefundPayload(request, gateway, secret);

  if (gateway === 'midtrans') {
    // Midtrans uses base64 encoded signatures
    const expectedBuffer = Buffer.from(expected, 'base64');
    const suppliedBuffer = Buffer.from(signature, 'base64');
    if (expectedBuffer.length !== suppliedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, suppliedBuffer);
  }

  // Stripe and Xendit use hex encoded signatures
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function dispatchRefund(
  request: RefundRequest,
  gateway: Gateway,
  config: PaymentGatewayConfig
): RefundResponse {
  assertGateway(config, gateway);

  const refundId = `re_${gateway}_${request.paymentIntentId}_${Date.now()}`;
  const amount = request.amount ?? 0;

  return {
    id: refundId,
    paymentIntentId: request.paymentIntentId,
    amount,
    currency: 'IDR',
    status: 'pending',
    reason: request.reason,
    gateway,
  };
}

export function reconcileStripePayouts(
  gatewayRecords: PayoutRecord[],
  localRecords: { readonly id: string; readonly amount: number; readonly currency: string }[]
): ReconciliationResult {
  const matched: string[] = [];
  const discrepancies: ReconciliationResult['discrepancies'] = [];
  const gatewayMap = new Map(gatewayRecords.map((r) => [r.id, r]));
  const localMap = new Map(localRecords.map((r) => [r.id, r]));

  for (const [id, gateway] of gatewayMap) {
    const local = localMap.get(id);
    if (!local) continue;

    const diff = Math.abs(gateway.amount - local.amount);
    if (diff <= 0.01) {
      matched.push(id);
    } else {
      discrepancies.push({ gateway, local, difference: gateway.amount - local.amount });
    }
  }

  return {
    matched: matched.length,
    unmatchedGateway: gatewayRecords.filter(
      (r) => !matched.includes(r.id) && !discrepancies.some((d) => d.gateway.id === r.id)
    ),
    unmatchedLocal: localRecords.filter(
      (r) => !matched.includes(r.id) && !discrepancies.some((d) => d.local.id === r.id)
    ),
    discrepancies,
  };
}

export function reconcileXenditPayouts(
  gatewayRecords: PayoutRecord[],
  localRecords: { readonly id: string; readonly amount: number; readonly currency: string }[]
): ReconciliationResult {
  return reconcileStripePayouts(gatewayRecords, localRecords);
}

export function reconcileMidtransPayouts(
  gatewayRecords: PayoutRecord[],
  localRecords: { readonly id: string; readonly amount: number; readonly currency: string }[]
): ReconciliationResult {
  return reconcileStripePayouts(gatewayRecords, localRecords);
}

export function reconcilePayouts(
  gatewayRecords: PayoutRecord[],
  localRecords: { readonly id: string; readonly amount: number; readonly currency: string }[],
  gateway: Gateway
): ReconciliationResult {
  switch (gateway) {
    case 'stripe':
      return reconcileStripePayouts(gatewayRecords, localRecords);
    case 'xendit':
      return reconcileXenditPayouts(gatewayRecords, localRecords);
    case 'midtrans':
      return reconcileMidtransPayouts(gatewayRecords, localRecords);
    default:
      throw new Error(`Unsupported gateway for reconciliation: ${gateway}`);
  }
}

export const PaymentGatewayConnector = defineModel('integration.payment_gateway_connector', {
  table: 'integration_payment_gateway_connectors',
  order: 'company_id asc, gateway asc, id asc',
  fields: {
    company: fields.belongsTo(Company, { required: true }),
    gateway: fields.enum(['stripe', 'xendit', 'midtrans'], { required: true }),
    name: fields.string({ required: true }),
    config_json: fields.text({ required: true }),
    webhook_secret_ref: fields.string({
      required: true,
      pattern: '^MW_WEBHOOK_SECRET_C[1-9][0-9]*_[A-Z0-9_]{1,100}$',
    }),
    enabled: fields.boolean({ required: true, default: true }),
    is_default: fields.boolean({ required: true, default: false }),
  },
  unique: [['company', 'gateway', 'is_default']],
});

export const PaymentIntentRecord = defineModel('integration.payment_intent', {
  table: 'integration_payment_intents',
  order: 'create_date desc, id desc',
  fields: {
    company: fields.belongsTo(Company, { required: true }),
    connector: fields.belongsTo(PaymentGatewayConnector, { required: true }),
    gateway: fields.enum(['stripe', 'xendit', 'midtrans'], { required: true }),
    external_id: fields.string({ required: true }),
    client_secret_ref: fields.string(),
    amount: fields.decimal({ required: true, precision: 18, scale: 2 }),
    currency: fields.string({ required: true, default: 'IDR' }),
    status: fields.enum(
      [
        'requires_payment_method',
        'requires_confirmation',
        'requires_action',
        'processing',
        'succeeded',
        'canceled',
      ],
      { required: true }
    ),
    order_id: fields.string({ required: true }),
    customer_id: fields.string({ required: true }),
    metadata_json: fields.text({ default: '{}' }),
    capture_method: fields.enum(['automatic', 'manual'], { default: 'automatic' }),
    next_action_url: fields.string(),
    idempotency_key: fields.string({ required: true }),
  },
  unique: [['connector', 'external_id']],
});

export const RefundRecord = defineModel('integration.refund', {
  table: 'integration_refunds',
  order: 'create_date desc, id desc',
  fields: {
    company: fields.belongsTo(Company, { required: true }),
    payment_intent: fields.belongsTo(PaymentIntentRecord, { required: true }),
    gateway: fields.enum(['stripe', 'xendit', 'midtrans'], { required: true }),
    external_id: fields.string({ required: true }),
    amount: fields.decimal({ required: true, precision: 18, scale: 2 }),
    currency: fields.string({ required: true, default: 'IDR' }),
    status: fields.enum(['pending', 'succeeded', 'failed', 'canceled'], { required: true }),
    reason: fields.enum(['duplicate', 'fraudulent', 'requested_by_customer']),
    metadata_json: fields.text({ default: '{}' }),
  },
  unique: [['payment_intent', 'external_id']],
});

export const PayoutReconciliationRecord = defineModel('integration.payout_reconciliation', {
  table: 'integration_payout_reconciliations',
  order: 'create_date desc, id desc',
  fields: {
    company: fields.belongsTo(Company, { required: true }),
    connector: fields.belongsTo(PaymentGatewayConnector, { required: true }),
    gateway: fields.enum(['stripe', 'xendit', 'midtrans'], { required: true }),
    period_start: fields.string({ required: true }),
    period_end: fields.string({ required: true }),
    matched_count: fields.integer({ required: true, default: 0 }),
    unmatched_gateway_count: fields.integer({ required: true, default: 0 }),
    unmatched_local_count: fields.integer({ required: true, default: 0 }),
    discrepancy_count: fields.integer({ required: true, default: 0 }),
    details_json: fields.text({ required: true }),
  },
});

export function buildJournalEntryFromPaymentIntent(
  paymentIntent: InstanceType<typeof PaymentIntentRecord>,
  gatewayFee?: number
): {
  lines: {
    account_code: string;
    debit: number;
    credit: number;
    description: string;
  }[];
  total: number;
} {
  const amount = Number(paymentIntent.amount);
  const fee = gatewayFee ?? 0;
  const lines = [
    {
      account_code: '1101',
      debit: amount,
      credit: 0,
      description: `Payment received: ${paymentIntent.order_id}`,
    },
    {
      account_code: '4101',
      debit: 0,
      credit: amount,
      description: `Revenue: ${paymentIntent.order_id}`,
    },
  ];

  if (fee > 0) {
    lines.push(
      {
        account_code: '6101',
        debit: fee,
        credit: 0,
        description: `Gateway fee: ${paymentIntent.gateway}`,
      },
      {
        account_code: '1101',
        debit: 0,
        credit: fee,
        description: `Gateway fee deduction: ${paymentIntent.gateway}`,
      }
    );
  }

  return {
    lines,
    total: amount,
  };
}

export function buildJournalEntryFromRefund(
  refund: InstanceType<typeof RefundRecord>,
  originalAmount: number
): {
  lines: {
    account_code: string;
    debit: number;
    credit: number;
    description: string;
  }[];
  total: number;
} {
  const amount = Number(refund.amount);
  return {
    lines: [
      {
        account_code: '4101',
        debit: amount,
        credit: 0,
        description: `Revenue reversal: ${refund.external_id}`,
      },
      {
        account_code: '1101',
        debit: 0,
        credit: amount,
        description: `Cash outflow for refund: ${refund.external_id}`,
      },
    ],
    total: amount,
  };
}
