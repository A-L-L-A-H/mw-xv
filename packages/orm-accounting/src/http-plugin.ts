import {
  requireAddonDb,
  requireAuth,
  type AddonHttpPlugin,
} from '@moonwitness/orm';
import { isRecord } from '@moonwitness/types';
import {
  validateJournalEntry,
  postJournalEntry,
  computeTrialBalance,
  type JournalLineInput,
  type JournalEntryInput,
  type TrialBalancePostingInput,
} from './accounting-engine.js';
import {
  OrderToCashBridge,
  type InvoiceKind,
  type InvoiceLineItem,
  type OrderToCashAccountMap,
  type OrderToCashInvoiceInput,
  type PaymentSettlementInput,
} from './order-to-cash-bridge.js';

export const accountingHttpPlugin: AddonHttpPlugin = async (app) => {
  const o2cBridge = new OrderToCashBridge();

  app.get('/api/accounting/accounts', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    try {
      const db = requireAddonDb(req);
      const accounts = await db('account_accounts')
        .where({ company_id: auth.companyId })
        .orderBy('code', 'asc')
        .select('id', 'code', 'name', 'type', 'company_id', 'currency_id', 'is_active');
      return reply.code(200).send({ success: true, data: accounts });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/accounting/journal/validate', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { lines } = req.body;
    if (!Array.isArray(lines)) {
      return reply.code(400).send({ success: false, error: 'lines array is required' });
    }

    try {
      const result = validateJournalEntry(lines as JournalLineInput[]);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/accounting/journal/post', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { entryNo, postingDate, lines } = req.body;
    if (
      typeof entryNo !== 'string' ||
      !entryNo.trim() ||
      typeof postingDate !== 'string' ||
      !postingDate.trim() ||
      !Array.isArray(lines)
    ) {
      return reply.code(400).send({
        success: false,
        error: 'entryNo, postingDate, and lines array are required',
      });
    }

    try {
      const input: JournalEntryInput = {
        entryNo,
        postingDate,
        lines: lines as JournalLineInput[],
      };
      const result = postJournalEntry(input);
      return reply.code(201).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/accounting/trial-balance', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { postings } = req.body;
    if (!Array.isArray(postings)) {
      return reply.code(400).send({ success: false, error: 'postings array is required' });
    }

    try {
      const result = computeTrialBalance(postings as TrialBalancePostingInput[]);
      return reply.code(200).send({ success: true, data: result });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/accounting/o2c/invoices', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { invoiceId, kind, customerId, currency, issueDate, idempotencyKey, lines, accounts } =
      req.body;

    if (
      typeof invoiceId !== 'string' ||
      typeof kind !== 'string' ||
      typeof customerId !== 'string' ||
      typeof currency !== 'string' ||
      typeof issueDate !== 'string' ||
      typeof idempotencyKey !== 'string' ||
      !Array.isArray(lines)
    ) {
      return reply.code(400).send({
        success: false,
        error:
          'invoiceId, kind, customerId, currency, issueDate, idempotencyKey, and lines array are required',
      });
    }

    const validKinds: readonly InvoiceKind[] = ['sales', 'subscription'];
    if (!validKinds.includes(kind as InvoiceKind)) {
      return reply.code(400).send({
        success: false,
        error: `Invalid kind. Must be one of: ${validKinds.join(', ')}`,
      });
    }

    try {
      const input: OrderToCashInvoiceInput = {
        invoiceId,
        kind: kind as InvoiceKind,
        customerId,
        currency,
        issueDate,
        idempotencyKey,
        lines: lines as InvoiceLineItem[],
        accounts: isRecord(accounts) ? (accounts as Partial<OrderToCashAccountMap>) : undefined,
      };
      const record = o2cBridge.postInvoice(input);
      return reply.code(201).send({ success: true, data: record });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/accounting/o2c/settlements', async (req, reply) => {
    const auth = requireAuth(req, reply);
    if (!auth) return;

    if (!isRecord(req.body)) {
      return reply
        .code(400)
        .send({ success: false, error: 'Invalid payload: body must be an object' });
    }

    const { settlementId, invoiceId, settlementDate, amountMinor, idempotencyKey, accounts } =
      req.body;

    if (
      typeof settlementId !== 'string' ||
      typeof invoiceId !== 'string' ||
      typeof settlementDate !== 'string' ||
      typeof idempotencyKey !== 'string' ||
      amountMinor === undefined
    ) {
      return reply.code(400).send({
        success: false,
        error: 'settlementId, invoiceId, settlementDate, amountMinor, and idempotencyKey are required',
      });
    }

    try {
      const input: PaymentSettlementInput = {
        settlementId,
        invoiceId,
        settlementDate,
        amountMinor: Number(amountMinor),
        idempotencyKey,
        accounts: isRecord(accounts) ? (accounts as Partial<OrderToCashAccountMap>) : undefined,
      };
      const record = o2cBridge.postPaymentSettlement(input);
      return reply.code(201).send({ success: true, data: record });
    } catch (err: unknown) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });
};

export const httpPlugin = accountingHttpPlugin;
