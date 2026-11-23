import { describe, expect, it } from 'vitest';
import {
  BudgetAllocation,
  Institution,
  Mandate,
  Official,
  Policy,
  PolicyVersion,
  PublicProgram,
  Regulation,
} from '../src/models.js';
import { manifest } from '../src/manifest.js';
import { views } from '../src/views.js';
import { columnName } from '@moonwitness/orm';

const GOVERNANCE_MODELS = [
  Institution,
  Official,
  Mandate,
  Policy,
  PolicyVersion,
  Regulation,
  PublicProgram,
  BudgetAllocation,
];

const OWN_MODEL_NAMES = GOVERNANCE_MODELS.map((model) => model.modelName);

describe('governance models', () => {
  it('binds every model to its governance_ table', () => {
    expect(Institution.tableName).toBe('governance_institutions');
    expect(Official.tableName).toBe('governance_officials');
    expect(Mandate.tableName).toBe('governance_mandates');
    expect(Policy.tableName).toBe('governance_policies');
    expect(PolicyVersion.tableName).toBe('governance_policy_versions');
    expect(Regulation.tableName).toBe('governance_regulations');
    expect(PublicProgram.tableName).toBe('governance_public_programs');
    expect(BudgetAllocation.tableName).toBe('governance_budget_allocations');
  });

  it('carries an external_ref on every model for cross-package links', () => {
    for (const model of GOVERNANCE_MODELS) {
      expect(model.fields['external_ref'], model.modelName).toBeDefined();
      expect(model.fields['is_active'], model.modelName).toBeDefined();
    }
  });

  it('resolves the institutional parent foreign key column', () => {
    expect(columnName('parent', Institution.fields['parent'])).toBe('parent_id');
  });
});

describe('governance manifest', () => {
  it('declares the governance addon', () => {
    expect(manifest.name).toBe('governance');
    expect(manifest.models.map((model) => model.modelName)).toEqual(OWN_MODEL_NAMES);
  });

  it('seeds at least one own model to satisfy the default-data policy', () => {
    const seededModels = manifest.data?.map((entry) => entry.model.modelName) ?? [];
    expect(seededModels.length).toBeGreaterThan(0);
    expect(seededModels.some((model) => OWN_MODEL_NAMES.includes(model))).toBe(true);
  });

  it('depends on the base addon', () => {
    expect(manifest.depends).toContain('base');
  });
});

describe('governance views', () => {
  it('defines one view per own model', () => {
    for (const view of views) {
      expect(OWN_MODEL_NAMES).toContain(view.model);
    }
  });
});
