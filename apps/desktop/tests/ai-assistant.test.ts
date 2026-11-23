import { describe, expect, it, vi } from 'vitest';
import {
  dispatchTaskAgentRun,
  runWorkspaceAssistant,
} from '../src/ai-assistant.js';
import { DesktopRiskGate } from '../src/risk-gate.js';
import type { DesktopActionAuthContext, GitWorktreeLease } from '../src/types.js';
import type { WorktreeSandbox } from '../src/worktree-sandbox.js';

function createAuthContext(
  overrides?: Partial<DesktopActionAuthContext['grant']>
): DesktopActionAuthContext {
  return {
    companyId: 1,
    agentId: 7,
    workContractId: 42,
    expectedPolicyVersion: 1,
    dataClassification: 'local_only',
    grant: {
      grantId: 'grant-dx-01',
      companyId: 1,
      agentId: 7,
      workContractId: 42,
      capability: 'worktree.create@v1',
      policyVersion: 1,
      allowedRiskTier: 'R1',
      allowedClassification: 'local_only',
      maxCallsPerRun: 10,
      expiresAt: '2099-01-01T00:00:00.000Z',
      status: 'active',
      ...overrides,
    },
  };
}

describe('ai-assistant', () => {
  it('queries local loopback Ollama /api/chat in workspace mode with R0 read-only guarantee', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toBe('http://127.0.0.1:11434/api/chat');
      return new Response(
        JSON.stringify({
          message: {
            role: 'assistant',
            content: '- Sprint tasks are 2/3 complete\n- Focus on onboarding checklist next',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const result = await runWorkspaceAssistant({
      mode: 'workspace',
      action: 'summarize_tasks',
      prompt: 'Summarize my open tasks',
      endpoint: 'http://127.0.0.1:11434/api/tags',
      providerKind: 'ollama',
      model: 'llama3.2:3b',
      tasks: [
        { id: 't1', code: 'TASK-1', title: 'Finalize Q3 roadmap', status: 'in_progress' },
        { id: 't2', code: 'TASK-2', title: 'Prepare onboarding checklist', status: 'todo' },
      ],
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.riskTier).toBe('R0');
    expect(result.readOnly).toBe(true);
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3.2:3b');
    expect(result.reply).toContain('Sprint tasks');
    expect(result.highlights.length).toBe(2);
    expect(result.citations.length).toBe(2);
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('queries local loopback OpenAI-compatible /v1/chat/completions endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toBe('http://127.0.0.1:1234/v1/chat/completions');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '# Weekly Sync\n\n- Confirm launch date',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const result = await runWorkspaceAssistant({
      mode: 'developer',
      action: 'draft_note',
      prompt: 'Draft weekly sync note',
      endpoint: 'http://127.0.0.1:1234/v1/models',
      providerKind: 'lmstudio',
      model: 'qwen2.5-7b-instruct',
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('openai_compat');
    expect(result.riskTier).toBe('R0');
    expect(result.readOnly).toBe(true);
    expect(result.reply).toContain('# Weekly Sync');
  });

  it('rejects non-loopback endpoints without making network calls and falls back deterministically', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const result = await runWorkspaceAssistant({
      mode: 'workspace',
      action: 'summarize_tasks',
      prompt: 'Summarize tasks',
      endpoint: 'https://api.example.com/v1/chat/completions',
      providerKind: 'vllm',
      tasks: [{ id: 't1', code: 'MW-10', title: 'Review budget', status: 'todo' }],
      fetchImpl: fetchMock,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.provider).toBe('offline_fallback');
    expect(result.fallbackReason).toContain('Non-loopback');
    expect(result.reply).toContain('Offline summary for 1 task(s)');
    expect(result.riskTier).toBe('R0');
    expect(result.readOnly).toBe(true);
  });

  it('falls back deterministically offline when no local LLM is reachable', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await runWorkspaceAssistant({
      mode: 'workspace',
      action: 'search_knowledge',
      prompt: 'onboarding policy',
      knowledge: [
        {
          id: 'k1',
          title: 'Employee Onboarding Policy',
          excerpt: 'All new hires complete security and workspace setup in week one.',
        },
        {
          id: 'k2',
          title: 'Travel Expense Guide',
          excerpt: 'Submit receipts within 14 days.',
        },
      ],
      fetchImpl: fetchMock,
    });

    expect(result.provider).toBe('offline_fallback');
    expect(result.riskTier).toBe('R0');
    expect(result.readOnly).toBe(true);
    expect(result.reply).toContain('Found 1 matching knowledge item(s)');
    expect(result.highlights[0]).toContain('Employee Onboarding Policy');
  });

  it('denies task agent dispatch in workspace mode (R0 read-only guarantee)', async () => {
    const acquireSpy = vi.fn();
    const fakeSandbox = { acquire: acquireSpy } as unknown as WorktreeSandbox;

    const result = await dispatchTaskAgentRun({
      mode: 'workspace',
      taskId: 'task-101',
      code: 'MW-101',
      title: 'Refactor auth middleware',
      description: 'Update session cookie flags',
      auth: createAuthContext(),
      sandbox: fakeSandbox,
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('denied');
    expect(result.reasonCode).toBe('WORKSPACE_MODE_READ_ONLY');
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('returns deterministic packet preview and proof-gate checklist in DX mode when sandbox is not acquired', async () => {
    const gate = new DesktopRiskGate();

    const first = await dispatchTaskAgentRun({
      mode: 'developer',
      taskId: 'task-202',
      code: 'MW-202',
      title: 'Add health check endpoint',
      description: 'Expose /healthz on local server',
      model: 'qwen2.5-coder:7b',
      allowedPaths: ['apps/desktop/src'],
      verificationCommands: ['pnpm --filter @moonwitness/desktop build'],
      auth: createAuthContext(),
      riskGate: gate,
      acquireWorktree: false,
    });

    const second = await dispatchTaskAgentRun({
      mode: 'developer',
      taskId: 'task-202',
      code: 'MW-202',
      title: 'Add health check endpoint',
      description: 'Expose /healthz on local server',
      model: 'qwen2.5-coder:7b',
      allowedPaths: ['apps/desktop/src'],
      verificationCommands: ['pnpm --filter @moonwitness/desktop build'],
      auth: createAuthContext(),
      riskGate: new DesktopRiskGate(),
      acquireWorktree: false,
    });

    expect(first.allowed).toBe(true);
    expect(first.status).toBe('preview');
    expect(first.digest).toBe(second.digest);
    expect(first.proofGateChecklist.some((item) => item.id === 'risk-gate' && item.status === 'passed')).toBe(
      true
    );
  });

  it('dispatches task agent run and acquires isolated worktree in DX mode', async () => {
    const fakeLease: GitWorktreeLease = {
      leaseId: 'lease-1',
      runId: 'task-MW-303',
      branchName: 'mw/run-task-MW-303-1',
      worktreePath: 'z:/repo/mw-xv/.mw-worktrees/run-task-MW-303',
      baseRef: 'HEAD',
      headCommit: 'abc1234',
      fencingToken: 1,
      status: 'active',
      createdAt: '2026-11-23T00:00:00.000Z',
      allowedPaths: ['apps/desktop/src'],
    };
    const acquireSpy = vi.fn(async () => fakeLease);
    const fakeSandbox = { acquire: acquireSpy } as unknown as WorktreeSandbox;

    const result = await dispatchTaskAgentRun({
      mode: 'developer',
      taskId: 'task-303',
      code: 'MW-303',
      title: 'Implement offline queue retry',
      description: 'Add exponential backoff for sync queue',
      allowedPaths: ['apps/desktop/src'],
      auth: createAuthContext(),
      riskGate: new DesktopRiskGate(),
      sandbox: fakeSandbox,
    });

    expect(result.allowed).toBe(true);
    expect(result.status).toBe('dispatched');
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(result.worktreeLease?.branchName).toBe('mw/run-task-MW-303-1');
    expect(
      result.proofGateChecklist.some(
        (item) => item.id === 'worktree-isolation' && item.status === 'passed'
      )
    ).toBe(true);
  });

  it('denies DX task agent dispatch when DesktopRiskGate rejects insufficient grant tier', async () => {
    const acquireSpy = vi.fn();
    const fakeSandbox = { acquire: acquireSpy } as unknown as WorktreeSandbox;

    const result = await dispatchTaskAgentRun({
      mode: 'developer',
      taskId: 'task-404',
      code: 'MW-404',
      title: 'Modify build pipeline',
      description: 'Requires R1 worktree grant',
      auth: createAuthContext({ allowedRiskTier: 'R0' }),
      riskGate: new DesktopRiskGate(),
      sandbox: fakeSandbox,
    });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe('denied');
    expect(result.decision?.allowed).toBe(false);
    expect(acquireSpy).not.toHaveBeenCalled();
  });
});
