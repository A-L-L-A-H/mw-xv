import { Company } from '@moonwitness/orm-base';
import { defineModel, fields } from '@moonwitness/orm';

export interface JournalEntry {
  id: string;
  date: string;
  description: string;
  lines: JournalLine[];
  reference?: string;
  source?: string;
}

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description?: string;
  costCenter?: string;
  project?: string;
}

export interface PSAKAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode?: string;
  isActive: boolean;
}

export const PSAK_CHART_OF_ACCOUNTS: PSAKAccount[] = [
  { code: '1000', name: 'Kas', type: 'asset', isActive: true },
  { code: '1100', name: 'Bank', type: 'asset', isActive: true },
  { code: '1200', name: 'Piutang Usaha', type: 'asset', isActive: true },
  { code: '1300', name: 'Persediaan', type: 'asset', isActive: true },
  { code: '1400', name: 'Aset Tetap', type: 'asset', isActive: true },
  { code: '1500', name: 'Aset Tidak Berwujud', type: 'asset', isActive: true },
  { code: '2000', name: 'Hutang Usaha', type: 'liability', isActive: true },
  { code: '2100', name: 'Hutang Pajak', type: 'liability', isActive: true },
  { code: '2200', name: 'Biaya Yang Masih Harus Dibayar', type: 'liability', isActive: true },
  { code: '2300', name: 'Hutang Jangka Panjang', type: 'liability', isActive: true },
  { code: '3000', name: 'Modal Disetor', type: 'equity', isActive: true },
  { code: '3100', name: 'Laba Ditahan', type: 'equity', isActive: true },
  { code: '4000', name: 'Penjualan', type: 'revenue', isActive: true },
  { code: '4100', name: 'Pendapatan Jasa', type: 'revenue', isActive: true },
  { code: '4200', name: 'Pendapatan Lain-lain', type: 'revenue', isActive: true },
  { code: '5000', name: 'Harga Pokok Penjualan', type: 'expense', isActive: true },
  { code: '5100', name: 'Biaya Gaji', type: 'expense', isActive: true },
  { code: '5200', name: 'Biaya Sewa', type: 'expense', isActive: true },
  { code: '5300', name: 'Biaya Utilitas', type: 'expense', isActive: true },
  { code: '5400', name: 'Biaya Penyusutan', type: 'expense', isActive: true },
  { code: '5500', name: 'Biaya Lain-lain', type: 'expense', isActive: true },
];

export function validateJournalEntry(entry: JournalEntry): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!entry.id) errors.push('Journal entry missing id');
  if (!entry.date) errors.push('Journal entry missing date');
  if (!entry.lines || entry.lines.length === 0) errors.push('Journal entry must have at least one line');
  if (entry.lines.length < 2) errors.push('Journal entry must have at least two lines for double-entry');

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of entry.lines) {
    if (!line.accountCode) errors.push('Line missing accountCode');
    if (line.debit < 0) errors.push(`Negative debit on account ${line.accountCode}`);
    if (line.credit < 0) errors.push(`Negative credit on account ${line.accountCode}`);
    if (line.debit > 0 && line.credit > 0) errors.push(`Line ${line.accountCode} has both debit and credit`);
    if (line.debit === 0 && line.credit === 0) errors.push(`Line ${line.accountCode} has zero amount`);

    totalDebit += line.debit;
    totalCredit += line.credit;

    const account = PSAK_CHART_OF_ACCOUNTS.find((a) => a.code === line.accountCode);
    if (!account) errors.push(`Unknown account code: ${line.accountCode}`);
    else if (!account.isActive) errors.push(`Inactive account: ${line.accountCode}`);
  }

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    errors.push(`Debit/Credit imbalance: debit=${totalDebit}, credit=${totalCredit}, diff=${Math.abs(totalDebit - totalCredit)}`);
  }

  return { valid: errors.length === 0, errors };
}

export function mapToPSAKAccount(internalCode: string): PSAKAccount | undefined {
  return PSAK_CHART_OF_ACCOUNTS.find((a) => a.code === internalCode);
}

export function exportToAccurateFormat(entry: JournalEntry): string {
  const lines = entry.lines.map((line) => {
    return [
      entry.date,
      entry.id,
      line.accountCode,
      line.accountName,
      line.debit.toFixed(2),
      line.credit.toFixed(2),
      line.description ?? entry.description,
      line.costCenter ?? '',
      line.project ?? '',
    ].join(',');
  });

  const header = ['Date,JournalNo,AccountCode,AccountName,Debit,Credit,Description,CostCenter,Project'];
  return [...header, ...lines].join('\n');
}

export function exportToOdooFormat(entry: JournalEntry): string {
  const lines = entry.lines.map((line, index) => {
    return [
      entry.id,
      entry.date,
      entry.reference ?? entry.description,
      line.accountCode,
      line.accountName,
      line.debit.toFixed(2),
      line.credit.toFixed(2),
      line.description ?? entry.description,
      index + 1,
    ].join(',');
  });

  const header = ['JournalEntry,Date,Reference,AccountCode,AccountName,Debit,Credit,Description,Sequence'];
  return [...header, ...lines].join('\n');
}

