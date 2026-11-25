import { defineModel, fields, type FieldMap } from '@moonwitness/orm';
import { Company } from '@moonwitness/orm-base';
import { Partner } from '@moonwitness/orm-base';
import { User } from '@moonwitness/orm-base';

export type ComplianceFrameworkCategory =
  'regulatory' | 'industry' | 'internal' | 'contractual' | 'esg';
export type ComplianceFrameworkStatus = 'draft' | 'active' | 'deprecated' | 'archived';
export type ComplianceControlType =
  'preventive' | 'detective' | 'corrective' | 'directive' | 'compensating';
export type ComplianceControlStatus = 'draft' | 'active' | 'deprecated' | 'archived';
export type ComplianceAssessmentStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type ComplianceFindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type ComplianceFindingStatus =
  'open' | 'in_progress' | 'resolved' | 'risk_accepted' | 'false_positive';
export type ComplianceRemediationStatus =
  'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected';
export type CompliancePolicyStatus =
  'draft' | 'under_review' | 'approved' | 'published' | 'archived';
export type ComplianceEvidenceType =
  'document' | 'screenshot' | 'log' | 'certificate' | 'attestation' | 'test_result';
export type ComplianceEvidenceStatus =
  'submitted' | 'under_review' | 'accepted' | 'rejected' | 'expired';

