import { describe, expect, it } from 'vitest';
import {
  validateJournalEntry,
  postJournalEntry,
  computeTrialBalance,
  accountingSeedManifest,
} from '../src/index.js';

describe('orm-accounting', () => {
  it('validates balanced double-entry journal lines', () => {
    const result = validateJournalEntry([
      { accountCode: '1000', debitMinor: 50000, creditMinor: 0, label: 'Cash receipt' },
      { accountCode: '4000', debitMinor: 0, creditMinor: 50000, label: 'Sales revenue' },
    ]);

    expect(result.valid).toBe(true);
    expect(result.totalDebitMinor).toBe(50000);
    expect(result.totalCreditMinor).toBe(50000);
    expect(result.errors).toEqual([]);
  });

  it('rejects unbalanced or single-line journal entries', () => {
    const unbalanced = validateJournalEntry([
      { accountCode: '1000', debitMinor: 50000, creditMinor: 0 },
      { accountCode: '4000', debitMinor: 0, creditMinor: 40000 },
    ]);
    expect(unbalanced.valid).toBe(false);
    expect(unbalanced.errors.length).toBeGreaterThan(0);

    const singleLine = validateJournalEntry([
      { accountCode: '1000', debitMinor: 1000, creditMinor: 0 },
    ]);
    expect(singleLine.valid).toBe(false);
  });

  it('posts journal entry and computes balanced trial balance', () => {
    const posted = postJournalEntry({
      entryNo: 'JE-2026-0001',
      postingDate: '2026-11-26',
      lines: [
        { accountCode: '1000', debitMinor: 120000, creditMinor: 0 },
        { accountCode: '4000', debitMinor: 0, creditMinor: 120000 },
      ],
    });

    expect(posted.postings).toHaveLength(2);

    const tb = computeTrialBalance([
      { accountCode: '1000', accountName: 'Cash', debitMinor: 120000, creditMinor: 0 },
      { accountCode: '4000', accountName: 'Revenue', debitMinor: 0, creditMinor: 120000 },
    ]);

    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitMinor).toBe(120000);
    expect(tb.totalCreditMinor).toBe(120000);
    expect(tb.rows).toHaveLength(2);
  });

  it('exposes accountingSeedManifest with orm-base dependency', () => {
    expect(accountingSeedManifest.seedVersion).toBe('1.0.0');
    expect(accountingSeedManifest.dependencies).toContain('orm-base');
  });
});
