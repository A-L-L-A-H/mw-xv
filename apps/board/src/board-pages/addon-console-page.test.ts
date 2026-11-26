import { describe, expect, it } from 'vitest';
import { groupModelsByAddon, type AddonModelSummary } from './addon-console-helpers';

const SAMPLE_MODELS: readonly AddonModelSummary[] = [
  {
    model: 'accounting.invoice',
    menu: { label: 'Invoices' },
  },
  {
    model: 'accounting.journal',
    menu: { label: 'Journals' },
  },
  {
    model: 'crm.lead',
    menu: { label: 'Leads' },
  },
];

describe('groupModelsByAddon', () => {
  it('groups and sorts models by addon prefix', () => {
    const grouped = groupModelsByAddon(SAMPLE_MODELS);
    expect(grouped.map((g) => g.addon)).toEqual(['accounting', 'crm']);
    expect(grouped[0]?.models.map((m) => m.model)).toEqual([
      'accounting.invoice',
      'accounting.journal',
    ]);
    expect(grouped[1]?.models.map((m) => m.model)).toEqual(['crm.lead']);
  });

  it('returns empty array for empty input', () => {
    expect(groupModelsByAddon([])).toEqual([]);
  });
});
