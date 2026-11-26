/**
 * T41 — read-only Plan-TaskOS Brain tools over the MCP JSON-RPC surface.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MoonWitnessMcpServer,
  MOONWITNESS_MCP_TOOLS,
  type MoonWitnessMcpContext,
} from '../src/server.js';
import {
  readPlanImpact,
  readPlanRecall,
  readPlanStatus,
  type PlanBrainContext,
} from '../src/plan-brain.js';

const SDK_PATH = path.resolve('../../packages/plan-taskos/dist/index.js');
const PLAN_ID = 'mcp-brain-demo';
const TASK_URN = `urn:mw:work:demo:demo:${PLAN_ID}:W1/${PLAN_ID}.W1_T01`;

interface Fixture {
  readonly root: string;
  readonly context: PlanBrainContext;
  readonly sdk: Record<string, unknown>;
  close(): Promise<void>;
}

async function createFixture(): Promise<Fixture> {
  const sdk = (await import(pathToFileURL(SDK_PATH).href)) as Record<string, any>;
  const root = await mkdtemp(path.join(os.tmpdir(), 'mw-mcp-brain-'));
  const planDir = path.join(root, '.plan', PLAN_ID);
  await mkdir(path.join(planDir, 'waves'), { recursive: true });
  const manifest = {
    schema_version: '1.0.0',
    plan_id: PLAN_ID,
    title: 'MCP Brain Demo',
    repo: { org: 'demo', name: 'demo', target_branch: 'dev' },
    adr_file: `.plan/${PLAN_ID}/ADR.md`,
    execution_policy: {
      max_attempts_per_task: 3,
      default_model_tier: 'flash',
      escalation_chain: ['flash'],
      require_clean_scope: true,
      auto_commit: true,
    },
    projections: {
      github_fold_mode: 'task',
      taskos_project: 'demo',
      orm_project_code: 'demo',
    },
    waves: [{ id: `${PLAN_ID}:W1`, title: 'Wave 1', wave_file: 'waves/w1.json', depends_on: [] }],
    documents: [],
  };
  const task = {
    urn: TASK_URN,
    code: `${PLAN_ID}.W1_T01`,
    kind: 'task',
    title: 'Implement MCP demo',
    lifecycle: { status: 'todo', delivery_stage: 'local', attempts: 0, model_tier: 'flash' },
    governance: { owner_files: ['src/demo.ts'], owner_globs: [], invariants: [] },
    graph: { depends_on: [] },
    verification: { commands: [{ cmd: 'bun test' }], acceptance_criteria: ['AC1'] },
    knowledge: { spec_files: [], adr_files: [] },
    projections: { taskos_code: `${PLAN_ID}.W1_T01` },
  };
  await writeFile(path.join(planDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  await writeFile(
    path.join(planDir, 'waves', 'w1.json'),
    JSON.stringify({
      schema_version: '1.0.0',
      plan_id: PLAN_ID,
      wave_id: `${PLAN_ID}:W1`,
      title: 'Wave 1',
      tasks: [task],
    }),
    'utf8'
  );

  const dbPath = path.join(root, '.plan', '.brain', 'taskos.sqlite');
  const seed = await sdk.openBrainStore({ dbPath, mode: 'sqlite' });
  try {
    sdk.initializeBrainSchema(seed);
    await sdk.reindexBrainFromRepo(seed, root);
    seed.run(
      `INSERT INTO proof_ledger (envelope_sha256, task_urn, task_code, plan_id, wave_id, verify_exit_code, merkle_root)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      'c'.repeat(64),
      TASK_URN,
      task.code,
      PLAN_ID,
      `${PLAN_ID}:W1`,
      'd'.repeat(64)
    );
    seed.run(
      `INSERT INTO leases (lease_id, task_urn, agent_runtime, session_id, model_tier, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'mcp-lease-1',
      TASK_URN,
      'claude',
      'mcp-session-1',
      'flash',
      '2099-01-01T00:00:00.000Z'
    );
  } finally {
    seed.close();
  }

  const context: PlanBrainContext = {
    repoRoot: root,
    discover: async () => sdk.discoverPlans(root),
  };
  return {
    root,
    context,
    sdk,
    close: async () => rm(root, { recursive: true, force: true }),
  };
}

function textPayload(response: { result?: unknown; error?: unknown }): Record<string, unknown> {
  expect(response.error).toBeUndefined();
  const result = response.result as { content: Array<{ text: string }> };
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('Plan-TaskOS read-only Brain tools', () => {
  let fixture: Fixture;
  let server: MoonWitnessMcpServer;
  let context: MoonWitnessMcpContext;

  beforeEach(async () => {
    fixture = await createFixture();
    context = { brain: fixture.context };
    server = new MoonWitnessMcpServer(context);
  });

  afterEach(async () => fixture.close());

  it('exposes exactly three new R0 read-only tools', () => {
    const names = MOONWITNESS_MCP_TOOLS.map((tool) => tool.name);
    expect(names.slice(-3)).toEqual(['plan_status', 'plan_recall', 'plan_impact']);
    for (const tool of MOONWITNESS_MCP_TOOLS.slice(-3)) {
      expect(tool.readOnly).toBe(true);
      expect(tool.riskTier).toBe('R0');
      expect(tool.idempotent).toBe(true);
    }
  });

  it('plan_status returns DAG progress, critical path, Merkle root, and active leases', async () => {
    const payload = textPayload(
      await server.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'plan_status', arguments: {} },
      })
    );
    expect(payload.brainAvailable).toBe(true);
    const plans = payload.plans as Array<Record<string, unknown>>;
    const plan = plans.find((entry) => entry.id === PLAN_ID);
    expect(plan).toBeDefined();
    expect(plan?.totalTasks).toBe(1);
    expect(plan?.doneTasks).toBe(0);
    expect(plan?.merkleRoot).toBe('c'.repeat(64));
    expect(plan?.criticalPath).toEqual([`${PLAN_ID}.W1_T01`]);
    const leases = payload.activeLeases as Array<Record<string, unknown>>;
    expect(leases.some((lease) => lease.taskUrn === TASK_URN)).toBe(true);
  });

  it('plan_recall searches FTS5 with redacted snippets', async () => {
    const payload = textPayload(
      await server.handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'plan_recall', arguments: { query: 'MCP demo' } },
      })
    );
    expect(payload.mode).toBe('lexical_only');
    const results = payload.results as Array<Record<string, unknown>>;
    expect(results.some((row) => row.urn === TASK_URN)).toBe(true);
    expect(results.every((row) => typeof row.snippet === 'string')).toBe(true);
  });

  it('plan_impact returns the two-hop blast radius for a task URN', async () => {
    const payload = textPayload(
      await server.handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'plan_impact', arguments: { target: TASK_URN } },
      })
    );
    expect(payload.target).toBe(TASK_URN);
    const tasks = payload.impactedTasks as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.code).toBe(`${PLAN_ID}.W1_T01`);
  });

  it('rejects missing required arguments without touching the Brain', async () => {
    const recall = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'plan_recall', arguments: {} },
    });
    expect(recall.error?.code).toBe(-32602);
    const impact = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'plan_impact', arguments: {} },
    });
    expect(impact.error?.code).toBe(-32602);
  });

  it('returns empty results when no Brain DB is present', async () => {
    const missing: PlanBrainContext = {
      repoRoot: fixture.root,
      dbPath: path.join(fixture.root, '.plan', '.brain', 'missing.sqlite'),
      discover: fixture.context.discover,
    };
    const status = await readPlanStatus(missing);
    expect(status.brainAvailable).toBe(false);
    const recall = await readPlanRecall('MCP demo', missing);
    expect(recall.results).toEqual([]);
    const impact = await readPlanImpact(TASK_URN, missing);
    expect(impact.impactedTasks).toEqual([]);
  });
});
