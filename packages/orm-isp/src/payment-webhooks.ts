import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type PaymentGatewayProvider = 'midtrans' | 'xendit' | 'tripay' | 'duitku';

export interface PaymentWebhookVerificationInput {
  readonly provider: PaymentGatewayProvider;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawBody: string;
  readonly parsedBody: Record<string, unknown>;
  readonly secretKey: string;
}

export interface PaymentWebhookEvent {
  readonly provider: PaymentGatewayProvider;
  readonly eventId: string;
  readonly invoiceId: string;
  readonly subscriberUsername: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: 'settled' | 'pending' | 'failed' | 'expired';
  readonly settledAt?: string;
  readonly rawPayload: Record<string, unknown>;
}

export interface PaymentWebhookProcessResult {
  readonly success: boolean;
  readonly isAuthentic: boolean;
  readonly event?: PaymentWebhookEvent;
  readonly shouldUnsuspend: boolean;
  readonly reason: string;
}

function safeString(val: unknown): string {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  return '';
}

function safeNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function verifyPaymentWebhook(
  input: PaymentWebhookVerificationInput
): { isValid: boolean; reason?: string } {
  const { provider, headers, rawBody, parsedBody, secretKey } = input;

  if (provider === 'midtrans') {
    // Midtrans SHA-512: signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)
    const orderId = safeString(parsedBody.order_id);
    const statusCode = safeString(parsedBody.status_code);
    const grossAmount = safeString(parsedBody.gross_amount);
    const signatureKey = safeString(parsedBody.signature_key);

    if (!orderId || !statusCode || !grossAmount || !signatureKey) {
      return { isValid: false, reason: 'Midtrans payload missing signature fields' };
    }

    const payload = `${orderId}${statusCode}${grossAmount}${secretKey}`;
    const expected = createHash('sha512').update(payload).digest('hex').toLowerCase();
    const isValid = signatureKey.toLowerCase() === expected;
    return { isValid, reason: isValid ? undefined : 'Midtrans signature mismatch' };
  }

  if (provider === 'xendit') {
    // Xendit callback token: x-callback-token header matching configured token
    const tokenHeader = headers['x-callback-token'];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    if (!token) {
      return { isValid: false, reason: 'Missing x-callback-token header' };
    }
    const isValid = token === secretKey;
    return { isValid, reason: isValid ? undefined : 'Xendit callback token mismatch' };
  }

  if (provider === 'tripay') {
    // Tripay HMAC-SHA256 of rawBody using private key, sent in x-callback-signature
    const sigHeader = headers['x-callback-signature'];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!signature) {
      return { isValid: false, reason: 'Missing x-callback-signature header' };
    }
    const expected = createHmac('sha256', secretKey).update(rawBody).digest('hex');
    const isValid = signature.toLowerCase() === expected.toLowerCase();
    return { isValid, reason: isValid ? undefined : 'Tripay HMAC signature mismatch' };
  }

  if (provider === 'duitku') {
    // Duitku MD5: MD5(merchantCode + amount + merchantOrderId + apiKey)
    const merchantCode = safeString(parsedBody.merchantCode);
    const amount = safeString(parsedBody.amount);
    const merchantOrderId = safeString(parsedBody.merchantOrderId);
    const signature = safeString(parsedBody.signature);

    if (!merchantCode || !amount || !merchantOrderId || !signature) {
      return { isValid: false, reason: 'Duitku payload missing signature fields' };
    }

    const payload = `${merchantCode}${amount}${merchantOrderId}${secretKey}`;
    const expected = createHash('md5').update(payload).digest('hex').toLowerCase();
    const isValid = signature.toLowerCase() === expected;
    return { isValid, reason: isValid ? undefined : 'Duitku MD5 signature mismatch' };
  }

  return { isValid: false, reason: `Unsupported gateway provider: ${provider}` };
}

