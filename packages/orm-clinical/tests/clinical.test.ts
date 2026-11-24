import knex, { type Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { manifest } from '../src/manifest.js';
import { clinicalSeedManifest } from '../src/seed.js';
import {
  Patient,
  Encounter,
  Diagnosis,
  Procedure,
  MedicationOrder,
  LabResult,
  VitalObservation,
  convertUnit,
  MASS_UNIT_CONVERSIONS,
  TEMPERATURE_UNIT_CONVERSIONS,
} from '../src/models.js';

describe('orm-clinical addon', () => {
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

  it('declares clinical namespace models with clinical_ table prefix and external_ref columns', () => {
    for (const model of manifest.models) {
      expect(model.modelName.startsWith('clinical.')).toBe(true);
      expect(model.tableName.startsWith('clinical_')).toBe(true);
    }
    expect(manifest.models.map((m) => m.modelName)).toEqual([
      'clinical.patient',
      'clinical.encounter',
      'clinical.diagnosis',
      'clinical.procedure',
      'clinical.medication_order',
      'clinical.lab_result',
      'clinical.vital_observation',
    ]);
    expect(manifest.depends).toContain('base');
    expect(manifest.data.length).toBeGreaterThan(0);
  });

  it('installs idempotently with seed disabled by default and cross-link columns present', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);
    await installAddons(connection, [manifest, baseManifest]);

    for (const table of [
      'clinical_patients',
      'clinical_encounters',
      'clinical_diagnoses',
      'clinical_procedures',
      'clinical_medication_orders',
      'clinical_lab_results',
      'clinical_vital_observations',
    ]) {
      expect(await connection.schema.hasColumn(table, 'external_ref')).toBe(true);
    }

    expect(await connection('clinical_patients').count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await connection('clinical_encounters').count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await connection('clinical_diagnoses').count({ count: '*' }).first()).toMatchObject({ count: 0 });
    expect(await connection('clinical_medication_orders').count({ count: '*' }).first()).toMatchObject({ count: 0 });
  });

  it('persists the full clinical graph with unit conversion helpers', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);

    expect(convertUnit(MASS_UNIT_CONVERSIONS, 'lb', 150)).toBeCloseTo(68.0389, 3);
    expect(convertUnit(MASS_UNIT_CONVERSIONS, 'kg', 80)).toBeCloseTo(80, 6);
    expect(convertUnit(TEMPERATURE_UNIT_CONVERSIONS, 'fahrenheit', 98.6)).toBeCloseTo(37, 5);

    const patient = await Patient.query(connection).insertAndFetch({
      mrn: 'MRN-T-0001',
      given_name: 'Test',
      family_name: 'Subject',
      gender: 'female',
      company_id: 1,
    });
    const encounter = await Encounter.query(connection).insertAndFetch({
      encounter_no: 'ENC-T-0001',
      patient_id: patient.id,
      status: 'in_progress',
      class: 'emergency',
      started_at: '2026-03-01T10:00:00.000Z',
    });
    const diagnosis = await Diagnosis.query(connection).insertAndFetch({
      encounter_id: encounter.id,
      code_system: 'ICD-10',
      code: 'J18.9',
      diagnosis_name: 'Pneumonia, unspecified organism',
      status: 'confirmed',
      recorded_at: '2026-03-01T10:30:00.000Z',
    });
    const procedure = await Procedure.query(connection).insertAndFetch({
      encounter_id: encounter.id,
      code_system: 'SNOMED CT',
      code: '52765003',
      procedure_name: 'Chest X-ray',
      status: 'completed',
      performed_at: '2026-03-01T11:00:00.000Z',
    });
    const order = await MedicationOrder.query(connection).insertAndFetch({
      encounter_id: encounter.id,
      medication_name: 'Amoxicillin',
      dose_amount: 500,
      dose_unit: 'mg',
      route: 'oral',
      frequency: 'TID',
      status: 'active',
      ordered_at: '2026-03-01T11:15:00.000Z',
      prescriber_id: 1,
    });
    const lab = await LabResult.query(connection).insertAndFetch({
      encounter_id: encounter.id,
      panel_code: 'LP12345-6',
      analyte_code: 'LP17857-9',
      analyte_name: 'Glucose',
      value_numeric: 6.1,
      value_unit: 'mmol_L',
      status: 'final',
      collected_at: '2026-03-01T09:45:00.000Z',
    });
    const vital = await VitalObservation.query(connection).insertAndFetch({
      encounter_id: encounter.id,
      vital_type: 'temperature',
      value: 38.4,
      unit: 'celsius',
      observed_at: '2026-03-01T10:05:00.000Z',
    });

    expect(diagnosis.encounter_id).toBe(encounter.id);
    expect(procedure.encounter_id).toBe(encounter.id);
    expect(order.encounter_id).toBe(encounter.id);
    expect(lab.encounter_id).toBe(encounter.id);
    expect(vital.encounter_id).toBe(encounter.id);

    const fetchedPatient = await Patient.query(connection).findById(patient.id).withGraphFetched('encounters');
    expect(fetchedPatient).not.toBeNull();
  });

  it('clinical seed manifest writes nothing unless explicitly enabled', async () => {
    const connection = database();
    await installAddons(connection, [manifest, baseManifest]);

    const disabled = await clinicalSeedManifest.seed({ db: connection, options: {} });
    expect(disabled).toEqual({ inserted: 0, updated: 0, skipped: 0 });
    expect(await connection('clinical_patients').count({ count: '*' }).first()).toMatchObject({ count: 1 });

    const enabled = await clinicalSeedManifest.seed({ db: connection, options: { enabled: true, companyId: 1 } });
    expect(enabled.inserted).toBeGreaterThan(0);
    expect(await connection('clinical_patients').where({ mrn: 'MRN-SEED-0001' })).toHaveLength(1);

    const repeat = await clinicalSeedManifest.seed({ db: connection, options: { enabled: true, companyId: 1 } });
    expect(repeat.inserted).toBe(0);
    expect(repeat.updated).toBeGreaterThan(0);
    expect(await connection('clinical_patients').count({ count: '*' }).first()).toMatchObject({ count: 2 });
    expect(await connection('clinical_diagnoses').count({ count: '*' }).first()).toMatchObject({ count: 1 });
    expect(await connection('clinical_medication_orders').count({ count: '*' }).first()).toMatchObject({ count: 1 });
  });

  it('exposes a seed manifest compatible with AddonSeedManifest', () => {
    expect(clinicalSeedManifest.seedVersion).toBe('1.0.0');
    expect(clinicalSeedManifest.dependencies).toEqual(['orm-base']);
    expect(typeof clinicalSeedManifest.seed).toBe('function');
  });
});
