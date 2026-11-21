import { describe, expect, it } from 'vitest';
import { EmergencyStopController } from '@moonwitness/ai-runtime';
import { createAiMcpServer } from '../src/index.js';

describe('@moonwitness/ai-mcp stateless MCP server adapter', () => {
  it('completes initialize handshake, lists tools, and reports health/shutdown cleanly', async () => {
    const server = createAiMcpServer();
    const healthBefore = await server.healthCheck();
    expect(healthBefore.ok).toBe(true);

    const init = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2026-07-28' },
    });
    expect(init.result?.protocolVersion).toBe('2026-07-28');

    const listed = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    expect(Array.isArray(listed.result?.tools)).toBe(true);
    expect((listed.result?.tools as unknown[]).length).toBeGreaterThanOrEqual(4);

    await server.close();
    const healthAfter = await server.healthCheck();
    expect(healthAfter.ok).toBe(false);
  });

  it('rejects unauthenticated requests, cross-company calls, A2A delegation, and injection payloads', async () => {
    const server = createAiMcpServer();

    const unauth = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ai.work_contract.read', arguments: {} },
      auth: null,
    });
    expect(unauth.error).toBeDefined();

    const crossCompany = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'ai.work_contract.read', arguments: { companyId: 2 } },
      },
      { companyId: 1, actorRole: 'user' }
    );
    expect(crossCompany.error).toBeDefined();

    const a2a = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'a2a.external_delegate', arguments: { targetUrl: 'https://evil.example' } },
      },
      { companyId: 1, actorRole: 'user' }
    );
    expect(a2a.error).toBeDefined();

    const traversal = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'ai.work_contract.read',
          arguments: { path: '../../.env', filter: '1; DROP TABLE users; --' },
        },
      },
      { companyId: 1, actorRole: 'user' }
    );
    expect(traversal.error).toBeDefined();
  });

  it('executes read tools, deduplicates idempotent write tool replays, and enforces emergency stop', async () => {
    const estop = new EmergencyStopController();
    const server = createAiMcpServer({ emergencyStopController: estop });

    const readRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'knowledge.search_approved', arguments: { query: 'governance' } },
      },
      { companyId: 1, actorRole: 'user' }
    );
    expect(readRes.error).toBeUndefined();
    expect(readRes.result?.source).toBe('orm-knowledge');

    const write1 = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'ai.submit_work_draft',
          arguments: { idempotencyKey: 'k-100', summary: 'Initial draft' },
        },
      },
      { companyId: 1, actorRole: 'user', grants: ['ai.draft.write@v1'] }
    );
    const write2 = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'ai.submit_work_draft',
          arguments: { idempotencyKey: 'k-100', summary: 'Initial draft' },
        },
      },
      { companyId: 1, actorRole: 'user', grants: ['ai.draft.write@v1'] }
    );
    expect(write1.result).toEqual(write2.result);

    const conflict = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'ai.submit_work_draft',
          arguments: { idempotencyKey: 'k-100', summary: 'Conflicting payload' },
        },
      },
      { companyId: 1, actorRole: 'user', grants: ['ai.draft.write@v1'] }
    );
    expect(conflict.error).toBeDefined();

    estop.activateStop({
      scope: 'company',
      targetId: 1,
      reason: 'Drill halt',
      activatedBy: 'op-1',
    });
    const blocked = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'ai.submit_work_draft',
          arguments: { idempotencyKey: 'k-101', summary: 'Blocked by estop' },
        },
      },
      { companyId: 1, actorRole: 'user', grants: ['ai.draft.write@v1'] }
    );
    expect(blocked.error).toBeDefined();
  });
});
