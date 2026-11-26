import { describe, expect, it } from 'vitest';
import {
  MoonWitnessMcpServer,
  MOONWITNESS_MCP_TOOLS,
  type MoonWitnessMcpRequest,
} from '../src/server.js';
import { serveMoonWitnessStdio } from '../src/stdio.js';
import { registerMoonWitnessManifest, listMoonWitnessModels } from '../src/catalog.js';
import { isForbiddenFieldName, redactRow } from '../src/query.js';
import { summarizeTaskos } from '../src/taskos.js';
import { probeApiHealth } from '../src/health.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function fakeManifest(name: string, modelNames: readonly string[]) {
  return {
    name,
    manifest: {
      name,
      version: '1.0.0',
      models: modelNames.map((modelName) => ({ modelName, fields: {} })),
    } as never,
  };
}

describe('MoonWitnessMcpServer protocol', () => {
  it('answers initialize with server info and protocol version', async () => {
    const server = new MoonWitnessMcpServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26' },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as { serverInfo: { name: string }; protocolVersion: string };
    expect(result.serverInfo.name).toBe('@moonwitness/mcp-moonwitness');
    expect(result.protocolVersion).toBe('2025-03-26');
  });

  it('answers ping with empty result', async () => {
    const server = new MoonWitnessMcpServer();
    const response = await server.handleRequest({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(response.result).toEqual({});
  });

  it('lists all nine read-only tools with R0 annotations', async () => {
    const server = new MoonWitnessMcpServer();
    const response = await server.handleRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = (
      response.result as {
        tools: Array<{ name: string; annotations: { readOnly: boolean; riskTier: string } }>;
      }
    ).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      'mw_list_models',
      'mw_describe_model',
      'mw_query',
      'mw_count',
      'mw_taskos_summary',
      'mw_api_health',
      'plan_status',
      'plan_recall',
      'plan_impact',
    ]);
    for (const tool of tools) {
      expect(tool.annotations.readOnly).toBe(true);
      expect(tool.annotations.riskTier).toBe('R0');
    }
  });

  it('returns -32601 for unknown methods and tools', async () => {
    const server = new MoonWitnessMcpServer();
    const badMethod = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/list',
    });
    expect(badMethod.error?.code).toBe(-32601);
    const badTool = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'mw_drop_database', arguments: {} },
    });
    expect(badTool.error?.code).toBe(-32601);
  });

  it('returns -32602 when mw_query lacks the model argument', async () => {
    const server = new MoonWitnessMcpServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'mw_query', arguments: {} },
    });
    expect(response.error?.code).toBe(-32602);
  });

  it('summarizes taskos through tools/call with real repo tasks.json', async () => {
    const server = new MoonWitnessMcpServer();
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'mw_taskos_summary', arguments: {} },
    });
    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0].text;
    const summary = JSON.parse(text) as { format: string; totalTasks: number };
    expect(summary.format).toBe('moonwitness-tasks/v2');
    expect(summary.totalTasks).toBe(715);
  });

  it('probes health against an unreachable port and reports ok:false without throwing', async () => {
    const server = new MoonWitnessMcpServer({ apiBaseUrl: 'http://127.0.0.1:1' });
    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'mw_api_health', arguments: { timeoutMs: 500 } },
    });
    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0].text;
    const health = JSON.parse(text) as { ok: boolean };
    expect(health.ok).toBe(false);
  });
});

