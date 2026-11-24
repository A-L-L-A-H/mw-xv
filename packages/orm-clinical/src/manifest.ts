import { defineAddon, seed, ref } from '@moonwitness/orm';
import { ModelAccess } from '@moonwitness/orm-base';
import {
  Patient,
  Encounter,
  Diagnosis,
  Procedure,
  MedicationOrder,
  LabResult,
  VitalObservation,
} from './models.js';
import { views } from './views.js';
import { clinicalSeedManifest } from './seed.js';

export const manifest = defineAddon({
  name: 'clinical',
  version: '1.0.0',
  displayName: 'Clinical / Medicine / Health',
  category: 'health',
  summary:
    'Patients, encounters, diagnoses, procedures, medication orders, lab results and vital observations.',
  depends: ['base'],
  models: [Patient, Encounter, Diagnosis, Procedure, MedicationOrder, LabResult, VitalObservation],
  data: [
    seed(Patient, 'clinical.patient_demo', {
      mrn: 'MRN-000001',
      given_name: 'Demo',
      family_name: 'Patient',
      gender: 'unknown',
      company: ref('base.company_default'),
    }),
    seed(Encounter, 'clinical.encounter_demo', {
      encounter_no: 'ENC-000001',
      patient: ref('clinical.patient_demo'),
      status: 'planned',
      class: 'ambulatory',
      started_at: '2026-01-01T08:00:00.000Z',
    }),
    seed(ModelAccess, 'clinical.access_user_patient_read', {
      group: ref('base.group_user'),
      model_name: Patient.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    }),
    seed(ModelAccess, 'clinical.access_user_encounter_read', {
      group: ref('base.group_user'),
      model_name: Encounter.modelName,
      read: true,
      create: false,
      write: false,
      unlink: false,
    }),
  ],
  views,
  menus: [
    { model: Patient.modelName, label: 'Patients', group: 'Clinical', sequence: 10 },
    { model: Encounter.modelName, label: 'Encounters', group: 'Clinical', sequence: 20 },
    { model: Diagnosis.modelName, label: 'Diagnoses', group: 'Clinical', sequence: 30 },
    { model: Procedure.modelName, label: 'Procedures', group: 'Clinical', sequence: 40 },
    {
      model: MedicationOrder.modelName,
      label: 'Medication Orders',
      group: 'Clinical',
      sequence: 50,
    },
    { model: LabResult.modelName, label: 'Lab Results', group: 'Clinical', sequence: 60 },
    {
      model: VitalObservation.modelName,
      label: 'Vital Observations',
      group: 'Clinical',
      sequence: 70,
    },
  ],
});

export { clinicalSeedManifest };
