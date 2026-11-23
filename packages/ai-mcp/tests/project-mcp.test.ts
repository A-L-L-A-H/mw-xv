import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AI_MCP_TOOLS, createAiMcpServer, handleAiMcpHttp, serveAiMcpStdio } from '../src/index.js';

interface MockDbTables {
  project_projects: Record<string, unknown>[];
  project_stages: Record<string, unknown>[];
  project_tasks: Record<string, unknown>[];
  project_task_dependencies: Record<string, unknown>[];
  audit_logs: Record<string, unknown>[];
}

function createMockKnex(initial?: Partial<MockDbTables>) {
  const tables: MockDbTables = {
    project_projects: initial?.project_projects ? [...initial.project_projects] : [],
    project_stages: initial?.project_stages ? [...initial.project_stages] : [],
    project_tasks: initial?.project_tasks ? [...initial.project_tasks] : [],
    project_task_dependencies: initial?.project_task_dependencies
      ? [...initial.project_task_dependencies]
      : [],
    audit_logs: initial?.audit_logs ? [...initial.audit_logs] : [],
  };

  let nextId = 1000;

  const knex = (tableName: string) => {
    const key = tableName as keyof MockDbTables;
    const rows = tables[key] ?? [];
    const filters: Record<string, unknown>[] = [];

    const matches = (row: Record<string, unknown>) =>
      filters.every((filter) => Object.entries(filter).every(([k, v]) => row[k] === v));

    const builder = {
      where(filter: Record<string, unknown>) {
        filters.push(filter);
        return builder;
      },
      async select() {
        return rows.filter(matches).map((r) => ({ ...r }));
      },
      async first() {
        const found = rows.find(matches);
        return found ? { ...found } : undefined;
      },
      async insert(values: Record<string, unknown>) {
        const id = typeof values.id === 'number' ? values.id : ++nextId;
        const record = { id, ...values };
        rows.push(record);
        return [id];
      },
      async update(values: Record<string, unknown>) {
        let count = 0;
        for (const row of rows) {
          if (matches(row)) {
            Object.assign(row, values);
            count++;
          }
        }
        return count;
      },
    };

    return builder;
  };

  return { knex, tables };
}