export function parsePaymentWebhookEvent(
  provider: PaymentGatewayProvider,
  parsedBody: Record<string, unknown>
): PaymentWebhookEvent {
  if (provider === 'midtrans') {
    const status = safeString(parsedBody.transaction_status);
    const fraudStatus = safeString(parsedBody.fraud_status);
    const isSettled =
      status === 'settlement' ||
      (status === 'capture' && (fraudStatus === 'accept' || !fraudStatus));

    const invoiceId = safeString(parsedBody.order_id);
    const customField = safeString(parsedBody.custom_field1);
    const subscriberUsername = customField || invoiceId.split(':')[0] || 'unknown';

    return {
      provider,
      eventId: safeString(parsedBody.transaction_id) || `mid-${Date.now()}`,
      invoiceId,
      subscriberUsername,
      amountMinor: Math.round(safeNumber(parsedBody.gross_amount)),
      currency: safeString(parsedBody.currency) || 'IDR',
      status: isSettled
        ? 'settled'
        : status === 'pending'
          ? 'pending'
          : status === 'expire'
            ? 'expired'
            : 'failed',
      settledAt: isSettled ? safeString(parsedBody.settlement_time) || new Date().toISOString() : undefined,
      rawPayload: parsedBody,
    };
  }

  if (provider === 'xendit') {
    const status = safeString(parsedBody.status).toUpperCase();
    const isSettled = status === 'PAID' || status === 'SETTLED' || status === 'COMPLETED';
    const invoiceId = safeString(parsedBody.external_id);
    const subscriberUsername = safeString(parsedBody.payer_email) || invoiceId.split(':')[0] || 'unknown';

    return {
      provider,
      eventId: safeString(parsedBody.id) || `xen-${Date.now()}`,
      invoiceId,
      subscriberUsername,
      amountMinor: Math.round(safeNumber(parsedBody.amount)),
      currency: safeString(parsedBody.currency) || 'IDR',
      status: isSettled ? 'settled' : status === 'PENDING' ? 'pending' : 'failed',
      settledAt: isSettled ? safeString(parsedBody.paid_at) || new Date().toISOString() : undefined,
      rawPayload: parsedBody,
    };
  }

  if (provider === 'tripay') {
    const status = safeString(parsedBody.status).toUpperCase();
    const isSettled = status === 'PAID';
    const invoiceId = safeString(parsedBody.merchant_ref);
    const subscriberUsername = safeString(parsedBody.customer_email) || invoiceId.split(':')[0] || 'unknown';

    return {
      provider,
      eventId: safeString(parsedBody.reference) || `tri-${Date.now()}`,
      invoiceId,
      subscriberUsername,
      amountMinor: Math.round(safeNumber(parsedBody.total_amount)),
      currency: 'IDR',
      status: isSettled ? 'settled' : status === 'UNPAID' ? 'pending' : status === 'EXPIRED' ? 'expired' : 'failed',
      settledAt: isSettled ? safeString(parsedBody.paid_at) || new Date().toISOString() : undefined,
      rawPayload: parsedBody,
    };
  }

  if (provider === 'duitku') {
    const resultCode = safeString(parsedBody.resultCode);
    const isSettled = resultCode === '00';
    const invoiceId = safeString(parsedBody.merchantOrderId);
    const subscriberUsername = safeString(parsedBody.customerEmail) || invoiceId.split(':')[0] || 'unknown';

    return {
      provider,
      eventId: safeString(parsedBody.reference) || `dui-${Date.now()}`,
      invoiceId,
      subscriberUsername,
      amountMinor: Math.round(safeNumber(parsedBody.amount)),
      currency: 'IDR',
      status: isSettled ? 'settled' : 'failed',
      settledAt: isSettled ? new Date().toISOString() : undefined,
      rawPayload: parsedBody,
    };
  }

  throw new Error(`Unsupported gateway provider: ${provider}`);
}

export function processPaymentWebhook(
  input: PaymentWebhookVerificationInput
): PaymentWebhookProcessResult {
  const verification = verifyPaymentWebhook(input);
  if (!verification.isValid) {
    return {
      success: false,
      isAuthentic: false,
      shouldUnsuspend: false,
      reason: verification.reason ?? 'Webhook verification failed',
    };
  }

  const event = parsePaymentWebhookEvent(input.provider, input.parsedBody);
  const shouldUnsuspend = event.status === 'settled';

  return {
    success: true,
    isAuthentic: true,
    event,
    shouldUnsuspend,
    reason: shouldUnsuspend
      ? `Payment settled via ${input.provider}; auto-unsuspend subscriber ${event.subscriberUsername}`
      : `Payment status ${event.status} from ${input.provider}; no unsuspend action`,
  };
}
