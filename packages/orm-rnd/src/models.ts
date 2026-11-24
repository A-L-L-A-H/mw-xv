import { defineModel, fields } from '@moonwitness/orm';

export const RndProgramStatus = {
  PLANNED: 'planned',
  ACTIVE: 'active',
  PAUSED: 'paused',
  CLOSED: 'closed',
} as const;

export const RndHypothesisStatus = {
  PROPOSED: 'proposed',
  TESTABLE: 'testable',
  SUPPORTED: 'supported',
  REJECTED: 'rejected',
  REFUTED: 'refuted',
} as const;

export const RndExperimentStatus = {
  DRAFT: 'draft',
  REGISTERED: 'registered',
  RUNNING: 'running',
  COMPLETED: 'completed',
  ABORTED: 'aborted',
} as const;

export const RndRunStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const RndPatentStatus = {
  DRAFTED: 'drafted',
  FILED: 'filed',
  PUBLISHED: 'published',
  GRANTED: 'granted',
  WITHDRAWN: 'withdrawn',
} as const;

export const RndIprType = {
  PATENT: 'patent',
  TRADEMARK: 'trademark',
  COPYRIGHT: 'copyright',
  TRADE_SECRET: 'trade_secret',
} as const;

export const RndDisclosureStatus = {
  INTERNAL_REVIEW: 'internal_review',
  COMMITTEE_PENDING: 'committee_pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
} as const;

export const ResearchProgram = defineModel('rnd.research_program', {
  table: 'rnd_programs',
  order: 'created_at desc',
  fields: {
    code: fields.string({ required: true, unique: true, label: 'Program Code' }),
    name: fields.string({ required: true }),
    objective: fields.text({ label: 'Objective' }),
    status: fields.enum(['planned', 'active', 'paused', 'closed'], {
      required: true,
      default: RndProgramStatus.PLANNED,
    }),
    funding_source: fields.string({ label: 'Funding Source' }),
    budget_minor: fields.integer({ label: 'Budget (minor units)' }),
    start_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    end_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-science/orm-clinical records',
    }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const Hypothesis = defineModel('rnd.hypothesis', {
  table: 'rnd_hypotheses',
  order: 'created_at desc',
  fields: {
    program: fields.belongsTo(ResearchProgram, { required: true }),
    statement: fields.text({ required: true }),
    status: fields.enum(['proposed', 'testable', 'supported', 'rejected', 'refuted'], {
      required: true,
      default: RndHypothesisStatus.PROPOSED,
    }),
    success_criteria: fields.json({ label: 'Success Criteria' }),
    external_ref: fields.string({ label: 'External Reference' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const Protocol = defineModel('rnd.protocol', {
  table: 'rnd_protocols',
  order: 'name asc',
  fields: {
    title: fields.string({ required: true }),
    version: fields.string({ required: true, default: '1.0.0' }),
    steps: fields.json({ label: 'Protocol Steps' }),
    safety_notes: fields.text({ label: 'Safety Notes' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const Experiment = defineModel('rnd.experiment', {
  table: 'rnd_experiments',
  order: 'created_at desc',
  fields: {
    name: fields.string({ required: true }),
    program: fields.belongsTo(ResearchProgram, { required: true }),
    hypothesis: fields.belongsTo(Hypothesis),
    protocol: fields.belongsTo(Protocol),
    status: fields.enum(['draft', 'registered', 'running', 'completed', 'aborted'], {
      required: true,
      default: RndExperimentStatus.DRAFT,
    }),
    pre_registration_hash: fields.string({ label: 'Pre-registration Hash' }),
    result_summary: fields.json({ label: 'Result Summary' }),
    external_ref: fields.string({ label: 'External Reference' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const ProtocolRun = defineModel('rnd.protocol_run', {
  table: 'rnd_protocol_runs',
  order: 'started_at desc',
  fields: {
    protocol: fields.belongsTo(Protocol, { required: true }),
    experiment: fields.belongsTo(Experiment),
    started_at: fields.datetime({ required: true }),
    finished_at: fields.datetime(),
    status: fields.enum(['pending', 'in_progress', 'succeeded', 'failed', 'cancelled'], {
      required: true,
      default: RndRunStatus.PENDING,
    }),
    measurements: fields.json({ label: 'Measurements' }),
    notes: fields.text(),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const Instrument = defineModel('rnd.instrument', {
  table: 'rnd_instruments',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    kind: fields.string({ label: 'Instrument Kind' }),
    serial_no: fields.string({ unique: true, label: 'Serial Number' }),
    calibration_due: fields.date({ label: 'Calibration Due' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-science instrument records',
    }),
  },
});

export const Reagent = defineModel('rnd.reagent', {
  table: 'rnd_reagents',
  order: 'name asc',
  fields: {
    name: fields.string({ required: true }),
    catalog_no: fields.string({ label: 'Catalog Number' }),
    lot_no: fields.string({ label: 'Lot Number' }),
    quantity: fields.float({ default: 0 }),
    unit: fields.string({ default: 'unit' }),
    expiry_date: fields.date({ label: 'Expiry Date' }),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});

export const Sample = defineModel('rnd.sample', {
  table: 'rnd_samples',
  order: 'collected_at desc',
  fields: {
    code: fields.string({ required: true, unique: true }),
    kind: fields.string({ label: 'Sample Kind' }),
    collected_at: fields.datetime({ required: true }),
    metadata: fields.json({ label: 'Sample Metadata' }),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-science/orm-clinical sample records',
    }),
  },
});

export const Publication = defineModel('rnd.publication', {
  table: 'rnd_publications',
  order: 'created_at desc',
  fields: {
    title: fields.string({ required: true }),
    doi: fields.string({ label: 'DOI' }),
    venue: fields.string({ label: 'Venue' }),
    published_at: fields.date(),
    program: fields.belongsTo(ResearchProgram),
    external_ref: fields.string({
      label: 'External Reference',
      help: 'Cross-package link to orm-knowledge publication records',
    }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const Patent = defineModel('rnd.patent', {
  table: 'rnd_patents',
  order: 'created_at desc',
  fields: {
    title: fields.string({ required: true }),
    jurisdiction: fields.string(),
    filing_date: fields.date(),
    status: fields.enum(['drafted', 'filed', 'published', 'granted', 'withdrawn'], {
      required: true,
      default: RndPatentStatus.DRAFTED,
    }),
    program: fields.belongsTo(ResearchProgram),
    external_ref: fields.string({ label: 'External Reference' }),
    created_at: fields.datetime(),
    updated_at: fields.datetime(),
  },
});

export const IprDisclosure = defineModel('rnd.ipr_disclosure', {
  table: 'rnd_ipr_disclosures',
  order: 'disclosed_at desc',
  fields: {
    title: fields.string({ required: true }),
    type: fields.enum(['patent', 'trademark', 'copyright', 'trade_secret'], {
      required: true,
      default: RndIprType.PATENT,
    }),
    disclosed_at: fields.datetime({ required: true }),
    status: fields.enum(['internal_review', 'committee_pending', 'accepted', 'declined'], {
      required: true,
      default: RndDisclosureStatus.INTERNAL_REVIEW,
    }),
    patent: fields.belongsTo(Patent),
    external_ref: fields.string({ label: 'External Reference' }),
  },
});