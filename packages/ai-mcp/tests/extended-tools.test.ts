import { describe, expect, it } from 'vitest';
import {
  AI_MCP_TOOLS,
  EXTENDED_MCP_TOOLS,
  computeMerkleEntryHash,
  createAiMcpServer,
  type MerkleAuditEntry,
} from '../src/index.js';

const AUTH = { companyId: 42, userId: 7 };

describe('Mega-Wave I.4: Extended MCP Tools (PaaS, AGI M15-M18, Desktop)', () => {
  it('registers all 8 extended tools in AI_MCP_TOOLS and tools/list without breaking existing tools', async () => {
    const server = createAiMcpServer();
    const response = await server.handleRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      AUTH
    );
    expect(response.error).toBeUndefined();
    const tools = (response.result?.tools as Array<{ name: string }>) ?? [];
    const names = new Set(tools.map((tool) => tool.name));

    for (const expected of EXTENDED_MCP_TOOLS) {
      expect(names.has(expected.name)).toBe(true);
    }
    expect(names.has('project.list_projects')).toBe(true);
    expect(names.has('ai.get_agent_registry')).toBe(true);
    expect(AI_MCP_TOOLS.length).toBeGreaterThanOrEqual(22);
  });

  it('handles paas.status, paas.backup_plan, and secret-redacted paas.logs_query', async () => {
    const server = createAiMcpServer({
      extendedToolProviders: {
        queryPaasLogs: () => [
          {
            timestamp: '2026-11-23T00:00:00Z',
            serviceId: 'mw-api-42',
            level: 'error',
            message:
              'Auth failed with Bearer eyJhbGciOiJIUzI1NiJ9.secret and api_key=supersecret123 sk-live99999999',
          },
        ],
      },
    });

    const statusRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'paas.status', arguments: {} },
      },
      AUTH
    );
    expect(statusRes.error).toBeUndefined();
    expect((statusRes.result?.summary as { healthy: number }).healthy).toBe(2);

    const backupRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'paas.backup_plan', arguments: {} },
      },
      AUTH
    );
    expect(backupRes.error).toBeUndefined();
    expect(backupRes.result?.allEncrypted).toBe(true);

    const logsRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'paas.logs_query', arguments: { serviceId: 'mw-api-42', limit: 10 } },
      },
      AUTH
    );
    expect(logsRes.error).toBeUndefined();
    const logs = logsRes.result?.logs as Array<{ message: string }>;
    expect(logs).toHaveLength(1);
    expect(logs[0].message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(logs[0].message).not.toContain('supersecret123');
    expect(logs[0].message).not.toContain('sk-live99999999');
    expect(logs[0].message).toContain('[REDACTED]');
  });

  it('verifies valid and tampered Merkle chains via agi.merkle_verify and enforces automatedPromotionAllowed=false', async () => {
    const server = createAiMcpServer();
    const h0 = computeMerkleEntryHash('GENESIS', 'event-0');
    const h1 = computeMerkleEntryHash(h0, 'event-1');
    const validChain: MerkleAuditEntry[] = [
      { index: 0, prevHash: 'GENESIS', payload: 'event-0', hash: h0 },
      { index: 1, prevHash: h0, payload: 'event-1', hash: h1 },
    ];

    const validRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'agi.merkle_verify', arguments: { entries: validChain } },
      },
      AUTH
    );
    expect(validRes.error).toBeUndefined();
    expect(validRes.result?.valid).toBe(true);
    expect(validRes.result?.rootHash).toBe(h1);
    expect(validRes.result?.automatedPromotionAllowed).toBe(false);

    const tamperedChain: MerkleAuditEntry[] = [
      validChain[0],
      { ...validChain[1], payload: 'tampered-event-1' },
    ];
    const invalidRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'agi.merkle_verify', arguments: { entries: tamperedChain } },
      },
      AUTH
    );
    expect(invalidRes.error).toBeUndefined();
    expect(invalidRes.result?.valid).toBe(false);
    expect(invalidRes.result?.brokenAtIndex).toBe(1);
    expect(invalidRes.result?.automatedPromotionAllowed).toBe(false);
  });

  it('enforces immutable automatedPromotionAllowed=false in agi.governance_status even if provider returns true', async () => {
    const server = createAiMcpServer({
      extendedToolProviders: {
        getAgiGovernanceStatus: () => ({
          automatedPromotionAllowed: true as unknown as false,
          pendingProposals: 3,
          merkleLedgerAnchored: true,
        }),
      },
    });

    const res = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'agi.governance_status', arguments: {} },
      },
      AUTH
    );
    expect(res.error).toBeUndefined();
    expect(res.result?.automatedPromotionAllowed).toBe(false);
    expect(res.result?.humanApprovalRequired).toBe(true);
    expect(res.result?.constitutionalMode).toBe('read_only_audit');
    expect(res.result?.pendingProposals).toBe(3);
  });

  it('handles pure-offline desktop.doctor, desktop.local_search, and idempotent secret-redacted desktop.quick_capture', async () => {
    const server = createAiMcpServer({
      extendedToolProviders: {
        searchDesktopLocal: (_companyId, { query }) => [
          {
            id: 'note-1',
            title: `Match for ${query}`,
            snippet: 'Local offline note with token=ghp_1234567890abcdef',
            path: '/notes/local.md',
            score: 0.95,
          },
        ],
      },
    });

    const doctorRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'desktop.doctor', arguments: {} },
      },
      AUTH
    );
    expect(doctorRes.error).toBeUndefined();
    expect(doctorRes.result?.offlineOnly).toBe(true);
    expect(doctorRes.result?.healthy).toBe(true);

    const searchRes = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'desktop.local_search', arguments: { query: 'offline' } },
      },
      AUTH
    );
    expect(searchRes.error).toBeUndefined();
    const hits = searchRes.result?.hits as Array<{ snippet: string }>;
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).not.toContain('ghp_1234567890abcdef');

    const cap1 = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'desktop.quick_capture',
          arguments: {
            title: 'Meeting Note',
            body: 'Remember password=topsecret',
            tags: ['ops'],
            idempotencyKey: 'cap-key-1',
          },
        },
      },
      AUTH
    );
    expect(cap1.error).toBeUndefined();
    expect(cap1.result?.created).toBe(true);
    expect(cap1.result?.offlineOnly).toBe(true);
    expect((cap1.result?.capture as { body: string }).body).not.toContain('topsecret');

    const cap2 = await server.handleRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'desktop.quick_capture',
          arguments: {
            title: 'Meeting Note',
            body: 'Remember password=topsecret',
            tags: ['ops'],
            idempotencyKey: 'cap-key-1',
          },
        },
      },
      AUTH
    );
    expect(cap2.error).toBeUndefined();
    expect(cap2.result?.created).toBe(false);
    expect(cap2.result?.idempotentReplay).toBe(true);
  });
});
