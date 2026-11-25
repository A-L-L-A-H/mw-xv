import knex, { type Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest } from '../src/manifest.js';
import { rndSeedManifest } from '../src/seed-manifest.js';
import {
  ResearchProgram,
  Hypothesis,
  Experiment,
  Protocol,
  ProtocolRun,
  Instrument,
  Reagent,
  Sample,
  Publication,
  Patent,
  IprDisclosure,
  RndHypothesisStatus,
} from '../src/models.js';
import { canTransitionHypothesis, validateTrl } from '../src/domain.js';

describe('orm-rnd addon', () => {
  let db: Knex;
  afterEach(async () => {
    if (db) await db.destroy();
  });

  const database = () =>
    (db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: {
        afterCreate(
          connection: { pragma(sql: string): unknown },
          done: (error: Error | null, connection: unknown) => void
        ) {
          connection.pragma('foreign_keys = ON');
          done(null, connection);
        },
      },
    }));

  it('declares rnd namespace models with rnd_ table prefix and external_ref columns', () => {
    for (const model of manifest.models) {
      expect(model.modelName.startsWith('rnd.')).toBe(true);
      expect(model.tableName.startsWith('rnd_')).toBe(true);
    }
    expect(manifest.models.map((m) => m.modelName)).toEqual([
      'rnd.research_program',
      'rnd.hypothesis',
      'rnd.protocol',
      'rnd.experiment',
      'rnd.protocol_run',
      'rnd.instrument',
      'rnd.reagent',
      'rnd.sample',
      'rnd.publication',
      'rnd.patent',
      'rnd.ipr_disclosure',
    ]);
    expect(manifest.depends).toContain('base');
    expect(manifest.menus.length).toBe(11);
  });

  it('installs idempotently with seed disabled by default and external_ref columns present', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);
    await installAddons(connection, [manifest, baseManifest]);

    for (const table of [
      'rnd_programs',
      'rnd_hypotheses',
      'rnd_protocols',
      'rnd_experiments',
      'rnd_protocol_runs',
      'rnd_instruments',
      'rnd_reagents',
      'rnd_samples',
      'rnd_publications',
      'rnd_patents',
      'rnd_ipr_disclosures',
    ]) {
      expect(await connection.schema.hasColumn(table, 'external_ref')).toBe(true);
    }

    expect(await connection('rnd_programs').count({ count: '*' }).first()).toMatchObject({
      count: 0,
    });
    expect(await connection('rnd_experiments').count({ count: '*' }).first()).toMatchObject({
      count: 0,
    });
  });

  it('persists the full R&D graph with hypotheses, experiments, protocols, runs, instruments, reagents, samples, publications, patents, IPR', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);

    const program = await ResearchProgram.query(connection).insertAndFetch({
      code: 'RND-T-0001',
      name: 'Test Program',
      status: 'active',
      funding_source: 'Test Budget',
    });

    const hypothesis = await Hypothesis.query(connection).insertAndFetch({
      program_id: program.id,
      statement: 'Test hypothesis',
      status: 'proposed',
    });

    const protocol = await Protocol.query(connection).insertAndFetch({
      title: 'Test Protocol',
      version: '1.0.0',
      steps: [{ step: 1, action: 'Initialize' }],
    });

    const experiment = await Experiment.query(connection).insertAndFetch({
      program_id: program.id,
      hypothesis_id: hypothesis.id,
      protocol_id: protocol.id,
      name: 'Test Experiment',
      status: 'draft',
    });

    const run = await ProtocolRun.query(connection).insertAndFetch({
      protocol_id: protocol.id,
      experiment_id: experiment.id,
      started_at: '2026-01-01T08:00:00.000Z',
      status: 'pending',
    });

    const instrument = await Instrument.query(connection).insertAndFetch({
      name: 'Test Instrument',
      kind: 'Spectrometer',
      serial_no: 'SN-001',
    });

    const reagent = await Reagent.query(connection).insertAndFetch({
      name: 'Test Reagent',
      catalog_no: 'CAT-001',
      lot_no: 'LOT-001',
      quantity: 100,
      unit: 'ml',
    });

    const sample = await Sample.query(connection).insertAndFetch({
      code: 'SMP-001',
      kind: 'Blood',
      collected_at: '2026-01-01T08:00:00.000Z',
    });

    const publication = await Publication.query(connection).insertAndFetch({
      title: 'Test Publication',
      doi: '10.1000/test',
      venue: 'Test Journal',
      program_id: program.id,
    });

    const patent = await Patent.query(connection).insertAndFetch({
      title: 'Test Patent',
      jurisdiction: 'US',
      filing_date: '2026-01-01',
      program_id: program.id,
    });

    const disclosure = await IprDisclosure.query(connection).insertAndFetch({
      title: 'Test Disclosure',
      type: 'patent',
      disclosed_at: '2026-01-01T08:00:00.000Z',
      patent_id: patent.id,
    });

    expect(hypothesis.program_id).toBe(program.id);
    expect(experiment.program_id).toBe(program.id);
    expect(experiment.hypothesis_id).toBe(hypothesis.id);
    expect(experiment.protocol_id).toBe(protocol.id);
    expect(run.protocol_id).toBe(protocol.id);
    expect(run.experiment_id).toBe(experiment.id);
    expect(publication.program_id).toBe(program.id);
    expect(patent.program_id).toBe(program.id);
    expect(disclosure.patent_id).toBe(patent.id);
  });

  it('canTransitionHypothesis validates allowed state transitions', () => {
    expect(canTransitionHypothesis({ from: 'proposed', to: 'testable' })).toBe(true);
    expect(canTransitionHypothesis({ from: 'proposed', to: 'refuted' })).toBe(true);
    expect(canTransitionHypothesis({ from: 'testable', to: 'supported' })).toBe(true);
    expect(canTransitionHypothesis({ from: 'testable', to: 'rejected' })).toBe(true);
    expect(canTransitionHypothesis({ from: 'testable', to: 'refuted' })).toBe(true);
    expect(canTransitionHypothesis({ from: 'proposed', to: 'supported' })).toBe(false);
    expect(canTransitionHypothesis({ from: 'supported', to: 'proposed' })).toBe(false);
  });

  it('validateTrl checks TRL bounds', () => {
    expect(validateTrl(1)).toEqual({ valid: true, reason: null });
    expect(validateTrl(9)).toEqual({ valid: true, reason: null });
    expect(validateTrl(5)).toEqual({ valid: true, reason: null });
    expect(validateTrl(0)).toEqual({
      valid: false,
      reason: 'TRL must be an integer between 1 and 9',
    });
    expect(validateTrl(10)).toEqual({
      valid: false,
      reason: 'TRL must be an integer between 1 and 9',
    });
    expect(validateTrl(null)).toEqual({
      valid: false,
      reason: 'TRL must be an integer between 1 and 9',
    });
    expect(validateTrl(1.5)).toEqual({
      valid: false,
      reason: 'TRL must be an integer between 1 and 9',
    });
  });

  it('rnd seed manifest writes nothing unless explicitly enabled', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);

    const disabled = await rndSeedManifest.seed({ db: connection, options: {} });
    expect(disabled).toEqual({ inserted: 0, updated: 0, skipped: 0 });
    expect(await connection('rnd_programs').count({ count: '*' }).first()).toMatchObject({
      count: 0,
    });

    const enabled = await rndSeedManifest.seed({
      db: connection,
      options: { enabled: true, companyId: 1 },
    });
    expect(enabled.inserted).toBeGreaterThan(0);
    expect(await connection('rnd_programs').where({ code: 'RND-CORE-001' })).toHaveLength(1);
    expect(
      await connection('rnd_experiments').where({ name: 'Baseline capability evaluation' })
    ).toHaveLength(1);

    const repeat = await rndSeedManifest.seed({
      db: connection,
      options: { enabled: true, companyId: 1 },
    });
    expect(repeat.inserted).toBe(0);
    expect(repeat.updated).toBeGreaterThan(0);
    expect(repeat.skipped).toBe(0);
  });

  it('exposes a seed manifest compatible with AddonSeedManifest', () => {
    expect(rndSeedManifest.seedVersion).toBe('1.0.0');
    expect(rndSeedManifest.dependencies).toEqual(['orm-base']);
    expect(typeof rndSeedManifest.seed).toBe('function');
  });
});
