import { defineView } from '@moonwitness/orm';
import {
  Patient,
  Encounter,
  Diagnosis,
  Procedure,
  MedicationOrder,
  LabResult,
  VitalObservation,
} from './models.js';

export const views = [
  defineView(Patient, {
    title: 'Patients',
    list: {
      columns: [
        'mrn',
        'given_name',
        'family_name',
        'gender',
        'birth_date',
        'company',
        'active',
        'external_ref',
      ],
      order: 'create_date desc, id desc',
      decorations: [{ color: 'muted', domain: [['active', '=', false]] }],
    },
    form: {
      sections: [
        {
          title: 'Identity',
          columns: 2,
          fields: ['mrn', 'given_name', 'family_name', 'gender', 'birth_date'],
        },
        {
          title: 'Organization',
          columns: 2,
          fields: ['company', 'partner', 'active', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['mrn', 'given_name', 'family_name'],
      filters: [
        { label: 'Active', domain: [['active', '=', true]] },
        { label: 'Inactive', domain: [['active', '=', false]] },
      ],
      groupBy: [{ label: 'Gender', field: 'gender' }],
    },
  }),

  defineView(Encounter, {
    title: 'Encounters',
    list: {
      columns: [
        'encounter_no',
        'patient',
        'status',
        'class',
        'started_at',
        'ended_at',
        'clinician',
      ],
      order: 'started_at desc, id desc',
      decorations: [
        { color: 'info', domain: [['status', '=', 'in_progress']] },
        { color: 'success', domain: [['status', '=', 'completed']] },
        { color: 'muted', domain: [['status', '=', 'cancelled']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Encounter',
          columns: 2,
          fields: ['encounter_no', 'patient', 'status', 'class', 'clinician'],
        },
        {
          title: 'Timing',
          columns: 2,
          fields: ['started_at', 'ended_at', 'reason', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['encounter_no'],
      filters: [
        { label: 'Planned', domain: [['status', '=', 'planned']] },
        { label: 'In Progress', domain: [['status', '=', 'in_progress']] },
        { label: 'Completed', domain: [['status', '=', 'completed']] },
        { label: 'Cancelled', domain: [['status', '=', 'cancelled']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Class', field: 'class' },
      ],
    },
  }),

  defineView(Diagnosis, {
    title: 'Diagnoses',
    list: {
      columns: [
        'encounter',
        'code_system',
        'code',
        'diagnosis_name',
        'status',
        'recorded_at',
        'recorder',
      ],
      order: 'recorded_at desc, id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'confirmed']] },
        { color: 'warning', domain: [['status', '=', 'provisional']] },
        { color: 'muted', domain: [['status', '=', 'refuted']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Diagnosis',
          columns: 2,
          fields: [
            'encounter',
            'code_system',
            'code',
            'diagnosis_name',
            'status',
            'recorder',
            'recorded_at',
            'note',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['code', 'diagnosis_name'],
      filters: [
        { label: 'Provisional', domain: [['status', '=', 'provisional']] },
        { label: 'Differential', domain: [['status', '=', 'differential']] },
        { label: 'Refuted', domain: [['status', '=', 'refuted']] },
      ],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),

  defineView(Procedure, {
    title: 'Procedures',
    list: {
      columns: [
        'encounter',
        'code_system',
        'code',
        'procedure_name',
        'status',
        'performed_at',
        'performer',
      ],
      order: 'performed_at desc, id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'completed']] },
        { color: 'info', domain: [['status', '=', 'in_progress']] },
        { color: 'muted', domain: [['status', '=', 'aborted']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Procedure',
          columns: 2,
          fields: [
            'encounter',
            'code_system',
            'code',
            'procedure_name',
            'status',
            'performer',
            'performed_at',
            'outcome_note',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['code', 'procedure_name'],
      filters: [
        { label: 'Planned', domain: [['status', '=', 'planned']] },
        { label: 'Completed', domain: [['status', '=', 'completed']] },
        { label: 'Aborted', domain: [['status', '=', 'aborted']] },
      ],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),

  defineView(MedicationOrder, {
    title: 'Medication Orders',
    list: {
      columns: [
        'encounter',
        'medication_name',
        'dose_amount',
        'dose_unit',
        'route',
        'frequency',
        'status',
        'ordered_at',
        'prescriber',
      ],
      order: 'ordered_at desc, id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'active']] },
        { color: 'warning', domain: [['status', '=', 'on_hold']] },
        { color: 'muted', domain: [['status', '=', 'cancelled']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Order',
          columns: 2,
          fields: [
            'encounter',
            'medication_name',
            'dose_amount',
            'dose_unit',
            'route',
            'frequency',
            'status',
            'prescriber',
          ],
        },
        {
          title: 'Details',
          columns: 2,
          fields: ['ordered_at', 'indication', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['medication_name'],
      filters: [
        { label: 'Draft', domain: [['status', '=', 'draft']] },
        { label: 'Active', domain: [['status', '=', 'active']] },
        { label: 'On Hold', domain: [['status', '=', 'on_hold']] },
        { label: 'Completed', domain: [['status', '=', 'completed']] },
        { label: 'Cancelled', domain: [['status', '=', 'cancelled']] },
      ],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Route', field: 'route' },
      ],
    },
  }),

  defineView(LabResult, {
    title: 'Lab Results',
    list: {
      columns: [
        'encounter',
        'panel_code',
        'analyte_code',
        'analyte_name',
        'value_numeric',
        'value_unit',
        'reference_low',
        'reference_high',
        'status',
        'collected_at',
      ],
      order: 'collected_at desc, id desc',
      decorations: [
        { color: 'success', domain: [['status', '=', 'final']] },
        { color: 'warning', domain: [['status', '=', 'pending']] },
        { color: 'muted', domain: [['status', '=', 'cancelled']] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Result',
          columns: 2,
          fields: [
            'encounter',
            'panel_code',
            'analyte_code',
            'analyte_name',
            'value_numeric',
            'value_unit',
            'value_text',
            'status',
          ],
        },
        {
          title: 'Reference & Timing',
          columns: 2,
          fields: [
            'reference_low',
            'reference_high',
            'collected_at',
            'resulted_at',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['analyte_name', 'analyte_code'],
      filters: [
        { label: 'Final', domain: [['status', '=', 'final']] },
        { label: 'Pending', domain: [['status', '=', 'pending']] },
        { label: 'Amended', domain: [['status', '=', 'amended']] },
      ],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),

  defineView(VitalObservation, {
    title: 'Vital Observations',
    list: {
      columns: [
        'encounter',
        'vital_type',
        'value',
        'unit',
        'observed_at',
        'observer',
        'device_ref',
      ],
      order: 'observed_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Observation',
          columns: 2,
          fields: [
            'encounter',
            'vital_type',
            'value',
            'unit',
            'observed_at',
            'observer',
            'device_ref',
            'external_ref',
          ],
        },
      ],
    },
    search: {
      fields: ['vital_type'],
      filters: [
        { label: 'Temperature', domain: [['vital_type', '=', 'temperature']] },
        { label: 'Heart Rate', domain: [['vital_type', '=', 'heart_rate']] },
        {
          label: 'Blood Pressure',
          domain: [['vital_type', 'in', ['systolic_bp', 'diastolic_bp']]],
        },
        { label: 'Oxygen Saturation', domain: [['vital_type', '=', 'oxygen_saturation']] },
      ],
      groupBy: [{ label: 'Vital Type', field: 'vital_type' }],
    },
  }),
];