describe('@moonwitness/ai-mcp project tools & transports', () => {
  it('registers all 6 canonical project tools in AI_MCP_TOOLS with expected metadata', () => {
    const names = AI_MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'project.list_projects',
        'project.list_tasks',
        'project.next_task',
        'project.create_task',
        'project.move_task',
        'project.add_dependency',
      ])
    );

    const readTools = AI_MCP_TOOLS.filter((t) =>
      ['project.list_projects', 'project.list_tasks', 'project.next_task'].includes(t.name)
    );
    for (const t of readTools) {
      expect(t.riskTier).toBe('R0');
      expect(t.readOnly).toBe(true);
      expect(t.requiredCapability).toBe('project.read@v1');
    }

    const writeTools = AI_MCP_TOOLS.filter((t) =>
      ['project.create_task', 'project.move_task', 'project.add_dependency'].includes(t.name)
    );
    for (const t of writeTools) {
      expect(t.riskTier).toBe('R1');
      expect(t.readOnly).toBe(false);
      expect(t.requiredCapability).toBe('project.write@v1');
    }
  });

  it('lists projects, lists tasks with DAG readiness, and selects highest-priority ready next_task', async () => {
    const { knex } = createMockKnex({
      project_projects: [
        { id: 1, company_id: 1, code: 'alpha', name: 'Alpha', status: 'active' },
        { id: 2, company_id: 2, code: 'beta', name: 'Beta (other tenant)', status: 'active' },
      ],
      project_stages: [
        { id: 10, company_id: 1, project_id: 1, code: 'backlog', name: 'Backlog' },
        { id: 11, company_id: 1, project_id: 1, code: 'doing', name: 'Doing' },
      ],
      project_tasks: [
        {
          id: 101,
          company_id: 1,
          project_id: 1,
          stage_id: 10,
          code: 'T-101',
          title: 'Urgent but blocked',
          priority: 'urgent',
          status: 'backlog',
          position: 10,
        },
        {
          id: 102,
          company_id: 1,
          project_id: 1,
          stage_id: 10,
          code: 'T-102',
          title: 'High priority ready',
          priority: 'high',
          status: 'backlog',
          position: 20,
        },
        {
          id: 103,
          company_id: 1,
          project_id: 1,
          stage_id: 10,
          code: 'T-103',
          title: 'Normal priority ready',
          priority: 'normal',
          status: 'backlog',
          position: 5,
        },
        {
          id: 201,
          company_id: 2,
          project_id: 2,
          stage_id: 20,
          code: 'T-201',
          title: 'Other tenant task',
          priority: 'urgent',
          status: 'backlog',
          position: 1,
        },
      ],
      project_task_dependencies: [
        { id: 501, company_id: 1, task_id: 101, depends_on_id: 102, kind: 'blocks' },
      ],
    });

    const server = createAiMcpServer({ db: knex });
    const auth = { companyId: 1, userId: 7, grants: ['project.read@v1'] };

    // 1. project.list_projects — strictly tenant isolated
    const projectsRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'project.list_projects', arguments: {} },
      },
      auth
    );
    expect(projectsRes.error).toBeUndefined();
    expect(projectsRes.result?.projects).toHaveLength(1);
    expect((projectsRes.result?.projects as Record<string, unknown>[])[0]?.code).toBe('alpha');

    // 2. project.list_tasks with ready_only=true excludes blocked T-101 and other tenant T-201
    const readyTasksRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'project.list_tasks',
          arguments: { project_code: 'alpha', ready_only: true },
        },
      },
      auth
    );
    expect(readyTasksRes.error).toBeUndefined();
    const readyCodes = (readyTasksRes.result?.tasks as Record<string, unknown>[]).map(
      (t) => t.code
    );
    expect(readyCodes).toEqual(['T-102', 'T-103']);
    expect(readyTasksRes.result?.blocked_task_ids).toEqual([101]);

    // 3. project.next_task picks T-102 (high, ready) over T-101 (urgent, blocked) and T-103 (normal, ready)
    const nextRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'project.next_task', arguments: { project_id: 1 } },
      },
      auth
    );
    expect(nextRes.error).toBeUndefined();
    expect((nextRes.result?.task as Record<string, unknown>)?.code).toBe('T-102');
    expect(nextRes.result?.ready_count).toBe(2);
  });

  it('creates tasks idempotently, enforces blocker gate on move_task, and prevents cycles in add_dependency', async () => {
    const { knex, tables } = createMockKnex({
      project_projects: [
        { id: 1, company_id: 1, code: 'alpha', name: 'Alpha', status: 'active' },
        { id: 2, company_id: 2, code: 'other', name: 'Other', status: 'active' },
      ],
      project_stages: [
        { id: 10, company_id: 1, project_id: 1, code: 'backlog', name: 'Backlog' },
        { id: 11, company_id: 1, project_id: 1, code: 'doing', name: 'Doing' },
      ],
      project_tasks: [
        {
          id: 101,
          company_id: 1,
          project_id: 1,
          stage_id: 10,
          code: 'T-101',
          title: 'Blocker task',
          priority: 'high',
          status: 'backlog',
          position: 10,
        },
        {
          id: 102,
          company_id: 1,
          project_id: 1,
          stage_id: 10,
          code: 'T-102',
          title: 'Dependent task',
          priority: 'normal',
          status: 'backlog',
          position: 20,
        },
        {
          id: 201,
          company_id: 2,
          project_id: 2,
          stage_id: 20,
          code: 'T-201',
          title: 'Tenant 2 task',
          priority: 'normal',
          status: 'backlog',
          position: 10,
        },
      ],
    });

    const server = createAiMcpServer({ db: knex });
    const writeAuth = { companyId: 1, userId: 9, grants: ['project.write@v1', 'project.read@v1'] };

    // 1. project.create_task idempotency via external_ref / idempotency_key
    const create1 = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'project.create_task',
          arguments: {
            project_id: 1,
            title: 'Implement MCP stdio',
            code: 'T-103',
            idempotency_key: 'ext-103',
          },
        },
      },
      writeAuth
    );
    expect(create1.error).toBeUndefined();
    expect(create1.result?.created).toBe(true);

    const create2 = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'project.create_task',
          arguments: {
            project_id: 1,
            title: 'Implement MCP stdio',
            code: 'T-103',
            idempotency_key: 'ext-103',
          },
        },
      },
      writeAuth
    );
    expect(create2.error).toBeUndefined();
    expect(create2.result?.idempotent_replay).toBe(true);
    expect(tables.project_tasks.filter((t) => t.code === 'T-103')).toHaveLength(1);

    // 2. project.add_dependency: reject self-cycle
    const selfCycle = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'project.add_dependency',
          arguments: { task_id: 101, depends_on_id: 101 },
        },
      },
      writeAuth
    );
    expect(selfCycle.error?.code).toBe(-32602);

    // 3. project.add_dependency: reject cross-tenant dependency
    const crossTenantDep = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'project.add_dependency',
          arguments: { task_id: 102, depends_on_id: 201 },
        },
      },
      writeAuth
    );
    expect(crossTenantDep.error?.code).toBe(-32003);

    // 4. project.add_dependency: valid edge 102 depends_on 101
    const validDep = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'project.add_dependency',
          arguments: { task_id: 102, depends_on_id: 101, kind: 'blocks' },
        },
      },
      writeAuth
    );
    expect(validDep.error).toBeUndefined();
    expect(validDep.result?.created).toBe(true);

    // 5. project.add_dependency: reject DAG cycle 101 depends_on 102
    const dagCycle = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'project.add_dependency',
          arguments: { task_id: 101, depends_on_id: 102, kind: 'blocks' },
        },
      },
      writeAuth
    );
    expect(dagCycle.error?.code).toBe(-32009);

    // 6. project.move_task: reject moving blocked task 102 to in_progress without force
    const blockedMove = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'project.move_task',
          arguments: { task_id: 102, stage_id: 11, status: 'in_progress' },
        },
      },
      writeAuth
    );
    expect(blockedMove.error?.code).toBe(-32009);

    // 7. project.move_task: allow moving blocked task 102 to in_progress when force=true
    const forcedMove = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'project.move_task',
          arguments: { task_id: 102, stage_id: 11, status: 'in_progress', force: true },
        },
      },
      writeAuth
    );
    expect(forcedMove.error).toBeUndefined();
    expect((forcedMove.result?.task as Record<string, unknown>)?.status).toBe('in_progress');
    expect((forcedMove.result?.task as Record<string, unknown>)?.stage_id).toBe(11);

    // Audit logs recorded for write operations
    expect(tables.audit_logs.length).toBeGreaterThanOrEqual(3);
  });

  it('supports handleAiMcpHttp and serveAiMcpStdio (both NDJSON and Content-Length framing)', async () => {
    const server = createAiMcpServer();
    const auth = { companyId: 1, actorRole: 'user' };

    // HTTP helper: valid object, JSON string, and invalid JSON
    const httpOk = await handleAiMcpHttp(server, { jsonrpc: '2.0', id: 1, method: 'ping' }, auth);
    expect(httpOk.error).toBeUndefined();
    expect(httpOk.result).toEqual({});

    const httpStr = await handleAiMcpHttp(
      server,
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize' }),
      auth
    );
    expect(httpStr.error).toBeUndefined();
    expect(httpStr.result?.serverInfo).toBeDefined();

    const httpBad = await handleAiMcpHttp(server, '{bad json', auth);
    expect(httpBad.error?.code).toBe(-32700);

    // Stdio helper: NDJSON + Content-Length framing
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));

    const handle = serveAiMcpStdio(server, auth, { input, output });

    // Send NDJSON request
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'nd-1', method: 'ping' })}\n`);

    // Send Content-Length framed request
    const clBody = JSON.stringify({ jsonrpc: '2.0', id: 'cl-2', method: 'tools/list' });
    input.write(`Content-Length: ${Buffer.byteLength(clBody, 'utf8')}\r\n\r\n${clBody}`);

    input.end();
    await handle.done;

    const fullOut = Buffer.concat(chunks).toString('utf8');
    expect(fullOut).toContain('"id":"nd-1"');
    expect(fullOut).toContain('Content-Length:');
    expect(fullOut).toContain('"id":"cl-2"');
    expect(fullOut).toContain('project.list_projects');
  });
});
