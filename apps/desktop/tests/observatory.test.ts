import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopObservatoryService } from '../src/observatory/service.js';
import { isBlockedProbeUrl, probeHttpTarget } from '../src/observatory/infra-collector.js';
import { collectPlans } from '../src/observatory/plan-collector.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Windows may hold transient directory handle briefly after child git process exits
      }
    }
  }
});

describe('DesktopObservatoryService & collectors', () => {
  it('parses .plan checklists and wave playbook details cleanly', async () => {
    const repoDir = createTempDir('mw-obs-plan-');
    mkdirSync(path.join(repoDir, '.plan', 'demo-plan'), { recursive: true });
    writeFileSync(
      path.join(repoDir, '.plan', 'demo-plan.md'),
      [
        '# Demo Autonomous Plan',
        '',
        '### Wave 1 — Foundations',
        '- [x] **M01** — Bootstrap config',
        '- [ ] **M02** — Wire runtime agent',
      ].join('\n'),
      'utf8'
    );
    writeFileSync(
      path.join(repoDir, '.plan', 'demo-plan', 'wave-1.md'),
      [
        '### [x] M01 — Bootstrap config',
        '- **Owner File(s):** `src/config.ts`',
        '- **Depends On:** None',
        '- **Exact Spec:** Load config safely.',
        '- **Acceptance Criteria:** Config loads with zero errors.',
        '- **Expected Output:** Exits 0.',
        '- **Verify:** `bun test`',
      ].join('\n'),
      'utf8'
    );

    const bundle = await collectPlans(repoDir);
    expect(bundle.defaultPlanId).toBe('demo-plan');
    expect(bundle.plans).toHaveLength(1);
    const plan = bundle.plans[0];
    expect(plan?.done).toBe(1);
    expect(plan?.total).toBe(2);
    expect(plan?.percent).toBe(50);
    expect(plan?.nextTaskId).toBe('M02');
    expect(plan?.tasks[0]?.ownerFiles).toContain('src/config.ts');
    expect(plan?.tasks[0]?.verify).toContain('bun test');
  });

  it('collects Antigravity, Claude Code, Codex, and redacts sensitive tokens while maintaining lazy polling', async () => {
    const repoDir = createTempDir('mw-obs-repo-');
    const homeDir = createTempDir('mw-obs-home-');

    // 1. Antigravity fixture with subagent + swarm + secret in command line
    const agConvDir = path.join(homeDir, '.gemini', 'antigravity', 'brain', 'conv-alpha-1234');
    mkdirSync(path.join(agConvDir, '.system_generated', 'logs'), { recursive: true });
    mkdirSync(path.join(agConvDir, '.system_generated', 'swarm'), { recursive: true });
    writeFileSync(
      path.join(agConvDir, '.system_generated', 'logs', 'transcript.jsonl'),
      [
        JSON.stringify({
          step_index: 0,
          type: 'USER_INPUT',
          created_at: new Date().toISOString(),
          content: '<USER_REQUEST>\nAudit desktop observatory\n</USER_REQUEST>',
        }),
        JSON.stringify({
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          model: 'gemini-4-hydrogen-high',
          input_tokens: 1200,
          cache_read_tokens: 400,
          output_tokens: 250,
          created_at: new Date().toISOString(),
          tool_calls: [
            {
              name: 'invoke_subagent',
              args: { Role: '"Code Auditor"', TypeName: '"research"', Model: '"flash"' },
            },
            {
              name: 'swarm',
              args: { action: '"add"', name: '"worker-1"', model: '"gemini-4-neon-low"' },
            },
            {
              name: 'run_command',
              args: {
                CommandLine:
                  '"curl -H Authorization: Bearer top_secret_jwt_123456 POSTGRES_PASSWORD=mysecretpass123"',
              },
            },
          ],
        }),
      ].join('\n'),
      'utf8'
    );
    writeFileSync(
      path.join(agConvDir, '.system_generated', 'swarm', 'plan.json'),
      JSON.stringify({
        goal: { title: 'Test Swarm', line: 'Verify workers' },
        tasks: { 'worker-1': 'Check collectors' },
        threads: [{ id: 't1', title: 'Wave 1', tasks: ['worker-1'] }],
      }),
      'utf8'
    );

    // 2. Claude Code fixture with custom-title + Agent subagent + subagents/*.jsonl
    const claudeProjDir = path.join(homeDir, '.claude', 'projects', 'Z--repo-mw-xv');
    mkdirSync(path.join(claudeProjDir, 'claude-sess-1', 'subagents'), { recursive: true });
    writeFileSync(
      path.join(claudeProjDir, 'claude-sess-1', 'custom-title.json'),
      JSON.stringify({ customTitle: 'Nightly E2E Audit' }),
      'utf8'
    );
    writeFileSync(
      path.join(claudeProjDir, 'claude-sess-1', 'subagents', 'agent-sub-a.jsonl'),
      '{}\n',
      'utf8'
    );
    writeFileSync(
      path.join(claudeProjDir, 'claude-sess-1.jsonl'),
      [
        JSON.stringify({
          type: 'assistant',
          cwd: repoDir,
          gitBranch: 'dev',
          timestamp: new Date().toISOString(),
          message: {
            model: 'claude-sonnet-test',
            usage: { input_tokens: 500, cache_read_input_tokens: 300, output_tokens: 120 },
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Agent',
                input: { description: 'Inspect routes', subagent_type: 'Explore' },
              },
            ],
          },
        }),
      ].join('\n'),
      'utf8'
    );

    // 3. Codex fixture with goal, tokens, and failed command execution
    const codexDayDir = path.join(homeDir, '.codex', 'sessions', '2026', '11', '25');
    mkdirSync(codexDayDir, { recursive: true });
    writeFileSync(
      path.join(codexDayDir, 'rollout-codex-1.jsonl'),
      [
        JSON.stringify({
          timestamp: new Date().toISOString(),
          ordinal: 0,
          type: 'session_meta',
          payload: {
            session_id: 'codex-1',
            cwd: repoDir,
            originator: 'Codex Desktop',
            git: { branch: 'dev' },
            base_instructions: { provenance: { model: 'gpt-6-luna' } },
          },
        }),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          ordinal: 1,
          type: 'event_msg',
          payload: {
            type: 'thread_goal_updated',
            goal: { objective: 'Verify visual tests', status: 'active' },
          },
        }),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          ordinal: 2,
          type: 'token_usage_record',
          payload: {
            thread_token_usage: {
              input_tokens: 4000,
              cached_input_tokens: 3500,
              output_tokens: 300,
              total_tokens: 4300,
            },
          },
        }),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          ordinal: 3,
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            item: {
              type: 'CommandExecution',
              command: ['pwsh', '-Command', 'bunx playwright test'],
              status: 'failed',
              exit_code: 1,
            },
          },
        }),
      ].join('\n'),
      'utf8'
    );

    const service = new DesktopObservatoryService({
      repoRoot: repoDir,
      homeDir,
      enableNetworkProbes: false,
      enableAntigravityApi: false,
      knownSecrets: ['mysecretpass123'],
    });

    // Lazy polling: inactive before any subscriber
    expect(service.isPollingActive()).toBe(false);

    const snap = await service.getSnapshot({ fresh: true });
    expect(snap.summary.totalSessions).toBe(3);
    expect(snap.summary.swarms).toBe(1);
    expect(snap.summary.subagents).toBeGreaterThanOrEqual(4);

    const agSession = snap.sessions.find((s) => s.runtime === 'antigravity');
    expect(agSession?.focus).not.toContain('top_secret_jwt_123456');
    expect(agSession?.focus).not.toContain('mysecretpass123');
    expect(agSession?.focus).toContain('[REDACTED]');

    const claudeSession = snap.sessions.find((s) => s.runtime === 'claude');
    expect(claudeSession?.title).toBe('Nightly E2E Audit');
    expect(claudeSession?.subagents.length).toBeGreaterThanOrEqual(2);

    const codexSession = snap.sessions.find((s) => s.runtime === 'codex');
    expect(codexSession?.title).toBe('Verify visual tests');
    expect(codexSession?.lastError).toContain('exit=1');

    const detail = await service.getSessionDetail('antigravity', 'conv-alpha-1234');
    expect(detail?.detail.events.length).toBeGreaterThanOrEqual(3);

    // Lazy polling activates on first subscribe and stops on last unsubscribe
    const unsub = service.subscribe(() => {});
    expect(service.isPollingActive()).toBe(true);
    expect(service.getSubscriberCount()).toBe(1);
    unsub();
    expect(service.isPollingActive()).toBe(false);
    expect(service.getSubscriberCount()).toBe(0);

    service.stop();
  });

  it('blocks link-local and cloud metadata URLs in VPS probe guard', async () => {
    expect(isBlockedProbeUrl('http://169.254.169.254/latest/meta-data')).toBe(true);
    expect(isBlockedProbeUrl('file:///etc/passwd')).toBe(true);
    expect(isBlockedProbeUrl('https://apps.moonwitness.biz.id/readyz')).toBe(false);

    const blocked = await probeHttpTarget({
      id: 'meta',
      label: 'Metadata SSRF',
      url: 'http://169.254.169.254/latest/meta-data',
    });
    expect(blocked.status).toBe('blocked');
  });
});
