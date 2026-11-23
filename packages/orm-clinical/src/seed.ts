import type { Knex } from 'knex';
import type { AddonSeedManifest, SeedResult } from '@moonwitness/orm-base';
import {
  Patient,
  Encounter,
  Diagnosis,
  Procedure,
  MedicationOrder,
  LabResult,
  VitalObservation,
} from './models.js';

export const CLINICAL_SEED_VERSION = '1.0.0';
export const dependencies = ['orm-base'];

export interface ClinicalSeedOptions {
  /** Seed data is DISABLED by default; pass enabled: true explicitly. */
  readonly enabled?: boolean;
  readonly companyId?: number;
  readonly clinicianId?: number;
}

export async function seed(_ctx: { db: Knex; options?: ClinicalSeedOptions }): Promise<SeedResult> {
  return { inserted: 0, updated: 0, skipped: 0 };
}

export const clinicalSeedManifest: AddonSeedManifest & { options?: ClinicalSeedOptions } = {
  seedVersion: CLINICAL_SEED_VERSION,
  dependencies,
  seed: async (ctx: { db: Knex; options?: ClinicalSeedOptions }): Promise<SeedResult> => {
    const options = ctx.options ?? {};
    if (options.enabled !== true) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }

    const companyId = options.companyId ?? 1;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const existingPatient = await Patient.query(ctx.db).findOne({ mrn: 'MRN-SEED-0001' });
    const patient =
      existingPatient ??
      (await Patient.query(ctx.db).insertAndFetch({
        mrn: 'MRN-SEED-0001',
        given_name: 'Seed',
        family_name: 'Patient',
        gender: 'unknown',
        company_id: companyId,
        active: true,
      }));
    if (existingPatient) updated += 1;
    else inserted += 1;

    const existingEncounter = await Encounter.query(ctx.db).findOne({ encounter_no: 'ENC-SEED-0001' });
    const encounter =
      existingEncounter ??
      (await Encounter.query(ctx.db).insertAndFetch({
        encounter_no: 'ENC-SEED-0001',
        patient_id: patient.id,
        status: 'completed',
        class: 'ambulatory',
        started_at: '2026-01-01T08:00:00.000Z',
        ended_at: '2026-01-01T09:00:00.000Z',
        clinician_id: options.clinicianId,
      }));
    if (existingEncounter) updated += 1;
    else inserted += 1;

    if (!existingPatient && !existingEncounter) {
      await Diagnosis.query(ctx.db).insert({
        encounter_id: encounter.id,
        code_system: 'ICD-10',
        code: 'E11.9',
        diagnosis_name: 'Type 2 diabetes mellitus without complications',
        status: 'confirmed',        recorded_at: '2026-01-01T08:30:00.000Z',
      });
      await MedicationOrder.query(ctx.db).insert({
        encounter_id: encounter.id,
        medication_name: 'Metformin',
        dose_amount: 500,
        dose_unit: 'mg',
        route: 'oral',
        frequency: 'BID',
        status: 'active',
        ordered_at: '2026-01-01T08:45:00.000Z',
        prescriber_id: options.clinicianId ?? encounter.clinician_id ?? 1,
      });
      await LabResult.query(ctx.db).insert({
        encounter_id: encounter.id,
        panel_code: 'LP12345-6',
        analyte_code: 'LP17857-9',
        analyte_name: 'Glucose [Mass/volume] in Serum or Plasma',
        value_numeric: 5.4,
        value_unit: 'mmol_L',
        reference_low: 3.9,
        reference_high: 5.5,
        status: 'final',
        collected_at: '2026-01-01T07:30:00.000Z',
        resulted_at: '2026-01-01T10:00:00.000Z',
      });
      await VitalObservation.query(ctx.db).insert({
        encounter_id: encounter.id,
        vital_type: 'temperature',
        value: 36.8,
        unit: 'celsius',
        observed_at: '2026-01-01T08:00:00.000Z',
      });
      inserted += 4;
    } else {
      skipped += 4;
    }

    return { inserted, updated, skipped };
  },
};
