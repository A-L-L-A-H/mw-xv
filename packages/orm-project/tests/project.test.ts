import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons, resolveViews, validateViews } from '@moonwitness/orm';
import {
  Activity,
  Company,
  CompanyMembership,
  Tag,
  TagLink,
  User,
  manifest as baseManifest,
  nextSequence,
} from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import {
  OrganizationDepartment,
  OrganizationTeam,
  manifest as organizationManifest,
} from '@moonwitness/orm-organization';
import { WorkflowDefinition, manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  Project,
  ProjectMilestone,
  ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
  buildProjectDependencyGraph,
  isValidProjectMutation,
  manifest,
  mapProjectTaskToTodoSnapshot,
  mapTodoTaskToProjectTaskFields,
  toPolymorphicResource,
  toWorkContractSource,
} from '../src/index.js';

describe('project addon', () => {
  let db: Knex;

  beforeEach(() => {
    db = knex({
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
    });
  });

  afterEach(async () => db.destroy());

  async function installEcosystem() {
    await installAddons(db, [
      manifest,
      workflowManifest,
      notificationManifest,
      organizationManifest,
      jobsManifest,
      baseManifest,
    ]);
  }

  it('installs project models, seeds, sequence, review workflow, and validates all views cleanly', async () => {
    await installEcosystem();

    expect(manifest.depends).toEqual(['base', 'organization', 'notification', 'workflow']);
    expect(await db('users').count({ count: '*' }).first()).toMatchObject({ count: 2 });
    expect(await db('project_stages').count({ count: '*' }).first()).toMatchObject({ count: 4 });
    expect(await db('project_projects').count({ count: '*' }).first()).toMatchObject({ count: 2 });
    expect(await db('project_milestones').count({ count: '*' }).first()).toMatchObject({
      count: 3,
    });
    expect(await db('project_tasks').count({ count: '*' }).first()).toMatchObject({ count: 6 });
    expect(await db('project_task_dependencies').count({ count: '*' }).first()).toMatchObject({
      count: 3,
    });

    const workflow = await WorkflowDefinition.query().findOne({ code: 'project.task_review' });
    expect(workflow?.name).toBe('Project task review');

    const allocated = await nextSequence('project.task');
    expect(allocated).toBe('TASK-0100');

    for (const model of manifest.models) {
      const resolved = resolveViews(model);
      expect(() => validateViews(model, resolved)).not.toThrow();
    }

    // Reinstall is idempotent and does not duplicate seeds.
    await installEcosystem();
    expect(await db('project_tasks').count({ count: '*' }).first()).toMatchObject({ count: 6 });
  });

  it('enforces company isolation, org department/team alignment, dates, and member ownership on projects', async () => {
    await installEcosystem();
    const secondCompany = await Company.query().insertAndFetch({ name: 'Second Company' });
    const secondDepartment = await OrganizationDepartment.query().insertAndFetch({
      company_id: secondCompany.id,
      code: 'eng',
      name: 'Engineering',
    });
    const operationsDepartment = await OrganizationDepartment.query()
      .findOne({ code: 'operations' })
      .throwIfNotFound();
    const boardTeam = await OrganizationTeam.query().findOne({ code: 'board' }).throwIfNotFound();
    const superadmin = await User.query().findOne({ login: 'superadmin' }).throwIfNotFound();
    const project = await Project.query().findOne({ code: 'platform-roadmap' }).throwIfNotFound();

    // Non-project model passes through unaffected.
    expect(await isValidProjectMutation('base.partner', {})).toBe(true);
    // Missing company fails.
    expect(await isValidProjectMutation(Project.modelName, { code: 'x', name: 'X' })).toBe(false);
    // Cross-company department fails.
    expect(
      await isValidProjectMutation(Project.modelName, {
        company_id: 1,
        department_id: secondDepartment.id,
        code: 'cross-dept',
        name: 'Cross Dept',
      })
    ).toBe(false);
    // Team from product department paired with operations department fails.
    expect(
      await isValidProjectMutation(Project.modelName, {
        company_id: 1,
        department_id: operationsDepartment.id,
        team_id: boardTeam.id,
        code: 'mismatch-team',
        name: 'Mismatch Team',
      })
    ).toBe(false);
    // Owner without membership in secondCompany fails.
    expect(
      await isValidProjectMutation(Project.modelName, {
        company_id: secondCompany.id,
        owner_id: superadmin.id,
        code: 'non-member-owner',
        name: 'Non Member Owner',
      })
    ).toBe(false);
    // Reversed or invalid dates fail.
    expect(
      await isValidProjectMutation(Project.modelName, {
        company_id: 1,
        code: 'bad-dates',
        name: 'Bad Dates',
        start_date: '2026-06-10',
        target_date: '2026-06-01',
      })
    ).toBe(false);
    expect(
      await isValidProjectMutation(Project.modelName, {
        company_id: 1,
        code: 'invalid-date',
        name: 'Invalid Date',
        start_date: '2026-02-30',
      })
    ).toBe(false);
    // Re-homing project with tasks across companies fails.
    expect(
      await isValidProjectMutation(
        Project.modelName,
        { company_id: secondCompany.id },
        project.toJSON()
      )
    ).toBe(false);
    // Valid project in secondCompany after adding membership succeeds.
    await CompanyMembership.query().insert({
      company_id: secondCompany.id,
      user_id: superadmin.id,
    });
    expect(
      await isValidProjectMutation(Project.modelName, {
        company_id: secondCompany.id,
        department_id: secondDepartment.id,
        owner_id: superadmin.id,
        code: 'valid-second',
        name: 'Valid Second',
        start_date: '2026-01-01',
        target_date: '2026-03-01',
      })
    ).toBe(true);
  });

  it('validates stage WIP limits, duplicate default stages, milestone ownership, and prevents moving referenced records', async () => {
    await installEcosystem();
    const secondCompany = await Company.query().insertAndFetch({ name: 'Second Company' });
    const project = await Project.query().findOne({ code: 'platform-roadmap' }).throwIfNotFound();
    const stage = await ProjectStage.query().findOne({ code: 'in_progress' }).throwIfNotFound();
    const milestone = await ProjectMilestone.query()
      .findOne({ code: 'rc1-release' })
      .throwIfNotFound();

    // Duplicate company-wide default stage code rejected.
    expect(
      await isValidProjectMutation(ProjectStage.modelName, {
        company_id: 1,
        code: 'backlog',
        name: 'Duplicate Backlog',
      })
    ).toBe(false);
    // Invalid WIP limit rejected.
    expect(
      await isValidProjectMutation(ProjectStage.modelName, {
        company_id: 1,
        code: 'qa',
        name: 'QA',
        wip_limit: 0,
      })
    ).toBe(false);
    // Moving stage with tasks across project rejected.
    expect(
      await isValidProjectMutation(
        ProjectStage.modelName,
        { company_id: 1, project_id: project.id },
        stage.toJSON()
      )
    ).toBe(false);
    // Moving milestone with tasks to another company rejected.
    expect(
      await isValidProjectMutation(
        ProjectMilestone.modelName,
        { company_id: secondCompany.id },
        milestone.toJSON()
      )
    ).toBe(false);
    // Valid custom stage and milestone succeed.
    expect(
      await isValidProjectMutation(ProjectStage.modelName, {
        company_id: 1,
        project_id: project.id,
        code: 'qa',
        name: 'QA',
        wip_limit: 3,
      })
    ).toBe(true);
    expect(
      await isValidProjectMutation(ProjectMilestone.modelName, {
        company_id: 1,
        project_id: project.id,
        code: 'ga-release',
        name: 'GA Release',
        due_date: '2026-12-31',
      })
    ).toBe(true);
  });

  it('prevents subtask cycles, blocking dependency cycles, cross-project links, and invalid estimates', async () => {
    await installEcosystem();
    const project = await Project.query().findOne({ code: 'platform-roadmap' }).throwIfNotFound();
    const stage = await ProjectStage.query().findOne({ code: 'backlog' }).throwIfNotFound();
    const secondProject = await Project.query().insertAndFetch({
      company_id: 1,
      code: 'other-project',
      name: 'Other Project',
    });
    const customStage = await ProjectStage.query().insertAndFetch({
      company_id: 1,
      project_id: secondProject.id,
      code: 'other-only',
      name: 'Other Only',
    });
    const task1 = await ProjectTask.query().findOne({ code: 'TASK-0001' }).throwIfNotFound();
    const task2 = await ProjectTask.query().findOne({ code: 'TASK-0002' }).throwIfNotFound();

    // Stage belonging to another project rejected.
    expect(
      await isValidProjectMutation(ProjectTask.modelName, {
        company_id: 1,
        project_id: project.id,
        stage_id: customStage.id,
        code: 'TASK-9001',
        title: 'Wrong Stage',
      })
    ).toBe(false);
    // Self-parent and ancestor-child subtask cycles rejected.
    expect(
      await isValidProjectMutation(ProjectTask.modelName, { parent_id: task1.id }, task1.toJSON())
    ).toBe(false);
    expect(
      await isValidProjectMutation(ProjectTask.modelName, { parent_id: task2.id }, task1.toJSON())
    ).toBe(false);
    // Negative estimate rejected.
    expect(
      await isValidProjectMutation(ProjectTask.modelName, {
        company_id: 1,
        project_id: project.id,
        stage_id: stage.id,
        code: 'TASK-9002',
        title: 'Negative Estimate',
        estimate_minutes: -15,
      })
    ).toBe(false);
    // Moving a task with subtasks/dependencies to another project rejected.
    expect(
      await isValidProjectMutation(
        ProjectTask.modelName,
        { project_id: secondProject.id },
        task1.toJSON()
      )
    ).toBe(false);

    // Self-dependency rejected.
    expect(
      await isValidProjectMutation(ProjectTaskDependency.modelName, {
        company_id: 1,
        task_id: task1.id,
        depends_on_id: task1.id,
        kind: 'blocks',
      })
    ).toBe(false);
    // Reverse blocking edge TASK-0001 -> TASK-0002 forms a cycle (since TASK-0002 already blocks on TASK-0001).
    expect(
      await isValidProjectMutation(ProjectTaskDependency.modelName, {
        company_id: 1,
        task_id: task1.id,
        depends_on_id: task2.id,
        kind: 'blocks',
      })
    ).toBe(false);
    // Non-blocking `relates_to` edge between tasks is allowed.
    expect(
      await isValidProjectMutation(ProjectTaskDependency.modelName, {
        company_id: 1,
        task_id: task1.id,
        depends_on_id: task2.id,
        kind: 'relates_to',
      })
    ).toBe(true);
  });

  it('synergizes cleanly with base.activity, base.tag_link, WorkContract source refs, and TaskOS mapping', async () => {
    await installEcosystem();
    const task = await ProjectTask.query().findOne({ code: 'TASK-0001' }).throwIfNotFound();
    const superadmin = await User.query().findOne({ login: 'superadmin' }).throwIfNotFound();

    const resource = toPolymorphicResource(ProjectTask.modelName, task.id);
    const activity = await Activity.query().insertAndFetch({
      summary: 'Review task progress',
      activity_type: 'todo',
      assigned_to_id: superadmin.id,
      ...resource,
    });
    expect(activity.resource_model).toBe('project.task');
    expect(activity.resource_id).toBe(task.id);

    const tag = await Tag.query().insertAndFetch({ name: 'ecosystem' });
    const link = await TagLink.query().insertAndFetch({
      tag_id: tag.id,
      ...resource,
    });
    expect(link.resource_model).toBe('project.task');

    expect(toWorkContractSource(task.id)).toEqual({
      source_model: 'project.task',
      source_id: task.id,
    });

    const mapped = mapTodoTaskToProjectTaskFields({
      code: 'TASK-0420',
      title: 'Sync local board with ORM project',
      summary: 'Keep local TaskOS and Board aligned.',
      priority: 'p1',
      status: 'doing',
      due_date: '2026-12-20',
    });
    expect(mapped).toEqual({
      code: 'TASK-0420',
      external_ref: 'TASK-0420',
      title: 'Sync local board with ORM project',
      description: 'Keep local TaskOS and Board aligned.',
      priority: 'high',
      status: 'in_progress',
      due_date: '2026-12-20',
    });

    const roundTrip = mapProjectTaskToTodoSnapshot({
      ...mapped,
      external_ref: mapped.external_ref,
    });
    expect(roundTrip).toEqual({
      code: 'TASK-0420',
      title: 'Sync local board with ORM project',
      summary: 'Keep local TaskOS and Board aligned.',
      priority: 'p1',
      status: 'doing',
      due_date: '2026-12-20',
    });

    const task2 = await ProjectTask.query().findOne({ code: 'TASK-0002' }).throwIfNotFound();
    const deps = await ProjectTaskDependency.query().where({ company_id: 1, active: true });
    const dag = buildProjectDependencyGraph([task.toJSON(), task2.toJSON()], deps);
    expect(dag.ready_task_ids).toContain(task.id);
    expect(dag.blocked_task_ids).toContain(task2.id);
    const blockedNode = dag.nodes.find((n) => n.id === task2.id);
    expect(blockedNode?.blocked_by_ids).toContain(task.id);
    expect(blockedNode?.is_ready).toBe(false);
  });
});
