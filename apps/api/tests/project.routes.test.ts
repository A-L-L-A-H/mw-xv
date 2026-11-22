import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import type { FastifyInstance } from 'fastify';
import { MemoryStorage, MoonWitnessClient, PermissionDeniedError } from '@moonwitness/client';
import { buildApp } from '../src/app.js';

const ADMIN_PASSWORD = 'project-test-password';

let lastAuthHeader = '';

function injectFetch(app: FastifyInstance): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = init?.headers as Record<string, string> | undefined;
    if (headers?.authorization) lastAuthHeader = headers.authorization;
    else if (headers?.Authorization) lastAuthHeader = headers.Authorization;
    const res = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url: url.pathname + url.search,
      headers,
      payload: init?.body as string | undefined,
    });
    return new Response(res.statusCode === 204 ? null : res.body, {
      status: res.statusCode,
      headers: res.headers as Record<string, string>,
    });
  }) as typeof fetch;
}

describe('project addon REST, SDK & workflow integration', () => {
  let db: Knex;
  let app: FastifyInstance;
  let client: MoonWitnessClient;

  beforeAll(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    Model.knex(db);
    process.env.NODE_ENV = 'test';
    app = await buildApp({
      db,
      superadminPassword: ADMIN_PASSWORD,
      jwtSecret: 'project-test-secret-project-test-secret-123',
      loginRateMax: 1000,
    });
    await app.ready();
    client = new MoonWitnessClient({
      baseUrl: 'http://api.test',
      fetch: injectFetch(app),
      storage: new MemoryStorage(),
    });
    await client.login({ login: 'superadmin', password: ADMIN_PASSWORD });
  }, 30000);

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  it('exposes seeded project models, Kanban views, and enforces acyclic dependencies via SDK & REST API', async () => {
    const models = await client.getModels();
    const modelNames = models.map((m) => m.model);
    expect(modelNames).toContain('project.project');
    expect(modelNames).toContain('project.task');
    expect(modelNames).toContain('project.milestone');
    expect(modelNames).toContain('project.stage');
    expect(modelNames).toContain('project.task_dependency');

    const taskModel = client.model<{ id: number; code: string; title: string }>('project.task');
    const views = await taskModel.getViews();
    expect(views.kanban?.groupBy).toBe('stage_id');

    const { records: tasks } = await taskModel.searchRead({ limit: 20 });
    const task1 = tasks.find((t) => t.code === 'TASK-0001');
    const task2 = tasks.find((t) => t.code === 'TASK-0002');
    expect(task1).toBeDefined();
    expect(task2).toBeDefined();

    const depModel = client.model<{
      id: number;
      company_id: number;
      task_id: number;
      depends_on_id: number;
      kind: 'blocks' | 'relates_to';
    }>('project.task_dependency');

    // Reverse `blocks` edge creates a cycle (TASK-0002 already depends on TASK-0001) -> rejected with 403.
    await expect(
      depModel.create({
        company_id: 1,
        task_id: task1!.id,
        depends_on_id: task2!.id,
        kind: 'blocks',
      })
    ).rejects.toThrow(PermissionDeniedError);

    // Non-blocking `relates_to` link succeeds.
    const created = await depModel.create({
      company_id: 1,
      task_id: task1!.id,
      depends_on_id: task2!.id,
      kind: 'relates_to',
    });
    expect(created.kind).toBe('relates_to');

    const projectModel = client.model<{ id: number; code: string }>('project.project');
    const { records: projects } = await projectModel.searchRead({ limit: 10 });
    const project = projects.find((item) => item.code === 'platform-roadmap');
    expect(project).toBeDefined();

    const boardRes = await client.request<{
      success: boolean;
      data: {
        dag: { blocked_task_ids: number[]; ready_task_ids: number[] };
      };
    }>(`/projects/${project!.id}/board`);
    expect(boardRes.success).toBe(true);
    expect(boardRes.data.dag.ready_task_ids).toContain(task1!.id);
    expect(boardRes.data.dag.blocked_task_ids).toContain(task2!.id);

    const syncRes = await client.request<{
      success: boolean;
      data: {
        imported: number;
        updated: number;
        snapshots: Array<{ code: string; priority: string; status: string }>;
      };
    }>(`/projects/${project!.id}/todo-sync`, {
      method: 'POST',
      body: {
        tasks: [
          {
            code: 'TASK-0777',
            title: 'TaskOS bi-directional sync probe',
            summary: 'Imported via /projects/:id/todo-sync',
            priority: 'p0',
            status: 'doing',
            due_date: '2026-12-25',
          },
        ],
      },
    });
    expect(syncRes.success).toBe(true);
    expect(syncRes.data.imported).toBe(1);
    const syncedSnapshot = syncRes.data.snapshots.find((s) => s.code === 'TASK-0777');
    expect(syncedSnapshot?.priority).toBe('p0');
    expect(syncedSnapshot?.status).toBe('doing');

    const wcFirst = await client.request<{
      success: boolean;
      created: boolean;
      data: { id: number; source_model: string; source_id: number; risk_tier: string };
    }>(`/projects/tasks/${task1!.id}/work-contract`, {
      method: 'POST',
      body: {},
    });
    expect(wcFirst.success).toBe(true);
    expect(wcFirst.created).toBe(true);
    expect(wcFirst.data.source_model).toBe('project.task');
    expect(wcFirst.data.source_id).toBe(task1!.id);

    const wcRepeat = await client.request<{
      success: boolean;
      created: boolean;
      data: { id: number };
    }>(`/projects/tasks/${task1!.id}/work-contract`, {
      method: 'POST',
      body: {},
    });
    expect(wcRepeat.created).toBe(false);
    expect(wcRepeat.data.id).toBe(wcFirst.data.id);

    // M13.05 Readiness Gate: task2 is blocked by TASK-0001 (not yet done) -> HTTP 409.
    const blockedRes = await app.inject({
      method: 'POST',
      url: `/projects/tasks/${task2!.id}/work-contract`,
      headers: {
        authorization: lastAuthHeader,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({}),
    });
    expect(blockedRes.statusCode).toBe(409);
    const blockedBody = blockedRes.json() as {
      success: boolean;
      code: string;
      error: string;
      blockers: Array<{ id: number; code: string; title: string; status: string }>;
    };
    expect(blockedBody.success).toBe(false);
    expect(blockedBody.code).toBe('TASK_NOT_READY');
    expect(blockedBody.blockers.some((b) => b.code === 'TASK-0001')).toBe(true);

    // Advance linked WorkContract to in_review -> task syncs to review stage/status.
    await db('ai_work_contracts').where({ id: wcFirst.data.id }).update({ status: 'in_review' });
    const syncReview = await client.request<{
      success: boolean;
      data: { task: { status: string }; advanced: boolean };
    }>(`/projects/tasks/${task1!.id}/work-contract/sync-stage`, { method: 'POST', body: {} });
    expect(syncReview.success).toBe(true);
    expect(syncReview.data.advanced).toBe(true);
    expect(syncReview.data.task.status).toBe('review');

    // Advance linked WorkContract to accepted -> task syncs to done stage/status.
    await db('ai_work_contracts').where({ id: wcFirst.data.id }).update({ status: 'accepted' });
    const syncDone = await client.request<{
      success: boolean;
      data: { task: { status: string }; advanced: boolean };
    }>(`/projects/tasks/${task1!.id}/work-contract/sync-stage`, { method: 'POST', body: {} });
    expect(syncDone.success).toBe(true);
    expect(syncDone.data.advanced).toBe(true);
    expect(syncDone.data.task.status).toBe('done');

    // Now that blocker TASK-0001 is done, task2 is ready and can create a WorkContract -> verify -> done.
    const wcTask2 = await client.request<{
      success: boolean;
      data: { id: number };
    }>(`/projects/tasks/${task2!.id}/work-contract`, { method: 'POST', body: {} });
    const otherUser = await db('users').whereNot({ login: 'superadmin' }).first();
    await db('ai_work_contracts')
      .where({ id: wcTask2.data.id })
      .update({ requested_by_id: otherUser.id });
    await client.request('/ai/artifacts', {
      method: 'POST',
      body: {
        work_contract_id: wcTask2.data.id,
        artifact_kind: 'evidence_bundle',
        content: 'task2-verified-evidence',
      },
    });
    const verifyRes = await client.request<{
      success: boolean;
      data: { status: string };
    }>(`/ai/work-contracts/${wcTask2.data.id}/verify`, { method: 'POST', body: {} });
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.data.status).toBe('accepted');
    const updatedTask2 = await db('project_tasks').where({ id: task2!.id }).first();
    expect(updatedTask2.status).toBe('done');
  });

  it('M13.05: enforces relates_to, inactive blocks, cancelled blockers, explicit task states, idempotency, and company isolation', async () => {
    const project = await db('project_projects').where({ company_id: 1, active: true }).first();
    const stage = await db('project_stages').where({ company_id: 1, active: true }).first();
    expect(project).toBeDefined();
    expect(stage).toBeDefined();

    const insertTask = async (
      companyId: number,
      projectId: number,
      stageId: number,
      code: string,
      status: string
    ): Promise<number> => {
      const [inserted] = await db('project_tasks').insert({
        company_id: companyId,
        project_id: projectId,
        stage_id: stageId,
        code,
        title: `Task ${code}`,
        priority: 'normal',
        status,
        position: 900,
        active: true,
      });
      return typeof inserted === 'object' && inserted !== null && 'id' in inserted
        ? Number((inserted as { id: number }).id)
        : Number(inserted);
    };

    const callCreateWc = (taskId: number) =>
      app.inject({
        method: 'POST',
        url: `/projects/tasks/${taskId}/work-contract`,
        headers: {
          authorization: lastAuthHeader,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({}),
      });

    const openBlockerId = await insertTask(
      1,
      project.id,
      stage.id,
      'TASK-M1305-OPEN',
      'in_progress'
    );
    const cancelledBlockerId = await insertTask(
      1,
      project.id,
      stage.id,
      'TASK-M1305-CANCELLED-BLK',
      'cancelled'
    );

    // 1. relates_to dependency on an open task does NOT block WorkContract creation.
    const relatesTargetId = await insertTask(
      1,
      project.id,
      stage.id,
      'TASK-M1305-RELATES',
      'backlog'
    );
    await db('project_task_dependencies').insert({
      company_id: 1,
      task_id: relatesTargetId,
      depends_on_id: openBlockerId,
      kind: 'relates_to',
      active: true,
    });
    const relatesRes = await callCreateWc(relatesTargetId);
    expect(relatesRes.statusCode).toBe(201);

    // Idempotency preserved even if the edge is later escalated to blocking `blocks`.
    await db('project_task_dependencies')
      .where({ task_id: relatesTargetId, depends_on_id: openBlockerId })
      .update({ kind: 'blocks' });
    const repeatAfterBlockRes = await callCreateWc(relatesTargetId);
    expect(repeatAfterBlockRes.statusCode).toBe(200);
    expect((repeatAfterBlockRes.json() as { created: boolean }).created).toBe(false);

    // 2. Inactive `blocks` edge does NOT block.
    const inactiveBlockTargetId = await insertTask(
      1,
      project.id,
      stage.id,
      'TASK-M1305-INACTIVE-BLK',
      'backlog'
    );
    await db('project_task_dependencies').insert({
      company_id: 1,
      task_id: inactiveBlockTargetId,
      depends_on_id: openBlockerId,
      kind: 'blocks',
      active: false,
    });
    const inactiveRes = await callCreateWc(inactiveBlockTargetId);
    expect(inactiveRes.statusCode).toBe(201);

    // 3. `blocks` edge whose blocker is `cancelled` is resolved -> 201.
    const cancelledBlockerTargetId = await insertTask(
      1,
      project.id,
      stage.id,
      'TASK-M1305-CAN-TGT',
      'backlog'
    );
    await db('project_task_dependencies').insert({
      company_id: 1,
      task_id: cancelledBlockerTargetId,
      depends_on_id: cancelledBlockerId,
      kind: 'blocks',
      active: true,
    });
    const cancelledBlockerRes = await callCreateWc(cancelledBlockerTargetId);
    expect(cancelledBlockerRes.statusCode).toBe(201);

    // 4. Explicit `blocked`, `done`, and `cancelled` task states are rejected with 409.
    for (const status of ['blocked', 'done', 'cancelled'] as const) {
      const id = await insertTask(
        1,
        project.id,
        stage.id,
        `TASK-M1305-${status.toUpperCase()}`,
        status
      );
      const res = await callCreateWc(id);
      expect(res.statusCode).toBe(409);
      const body = res.json() as { success: boolean; code: string; task_status: string };
      expect(body.success).toBe(false);
      expect(body.code).toBe('TASK_NOT_READY');
      expect(body.task_status).toBe(status);
    }

    // 5. Company isolation: another company's task is 404, and cross-company rows never leak.
    const [otherCompanyInsert] = await db('companies').insert({
      name: 'Isolation Corp M13.05',
      timezone: 'UTC',
      active: true,
    });
    const otherCompanyId =
      typeof otherCompanyInsert === 'object' &&
      otherCompanyInsert !== null &&
      'id' in otherCompanyInsert
        ? Number((otherCompanyInsert as { id: number }).id)
        : Number(otherCompanyInsert);
    const [otherProjectInsert] = await db('project_projects').insert({
      company_id: otherCompanyId,
      code: 'iso-m1305-proj',
      name: 'Isolation Project',
      status: 'active',
      active: true,
    });
    const otherProjectId =
      typeof otherProjectInsert === 'object' &&
      otherProjectInsert !== null &&
      'id' in otherProjectInsert
        ? Number((otherProjectInsert as { id: number }).id)
        : Number(otherProjectInsert);
    const otherTaskId = await insertTask(
      otherCompanyId,
      otherProjectId,
      stage.id,
      'TASK-OTHER-SECRET',
      'backlog'
    );
    await db('project_task_dependencies').insert({
      company_id: otherCompanyId,
      task_id: openBlockerId,
      depends_on_id: otherTaskId,
      kind: 'blocks',
      active: true,
    });

    const crossCompanyRes = await callCreateWc(otherTaskId);
    expect(crossCompanyRes.statusCode).toBe(404);

    // Company 2's injected dependency edge referencing Company 1 task must NOT block Company 1.
    const company1ReadyRes = await callCreateWc(openBlockerId);
    expect(company1ReadyRes.statusCode).toBe(201);
  });
});
