import { defineModel, fields } from '@moonwitness/orm';
import { Company, Currency, Partner, User } from '@moonwitness/orm-base';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type JournalEntryStatus = 'draft' | 'posted' | 'reversed';

export const Account = defineModel('account.account', {
  table: 'account_accounts',
  order: 'code asc',
  fields: {
    code: fields.string({ required: true, unique: true, label: 'Account Code' }),
    name: fields.string({ required: true, label: 'Account Name' }),
    type: fields.string({
      required: true,
      values: ['asset', 'liability', 'equity', 'revenue', 'expense'],
      label: 'Account Type',
    }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    currency: fields.belongsTo(Currency, { required: true, label: 'Currency' }),
    is_active: fields.boolean({ required: true, default: true, label: 'Active' }),
  },
});

export const JournalEntry = defineModel('account.journal_entry', {
  table: 'account_journal_entries',
  order: 'entry_date desc',
  fields: {
    entry_no: fields.string({ required: true, unique: true, label: 'Entry No' }),
    entry_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Entry Date',
    }),
    description: fields.text({ required: true, label: 'Description' }),
    status: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'posted', 'reversed'],
      label: 'Status',
    }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    currency: fields.belongsTo(Currency, { required: true, label: 'Currency' }),
    posted_by: fields.belongsTo(User, { label: 'Posted By' }),
  },
});

export const JournalLine = defineModel('account.journal_line', {
  table: 'account_journal_lines',
  order: 'id asc',
  fields: {
    entry: fields.belongsTo(JournalEntry, { required: true, label: 'Journal Entry' }),
    account: fields.belongsTo(Account, { required: true, label: 'Account' }),
    partner: fields.belongsTo(Partner, { label: 'Partner' }),
    debit_minor: fields.integer({ required: true, default: 0, label: 'Debit (minor units)' }),
    credit_minor: fields.integer({ required: true, default: 0, label: 'Credit (minor units)' }),
    label: fields.string({ label: 'Line Label' }),
  },
});

export const LedgerPosting = defineModel('account.ledger_posting', {
  table: 'account_ledger_postings',
  order: 'posting_date desc',
  fields: {
    entry: fields.belongsTo(JournalEntry, { required: true, label: 'Journal Entry' }),
    account: fields.belongsTo(Account, { required: true, label: 'Account' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    posting_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Posting Date',
    }),
    debit_minor: fields.integer({ required: true, default: 0, label: 'Debit (minor units)' }),
    credit_minor: fields.integer({ required: true, default: 0, label: 'Credit (minor units)' }),
    balance_minor: fields.integer({ required: true, default: 0, label: 'Net Balance (minor units)' }),
  },
});
