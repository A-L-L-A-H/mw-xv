import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Partner, User, Company } from '@moonwitness/orm-base';

export type PatientGender = 'male' | 'female' | 'other' | 'unknown';
export type EncounterStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type EncounterClass = 'ambulatory' | 'emergency' | 'inpatient' | 'virtual' | 'home_health';
export type DiagnosisStatus = 'provisional' | 'confirmed' | 'differential' | 'refuted';
export type ProcedureStatus = 'planned' | 'in_progress' | 'completed' | 'aborted';
export type MedicationOrderStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type LabResultStatus = 'registered' | 'pending' | 'final' | 'amended' | 'cancelled';
export type VitalStatusCode = 'final' | 'preliminary' | 'amended' | 'entered_in_error';
export type TemperatureUnit = 'celsius' | 'fahrenheit';
export type LengthUnit = 'cm' | 'in' | 'm';
export type MassUnit = 'kg' | 'lb' | 'g';
export type ConcentrationUnit = 'mmol_L' | 'mg_dL' | 'mEq_L' | 'u_mol_L';

export const TEMPERATURE_UNIT_CONVERSIONS: Readonly<
  Record<TemperatureUnit, { readonly base: 'celsius'; readonly factor: number; readonly offset: number }>
> = {
  celsius: { base: 'celsius', factor: 1, offset: 0 },
  fahrenheit: { base: 'celsius', factor: 5 / 9, offset: -32 * (5 / 9) },
};

export const LENGTH_UNIT_CONVERSIONS: Readonly<
  Record<LengthUnit, { readonly base: 'm'; readonly factor: number }>
> = {
  cm: { base: 'm', factor: 0.01 },
  in: { base: 'm', factor: 0.0254 },
  m: { base: 'm', factor: 1 },
};

export const MASS_UNIT_CONVERSIONS: Readonly<
  Record<MassUnit, { readonly base: 'kg'; readonly factor: number }>
> = {
  g: { base: 'kg', factor: 0.001 },
  kg: { base: 'kg', factor: 1 },
  lb: { base: 'kg', factor: 0.45359237 },
};

export const CONCENTRATION_UNIT_CONVERSIONS: Readonly<
  Record<ConcentrationUnit, { readonly base: 'mmol_L'; readonly factor: number }>
> = {
  mmol_L: { base: 'mmol_L', factor: 1 },
  mg_dL: { base: 'mmol_L', factor: 1 / 18.01559 },
  mEq_L: { base: 'mmol_L', factor: 1 },
  u_mol_L: { base: 'mmol_L', factor: 0.001 },
};

export function convertUnit<M extends string>(
  conversions: Readonly<Record<M, { readonly base: string; readonly factor: number; readonly offset?: number }>>,
  from: M,
  value: number,
): number {
  const conversion = conversions[from];
  if (!conversion) throw new Error(`Unknown unit '${from}'`);
  return value * conversion.factor + (conversion.offset ?? 0);
}

