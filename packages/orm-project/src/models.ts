import { defineModel, fields, type BaseModel } from '@moonwitness/orm';
import { Company, Partner, User } from '@moonwitness/orm-base';
import { OrganizationDepartment, OrganizationTeam } from '@moonwitness/orm-organization';

const SLUG_PATTERN = '^[a-z][a-z0-9_-]{1,63}$';
const TASK_CODE_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{1,63}$';
const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const MILESTONE_STATUSES = ['open', 'reached', 'missed'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = [
  'backlog',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_DEPENDENCY_KINDS = ['blocks', 'relates_to'] as const;
export type TaskDependencyKind = (typeof TASK_DEPENDENCY_KINDS)[number];

function modelRef(resolver: () => typeof BaseModel): () => typeof BaseModel {
  return resolver;
}

function projectTaskModel(): typeof BaseModel {
  return ProjectTask;
}

/** Company-scoped project container linked to organization teams, partners, and milestones. */
export const Project = defineModel('project.project', {
  table: 'project_projects',
  order: 'company_id asc, sequence asc, name asc',
  displayField: 'name',
  unique: [['company', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    code: fields.string({ required: true, pattern: SLUG_PATTERN, label: 'Project Code' }),
    name: fields.string({ required: true, label: 'Project Name' }),
    description: fields.text({ label: 'Description' }),
    partner: fields.belongsTo(
      modelRef(() => Partner),
      { label: 'Client / Sponsor' }
    ),
    department: fields.belongsTo(
      modelRef(() => OrganizationDepartment),
      { label: 'Department' }
    ),
    team: fields.belongsTo(
      modelRef(() => OrganizationTeam),
      { label: 'Team' }
    ),
    owner: fields.belongsTo(
      modelRef(() => User),
      { label: 'Project Owner' }
    ),
    status: fields.enum(PROJECT_STATUSES, {
      required: true,
      default: 'planned',
      label: 'Status',
    }),
    start_date: fields.string({ pattern: ISO_DATE_PATTERN, label: 'Start Date' }),
    target_date: fields.string({ pattern: ISO_DATE_PATTERN, label: 'Target Date' }),
    sequence: fields.integer({ required: true, default: 10, label: 'Sequence' }),
  },
});

/** Kanban workflow stage; leave project unset for company-wide default stages. */
export const ProjectStage = defineModel('project.stage', {
  table: 'project_stages',
  order: 'company_id asc, sequence asc, id asc',
  displayField: 'name',
  unique: [['company', 'project', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    project: fields.belongsTo(
      modelRef(() => Project),
      { label: 'Project' }
    ),
    code: fields.string({ required: true, pattern: SLUG_PATTERN, label: 'Stage Code' }),
    name: fields.string({ required: true, label: 'Stage Name' }),
    sequence: fields.integer({ required: true, default: 10, label: 'Sequence' }),
    wip_limit: fields.integer({ label: 'WIP Limit' }),
    is_closed: fields.boolean({ required: true, default: false, label: 'Closed Stage' }),
    fold: fields.boolean({ required: true, default: false, label: 'Folded' }),
  },
});

/** Deliverable target date within a project. */
export const ProjectMilestone = defineModel('project.milestone', {
  table: 'project_milestones',
  order: 'project_id asc, due_date asc, id asc',
  displayField: 'name',
  unique: [['project', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    project: fields.belongsTo(
      modelRef(() => Project),
      { required: true, label: 'Project' }
    ),
    code: fields.string({ required: true, pattern: SLUG_PATTERN, label: 'Milestone Code' }),
    name: fields.string({ required: true, label: 'Milestone Name' }),
    description: fields.text({ label: 'Description' }),
    due_date: fields.string({ pattern: ISO_DATE_PATTERN, label: 'Due Date' }),
    status: fields.enum(MILESTONE_STATUSES, {
      required: true,
      default: 'open',
      label: 'Status',
    }),
    owner: fields.belongsTo(
      modelRef(() => User),
      { label: 'Owner' }
    ),
  },
});

/** Actionable unit of work supporting subtasks, Kanban stages, workflow reviews, and AI/TaskOS bridges. */
export const ProjectTask = defineModel('project.task', {
  table: 'project_tasks',
  order: 'project_id asc, position asc, id desc',
  displayField: 'title',
  unique: [['company', 'code']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    project: fields.belongsTo(
      modelRef(() => Project),
      { required: true, label: 'Project' }
    ),
    stage: fields.belongsTo(
      modelRef(() => ProjectStage),
      { required: true, label: 'Stage' }
    ),
    milestone: fields.belongsTo(
      modelRef(() => ProjectMilestone),
      { label: 'Milestone' }
    ),
    parent: fields.belongsTo(projectTaskModel, { label: 'Parent Task' }),
    code: fields.string({ required: true, pattern: TASK_CODE_PATTERN, label: 'Task Code' }),
    title: fields.string({ required: true, label: 'Title' }),
    description: fields.text({ label: 'Description' }),
    priority: fields.enum(TASK_PRIORITIES, {
      required: true,
      default: 'normal',
      label: 'Priority',
    }),
    status: fields.enum(TASK_STATUSES, {
      required: true,
      default: 'backlog',
      label: 'Status',
    }),
    assignee: fields.belongsTo(
      modelRef(() => User),
      { label: 'Assignee' }
    ),
    reviewer: fields.belongsTo(
      modelRef(() => User),
      { label: 'Reviewer' }
    ),
    blocked_reason: fields.text({ label: 'Blocked Reason' }),
    estimate_minutes: fields.integer({ label: 'Estimate (Minutes)' }),
    due_date: fields.string({ pattern: ISO_DATE_PATTERN, label: 'Due Date' }),
    position: fields.integer({ required: true, default: 100, label: 'Position' }),
    external_ref: fields.string({
      label: 'External Sync Ref',
      help: 'Correlates 1:1 with local TaskOS (apps/todo) task code or external issue identifier.',
    }),
  },
});

/** Directed dependency edge between tasks; `blocks` edges are validated to remain acyclic. */
export const ProjectTaskDependency = defineModel('project.task_dependency', {
  table: 'project_task_dependencies',
  order: 'task_id asc, id asc',
  unique: [['task', 'depends_on']],
  fields: {
    company: fields.belongsTo(
      modelRef(() => Company),
      { required: true, label: 'Company' }
    ),
    task: fields.belongsTo(
      modelRef(() => ProjectTask),
      { required: true, label: 'Task' }
    ),
    depends_on: fields.belongsTo(
      modelRef(() => ProjectTask),
      {
        required: true,
        label: 'Depends On',
      }
    ),
    kind: fields.enum(TASK_DEPENDENCY_KINDS, {
      required: true,
      default: 'blocks',
      label: 'Kind',
    }),
  },
});

Project.relationMappings = {
  ...Project.relationMappings,
  stages: {
    relation: Project.HasManyRelation,
    modelClass: ProjectStage,
    join: { from: 'project_projects.id', to: 'project_stages.project_id' },
  },
  milestones: {
    relation: Project.HasManyRelation,
    modelClass: ProjectMilestone,
    join: { from: 'project_projects.id', to: 'project_milestones.project_id' },
  },
  tasks: {
    relation: Project.HasManyRelation,
    modelClass: ProjectTask,
    join: { from: 'project_projects.id', to: 'project_tasks.project_id' },
  },
};

ProjectTask.relationMappings = {
  ...ProjectTask.relationMappings,
  subtasks: {
    relation: ProjectTask.HasManyRelation,
    modelClass: ProjectTask,
    join: { from: 'project_tasks.id', to: 'project_tasks.parent_id' },
  },
  dependencies: {
    relation: ProjectTask.HasManyRelation,
    modelClass: ProjectTaskDependency,
    join: { from: 'project_tasks.id', to: 'project_task_dependencies.task_id' },
  },
  dependents: {
    relation: ProjectTask.HasManyRelation,
    modelClass: ProjectTaskDependency,
    join: { from: 'project_tasks.id', to: 'project_task_dependencies.depends_on_id' },
  },
};
