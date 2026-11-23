import type { Knex } from 'knex';
import {
  Project,
  ProjectMilestone,
  ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
} from './models.js';

type StageFields = {
  company_id: number;
  code: string;
  name: string;
  sequence: number;
  is_closed: boolean;
  fold: boolean;
  wip_limit?: number;
  project_id?: number;
};

type ProjectFields = {
  company_id: number;
  code: string;
  name: string;
  status: string;
  start_date: string;
  target_date: string;
  sequence: number;
  description?: string;
  partner_id?: number;
  department_id?: number;
  team_id?: number;
  owner_id?: number;
};

type MilestoneFields = {
  company_id: number;
  project_id: number;
  code: string;
  name: string;
  due_date: string;
  status: string;
  description?: string;
  owner_id?: number;
};

type TaskFields = {
  company_id: number;
  project_id: number;
  stage_id: number;
  milestone_id: number;
  code: string;
  title: string;
  priority: string;
  status: string;
  position: number;
  description?: string;
  parent_id?: number;
  assignee_id?: number;
  reviewer_id?: number;
  estimate_minutes?: number;
  due_date?: string;
  external_ref?: string;
};

type DependencyFields = {
  company_id: number;
  task_id: number;
  depends_on_id: number;
  kind: string;
};

export const PROJECT_SEED_VERSION = '1.0.0';

export const PROJECT_SEED_ENUMS = {
  projectStatuses: ['planned', 'active', 'on_hold', 'completed', 'archived'] as const,
  milestoneStatuses: ['open', 'reached', 'missed'] as const,
  taskPriorities: ['low', 'normal', 'high', 'urgent'] as const,
  taskStatuses: ['backlog', 'in_progress', 'blocked', 'review', 'done', 'cancelled'] as const,
  taskDependencyKinds: ['blocks', 'relates_to'] as const,
};

export type ProjectSeedCompanyRef = { model: string; externalId: string };
export type ProjectSeedProjectRef = { model: string; externalId: string };
export type ProjectSeedStageRef = { model: string; externalId: string };
export type ProjectSeedMilestoneRef = { model: string; externalId: string };
export type ProjectSeedTaskRef = { model: string; externalId: string };
export type ProjectSeedDependencyRef = { model: string; externalId: string };

export type ProjectSeedStage = {
  externalId: string;
  code: string;
  name: string;
  sequence: number;
  wipLimit?: number;
  isClosed: boolean;
  fold: boolean;
  project?: ProjectSeedProjectRef;
};

export type ProjectSeedProject = {
  externalId: string;
  code: string;
  name: string;
  description?: string;
  partner?: { model: string; externalId: string };
  department?: { model: string; externalId: string };
  team?: { model: string; externalId: string };
  owner?: { model: string; externalId: string };
  status: 'planned' | 'active' | 'on_hold' | 'completed' | 'archived';
  startDate: string;
  targetDate: string;
  sequence: number;
};

export type ProjectSeedMilestone = {
  externalId: string;
  project: ProjectSeedProjectRef;
  code: string;
  name: string;
  description?: string;
  dueDate: string;
  status: 'open' | 'reached' | 'missed';
  owner?: { model: string; externalId: string };
};

export type ProjectSeedTask = {
  externalId: string;
  project: ProjectSeedProjectRef;
  stage: ProjectSeedStageRef;
  milestone: ProjectSeedMilestoneRef;
  parent?: ProjectSeedTaskRef;
  code: string;
  title: string;
  description?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'backlog' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled';
  assignee?: { model: string; externalId: string };
  reviewer?: { model: string; externalId: string };
  estimateMinutes?: number;
  dueDate?: string;
  position: number;
  externalRef?: string;
};

export type ProjectSeedDependency = {
  externalId: string;
  task: ProjectSeedTaskRef;
  dependsOn: ProjectSeedTaskRef;
  kind: 'blocks' | 'relates_to';
};

export type ProjectInitialSeedBundle = {
  version: string;
  company: ProjectSeedCompanyRef;
  stages: ProjectSeedStage[];
  projects: ProjectSeedProject[];
  milestones: ProjectSeedMilestone[];
  tasks: ProjectSeedTask[];
  dependencies: ProjectSeedDependency[];
};

