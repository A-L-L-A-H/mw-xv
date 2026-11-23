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
  name_id: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode?: string;
  isActive: boolean;
}

export const PSAK_CHART_OF_ACCOUNTS = new Map<string, PSAKAccount>([
  ['1101', { code: '1101', name: 'Kas', name_id: 'Kas', type: 'asset', isActive: true }],
  ['1102', { code: '1102', name: 'Bank', name_id: 'Bank', type: 'asset', isActive: true }],
  [
    '1200',
    {
      code: '1200',
      name: 'Piutang Usaha',
      name_id: 'Piutang Usaha',
      type: 'asset',
      isActive: true,
    },
  ],
  [
    '1300',
    { code: '1300', name: 'Persediaan', name_id: 'Persediaan', type: 'asset', isActive: true },
  ],
  [
    '1400',
    { code: '1400', name: 'Aset Tetap', name_id: 'Aset Tetap', type: 'asset', isActive: true },
  ],
  [
    '1500',
    {
      code: '1500',
      name: 'Aset Tidak Berwujud',
      name_id: 'Aset Tidak Berwujud',
      type: 'asset',
      isActive: true,
    },
  ],
  [
    '2000',
    {
      code: '2000',
      name: 'Hutang Usaha',
      name_id: 'Hutang Usaha',
      type: 'liability',
      isActive: true,
    },
  ],
  [
    '2100',
    {
      code: '2100',
      name: 'Hutang Pajak',
      name_id: 'Hutang Pajak',
      type: 'liability',
      isActive: true,
    },
  ],
  [
    '2200',
    {
      code: '2200',
      name: 'Biaya Yang Masih Harus Dibayar',
      name_id: 'Biaya Yang Masih Harus Dibayar',
      type: 'liability',
      isActive: true,
    },
  ],
  [
    '2300',
    {
      code: '2300',
      name: 'Hutang Jangka Panjang',
      name_id: 'Hutang Jangka Panjang',
      type: 'liability',
      isActive: true,
    },
  ],
  [
    '3000',
    {
      code: '3000',
      name: 'Modal Disetor',
      name_id: 'Modal Disetor',
      type: 'equity',
      isActive: true,
    },
  ],
  [
    '3100',
    { code: '3100', name: 'Laba Ditahan', name_id: 'Laba Ditahan', type: 'equity', isActive: true },
  ],
  [
    '4101',
    { code: '4101', name: 'Penjualan', name_id: 'Penjualan', type: 'revenue', isActive: true },
  ],
  [
    '4102',
    {
      code: '4102',
      name: 'Pendapatan Jasa',
      name_id: 'Pendapatan Jasa',
      type: 'revenue',
      isActive: true,
    },
  ],
  [
    '4200',
    {
      code: '4200',
      name: 'Pendapatan Lain-lain',
      name_id: 'Pendapatan Lain-lain',
      type: 'revenue',
      isActive: true,
    },
  ],
  [
    '5101',
    {
      code: '5101',
      name: 'Harga Pokok Penjualan',
      name_id: 'Harga Pokok Penjualan',
      type: 'expense',
      isActive: true,
    },
  ],
  [
    '5102',
    { code: '5102', name: 'Biaya Gaji', name_id: 'Biaya Gaji', type: 'expense', isActive: true },
  ],
  [
    '5200',
    { code: '5200', name: 'Biaya Sewa', name_id: 'Biaya Sewa', type: 'expense', isActive: true },
  ],
  [
    '5300',
    {
      code: '5300',
      name: 'Biaya Utilitas',
      name_id: 'Biaya Utilitas',
      type: 'expense',
      isActive: true,
    },
  ],
  [
    '5400',
    {
      code: '5400',
      name: 'Biaya Penyusutan',
      name_id: 'Biaya Penyusutan',
      type: 'expense',
      isActive: true,
    },
  ],
  [
    '6101',
    {
      code: '6101',
      name: 'Biaya Administrasi',
      name_id: 'Biaya Administrasi',
      type: 'expense',
      isActive: true,
    },
  ],
]);

export function validateJournalEntry(entry: JournalEntry): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!entry.id) errors.push('Journal entry missing id');
  if (!entry.date) errors.push('Journal entry missing date');
  if (!entry.lines || entry.lines.length === 0)
    errors.push('Journal entry must have at least one line');
  if (entry.lines.length < 2)
    errors.push('Journal entry must have at least two lines for double-entry');

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of entry.lines) {
    if (!line.accountCode) errors.push('Line missing accountCode');
    if (line.debit < 0) errors.push(`Negative debit on account ${line.accountCode}`);
    if (line.credit < 0) errors.push(`Negative credit on account ${line.accountCode}`);
    if (line.debit > 0 && line.credit > 0)
      errors.push(`Line ${line.accountCode} has both debit and credit`);
    if (line.debit === 0 && line.credit === 0)
      errors.push(`Line ${line.accountCode} has zero amount`);

    totalDebit += line.debit;
    totalCredit += line.credit;

    const account = PSAK_CHART_OF_ACCOUNTS.get(line.accountCode);
    if (!account) errors.push(`Unknown account code: ${line.accountCode}`);
    else if (!account.isActive) errors.push(`Inactive account: ${line.accountCode}`);
  }

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    errors.push(
      `Debit/Credit imbalance: debit=${totalDebit}, credit=${totalCredit}, diff=${Math.abs(totalDebit - totalCredit)}`
    );
  }

  return { valid: errors.length === 0, errors };
}

