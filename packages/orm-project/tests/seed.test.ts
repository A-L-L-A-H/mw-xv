import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { installAddons } from '@moonwitness/orm';
import { manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  buildProjectInitialSeed,
  manifest,
  seedProjectInitialData,
  PROJECT_SEED_ENUMS,
  PROJECT_SEED_VERSION,
  Project,
  ProjectMilestone,
  ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
  type ProjectInitialSeedBundle,
} from '../src/index.js';

function cloneBundle(value: ProjectInitialSeedBundle): ProjectInitialSeedBundle {
  return JSON.parse(JSON.stringify(value)) as ProjectInitialSeedBundle;
}

describe('@moonwitness/orm-project initial seed module', () => {
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
      baseManifest,
      manifest,
      workflowManifest,
      notificationManifest,
      organizationManifest,
      jobsManifest,
    ]);
  }

  it('builds a deterministic, schema-valid project seed bundle', () => {
    const first = buildProjectInitialSeed();
    const second = buildProjectInitialSeed();

    expect(first).toEqual(second);
    expect(first.version).toBe(PROJECT_SEED_VERSION);
    expect(first.company).toBeDefined();
    expect(first.company.externalId).toBe('base.company_default');
    expect(first.stages).toHaveLength(4);
    expect(first.projects).toHaveLength(2);
    expect(first.milestones).toHaveLength(3);
    expect(first.tasks).toHaveLength(6);
    expect(first.dependencies).toHaveLength(3);

    expect(new Set(first.stages.map((stage) => stage.code)).size).toBe(first.stages.length);
    expect(new Set(first.projects.map((project) => project.code)).size).toBe(first.projects.length);
    expect(new Set(first.milestones.map((milestone) => milestone.code)).size).toBe(
      first.milestones.length
    );
    expect(new Set(first.tasks.map((task) => task.code)).size).toBe(first.tasks.length);
    expect(new Set(first.dependencies.map((dependency) => dependency.externalId)).size).toBe(
      first.dependencies.length
    );

    const stageIds = new Set(first.stages.map((stage) => stage.externalId));
    const projectIds = new Set(first.projects.map((project) => project.externalId));
    const milestoneIds = new Set(first.milestones.map((milestone) => milestone.externalId));
    const taskIds = new Set(first.tasks.map((task) => task.externalId));

    for (const project of first.projects) {
      expect(project.code).toMatch(/^[a-z][a-z0-9-]{1,63}$/u);
      expect(PROJECT_SEED_ENUMS.projectStatuses).toContain(project.status);
      expect(project.startDate <= project.targetDate).toBe(true);
    }
    for (const milestone of first.milestones) {
      expect(projectIds.has(milestone.project.externalId)).toBe(true);
      expect(PROJECT_SEED_ENUMS.milestoneStatuses).toContain(milestone.status);
      expect(milestone.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
    for (const task of first.tasks) {
      expect(projectIds.has(task.project.externalId)).toBe(true);
      expect(stageIds.has(task.stage.externalId)).toBe(true);
      expect(milestoneIds.has(task.milestone.externalId)).toBe(true);
      if (task.parent) expect(taskIds.has(task.parent.externalId)).toBe(true);
      expect(PROJECT_SEED_ENUMS.taskPriorities).toContain(task.priority);
      expect(PROJECT_SEED_ENUMS.taskStatuses).toContain(task.status);
      expect(task.estimateMinutes).toBeGreaterThan(0);
      expect(task.position).toBeGreaterThan(0);
    }
    for (const dependency of first.dependencies) {
      expect(taskIds.has(dependency.task.externalId)).toBe(true);
      expect(taskIds.has(dependency.dependsOn.externalId)).toBe(true);
      expect(PROJECT_SEED_ENUMS.taskDependencyKinds).toContain(dependency.kind);
      expect(dependency.task.externalId).not.toBe(dependency.dependsOn.externalId);
    }
  });

  it('returns a mutable deep copy so callers cannot mutate subsequent bundles', () => {
    const untouched = cloneBundle(buildProjectInitialSeed());
    const mutable = buildProjectInitialSeed() as unknown as {
      stages: Array<{ code: string }>;
      tasks: Array<{ code: string; parent?: { externalId: string } }>;
    };
    mutable.stages[0].code = 'mutated';
    mutable.tasks[1].parent.externalId = 'mutated';

    expect(buildProjectInitialSeed()).toEqual(untouched);
  });

  it('seeds company-scoped projects, stages, milestones, tasks, and dependencies idempotently with foreign keys', async () => {
    await installEcosystem();

    const initialRun = await seedProjectInitialData(db);
    expect(initialRun).toMatchObject({
      insertedStages: 0,
      insertedProjects: 0,
      insertedMilestones: 0,
      insertedTasks: 0,
      insertedDependencies: 0,
      stagesTotal: 4,
      projectsTotal: 2,
      milestonesTotal: 3,
      tasksTotal: 6,
      dependenciesTotal: 3,
    });

    const secondRun = await seedProjectInitialData(db);
    expect(secondRun).toMatchObject({
      insertedStages: 0,
      insertedProjects: 0,
      insertedMilestones: 0,
      insertedTasks: 0,
      insertedDependencies: 0,
      stagesTotal: 4,
      projectsTotal: 2,
      milestonesTotal: 3,
      tasksTotal: 6,
      dependenciesTotal: 3,
    });

    const companyRecord = await db('_orm_data')
      .where({ id: 'base.company_default', model: 'base.company' })
      .first('record_id');
    const companyId = Number(companyRecord?.record_id);
    const stages = await db(ProjectStage.tableName).where({ company_id: companyId });
    const projects = await db(Project.tableName).where({ company_id: companyId });
    const milestones = await db(ProjectMilestone.tableName).where({ company_id: companyId });
    const tasks = await db(ProjectTask.tableName).where({ company_id: companyId });
    const dependencies = await db(ProjectTaskDependency.tableName).where({ company_id: companyId });
    expect(stages).toHaveLength(4);
    expect(projects).toHaveLength(2);
    expect(milestones).toHaveLength(3);
    expect(tasks).toHaveLength(6);
    expect(dependencies).toHaveLength(3);

    const externalIds = await db('_orm_data')
      .whereIn('model', [
        Project.modelName,
        ProjectStage.modelName,
        ProjectMilestone.modelName,
        ProjectTask.modelName,
        ProjectTaskDependency.modelName,
      ])
      .pluck('id');
    const bundle = buildProjectInitialSeed();
    expect(new Set(externalIds)).toEqual(
      new Set([
        ...bundle.stages.map((stage) => stage.externalId),
        ...bundle.projects.map((project) => project.externalId),
        ...bundle.milestones.map((milestone) => milestone.externalId),
        ...bundle.tasks.map((task) => task.externalId),
        ...bundle.dependencies.map((dependency) => dependency.externalId),
      ])
    );

    const taskByCode = new Map(tasks.map((task) => [task.code, task]));
    expect(taskByCode.get('TASK-0002')?.parent_id).toBe(taskByCode.get('TASK-0001')?.id);
    expect(dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: taskByCode.get('TASK-0002')?.id,
          depends_on_id: taskByCode.get('TASK-0001')?.id,
          kind: 'blocks',
        }),
      ])
    );
  });
});
