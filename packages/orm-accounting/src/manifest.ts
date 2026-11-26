import { defineAddon, ref, seed } from '@moonwitness/orm';
import {
  Account,
  JournalEntry,
  JournalLine,
  LedgerPosting,
} from './models/index.js';

export const manifest = defineAddon({
  name: 'accounting',
  version: '1.0.0',
  depends: ['base'],
  models: [Account, JournalEntry, JournalLine, LedgerPosting],
  data: [
    seed(Account, 'accounting.account_cash', {
      code: '1000',
      name: 'Cash and Cash Equivalents',
      type: 'asset',
      company: ref('base.company_default'),
      currency: ref('base.currency_usd'),
      is_active: true,
    }),
    seed(Account, 'accounting.account_ar', {
      code: '1200',
      name: 'Accounts Receivable',
      type: 'asset',
      company: ref('base.company_default'),
      currency: ref('base.currency_usd'),
      is_active: true,
    }),
    seed(Account, 'accounting.account_ap', {
      code: '2000',
      name: 'Accounts Payable',
      type: 'liability',
      company: ref('base.company_default'),
      currency: ref('base.currency_usd'),
      is_active: true,
    }),
    seed(Account, 'accounting.account_equity', {
      code: '3000',
      name: 'Owner Equity',
      type: 'equity',
      company: ref('base.company_default'),
      currency: ref('base.currency_usd'),
      is_active: true,
    }),
    seed(Account, 'accounting.account_revenue', {
      code: '4000',
      name: 'Operating Revenue',
      type: 'revenue',
      company: ref('base.company_default'),
      currency: ref('base.currency_usd'),
      is_active: true,
    }),
    seed(Account, 'accounting.account_expense', {
      code: '5000',
      name: 'Operating Expense',
      type: 'expense',
      company: ref('base.company_default'),
      currency: ref('base.currency_usd'),
      is_active: true,
    }),
  ],
});