export function mapToPSAKAccount(internalCode: string): PSAKAccount | undefined {
  return PSAK_CHART_OF_ACCOUNTS.get(internalCode);
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

  const header = [
    'Journal Entry,JournalNo,AccountCode,AccountName,Debit,Credit,Description,CostCenter,Project',
  ];
  return [...header, ...lines].join('\n');
}

export function exportToOdooFormat(entry: JournalEntry): string {
  const line_ids = entry.lines.map((line, index) => ({
    account_id: { code: line.accountCode },
    name: line.description ?? entry.description,
    debit: line.debit,
    credit: line.credit,
  }));

  return JSON.stringify({
    name: entry.id,
    date: entry.date,
    ref: entry.reference ?? entry.description,
    line_ids,
  });
}

export function exportToSAPFormat(entry: JournalEntry): string {
  const lines = entry.lines.map((line, index) => {
    return [
      'BSEG',
      entry.id,
      line.accountCode.padEnd(10),
      (line.debit > 0 ? 'S' : 'H').padEnd(1),
      (line.debit > 0 ? line.debit : line.credit).toFixed(2).padStart(15, '0'),
      'IDR'.padEnd(5),
      (index + 1).toString().padStart(3, '0'),
      (line.costCenter ?? '').padEnd(10),
      (line.project ?? '').padEnd(12),
      line.description?.substring(0, 50).padEnd(50) ?? ' '.repeat(50),
    ].join(',');
  });

  const header = 'BKPF,' + entry.id + ',' + entry.date + ',SA';
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
  const journalId = header[1]?.trim() ?? `JE-${Date.now()}`;
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
    id: journalId,
    date: new Date().toISOString().split('T')[0],
    description: 'Imported from Accurate',
    lines: entryLines,
  };
}

export function importFromOdooFormat(json: string): JournalEntry {
  const data = JSON.parse(json);
  const entryLines: JournalLine[] = [];

  for (const line of data.line_ids ?? []) {
    entryLines.push({
      accountCode: line.account_id?.code ?? '',
      accountName: '',
      debit: line.debit ?? 0,
      credit: line.credit ?? 0,
      description: line.name ?? '',
    });
  }

  return {
    id: data.name ?? `ODOO-${Date.now()}`,
    date: data.date ?? new Date().toISOString().split('T')[0],
    description: data.ref ?? 'Imported from Odoo',
    lines: entryLines,
    reference: data.ref,
  };
}

export function importFromSAPFormat(text: string): JournalEntry {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('Invalid SAP format: no data lines');

  const entryLines: JournalLine[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('BSEG,')) continue;

    const cols = line.split(',');
    if (cols.length < 10) continue;

    const accountCode = cols[2].trim();
    const debitCredit = cols[3].trim();
    const amount = parseFloat(cols[4]) / 100;
    const costCenter = cols[6].trim();
    const project = cols[7].trim();
    const description = cols[8].trim();

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

  const bkpfLine = lines[0].split(',');
  const journalId = bkpfLine[1] ?? `SAP-${Date.now()}`;
  const journalDate = bkpfLine[2] ?? new Date().toISOString().split('T')[0];

  return {
    id: journalId,
    date: journalDate,
    description: 'Imported from SAP',
    lines: entryLines,
  };
}

export function importJournalEntry(
  text: string,
  format: 'accurate' | 'odoo' | 'sap'
): JournalEntry {
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
    erp_type: fields.enum(['accurate', 'odoo', 'sap', 'custom'], { required: true }),
    config: fields.text({ required: true, default: '{}' }),
    chart_of_accounts: fields.text({ required: true, default: '[]' }),
    enabled: fields.boolean({ required: true, default: false }),
    last_sync_at: fields.string(),
    sync_status: fields.enum(['idle', 'syncing', 'success', 'error'], {
      required: true,
      default: 'idle',
    }),
    last_error: fields.text(),
  },
});

export function buildJournalEntryFromTransaction(transaction: {
  id: string;
  date: string;
  description: string;
  amount: number;
  debitAccount: string;
  creditAccount: string;
  costCenter?: string;
  project?: string;
  reference?: string;
}): JournalEntry {
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
