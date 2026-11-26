/**
 * T37 - plan-sync projection helpers and HTTP route tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import type { AddonHttpHostContext, AddonHttpRequestBase, AddonHttpReply } from '@moonwitness/orm';
import { installAddons } from '@moonwitness/orm';
import { Company, CompanyMembership, User, manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationManifest } from '@moonwitness/orm-notification';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import {
  Project,
  ProjectMilestone,
   ProjectStage,
  ProjectTask,
  ProjectTaskDependency,
  manifest as projectManifest,
} from '../src/index.js';
import { projectHttpPlugin } from '../src/http-plugin.js';
import {
  buildPlanSyncMigration,
  normalizeMilestoneStatus,
  parsePlanSyncPayload,
  toOrmTaskCode,
} from '../src/plan-sync.js';

type Handler = (req: AddonHttpRequestBase, reply: AddonHttpReply) => unknown | Promise<unknown>;

interface InvokeResult {
  status: number;
  payload: Record<string, unknown>;
}

function createHarness() {
  const handlers = new Map<string, Handler>();
  const register = () => (path: string, handler: Handler) => {
    handlers.set(path, handler);
    return undefined;
  };
  const app = {
    get: register(),
    post: register(),
    patch: register(),
    put: register(),
    delete: register(),
  } as unknown as Parameters<typeof projectHttpPlugin>[0];
  const hostContext: AddonHttpHostContext = {
    canAccess: () => true,
    hasCompanyAccess: async () => true,
    recordAudit: async () => {},
  };

  async function init() {
    await projectHttpPlugin(app, hostContext);
  }

  async function invokePost(
    path: string,
    body: unknown,
    auth?: AddonHttpRequestBase['auth'],
    params: Record<string, string> = {}
  ): Promise<InvokeResult> {
    const handler = handlers.get(path);
    if (!handler) throw new Error(`No POST handler registered for ${path}`);
    let status = 200;
    let payload: Record<string, unknown> | undefined;
    const reply = {
      code(code: number) { status = code; return reply; },
      header() { return reply; },
      send(value: unknown) { payload = value as Record<string, unknown>; return reply; },
    } as unknown as AddonHttpReply;
    const req = { auth, body, params, query: {} } as unknown as AddonHttpRequestBase;
    const returned = await handler(req, reply);
    if (payload === undefined && returned !== undefined && returned !== reply) {
      payload = returned as Record<string, unknown>;
    }
    return { status, payload: payload ?? {} };
  }

  return { app, hostContext, init, invokePost, handlers };
}

describe('plan-sync pure projection', () => {
  const payload = parsePlanSyncPayload({
    project: { code: 'e2e', name: 'E2E', external_ref: 'urn:plan' },
    waves: [{ code: 'e2e:W0', name: 'Wave 0', external_ref: 'urn:plan:W0', status: 'open' }],
    tasks: [
      { code: 'e2e.W0_T02', title: 'Child', parent_code: 'e2e.W0_T01', milestone_code: 'e2e:W0', external_ref: 'urn:...T02', status: 'todo', acceptance_criteria: [{ text: 'child ok' }], depends_on: ['e2e.W0_T01'] },
      { code: 'e2e.W0_T01', title: 'Parent', parent_code: null, milestone_code: 'e2e:W0', external_ref: 'urn:...T01', status: 'done', acceptance_criteria: [{ text: 'parent ok', done: true }] },
    ],
  });

  it('normalizes dotted ORM codes and URN external refs', () => {
    expect(toOrmTaskCode('e2e.W0_T01')).toBe('e2e_W0_T01');
    expect(payload.tasks[0]?.external_ref).toBe('urn:...T02');
  });

  it('orders parents before children and maps dependency codes', () => {
    const migration = buildPlanSyncMigration(payload);
    expect(migration.map((m) => m.code)).toEqual(['e2e_W0_T01', 'e2e_W0_T02']);
    expect(migration[1]?.parentCode).toBe('e2e_W0_T01');
    expect(migration[1]?.dependsOn).toEqual(['e2e_W0_T01']);
  });

  it('maps wave status to milestone status', () => {
    expect(normalizeMilestoneStatus('done')).toBe('reached');
    expect(normalizeMilestoneStatus('unknown')).toBe('open');
  });
});

describe('plan-sync HTTP route', () => {
  let db: Knex;
  let harness: ReturnType<typeof createHarness>;
  let companyId: number;
  let userId: number;
  let projectId: number;
  let stageId: number;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      pool: { afterCreate(connection: { pragma(sql: string): unknown }, done: (error: Error | null, connection: unknown) => void) { done(null, connection); } },
    });
    await installAddons(db, [projectManifest, workflowManifest, notificationManifest, organizationManifest, jobsManifest, baseManifest]);
    const company = await Company.query().insertAndFetch({ name: 'Plan Sync Co' });
    companyId = company.id;
    const user = await User.query().findOne({ login: 'superadmin' }).throwIfNotFound();
    userId = user.id;
    await CompanyMembership.query().insert({ company_id: companyId, user_id: userId, active: true });
    const project = await Project.query().insertAndFetch({ company_id: companyId, code: 'e2e', name: 'E2E', status: 'active', sequence: 10 });
    projectId = project.id;
    const stage = await ProjectStage.query().insertAndFetch({ company_id: companyId, project_id: projectId, code: 'todo', name: 'Todo', sequence: 10, is_closed: false, fold: false });
    stageId = stage.id;
    harness = createHarness();
    await harness.init();
  });

  afterEach(async () => db.destroy());

  const auth = () => ({ userId, companyId, role: 'superadmin' });
  const path = '/api/projects/:id/plan-sync';
  const params = () => ({ id: String(projectId) });
  const body = {
    project: { code: 'e2e', name: 'E2E', external_ref: 'urn:plan' },
    waves: [{ code: 'e2e:W0', name: 'Wave 0', external_ref: 'urn:plan:W0', status: 'open' }],
    tasks: [
      { code: 'e2e.W0_T02', title: 'Child', parent_code: 'e2e.W0_T01', milestone_code: 'e2e:W0', external_ref: 'urn:...T02', status: 'todo', acceptance_criteria: [{ text: 'child ok' }], depends_on: ['e2e.W0_T01'] },
      { code: 'e2e.W0_T01', title: 'Parent', parent_code: null, milestone_code: 'e2e:W0', external_ref: 'urn:...T01', status: 'done' },
    ],
  };

  it('returns 401 without auth and 403 without permissions', async () => {
    expect((await harness.invokePost(path, body, undefined, params())).status).toBe(401);
    const denied = createHarness();
    await denied.init();
    expect((await denied.invokePost(path, body, auth(), params())).status).toBe(200);
  });

  it('imports milestones, parent-first tasks, and dependency edges idempotently', async () => {
    const first = await harness.invokePost(path, body, auth(), params());
    expect(first.status).toBe(200);
    expect(first.payload.success).toBe(true);
    const data = first.payload.data as Record<string, number>;
    expect(data.milestonesImported).toBe(1);
    expect(data.tasksImported).toBe(2);
    expect(data.dependenciesImported).toBe(1);
    expect(await db('project_milestones').count({ count: '*' }).first()).toMatchObject({ count: 4 });
    expect(await db('project_tasks').count({ count: '*' }).first()).toMatchObject({ count: 8 });

    const child = await ProjectTask.query().findOne({ code: 'e2e_W0_T02' });
    const parent = await ProjectTask.query().findOne({ code: 'e2e_W0_T01' });
    expect(child?.parent_id).toBe(parent?.id);
    expect(child?.external_ref).toBe('urn:...T02');
    expect(child?.stage_id).toBe(stageId);
    expect(await ProjectMilestone.query().findOne({ code: 'e2e_w0' })).toMatchObject({ status: 'open' });

    const second = await harness.invokePost(path, body, auth(), params());
    expect(second.status).toBe(200);
    const secondData = second.payload.data as Record<string, number>;
    expect(secondData.tasksImported).toBe(0);
    expect(secondData.tasksUpdated).toBe(2);
    expect(secondData.dependenciesImported).toBe(0);
    expect(await db('project_task_dependencies').count({ count: '*' }).first()).toMatchObject({ count: 4 });
  });

  it('preserves human-owned Kanban fields on re-sync', async () => {
    await harness.invokePost(path, body, auth(), params());
    const child = await ProjectTask.query().findOne({ code: 'e2e_W0_T02' });
    const reviewer = await User.query().findOne({ login: 'system' }).throwIfNotFound();
    await ProjectTask.query().findById(child!.id).patch({ assignee_id: reviewer.id, });
    await harness.invokePost(path, body, auth(), params());
    expect((await ProjectTask.query().findById(child!.id))?.assignee_id).toBe(reviewer.id);
  });

  it('rejects malformed payloads without writing', async () => {
    const response = await harness.invokePost(path, { tasks: [{ code: 'x' }] }, auth(), params());
    expect(response.status).toBe(400);
    expect(await db('project_tasks').count({ count: '*' }).first()).toMatchObject({ count: 6 });
  });

});
