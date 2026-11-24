import { defineView } from '@moonwitness/orm';
import {
  Experiment,
  Hypothesis,
  Instrument,
  IprDisclosure,
  Patent,
  Protocol,
  ProtocolRun,
  Publication,
  Reagent,
  ResearchProgram,
  Sample,
} from './models.js';

export const views = [
  defineView(ResearchProgram, {
    title: 'Research Programs',
    list: {
      columns: ['code', 'name', 'status', 'funding_source', 'budget_minor', 'start_date', 'end_date'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Program',
          columns: 2,
          fields: ['code', 'name', 'status', 'funding_source', 'budget_minor', 'external_ref'],
        },
        {
          title: 'Timeline',
          columns: 2,
          fields: ['start_date', 'end_date'],
        },
        {
          title: 'Objective',
          fields: ['objective'],
        },
      ],
    },
    search: {
      fields: ['code', 'name', 'objective'],
      filters: [{ label: 'Active', domain: [['status', '=', 'active']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(Hypothesis, {
    title: 'Hypotheses',
    list: {
      columns: ['program', 'statement', 'status'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Hypothesis',
          columns: 2,
          fields: ['program', 'status', 'external_ref'],
        },
        {
          title: 'Statement',
          fields: ['statement'],
        },
        {
          title: 'Success Criteria',
          fields: ['success_criteria'],
        },
      ],
    },
    search: {
      fields: ['statement'],
      filters: [{ label: 'Supported', domain: [['status', '=', 'supported']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(Protocol, {
    title: 'Protocols',
    list: {
      columns: ['title', 'version', 'external_ref'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Protocol',
          columns: 2,
          fields: ['title', 'version', 'external_ref'],
        },
        {
          title: 'Steps',
          fields: ['steps'],
        },
        {
          title: 'Safety',
          fields: ['safety_notes'],
        },
      ],
    },
    search: { fields: ['title'] },
  }),
  defineView(Experiment, {
    title: 'Experiments',
    list: {
      columns: ['name', 'program', 'hypothesis', 'protocol', 'status', 'pre_registration_hash'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Experiment',
          columns: 2,
          fields: ['name', 'program', 'hypothesis', 'protocol', 'status', 'external_ref'],
        },
        {
          title: 'Pre-registration',
          fields: ['pre_registration_hash'],
        },
        {
          title: 'Results',
          fields: ['result_summary'],
        },
      ],
    },
    search: {
      fields: ['name'],
      filters: [{ label: 'Running', domain: [['status', '=', 'running']] }],
      groupBy: [
        { label: 'Status', field: 'status' },
        { label: 'Program', field: 'program_id' },
      ],
    },
    kanban: {
      groupBy: 'status',
      cardTitle: 'name',
      cardFields: ['program_id', 'hypothesis_id', 'protocol_id'],
    },
  }),
  defineView(ProtocolRun, {
    title: 'Protocol Runs',
    list: {
      columns: ['protocol', 'experiment', 'started_at', 'finished_at', 'status'],
      order: 'started_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Run',
          columns: 2,
          fields: ['protocol', 'experiment', 'started_at', 'finished_at', 'status', 'external_ref'],
        },
        {
          title: 'Measurements',
          fields: ['measurements'],
        },
        {
          title: 'Notes',
          fields: ['notes'],
        },
      ],
    },
    search: {
      fields: ['notes'],
      filters: [{ label: 'Failed', domain: [['status', '=', 'failed']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(Instrument, {
    title: 'Instruments',
    list: {
      columns: ['name', 'kind', 'serial_no', 'calibration_due', 'external_ref'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Instrument',
          columns: 2,
          fields: ['name', 'kind', 'serial_no', 'calibration_due', 'external_ref'],
        },
      ],
    },
    search: { fields: ['name', 'kind', 'serial_no'] },
  }),
  defineView(Reagent, {
    title: 'Reagents',
    list: {
      columns: ['name', 'catalog_no', 'lot_no', 'quantity', 'unit', 'expiry_date'],
      order: 'name asc, id asc',
    },
    form: {
      sections: [
        {
          title: 'Reagent',
          columns: 2,
          fields: ['name', 'catalog_no', 'lot_no', 'quantity', 'unit', 'expiry_date', 'external_ref'],
        },
      ],
    },
    search: { fields: ['name', 'catalog_no', 'lot_no'] },
  }),
  defineView(Sample, {
    title: 'Samples',
    list: {
      columns: ['code', 'kind', 'collected_at', 'external_ref'],
      order: 'collected_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Sample',
          columns: 2,
          fields: ['code', 'kind', 'collected_at', 'external_ref'],
        },
        {
          title: 'Metadata',
          fields: ['metadata'],
        },
      ],
    },
    search: { fields: ['code', 'kind'] },
  }),
  defineView(Publication, {
    title: 'Publications',
    list: {
      columns: ['title', 'doi', 'venue', 'published_at', 'program', 'external_ref'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Publication',
          columns: 2,
          fields: ['title', 'doi', 'venue', 'published_at', 'program', 'external_ref'],
        },
      ],
    },
    search: { fields: ['title', 'doi', 'venue'] },
  }),
  defineView(Patent, {
    title: 'Patents',
    list: {
      columns: ['title', 'jurisdiction', 'filing_date', 'status', 'program', 'external_ref'],
      order: 'create_date desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Patent',
          columns: 2,
          fields: ['title', 'jurisdiction', 'filing_date', 'status', 'program', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['title', 'jurisdiction'],
      filters: [{ label: 'Granted', domain: [['status', '=', 'granted']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
  }),
  defineView(IprDisclosure, {
    title: 'IPR Disclosures',
    list: {
      columns: ['title', 'type', 'disclosed_at', 'status', 'patent'],
      order: 'disclosed_at desc, id desc',
    },
    form: {
      sections: [
        {
          title: 'Disclosure',
          columns: 2,
          fields: ['title', 'type', 'disclosed_at', 'status', 'patent', 'external_ref'],
        },
      ],
    },
    search: {
      fields: ['title'],
      filters: [{ label: 'Accepted', domain: [['status', '=', 'accepted']] }],
      groupBy: [{ label: 'Type', field: 'type' }],
    },
  }),
];