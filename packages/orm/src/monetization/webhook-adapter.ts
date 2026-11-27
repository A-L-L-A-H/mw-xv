import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  MidtransAdapterConfig,
  MidtransWebhookPayload,
  PaymentChannel,
  PaymentWebhookEventType,
  VerifiedWebhookEvent,
  XenditAdapterConfig,
  XenditVaWebhookPayload,
  XenditVerificationMode,
} from './types.js';

export type WebhookHeaders = Record<string, string | string[] | undefined>;

/**
 * Error raised when a payment webhook payload or signature fails verification.
 */
export class WebhookVerificationError extends Error {
  public readonly provider: 'midtrans' | 'xendit';

  public constructor(provider: 'midtrans' | 'xendit', message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
    this.provider = provider;
  }
}

/**
 * Constant-time string equality using fixed-length SHA-256 digests so
 * neither secret length nor prefix bytes leak via timing side channels.
 */
export function constantTimeEqual(expected: string, actual: string): boolean {
  if (typeof expected !== 'string' || typeof actual !== 'string') {
    return false;
  }
  if (expected.length === 0 || actual.length === 0) {
    return false;
  }
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const actualDigest = createHash('sha256').update(actual, 'utf8').digest();
  return timingSafeEqual(expectedDigest, actualDigest);
}

function readHeader(headers: WebhookHeaders, targetName: string): string | undefined {
  const normalizedTarget = targetName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedTarget) {
      continue;
    }
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
  return undefined;
}

function parsePositiveAmount(raw: string | number, provider: 'midtrans' | 'xendit'): number {
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new WebhookVerificationError(provider, `Invalid payment amount: ${String(raw)}`);
  }
  return numeric;
}

/**
 * Computes the canonical Midtrans Snap/QRIS SHA-512 webhook signature:
 * SHA512(order_id + status_code + gross_amount + serverKey).
 */
export function computeMidtransSignature(
  orderId: string,
  statusCode: string | number,
  grossAmount: string | number,
  serverKey: string
): string {
  const preimage = `${orderId}${String(statusCode)}${String(grossAmount)}${serverKey}`;
  return createHash('sha512').update(preimage, 'utf8').digest('hex');
}

function mapMidtransEventType(
  transactionStatus: string,
  fraudStatus?: string
): PaymentWebhookEventType {
  const normalized = transactionStatus.trim().toLowerCase();
  const fraud = fraudStatus?.trim().toLowerCase();
  if (normalized === 'settlement') {
    return 'payment.settled';
  }
  if (normalized === 'capture') {
    return fraud === 'deny' || fraud === 'challenge' ? 'payment.pending' : 'payment.settled';
  }
  if (normalized === 'pending') {
    return 'payment.pending';
  }
  if (normalized === 'expire') {
    return 'payment.expired';
  }
  if (normalized === 'refund' || normalized === 'partial_refund' || normalized === 'chargeback') {
    return 'payment.refunded';
  }
  return 'payment.failed';
}

function resolveMidtransChannel(paymentType?: string): PaymentChannel {
  const normalized = paymentType?.trim().toLowerCase();
  if (normalized === 'qris') {
    return 'qris';
  }
  if (normalized === 'bank_transfer' || normalized === 'echannel' || normalized === 'permata') {
    return 'virtual_account';
  }
  if (!normalized || normalized === 'snap') {
    return 'snap';
  }
  return 'other';
}

function assertMidtransPayloadValid(
  payload: MidtransWebhookPayload,
  config: MidtransAdapterConfig
): void {
  if (!config.serverKey) {
    throw new WebhookVerificationError('midtrans', 'Midtrans serverKey is required.');
  }
  const missingFields =
    !payload || !payload.order_id || payload.status_code === undefined || payload.gross_amount === undefined;
  if (missingFields) {
    throw new WebhookVerificationError('midtrans', 'Midtrans payload missing required signature fields.');
  }
  const actualSig = (payload.signature_key ?? '').trim().toLowerCase();
  const expectedSig = computeMidtransSignature(
    payload.order_id,
    payload.status_code,
    payload.gross_amount,
    config.serverKey
  ).toLowerCase();

  if (!constantTimeEqual(expectedSig, actualSig)) {
    throw new WebhookVerificationError('midtrans', 'Midtrans signature verification failed.');
  }
}

function buildMidtransMetadata(payload: MidtransWebhookPayload): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(payload.metadata ?? {}),
    statusCode: String(payload.status_code),
    transactionStatus: payload.transaction_status,
  };
  if (payload.fraud_status) {
    metadata.fraudStatus = payload.fraud_status;
  }
  if (payload.payment_type) {
    metadata.paymentType = payload.payment_type;
  }
  return metadata;
}

/**
 * Verifies and normalizes a Midtrans Snap or QRIS webhook payload.
 */
export function verifyMidtransWebhook(
  payload: MidtransWebhookPayload,
  config: MidtransAdapterConfig
): VerifiedWebhookEvent {
  assertMidtransPayloadValid(payload, config);

  const eventType = mapMidtransEventType(payload.transaction_status, payload.fraud_status);
  const transactionId = payload.transaction_id || payload.order_id;
  const fallbackNow = config.now ? config.now() : new Date().toISOString();
  const occurredAt = payload.settlement_time || payload.transaction_time || fallbackNow;

  return {
    provider: 'midtrans',
    channel: resolveMidtransChannel(payload.payment_type),
    eventType,
    eventKey: `midtrans:${payload.order_id}:${eventType}:${transactionId}`,
    transactionId,
    orderId: payload.order_id,
    amount: parsePositiveAmount(payload.gross_amount, 'midtrans'),
    currency: payload.currency ?? 'IDR',
    occurredAt,
    metadata: buildMidtransMetadata(payload),
    raw: payload,
  };
}