function cloneStage(stage: ProjectSeedStage): ProjectSeedStage {
  return { ...stage };
}

function cloneProject(project: ProjectSeedProject): ProjectSeedProject {
  return { ...project };
}

function cloneMilestone(milestone: ProjectSeedMilestone): ProjectSeedMilestone {
  return { ...milestone };
}

function cloneTask(task: ProjectSeedTask): ProjectSeedTask {
  return { ...task };
}

function cloneDependency(dep: ProjectSeedDependency): ProjectSeedDependency {
  return { ...dep };
}

export function buildProjectInitialSeed(): ProjectInitialSeedBundle {
  return {
    version: PROJECT_SEED_VERSION,
    company: { model: 'base.company', externalId: 'base.company_default' },
    stages: [
      {
        externalId: 'project.stage_backlog',
        code: 'backlog',
        name: 'Backlog',
        sequence: 10,
        isClosed: false,
        fold: false,
      },
      {
        externalId: 'project.stage_in_progress',
        code: 'in_progress',
        name: 'In Progress',
        sequence: 20,
        wipLimit: 5,
        isClosed: false,
        fold: false,
      },
      {
        externalId: 'project.stage_review',
        code: 'review',
        name: 'Review',
        sequence: 30,
        isClosed: false,
        fold: false,
      },
      {
        externalId: 'project.stage_done',
        code: 'done',
        name: 'Done',
        sequence: 40,
        isClosed: true,
        fold: true,
      },
    ] as const,
    projects: [
      {
        externalId: 'project.example_platform_roadmap',
        code: 'platform-roadmap',
        name: 'Platform Roadmap',
        description: 'Core workspace coordination project aligned with Product Engineering.',
        partner: { model: 'base.partner', externalId: 'base.partner_acme' },
        department: {
          model: 'organization.department',
          externalId: 'organization.department_product',
        },
        team: { model: 'organization.team', externalId: 'organization.team_board' },
        owner: { model: 'base.user', externalId: 'base.user_superadmin' },
        status: 'active',
        startDate: '2026-01-01',
        targetDate: '2026-12-31',
        sequence: 10,
      },
      {
        externalId: 'project.demo_customer_launch',
        code: 'customer-launch',
        name: 'Customer Launch & Omnichannel Rollout',
        description:
          'Cross-functional rollout linking CRM, Sales Orders, Subscriptions, and WhatsApp Support.',
        partner: { model: 'base.partner', externalId: 'base.partner_meridian' },
        department: {
          model: 'organization.department',
          externalId: 'organization.department_product',
        },
        team: { model: 'organization.team', externalId: 'organization.team_api' },
        owner: { model: 'base.user', externalId: 'base.user_superadmin' },
        status: 'active',
        startDate: '2026-10-01',
        targetDate: '2027-02-28',
        sequence: 20,
      },
    ] as const,
    milestones: [
      {
        externalId: 'project.example_milestone_rc1',
        project: { model: 'project.project', externalId: 'project.example_platform_roadmap' },
        code: 'rc1-release',
        name: 'RC.1 Ecosystem Readiness',
        description: 'Baseline delivery milestone connecting organization, workflow, and AI work.',
        dueDate: '2026-12-15',
        status: 'open',
        owner: { model: 'base.user', externalId: 'base.user_superadmin' },
      },
      {
        externalId: 'project.demo_milestone_beta',
        project: { model: 'project.project', externalId: 'project.demo_customer_launch' },
        code: 'beta-launch',
        name: 'Customer Beta Launch',
        description: 'Production validation milestone for pilot customer onboarding flows.',
        dueDate: '2026-11-30',
        status: 'reached',
        owner: { model: 'base.user', externalId: 'base.user_superadmin' },
      },
      {
        externalId: 'project.demo_milestone_q1_ga',
        project: { model: 'project.project', externalId: 'project.example_platform_roadmap' },
        code: 'q1-ga-scale',
        name: 'Q1 General Availability',
        description: 'Multi-addon production polish across board UI, CRM, and billing suites.',
        dueDate: '2027-02-15',
        status: 'open',
        owner: { model: 'base.user', externalId: 'base.user_system' },
      },
    ] as const,
    tasks: [
      {
        externalId: 'project.example_task_bootstrap',
        project: { model: 'project.project', externalId: 'project.example_platform_roadmap' },
        stage: { model: 'project.stage', externalId: 'project.stage_in_progress' },
        milestone: { model: 'project.milestone', externalId: 'project.example_milestone_rc1' },
        code: 'TASK-0001',
        title: 'Align project tasks with workflow reviews and AI contracts',
        description:
          'Reference task demonstrating cross-addon orchestration without schema overlap.',
        priority: 'high',
        status: 'in_progress',
        assignee: { model: 'base.user', externalId: 'base.user_superadmin' },
        reviewer: { model: 'base.user', externalId: 'base.user_system' },
        estimateMinutes: 120,
        dueDate: '2026-12-01',
        position: 10,
        externalRef: 'TASK-0001',
      },
      {
        externalId: 'project.example_task_verify',
        project: { model: 'project.project', externalId: 'project.example_platform_roadmap' },
        stage: { model: 'project.stage', externalId: 'project.stage_backlog' },
        milestone: { model: 'project.milestone', externalId: 'project.example_milestone_rc1' },
        parent: { model: 'project.task', externalId: 'project.example_task_bootstrap' },
        code: 'TASK-0002',
        title: 'Verify end-to-end milestone readiness',
        description: 'Follow-up subtask blocked until bootstrap alignment completes.',
        priority: 'normal',
        status: 'backlog',
        assignee: { model: 'base.user', externalId: 'base.user_superadmin' },
        estimateMinutes: 60,
        dueDate: '2026-12-10',
        position: 20,
        externalRef: 'TASK-0002',
      },
      {
        externalId: 'project.demo_task_schema_audit',
        project: { model: 'project.project', externalId: 'project.example_platform_roadmap' },
        stage: { model: 'project.stage', externalId: 'project.stage_done' },
        milestone: { model: 'project.milestone', externalId: 'project.example_milestone_rc1' },
        code: 'TASK-0003',
        title: 'Certify default seed conformance across ORM addons',
        description:
          'Completed schema & default-data verification gate across all workspace addons.',
        priority: 'high',
        status: 'done',
        assignee: { model: 'base.user', externalId: 'base.user_system' },
        reviewer: { model: 'base.user', externalId: 'base.user_superadmin' },
        estimateMinutes: 90,
        dueDate: '2026-11-20',
        position: 5,
        externalRef: 'TASK-0003',
      },
      {
        externalId: 'project.demo_task_board_polish',
        project: { model: 'project.project', externalId: 'project.example_platform_roadmap' },
        stage: { model: 'project.stage', externalId: 'project.stage_review' },
        milestone: { model: 'project.milestone', externalId: 'project.demo_milestone_q1_ga' },
        code: 'TASK-0004',
        title: 'Review Kanban typography & Grunge UI contrast across Board routes',
        description:
          'Design QA pass using MoonWitness Grunge display hierarchy and shared SelectField controls.',
        priority: 'normal',
        status: 'review',
        assignee: { model: 'base.user', externalId: 'base.user_superadmin' },
        reviewer: { model: 'base.user', externalId: 'base.user_system' },
        estimateMinutes: 75,
        dueDate: '2026-12-18',
        position: 15,
        externalRef: 'TASK-0004',
      },
      {
        externalId: 'project.demo_task_crm_sync',
        project: { model: 'project.project', externalId: 'project.demo_customer_launch' },
        stage: { model: 'project.stage', externalId: 'project.stage_in_progress' },
        milestone: { model: 'project.milestone', externalId: 'project.demo_milestone_beta' },
        code: 'TASK-0005',
        title: 'Wire CRM opportunities & Sales Orders into subscription provisioning',
        description: 'Tracks won opportunities feeding SO-2026-0003 and active billing contracts.',
        priority: 'urgent',
        status: 'in_progress',
        assignee: { model: 'base.user', externalId: 'base.user_superadmin' },
        reviewer: { model: 'base.user', externalId: 'base.user_system' },
        estimateMinutes: 180,
        dueDate: '2026-12-05',
        position: 10,
        externalRef: 'TASK-0005',
      },
      {
        externalId: 'project.demo_task_launch_checklist',
        project: { model: 'project.project', externalId: 'project.demo_customer_launch' },
        stage: { model: 'project.stage', externalId: 'project.stage_backlog' },
        milestone: { model: 'project.milestone', externalId: 'project.demo_milestone_beta' },
        code: 'TASK-0006',
        title: 'Publish customer onboarding SLA & webhook runbook',
        description: 'Final launch signoff queued behind CRM/Sales provisioning sync.',
        priority: 'normal',
        status: 'backlog',
        assignee: { model: 'base.user', externalId: 'base.user_system' },
        estimateMinutes: 60,
        dueDate: '2026-12-12',
        position: 20,
        externalRef: 'TASK-0006',
      },
    ] as const,
    dependencies: [
      {
        externalId: 'project.example_dep_verify_blocks',
        task: { model: 'project.task', externalId: 'project.example_task_verify' },
        dependsOn: { model: 'project.task', externalId: 'project.example_task_bootstrap' },
        kind: 'blocks',
      },
      {
        externalId: 'project.demo_dep_checklist_blocks',
        task: { model: 'project.task', externalId: 'project.demo_task_launch_checklist' },
        dependsOn: { model: 'project.task', externalId: 'project.demo_task_crm_sync' },
        kind: 'blocks',
      },
      {
        externalId: 'project.demo_dep_polish_relates',
        task: { model: 'project.task', externalId: 'project.demo_task_board_polish' },
        dependsOn: { model: 'project.task', externalId: 'project.demo_task_schema_audit' },
        kind: 'relates_to',
      },
    ] as const,
  };
}