export function exportToSAPFormat(entry: JournalEntry): string {
  const lines = entry.lines.map((line, index) => {
    return [
      entry.id.padEnd(10),
      entry.date,
      line.accountCode.padEnd(10),
      (line.debit > 0 ? 'S' : 'H').padEnd(1),
      (line.debit > 0 ? line.debit : line.credit).toFixed(2).padStart(15, '0'),
      'IDR'.padEnd(5),
      (index + 1).toString().padStart(3, '0'),
      (line.costCenter ?? '').padEnd(10),
      (line.project ?? '').padEnd(12),
      line.description?.substring(0, 50).padEnd(50) ?? ' '.repeat(50),
    ].join('');
  });

  const header = 'BKPF' + ' '.repeat(150);
  return [header, ...lines].join('\n');
}

export function exportJournalEntry(
  entry: JournalEntry,
  format: 'accurate' | 'odoo' | 'sap' | 'json'
): string {
  switch (format) {
    case 'accurate':
      return exportToAccurateFormat(entry);
    case 'odoo':
      return exportToOdooFormat(entry);
    case 'sap':
      return exportToSAPFormat(entry);
    case 'json':
    default:
      return JSON.stringify(entry, null, 2);
  }
}

export function importFromAccurateFormat(csv: string): JournalEntry {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) throw new Error('Invalid Accurate CSV: no data lines');

  const header = lines[0].split(',');
  const entryLines: JournalLine[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 7) continue;

    entryLines.push({
      accountCode: cols[2],
      accountName: cols[3],
      debit: parseFloat(cols[4]) || 0,
      credit: parseFloat(cols[5]) || 0,
      description: cols[6],
      costCenter: cols[7] || undefined,
      project: cols[8] || undefined,
    });
  }

  return {
    id: entryLines[0] ? `ACC-${Date.now()}` : `ACC-${Date.now()}`,
    date: new Date().toISOString().split('T')[0],
    description: 'Imported from Accurate',
    lines: entryLines,
  };
}

export function importFromOdooFormat(csv: string): JournalEntry {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) throw new Error('Invalid Odoo CSV: no data lines');

  const entryLines: JournalLine[] = [];
  let journalEntryId = `ODOO-${Date.now()}`;
  let journalDate = new Date().toISOString().split('T')[0];
  let reference = '';

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 8) continue;

    if (i === 1) {
      journalEntryId = cols[0];
      journalDate = cols[1];
      reference = cols[2];
    }

    entryLines.push({
      accountCode: cols[3],
      accountName: cols[4],
      debit: parseFloat(cols[5]) || 0,
      credit: parseFloat(cols[6]) || 0,
      description: cols[7],
    });
  }

  return {
    id: journalEntryId,
    date: journalDate,
    description: reference || 'Imported from Odoo',
    lines: entryLines,
    reference,
  };
}

export function importFromSAPFormat(text: string): JournalEntry {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('Invalid SAP format: no data lines');

  const entryLines: JournalLine[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 100) continue;

    const accountCode = line.substring(10, 20).trim();
    const debitCredit = line.substring(20, 21);
    const amount = parseFloat(line.substring(21, 36)) / 100;
    const costCenter = line.substring(41, 51).trim();
    const project = line.substring(51, 63).trim();
    const description = line.substring(63, 113).trim();

    entryLines.push({
      accountCode,
      accountName: '',
      debit: debitCredit === 'S' ? amount : 0,
      credit: debitCredit === 'H' ? amount : 0,
      description,
      costCenter: costCenter || undefined,
      project: project || undefined,
    });
  }

  return {
    id: `SAP-${Date.now()}`,
    date: new Date().toISOString().split('T')[0],
    description: 'Imported from SAP',
    lines: entryLines,
  };
}

export function importJournalEntry(text: string, format: 'accurate' | 'odoo' | 'sap'): JournalEntry {
  switch (format) {
    case 'accurate':
      return importFromAccurateFormat(text);
    case 'odoo':
      return importFromOdooFormat(text);
    case 'sap':
      return importFromSAPFormat(text);
    default:
      throw new Error(`Unsupported import format: ${format}`);
  }
}

export const ErpLedgerConnector = defineModel('integration.erp_ledger_connector', {
  table: 'integration_erp_ledger_connectors',
  order: 'name asc',
  fields: {
    company: fields.belongsTo(Company, { required: true }),
    name: fields.string({ required: true }),
    erpType: fields.enum(['accurate', 'odoo', 'sap', 'custom'], { required: true }),
    config: fields.text({ required: true, default: '{}' }),
    chartOfAccounts: fields.text({ required: true, default: '[]' }),
    enabled: fields.boolean({ required: true, default: false }),
    lastSyncAt: fields.string(),
    syncStatus: fields.enum(['idle', 'syncing', 'success', 'error'], { required: true, default: 'idle' }),
    lastError: fields.text(),
  },
});

export function buildJournalEntryFromTransaction(
  transaction: {
    id: string;
    date: string;
    description: string;
    amount: number;
    debitAccount: string;
    creditAccount: string;
    costCenter?: string;
    project?: string;
    reference?: string;
  }
): JournalEntry {
  return {
    id: transaction.id,
    date: transaction.date,
    description: transaction.description,
    reference: transaction.reference,
    lines: [
      {
        accountCode: transaction.debitAccount,
        accountName: mapToPSAKAccount(transaction.debitAccount)?.name ?? '',
        debit: transaction.amount,
        credit: 0,
        costCenter: transaction.costCenter,
        project: transaction.project,
      },
      {
        accountCode: transaction.creditAccount,
        accountName: mapToPSAKAccount(transaction.creditAccount)?.name ?? '',
        debit: 0,
        credit: transaction.amount,
        costCenter: transaction.costCenter,
        project: transaction.project,
      },
    ],
  };
}