/**
 * Computes the hex HMAC-SHA512 signature for a raw Xendit webhook body.
 */
export function computeXenditHmacSignature(rawBody: string, hmacSecret: string): string {
  return createHmac('sha512', hmacSecret).update(rawBody, 'utf8').digest('hex');
}

function evaluateXenditMode(mode: XenditVerificationMode, tokenOk: boolean, hmacOk: boolean): boolean {
  if (mode === 'callback-token') return tokenOk;
  if (mode === 'hmac-sha512') return hmacOk;
  if (mode === 'both') return tokenOk && hmacOk;
  return tokenOk || hmacOk;
}

function readXenditHmacHeader(headers: WebhookHeaders): string {
  const raw = readHeader(headers, 'x-callback-signature') ?? readHeader(headers, 'x-xendit-signature');
  return (raw ?? '').trim().toLowerCase();
}

function verifyXenditCredentials(
  rawBody: string,
  headers: WebhookHeaders,
  config: XenditAdapterConfig
): void {
  const mode: XenditVerificationMode = config.verificationMode ?? resolveDefaultXenditMode(config);
  const actualToken = readHeader(headers, 'x-callback-token') ?? '';
  const actualHmac = readXenditHmacHeader(headers);

  const tokenOk = Boolean(config.callbackToken) && constantTimeEqual(config.callbackToken!, actualToken);
  const hmacOk =
    Boolean(config.hmacSecret) &&
    constantTimeEqual(computeXenditHmacSignature(rawBody, config.hmacSecret!).toLowerCase(), actualHmac);

  if (!evaluateXenditMode(mode, tokenOk, hmacOk)) {
    throw new WebhookVerificationError(
      'xendit',
      `Xendit webhook authentication failed under mode "${mode}".`
    );
  }
}

function resolveDefaultXenditMode(config: XenditAdapterConfig): XenditVerificationMode {
  if (config.callbackToken && config.hmacSecret) {
    return 'both';
  }
  if (config.hmacSecret) {
    return 'hmac-sha512';
  }
  if (config.callbackToken) {
    return 'callback-token';
  }
  throw new WebhookVerificationError(
    'xendit',
    'Xendit adapter requires callbackToken and/or hmacSecret.'
  );
}

const XENDIT_STATUS_MAP: Record<string, PaymentWebhookEventType> = {
  PAID: 'payment.settled',
  SETTLED: 'payment.settled',
  COMPLETED: 'payment.settled',
  FAILED: 'payment.failed',
  EXPIRED: 'payment.expired',
  REFUNDED: 'payment.refunded',
};

function mapXenditEventType(payload: XenditVaWebhookPayload): PaymentWebhookEventType {
  const status = payload.status?.trim().toUpperCase();
  if (status && XENDIT_STATUS_MAP[status]) {
    return XENDIT_STATUS_MAP[status];
  }
  if (!status && payload.payment_id && typeof payload.amount === 'number' && payload.amount > 0) {
    return 'payment.settled';
  }
  return 'payment.pending';
}

function parseXenditPayload(rawBody: string): XenditVaWebhookPayload {
  let payload: XenditVaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as XenditVaWebhookPayload;
  } catch {
    throw new WebhookVerificationError('xendit', 'Invalid JSON body in Xendit webhook.');
  }
  if (!payload || !payload.id || !payload.external_id) {
    throw new WebhookVerificationError('xendit', 'Xendit payload missing id or external_id.');
  }
  return payload;
}

function buildXenditMetadata(payload: XenditVaWebhookPayload): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...(payload.metadata ?? {}) };
  if (payload.bank_code) metadata.bankCode = payload.bank_code;
  if (payload.account_number) metadata.accountNumber = payload.account_number;
  if (payload.callback_virtual_account_id) {
    metadata.virtualAccountId = payload.callback_virtual_account_id;
  }
  if (payload.status) metadata.xenditStatus = payload.status;
  return metadata;
}

/**
 * Verifies and normalizes a Xendit Virtual Account webhook payload using
 * `x-callback-token` and/or `HMAC-SHA512` in constant time.
 */
export function verifyXenditVaWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  config: XenditAdapterConfig
): VerifiedWebhookEvent {
  verifyXenditCredentials(rawBody, headers, config);

  const payload = parseXenditPayload(rawBody);
  const eventType = mapXenditEventType(payload);
  const transactionId = payload.payment_id || payload.id;
  const fallbackNow = config.now ? config.now() : new Date().toISOString();
  const occurredAt = payload.transaction_timestamp || payload.updated || payload.created || fallbackNow;

  return {
    provider: 'xendit',
    channel: 'virtual_account',
    eventType,
    eventKey: `xendit:${payload.id}:${eventType}:${transactionId}`,
    transactionId,
    orderId: payload.external_id,
    amount: parsePositiveAmount(payload.amount ?? 0, 'xendit'),
    currency: payload.currency ?? 'IDR',
    occurredAt,
    metadata: buildXenditMetadata(payload),
    raw: payload,
  };
}