async function resolveSeedId(db: Knex, model: string, externalId: string): Promise<number | null> {
  const row = await db('_orm_data').where({ id: externalId, model }).first('record_id');
  return row ? Number(row.record_id) : null;
}

async function insertSeedRow(
  db: Knex,
  modelName: string,
  externalId: string,
  fields: StageFields | ProjectFields | MilestoneFields | TaskFields | DependencyFields
): Promise<boolean> {
  const existing = await db('_orm_data')
    .where({ id: externalId, model: modelName })
    .first('record_id');
  if (existing) return false;
  const [id] = await db(modelName).insert(fields);
  await db('_orm_data').insert({ id: externalId, model: modelName, record_id: id });
  return true;
}

export async function seedProjectInitialData(db: Knex) {
  const bundle = buildProjectInitialSeed();
  let insertedStages = 0;
  let insertedProjects = 0;
  let insertedMilestones = 0;
  let insertedTasks = 0;
  let insertedDependencies = 0;

  const companyId = await resolveSeedId(db, 'base.company', bundle.company.externalId);
  if (!companyId) throw new Error('Default company not seeded');

  for (const stage of bundle.stages) {
    const fields: StageFields = {
      company_id: companyId,
      code: stage.code,
      name: stage.name,
      sequence: stage.sequence,
      is_closed: stage.isClosed,
      fold: stage.fold,
    };
    if (stage.wipLimit !== undefined) fields.wip_limit = stage.wipLimit;
    if (stage.project) {
      const projectId = await resolveSeedId(db, 'project.project', stage.project.externalId);
      if (projectId) fields.project_id = projectId;
    }
    const inserted = await insertSeedRow(db, 'project.stage', stage.externalId, fields);
    if (inserted) insertedStages++;
  }

  for (const project of bundle.projects) {
    const fields: ProjectFields = {
      company_id: companyId,
      code: project.code,
      name: project.name,
      status: project.status,
      start_date: project.startDate,
      target_date: project.targetDate,
      sequence: project.sequence,
    };
    if (project.description) fields.description = project.description;
    if (project.partner) {
      const partnerId = await resolveSeedId(db, 'base.partner', project.partner.externalId);
      if (partnerId) fields.partner_id = partnerId;
    }
    if (project.department) {
      const deptId = await resolveSeedId(
        db,
        'organization.department',
        project.department.externalId
      );
      if (deptId) fields.department_id = deptId;
    }
    if (project.team) {
      const teamId = await resolveSeedId(db, 'organization.team', project.team.externalId);
      if (teamId) fields.team_id = teamId;
    }
    if (project.owner) {
      const ownerId = await resolveSeedId(db, 'base.user', project.owner.externalId);
      if (ownerId) fields.owner_id = ownerId;
    }
    const inserted = await insertSeedRow(db, 'project.project', project.externalId, fields);
    if (inserted) insertedProjects++;
  }

  for (const milestone of bundle.milestones) {
    const projectId = await resolveSeedId(db, 'project.project', milestone.project.externalId);
    if (!projectId) continue;
    const fields: MilestoneFields = {
      company_id: companyId,
      project_id: projectId,
      code: milestone.code,
      name: milestone.name,
      due_date: milestone.dueDate,
      status: milestone.status,
    };
    if (milestone.description) fields.description = milestone.description;
    if (milestone.owner) {
      const ownerId = await resolveSeedId(db, 'base.user', milestone.owner.externalId);
      if (ownerId) fields.owner_id = ownerId;
    }
    const inserted = await insertSeedRow(db, 'project.milestone', milestone.externalId, fields);
    if (inserted) insertedMilestones++;
  }

  for (const task of bundle.tasks) {
    const projectId = await resolveSeedId(db, 'project.project', task.project.externalId);
    const stageId = await resolveSeedId(db, 'project.stage', task.stage.externalId);
    const milestoneId = await resolveSeedId(db, 'project.milestone', task.milestone.externalId);
    if (!projectId || !stageId || !milestoneId) continue;
    const fields: TaskFields = {
      company_id: companyId,
      project_id: projectId,
      stage_id: stageId,
      milestone_id: milestoneId,
      code: task.code,
      title: task.title,
      priority: task.priority,
      status: task.status,
      position: task.position,
    };
    if (task.description) fields.description = task.description;
    if (task.parent) {
      const parentId = await resolveSeedId(db, 'project.task', task.parent.externalId);
      if (parentId) fields.parent_id = parentId;
    }
    if (task.assignee) {
      const assigneeId = await resolveSeedId(db, 'base.user', task.assignee.externalId);
      if (assigneeId) fields.assignee_id = assigneeId;
    }
    if (task.reviewer) {
      const reviewerId = await resolveSeedId(db, 'base.user', task.reviewer.externalId);
      if (reviewerId) fields.reviewer_id = reviewerId;
    }
    if (task.estimateMinutes !== undefined) fields.estimate_minutes = task.estimateMinutes;
    if (task.dueDate) fields.due_date = task.dueDate;
    if (task.externalRef) fields.external_ref = task.externalRef;
    const inserted = await insertSeedRow(db, 'project.task', task.externalId, fields);
    if (inserted) insertedTasks++;
  }

  for (const dep of bundle.dependencies) {
    const taskId = await resolveSeedId(db, 'project.task', dep.task.externalId);
    const dependsOnId = await resolveSeedId(db, 'project.task', dep.dependsOn.externalId);
    if (!taskId || !dependsOnId) continue;
    const fields: DependencyFields = {
      company_id: companyId,
      task_id: taskId,
      depends_on_id: dependsOnId,
      kind: dep.kind,
    };
    const inserted = await insertSeedRow(db, 'project.task_dependency', dep.externalId, fields);
    if (inserted) insertedDependencies++;
  }

  const stagesTotal = await db(ProjectStage.tableName).count({ count: '*' }).first();
  const projectsTotal = await db(Project.tableName).count({ count: '*' }).first();
  const milestonesTotal = await db(ProjectMilestone.tableName).count({ count: '*' }).first();
  const tasksTotal = await db(ProjectTask.tableName).count({ count: '*' }).first();
  const dependenciesTotal = await db(ProjectTaskDependency.tableName).count({ count: '*' }).first();

  return {
    insertedStages,
    insertedProjects,
    insertedMilestones,
    insertedTasks,
    insertedDependencies,
    stagesTotal: Number(stagesTotal?.count ?? 0),
    projectsTotal: Number(projectsTotal?.count ?? 0),
    milestonesTotal: Number(milestonesTotal?.count ?? 0),
    tasksTotal: Number(tasksTotal?.count ?? 0),
    dependenciesTotal: Number(dependenciesTotal?.count ?? 0),
  };
}
