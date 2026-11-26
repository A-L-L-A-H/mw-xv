export interface JournalLineInput {
  readonly accountCode: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
  readonly label?: string;
}

export interface JournalValidationResult {
  readonly valid: boolean;
  readonly totalDebitMinor: number;
  readonly totalCreditMinor: number;
  readonly errors: readonly string[];
}

export interface JournalEntryInput {
  readonly entryNo: string;
  readonly postingDate: string;
  readonly lines: readonly JournalLineInput[];
}

export interface LedgerPostingLine {
  readonly entryNo: string;
  readonly postingDate: string;
  readonly accountCode: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
  readonly netMinor: number;
}

export interface LedgerPostingResult {
  readonly entryNo: string;
  readonly postingDate: string;
  readonly totalDebitMinor: number;
  readonly totalCreditMinor: number;
  readonly postings: readonly LedgerPostingLine[];
}

export interface TrialBalancePostingInput {
  readonly accountCode: string;
  readonly accountName?: string;
  readonly debitMinor: number;
  readonly creditMinor: number;
}

export interface TrialBalanceRow {
  readonly accountCode: string;
  readonly accountName: string;
  readonly totalDebitMinor: number;
  readonly totalCreditMinor: number;
  readonly netBalanceMinor: number;
}

export interface TrialBalanceResult {
  readonly rows: readonly TrialBalanceRow[];
  readonly totalDebitMinor: number;
  readonly totalCreditMinor: number;
  readonly balanced: boolean;
}

export function validateJournalEntry(lines: readonly JournalLineInput[]): JournalValidationResult {
  const errors: string[] = [];
  if (lines.length < 2) {
    errors.push('Journal entry must contain at least two lines');
  }

  let totalDebitMinor = 0;
  let totalCreditMinor = 0;

  for (const [index, line] of lines.entries()) {
    if (!line.accountCode.trim()) {
      errors.push(`Line ${index + 1}: accountCode is required`);
    }
    if (!Number.isInteger(line.debitMinor) || line.debitMinor < 0) {
      errors.push(`Line ${index + 1}: debitMinor must be a non-negative integer`);
    }
    if (!Number.isInteger(line.creditMinor) || line.creditMinor < 0) {
      errors.push(`Line ${index + 1}: creditMinor must be a non-negative integer`);
    }
    if (line.debitMinor > 0 && line.creditMinor > 0) {
      errors.push(`Line ${index + 1}: cannot have both debitMinor and creditMinor > 0`);
    }
    if (line.debitMinor === 0 && line.creditMinor === 0) {
      errors.push(`Line ${index + 1}: must have either debitMinor > 0 or creditMinor > 0`);
    }
    totalDebitMinor += line.debitMinor;
    totalCreditMinor += line.creditMinor;
  }

  if (totalDebitMinor !== totalCreditMinor) {
    errors.push(
      `Journal entry is unbalanced: debit=${totalDebitMinor} credit=${totalCreditMinor}`
    );
  }
  if (totalDebitMinor <= 0) {
    errors.push('Journal entry total must be greater than zero');
  }

  return {
    valid: errors.length === 0,
    totalDebitMinor,
    totalCreditMinor,
    errors,
  };
}

export function postJournalEntry(input: JournalEntryInput): LedgerPostingResult {
  const validation = validateJournalEntry(input.lines);
  if (!validation.valid) {
    throw new Error(`Cannot post journal entry '${input.entryNo}': ${validation.errors.join('; ')}`);
  }

  const postings: LedgerPostingLine[] = input.lines.map((line) => ({
    entryNo: input.entryNo,
    postingDate: input.postingDate,
    accountCode: line.accountCode,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    netMinor: line.debitMinor - line.creditMinor,
  }));

  return {
    entryNo: input.entryNo,
    postingDate: input.postingDate,
    totalDebitMinor: validation.totalDebitMinor,
    totalCreditMinor: validation.totalCreditMinor,
    postings,
  };
}

export function computeTrialBalance(
  postings: readonly TrialBalancePostingInput[]
): TrialBalanceResult {
  const byAccount = new Map<
    string,
    { accountName: string; totalDebitMinor: number; totalCreditMinor: number }
  >();

  for (const posting of postings) {
    const existing = byAccount.get(posting.accountCode);
    if (existing) {
      existing.totalDebitMinor += posting.debitMinor;
      existing.totalCreditMinor += posting.creditMinor;
    } else {
      byAccount.set(posting.accountCode, {
        accountName: posting.accountName ?? posting.accountCode,
        totalDebitMinor: posting.debitMinor,
        totalCreditMinor: posting.creditMinor,
      });
    }
  }

  const rows: TrialBalanceRow[] = Array.from(byAccount.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([accountCode, agg]) => ({
      accountCode,
      accountName: agg.accountName,
      totalDebitMinor: agg.totalDebitMinor,
      totalCreditMinor: agg.totalCreditMinor,
      netBalanceMinor: agg.totalDebitMinor - agg.totalCreditMinor,
    }));

  const totalDebitMinor = rows.reduce((sum, row) => sum + row.totalDebitMinor, 0);
  const totalCreditMinor = rows.reduce((sum, row) => sum + row.totalCreditMinor, 0);

  return {
    rows,
    totalDebitMinor,
    totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor,
  };
}