export const ComplianceFramework = defineModel('compliance.framework', {
  table: 'compliance_frameworks',
  order: 'create_date desc',
  fields: {
    code: fields.string({ required: true, unique: true, label: 'Framework Code' }),
    name: fields.string({ required: true, label: 'Framework Name' }),
    version: fields.string({ required: true, label: 'Version' }),
    category: fields.string({
      required: true,
      values: ['regulatory', 'industry', 'internal', 'contractual', 'esg'],
      label: 'Category',
    }),
    description: fields.text({ label: 'Description' }),
    status: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'active', 'deprecated', 'archived'],
      label: 'Status',
    }),
    issuer: fields.string({ label: 'Issuing Body' }),
    effective_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Effective Date' }),
    expiry_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Expiry Date' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    owner: fields.belongsTo(User, { required: true, label: 'Framework Owner' }),
    reference_url: fields.string({ label: 'Reference URL' }),
    tags: fields.text({ label: 'Tags (JSON)' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

export const ComplianceControl = defineModel('compliance.control', {
  table: 'compliance_controls',
  order: 'create_date desc',
  fields: {
    control_id: fields.string({ required: true, unique: true, label: 'Control ID' }),
    framework: fields.belongsTo(ComplianceFramework, { required: true, label: 'Framework' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    name: fields.string({ required: true, label: 'Control Name' }),
    description: fields.text({ label: 'Description' }),
    control_type: fields.string({
      required: true,
      values: ['preventive', 'detective', 'corrective', 'directive', 'compensating'],
      label: 'Control Type',
    }),
    status: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'active', 'deprecated', 'archived'],
      label: 'Status',
    }),
    risk_category: fields.string({ label: 'Risk Category' }),
    control_objective: fields.text({ label: 'Control Objective' }),
    testing_procedure: fields.text({ label: 'Testing Procedure' }),
    frequency: fields.string({
      label: 'Testing Frequency',
      values: [
        'continuous',
        'daily',
        'weekly',
        'monthly',
        'quarterly',
        'semi_annual',
        'annual',
        'ad_hoc',
      ],
    }),
    automation_level: fields.string({
      label: 'Automation Level',
      values: ['manual', 'semi_automated', 'fully_automated'],
    }),
    owner: fields.belongsTo(User, { label: 'Control Owner' }),
    reviewer: fields.belongsTo(User, { label: 'Reviewer' }),
    evidence_requirements: fields.text({ label: 'Evidence Requirements (JSON)' }),
    related_controls: fields.text({ label: 'Related Controls (JSON)' }),
    tags: fields.text({ label: 'Tags (JSON)' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

export const ComplianceAssessment = defineModel('compliance.assessment', {
  table: 'compliance_assessments',
  order: 'assessment_date desc',
  fields: {
    assessment_no: fields.string({ required: true, unique: true, label: 'Assessment No' }),
    framework: fields.belongsTo(ComplianceFramework, { required: true, label: 'Framework' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    assessment_date: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Assessment Date',
    }),
    period_start: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Period Start',
    }),
    period_end: fields.string({
      required: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Period End',
    }),
    status: fields.string({
      required: true,
      default: 'planned',
      values: ['planned', 'in_progress', 'completed', 'cancelled'],
      label: 'Status',
    }),
    scope: fields.text({ label: 'Assessment Scope (JSON)' }),
    assessor: fields.belongsTo(User, { required: true, label: 'Lead Assessor' }),
    reviewer: fields.belongsTo(User, { label: 'Reviewer' }),
    overall_score: fields.integer({ label: 'Overall Score (0-100)' }),
    maturity_level: fields.string({
      label: 'Maturity Level',
      values: ['initial', 'managed', 'defined', 'quantitatively_managed', 'optimizing'],
    }),
    controls_tested: fields.integer({ required: true, default: 0, label: 'Controls Tested' }),
    controls_passed: fields.integer({ required: true, default: 0, label: 'Controls Passed' }),
    controls_failed: fields.integer({ required: true, default: 0, label: 'Controls Failed' }),
    controls_not_applicable: fields.integer({ required: true, default: 0, label: 'Controls N/A' }),
    findings_critical: fields.integer({ required: true, default: 0, label: 'Critical Findings' }),
    findings_high: fields.integer({ required: true, default: 0, label: 'High Findings' }),
    findings_medium: fields.integer({ required: true, default: 0, label: 'Medium Findings' }),
    findings_low: fields.integer({ required: true, default: 0, label: 'Low Findings' }),
    completed_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Completed Date' }),
    next_assessment_date: fields.string({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      label: 'Next Assessment Date',
    }),
    report_reference: fields.string({ label: 'Report Reference' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

const complianceFindingFields: FieldMap = {
  finding_no: fields.string({ required: true, unique: true, label: 'Finding No' }),
  assessment: fields.belongsTo(ComplianceAssessment, { required: true, label: 'Assessment' }),
  control: fields.belongsTo(ComplianceControl, { label: 'Related Control' }),
  company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  title: fields.string({ required: true, label: 'Finding Title' }),
  description: fields.text({ required: true, label: 'Description' }),
  severity: fields.string({
    required: true,
    values: ['critical', 'high', 'medium', 'low', 'informational'],
    label: 'Severity',
  }),
  status: fields.string({
    required: true,
    default: 'open',
    values: ['open', 'in_progress', 'resolved', 'risk_accepted', 'false_positive'],
    label: 'Status',
  }),
  risk_rating: fields.integer({ label: 'Risk Rating (1-25)' }),
  root_cause: fields.text({ label: 'Root Cause' }),
  impact: fields.text({ label: 'Impact' }),
  recommendation: fields.text({ label: 'Recommendation' }),
  reported_by: fields.belongsTo(User, { required: true, label: 'Reported By' }),
  assigned_to: fields.belongsTo(User, { label: 'Assigned To' }),
  target_resolution_date: fields.string({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    label: 'Target Resolution Date',
  }),
  actual_resolution_date: fields.string({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    label: 'Actual Resolution Date',
  }),
  risk_acceptance_rationale: fields.text({ label: 'Risk Acceptance Rationale' }),
  risk_accepted_by: fields.belongsTo(User, { label: 'Risk Accepted By' }),
  risk_accepted_date: fields.string({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    label: 'Risk Accepted Date',
  }),
  tags: fields.text({ label: 'Tags (JSON)' }),
  notes: fields.text({ label: 'Notes' }),
};

export const ComplianceFinding = defineModel('compliance.finding', {
  table: 'compliance_findings',
  order: 'create_date desc',
  fields: complianceFindingFields,
});

const complianceRemediationFields: FieldMap = {
  remediation_no: fields.string({ required: true, unique: true, label: 'Remediation No' }),
  finding: fields.belongsTo(ComplianceFinding, { required: true, label: 'Finding' }),
  company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  title: fields.string({ required: true, label: 'Remediation Title' }),
  description: fields.text({ required: true, label: 'Description' }),
  action_plan: fields.text({ label: 'Action Plan' }),
  status: fields.string({
    required: true,
    default: 'pending',
    values: ['pending', 'in_progress', 'completed', 'verified', 'rejected'],
    label: 'Status',
  }),
  priority: fields.string({
    required: true,
    default: 'medium',
    values: ['critical', 'high', 'medium', 'low'],
    label: 'Priority',
  }),
  owner: fields.belongsTo(User, { required: true, label: 'Remediation Owner' }),
  verifier: fields.belongsTo(User, { label: 'Verifier' }),
  start_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Start Date' }),
  target_completion_date: fields.string({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    label: 'Target Completion Date',
  }),
  actual_completion_date: fields.string({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    label: 'Actual Completion Date',
  }),
  verification_date: fields.string({
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    label: 'Verification Date',
  }),
  verification_notes: fields.text({ label: 'Verification Notes' }),
  evidence_references: fields.text({ label: 'Evidence References (JSON)' }),
  cost_estimate_minor: fields.integer({ label: 'Cost Estimate (minor units)' }),
  actual_cost_minor: fields.integer({ label: 'Actual Cost (minor units)' }),
  tags: fields.text({ label: 'Tags (JSON)' }),
  notes: fields.text({ label: 'Notes' }),
};

export const ComplianceRemediation = defineModel('compliance.remediation', {
  table: 'compliance_remediations',
  order: 'create_date desc',
  fields: complianceRemediationFields,
});

export const CompliancePolicy = defineModel('compliance.policy', {
  table: 'compliance_policies',
  order: 'create_date desc',
  fields: {
    policy_no: fields.string({ required: true, unique: true, label: 'Policy No' }),
    framework: fields.belongsTo(ComplianceFramework, { label: 'Framework' }),
    company: fields.belongsTo(Company, { required: true, label: 'Company' }),
    title: fields.string({ required: true, label: 'Policy Title' }),
    description: fields.text({ label: 'Description' }),
    content: fields.text({ label: 'Policy Content' }),
    status: fields.string({
      required: true,
      default: 'draft',
      values: ['draft', 'under_review', 'approved', 'published', 'archived'],
      label: 'Status',
    }),
    version: fields.string({ required: true, default: '1.0', label: 'Version' }),
    effective_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Effective Date' }),
    review_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Next Review Date' }),
    owner: fields.belongsTo(User, { required: true, label: 'Policy Owner' }),
    approver: fields.belongsTo(User, { label: 'Approver' }),
    approved_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Approved Date' }),
    applicability: fields.text({ label: 'Applicability (JSON)' }),
    related_policies: fields.text({ label: 'Related Policies (JSON)' }),
    tags: fields.text({ label: 'Tags (JSON)' }),
    notes: fields.text({ label: 'Notes' }),
  },
});

const complianceEvidenceFields: FieldMap = {
  evidence_no: fields.string({ required: true, unique: true, label: 'Evidence No' }),
  assessment: fields.belongsTo(ComplianceAssessment, { label: 'Assessment' }),
  control: fields.belongsTo(ComplianceControl, { label: 'Control' }),
  finding: fields.belongsTo(ComplianceFinding, { label: 'Finding' }),
  remediation: fields.belongsTo(ComplianceRemediation, { label: 'Remediation' }),
  company: fields.belongsTo(Company, { required: true, label: 'Company' }),
  title: fields.string({ required: true, label: 'Evidence Title' }),
  description: fields.text({ label: 'Description' }),
  evidence_type: fields.string({
    required: true,
    values: ['document', 'screenshot', 'log', 'certificate', 'attestation', 'test_result'],
    label: 'Evidence Type',
  }),
  status: fields.string({
    required: true,
    default: 'submitted',
    values: ['submitted', 'under_review', 'accepted', 'rejected', 'expired'],
    label: 'Status',
  }),
  file_path: fields.string({ label: 'File Path/URL' }),
  file_hash: fields.string({ label: 'File Hash (SHA256)' }),
  file_size: fields.integer({ label: 'File Size (bytes)' }),
  mime_type: fields.string({ label: 'MIME Type' }),
  collected_date: fields.string({
    required: true,
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    label: 'Collected Date',
  }),
  expiry_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Expiry Date' }),
  collected_by: fields.belongsTo(User, { required: true, label: 'Collected By' }),
  reviewed_by: fields.belongsTo(User, { label: 'Reviewed By' }),
  review_date: fields.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'Review Date' }),
  review_notes: fields.text({ label: 'Review Notes' }),
  tags: fields.text({ label: 'Tags (JSON)' }),
  notes: fields.text({ label: 'Notes' }),
};

export const ComplianceEvidence = defineModel('compliance.evidence', {
  table: 'compliance_evidence',
  order: 'create_date desc',
  fields: complianceEvidenceFields,
});