describe('tool descriptor invariants', () => {
  it('declares every tool read-only, R0, idempotent, capability-gated', () => {
    expect(MOONWITNESS_MCP_TOOLS.length).toBeGreaterThanOrEqual(4);
    for (const tool of MOONWITNESS_MCP_TOOLS) {
      expect(tool.readOnly).toBe(true);
      expect(tool.riskTier).toBe('R0');
      expect(tool.idempotent).toBe(true);
      expect(tool.requiredCapability).toMatch(/^mw\./u);
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('catalog enumeration', () => {
  it('statically enumerates manifests without ORM registration', () => {
    registerMoonWitnessManifest(fakeManifest('fake-addon', ['fake.alpha', 'fake.beta']));
    const models = listMoonWitnessModels();
    const names = models
      .filter((entry) => entry.addonName === 'fake-addon')
      .map((entry) => entry.modelName);
    expect(names).toEqual(['fake.alpha', 'fake.beta']);
  });
});

describe('query redaction', () => {
  it('flags denylisted field names case-insensitively', () => {
    expect(isForbiddenFieldName('password_hash')).toBe(true);
    expect(isForbiddenFieldName('clientSecret')).toBe(true);
    expect(isForbiddenFieldName('api_token')).toBe(true);
    expect(isForbiddenFieldName('display_name')).toBe(false);
  });

  it('redacts secret-named keys from rows', () => {
    const row = {
      id: 1,
      name: 'x',
      password: 'hunter2',
      secret_key: 's',
      token: 't',
      label: 'keep',
    };
    expect(redactRow('fake.alpha', row)).toEqual({
      id: 1,
      name: 'x',
      label: 'keep',
    });
  });
});

describe('taskos summary', () => {
  it('reads the real repo tasks.json with expected shape', async () => {
    const summary = await summarizeTaskos(path.join(repoRoot, 'docs', 'tasks', 'tasks.json'));
    expect(summary.format).toBe('moonwitness-tasks/v2');
    expect(summary.schemaVersion).toBe('2.0.0');
    expect(summary.totalTasks).toBeGreaterThan(0);
    expect(summary.byStatus['done']).toBeGreaterThan(0);
    expect(summary.byProject['moonwitness']).toBeGreaterThan(0);
    expect(summary.byPriority['p1']).toBeGreaterThan(0);
    const statusTotal = Object.values(summary.byStatus).reduce((sum, count) => sum + count, 0);
    const projectTotal = Object.values(summary.byProject).reduce((sum, count) => sum + count, 0);
    const priorityTotal = Object.values(summary.byPriority).reduce((sum, count) => sum + count, 0);
    expect(statusTotal).toBe(summary.totalTasks);
    expect(projectTotal).toBe(summary.totalTasks);
    expect(priorityTotal).toBe(summary.totalTasks);
  });
});

describe('api health probe', () => {
  it('reports ok for a healthy stub server', async () => {
    const result = await probeApiHealth({
      baseUrl: 'http://127.0.0.1:1',
      timeoutMs: 300,
      fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it.each([
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000/health'],
    ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000/health'],
    ['http://127.0.0.1:3000///', 'http://127.0.0.1:3000/health'],
    ['http://127.0.0.1:3000/api//v1///', 'http://127.0.0.1:3000/api//v1/health'],
    ['/', '/health'],
    ['///', '/health'],
    ['', '/health'],
  ] as const)('trims all trailing slashes from base URL %j', async (baseUrl, expectedUrl) => {
    let requestedUrl: string | undefined;
    const result = await probeApiHealth({
      baseUrl,
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response('{}', { status: 200 });
      },
    });
    expect(result.ok).toBe(true);
    expect(requestedUrl).toBe(expectedUrl);
  });

  it('handles long slash runs without altering non-trailing characters', async () => {
    const slashRun = '/'.repeat(10_000);
    let requestedUrl: string | undefined;
    await probeApiHealth({
      baseUrl: `http://127.0.0.1:3000/api${slashRun}v1///`,
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response('{}', { status: 200 });
      },
    });
    expect(requestedUrl).toBe(`http://127.0.0.1:3000/api${slashRun}v1/health`);
  });
});

describe('stdio transport framing', () => {
  it('dispatches an NDJSON request through in-memory streams', async () => {
    const server = new MoonWitnessMcpServer();
    const chunks: Buffer[] = [];
    const input = new (await import('node:stream')).PassThrough();
    const output = new (await import('node:stream')).PassThrough();
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    const handle = serveMoonWitnessStdio(server, { input, output });
    const request: MoonWitnessMcpRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    input.write(`${JSON.stringify(request)}\n`);
    input.end();
    await handle.done;
    const text = Buffer.concat(chunks).toString('utf8');
    const response = JSON.parse(text.trim().split('\n')[0]) as { result: { tools: unknown[] } };
    expect(response.result.tools.length).toBe(MOONWITNESS_MCP_TOOLS.length);
  });
});