export const Patient = defineModel('clinical.patient', {
  table: 'clinical_patients',
  order: 'create_date desc',
  fields: {
    mrn: fields.string({ required: true, unique: true, label: 'Medical Record Number' }),
    given_name: fields.string({ required: true, label: 'Given Name' }),
    family_name: fields.string({ required: true, label: 'Family Name' }),
    gender: fields.enum(['male', 'female', 'other', 'unknown'] as const, {
      required: true,
      default: 'unknown',
      label: 'Gender',
    }),
    birth_date: fields.date({ label: 'Birth Date' }),
    partner: fields.belongsTo(Partner, { label: 'Partner' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    external_ref: fields.string({ label: 'External Reference (sensor/science cross-link)' }),
    encounters: fields.hasMany(encounterModel, { foreignKey: 'patient_id', label: 'Encounters' }),
  },
});

function encounterModel(): typeof BaseModel {
  return Encounter;
}

export const Encounter = defineModel('clinical.encounter', {
  table: 'clinical_encounters',
  order: 'started_at desc',
  fields: {
    encounter_no: fields.string({ required: true, unique: true, label: 'Encounter No' }),
    patient: fields.belongsTo(Patient, { required: true, label: 'Patient' }),
    status: fields.enum(['planned', 'in_progress', 'completed', 'cancelled'] as const, {
      required: true,
      default: 'planned',
      label: 'Status',
    }),
    class: fields.enum(['ambulatory', 'emergency', 'inpatient', 'virtual', 'home_health'] as const, {
      required: true,
      default: 'ambulatory',
      label: 'Class',
    }),
    started_at: fields.datetime({ required: true, label: 'Started At' }),
    ended_at: fields.datetime({ label: 'Ended At' }),
    clinician: fields.belongsTo(User, { label: 'Attending Clinician' }),
    reason: fields.text({ label: 'Reason for Visit' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const Diagnosis = defineModel('clinical.diagnosis', {
  table: 'clinical_diagnoses',
  order: 'recorded_at desc',
  fields: {
    encounter: fields.belongsTo(Encounter, { required: true, label: 'Encounter' }),
    code_system: fields.string({ required: true, default: 'ICD-10', label: 'Code System' }),
    code: fields.string({ required: true, label: 'Diagnosis Code' }),
    diagnosis_name: fields.string({ required: true, label: 'Diagnosis Name' }),
    status: fields.enum(['provisional', 'confirmed', 'differential', 'refuted'] as const, {
      required: true,
      default: 'provisional',
      label: 'Status',
    }),
    recorded_at: fields.datetime({ required: true, label: 'Recorded At' }),
    recorder: fields.belongsTo(User, { label: 'Recorder' }),
    note: fields.text({ label: 'Note' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const Procedure = defineModel('clinical.procedure', {
  table: 'clinical_procedures',
  order: 'performed_at desc',
  fields: {
    encounter: fields.belongsTo(Encounter, { required: true, label: 'Encounter' }),
    code_system: fields.string({ required: true, default: 'SNOMED CT', label: 'Code System' }),
    code: fields.string({ required: true, label: 'Procedure Code' }),
    procedure_name: fields.string({ required: true, label: 'Procedure Name' }),
    status: fields.enum(['planned', 'in_progress', 'completed', 'aborted'] as const, {
      required: true,
      default: 'planned',
      label: 'Status',
    }),
    performed_at: fields.datetime({ required: true, label: 'Performed At' }),
    performer: fields.belongsTo(User, { label: 'Performer' }),
    outcome_note: fields.text({ label: 'Outcome Note' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const MedicationOrder = defineModel('clinical.medication_order', {
  table: 'clinical_medication_orders',
  order: 'ordered_at desc',
  fields: {
    encounter: fields.belongsTo(Encounter, { required: true, label: 'Encounter' }),
    medication_name: fields.string({ required: true, label: 'Medication' }),
    dose_amount: fields.float({ required: true, label: 'Dose Amount' }),
    dose_unit: fields.enum(['mg', 'mcg', 'g', 'mL', 'IU'] as const, {
      required: true,
      label: 'Dose Unit',
    }),
    route: fields.enum(['oral', 'iv', 'im', 'sc', 'topical', 'inhalation'] as const, {
      required: true,
      default: 'oral',
      label: 'Route',
    }),
    frequency: fields.string({ required: true, label: 'Frequency (e.g. BID, q8h)' }),
    status: fields.enum(['draft', 'active', 'on_hold', 'completed', 'cancelled'] as const, {
      required: true,
      default: 'draft',
      label: 'Status',
    }),
    ordered_at: fields.datetime({ required: true, label: 'Ordered At' }),
    prescriber: fields.belongsTo(User, { required: true, label: 'Prescriber' }),
    indication: fields.text({ label: 'Indication' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const LabResult = defineModel('clinical.lab_result', {
  table: 'clinical_lab_results',
  order: 'collected_at desc',
  fields: {
    encounter: fields.belongsTo(Encounter, { required: true, label: 'Encounter' }),
    panel_code: fields.string({ required: true, label: 'Panel Code (LOINC)' }),
    analyte_code: fields.string({ required: true, label: 'Analyte Code (LOINC)' }),
    analyte_name: fields.string({ required: true, label: 'Analyte Name' }),
    value_numeric: fields.float({ label: 'Numeric Value' }),
    value_unit: fields.enum(['mmol_L', 'mg_dL', 'mEq_L', 'u_mol_L', 'g_dL', 'U_L'] as const, {
      label: 'Value Unit',
    }),
    value_text: fields.string({ label: 'Textual Value' }),
    reference_low: fields.float({ label: 'Reference Low' }),
    reference_high: fields.float({ label: 'Reference High' }),
    status: fields.enum(['registered', 'pending', 'final', 'amended', 'cancelled'] as const, {
      required: true,
      default: 'registered',
      label: 'Status',
    }),
    collected_at: fields.datetime({ required: true, label: 'Collected At' }),
    resulted_at: fields.datetime({ label: 'Resulted At' }),
    external_ref: fields.string({ label: 'External Reference (science bench link)' }),
  },
});

export const VitalObservation = defineModel('clinical.vital_observation', {
  table: 'clinical_vital_observations',
  order: 'observed_at desc',
  fields: {
    encounter: fields.belongsTo(Encounter, { required: true, label: 'Encounter' }),
    vital_type: fields.string({
      required: true,
      values: ['temperature', 'heart_rate', 'systolic_bp', 'diastolic_bp', 'respiratory_rate', 'oxygen_saturation', 'height', 'weight', 'bmi'],
      label: 'Vital Type',
    }),
    value: fields.float({ required: true, label: 'Value' }),
    unit: fields.string({
      required: true,
      values: ['celsius', 'fahrenheit', 'bpm', 'mmHg', 'breaths_per_min', 'percent', 'cm', 'in', 'm', 'kg', 'lb', 'g', 'kg_m2'],
      label: 'Unit',
    }),
    observed_at: fields.datetime({ required: true, label: 'Observed At' }),
    observer: fields.belongsTo(User, { label: 'Observer' }),
    device_ref: fields.string({ label: 'Device Reference (sensor stream link)' }),
    external_ref: fields.string({ label: 'External Reference (sensor cross-link)' }),
  },
});
