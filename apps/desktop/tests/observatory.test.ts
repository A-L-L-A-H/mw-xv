import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFlowGraph,
  computeAnalytics,
  formatSnapshotMarkdown,
} from '../src/observatory/analytics.js';
import { DesktopObservatoryService } from '../src/observatory/service.js';
import {
  isBlockedProbeUrl,
  parseProbeUrl,
  probeHttpTarget,
  readGitCommitDetail,
} from '../src/observatory/infra-collector.js';
import {
  buildPlanDag,
  collectPlans,
  extractTaskDependencies,
} from '../src/observatory/plan-collector.js';

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

describe('DesktopObservatoryService & v3 collectors', () => {
  it('parses .plan checklists, wave playbook details, dependency ranges, and builds Boss Critical Path DAG', async () => {
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
        '- [ ] **M03** — Build telemetry HUD',
        '- [ ] **M04** — Verify release bundle',
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
        '',
        '### [ ] M02 — Wire runtime agent',
        '- **Owner File(s):** `src/agent-runner.ts`',
        '- **Depends On:** M01',
        '',
        '### [ ] M03 — Build telemetry HUD',
        '- **Owner File(s):** `src/hud.tsx`',
        '- **Depends On:** M01-M02',
        '',
        '### [ ] M04 — Verify release bundle',
        '- **Owner File(s):** `src/release.ts`',
        '- **Depends On:** M03',
      ].join('\n'),
      'utf8'
    );

    const bundle = await collectPlans(repoDir);
    expect(bundle.defaultPlanId).toBe('demo-plan');
    expect(bundle.plans).toHaveLength(1);
    const plan = bundle.plans[0]!;
    expect(plan.done).toBe(1);
    expect(plan.total).toBe(4);
    expect(plan.percent).toBe(25);
    expect(plan.nextTaskId).toBe('M02');
    expect(plan.tasks[0]?.ownerFiles).toContain('src/config.ts');
    expect(plan.tasks[0]?.verify).toContain('bun test');

    expect(extractTaskDependencies('M01-M03', new Set(['M01', 'M02', 'M03', 'M04']))).toEqual([
      'M01',
      'M02',
      'M03',
    ]);

    const dag = buildPlanDag(
      plan.tasks,
      plan.waves,
      [],
      [{ code: 'M', status: 'modified', path: 'src/agent-runner.ts', area: 'src' }]
    );
    expect(dag.stats).toEqual({ done: 1, active: 1, ready: 0, blocked: 2 });
    expect(dag.criticalPathIds).toEqual(['M02', 'M03', 'M04']);
    expect(plan.tasks.find((t) => t.id === 'M02')?.dagState).toBe('active');
    expect(plan.tasks.find((t) => t.id === 'M03')?.dagState).toBe('blocked');
  });

  it('collects Antigravity, Claude Code, Codex, OpenCode SQLite, and Magpie Router telemetry with secret redaction & analytics', async () => {
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

    // 2. Claude Code fixture
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

    // 3. Codex fixture with failed command
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

    // 4. OpenCode SQLite v2 fixture with parent + child session
    const openCodeDir = path.join(homeDir, '.local', 'share', 'opencode');
    mkdirSync(openCodeDir, { recursive: true });
    const openCodeDbPath = path.join(openCodeDir, 'opencode.db');
    const nowMs = Date.now();
    const ocDb = new Database(openCodeDbPath);
    try {
      ocDb.exec(`
        CREATE TABLE session_v2 (
          id TEXT PRIMARY KEY,
          parent_id TEXT,
          title TEXT,
          directory TEXT,
          agent TEXT,
          model TEXT,
          cost REAL,
          tokens_input INTEGER,
          tokens_output INTEGER,
          tokens_cache_read INTEGER,
          tokens_cache_write INTEGER,
          time_created INTEGER,
          time_updated INTEGER,
          time_busy INTEGER,
          time_idle INTEGER,
          time_archived INTEGER
        );
        CREATE TABLE session_part (
          session_id TEXT,
          type TEXT,
          time_updated INTEGER,
          data TEXT
        );
        CREATE TABLE session_message (
          id TEXT,
          session_id TEXT
        );
      `);
      ocDb
        .prepare(
          `INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(
          'oc-parent-1',
          null,
          'OpenCode Refactor Sidecar',
          repoDir,
          'coder',
          JSON.stringify({ providerID: 'anthropic', id: 'claude-sonnet-4' }),
          0.145,
          2400,
          600,
          1800,
          200,
          nowMs - 5_000,
          nowMs,
          nowMs,
          null
        );
      ocDb
        .prepare(
          `INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
        )
        .run(
          'oc-child-1',
          'oc-parent-1',
          'OpenCode Subagent Reviewer',
          repoDir,
          'reviewer',
          'openai/gpt-5',
          0.02,
          500,
          100,
          100,
          0,
          nowMs - 3_000,
          nowMs - 1_000,
          null,
          nowMs - 1_000
        );
      ocDb
        .prepare(`INSERT INTO session_part VALUES (?, ?, ?, ?)`)
        .run(
          'oc-parent-1',
          'tool',
          nowMs,
          JSON.stringify({
            type: 'tool',
            name: 'edit_file',
            state: { status: 'done', input: { filePath: 'apps/desktop/src/index.ts' } },
          })
        );
      ocDb.prepare(`INSERT INTO session_message VALUES (?, ?)`).run('m1', 'oc-parent-1');
    } finally {
      ocDb.close();
    }

    // 5. Magpie Router fixture (usage.jsonl + gateway.json + memory-stats.json)
    const magpieDir = path.join(homeDir, '.config', 'magpie');
    mkdirSync(magpieDir, { recursive: true });
    writeFileSync(
      path.join(magpieDir, 'gateway.json'),
      JSON.stringify({ addr: '127.0.0.1:3425', version: '2.4.0' }),
      'utf8'
    );
    writeFileSync(
      path.join(magpieDir, 'memory-stats.json'),
      JSON.stringify({
        days: {
          '2026-11-25': { searches: 12, found: 10, recalled: 8, created: { fact: 3, note: 2 } },
        },
      }),
      'utf8'
    );
    writeFileSync(
      path.join(magpieDir, 'usage.jsonl'),
      [
        JSON.stringify({
          t: new Date(nowMs - 2_000).toISOString(),
          agent: 'opencode',
          provider: 'alice@provider.example',
          served: 'claude-sonnet-4',
          status: 200,
          ms: 420,
          ttft_ms: 110,
          in: 1200,
          out: 300,
          cache_read: 600,
          stop: 'end_turn',
        }),
        JSON.stringify({
          t: new Date(nowMs - 1_000).toISOString(),
          agent: 'opencode',
          provider: 'alice@provider.example',
          served: 'claude-sonnet-4',
          status: 429,
          ms: 90,
          ttft_ms: 40,
          in: 100,
          out: 0,
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

    expect(service.isPollingActive()).toBe(false);

    const snap = await service.getSnapshot({ fresh: true });
    expect(snap.version).toBe(3);
    expect(snap.summary.totalSessions).toBe(6); // ag + claude + codex + 2 opencode + 1 magpie
    expect(snap.summary.swarms).toBe(1);
    expect(snap.summary.subagents).toBeGreaterThanOrEqual(5);
    expect(snap.telemetryHistory.length).toBeGreaterThanOrEqual(1);
    expect(snap.flowGraph.nodes.length).toBeGreaterThan(3);
    expect(snap.flowGraph.edges.some((e) => e.kind === 'router-link')).toBe(true);
    expect(snap.analytics.toolFrequency.length).toBeGreaterThan(0);
    expect(snap.analytics.activityBuckets).toHaveLength(24);
    expect(snap.magpie.totalRecentCalls).toBe(2);
    expect(snap.magpie.okCalls).toBe(1);
    expect(snap.magpie.rateLimit429).toBe(1);
    expect(snap.magpie.memoryStats?.recalled).toBe(8);
    expect(snap.magpie.providers[0]?.provider).not.toContain('@');

    const agSession = snap.sessions.find((s) => s.runtime === 'antigravity');
    expect(agSession?.focus).not.toContain('top_secret_jwt_123456');
    expect(agSession?.focus).not.toContain('mysecretpass123');
    expect(agSession?.focus).toContain('[REDACTED]');

    const ocParent = snap.sessions.find((s) => s.runtime === 'opencode' && s.id === 'oc-parent-1');
    expect(ocParent?.cost).toBeCloseTo(0.145, 3);
    expect(ocParent?.subagents).toHaveLength(1);
    expect(ocParent?.subagents[0]?.type).toBe('opencode-child');

    const ocDetail = await service.getSessionDetail('opencode', 'oc-parent-1');
    expect(ocDetail?.detail.events.length).toBe(1);
    expect(ocDetail?.detail.toolCounts?.edit_file).toBe(1);

    const md = formatSnapshotMarkdown(snap);
    expect(md).toContain('# MoonWitness Desktop Agent Observatory Report');
    expect(md).toContain('## Magpie Router');

    const graphDirect = buildFlowGraph(
      snap.sessions,
      snap.swarms,
      null,
      snap.git,
      snap.probes,
      snap.activityFeed,
      repoDir
    );
    expect(graphDirect.nodes.some((n) => n.id === 'hub:workspace')).toBe(true);

    const analyticsDirect = computeAnalytics(snap.sessions, snap.activityFeed);
    expect(analyticsDirect.errorLedger.length).toBeGreaterThanOrEqual(1);

    // Lazy polling activates on first subscribe and stops on last unsubscribe
    const unsub = service.subscribe(() => {});
    expect(service.isPollingActive()).toBe(true);
    expect(service.getSubscriberCount()).toBe(1);
    unsub();
    expect(service.isPollingActive()).toBe(false);
    expect(service.getSubscriberCount()).toBe(0);

    service.stop();
  });

  it('reads git commit diff stats and blocks SSRF metadata URLs in VPS probe guard', async () => {
    const repoDir = createTempDir('mw-obs-git-');
    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@moonwitness.local'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'MoonWitness Test'], { cwd: repoDir });
    writeFileSync(path.join(repoDir, 'demo.txt'), 'hello\nworld\n', 'utf8');
    execFileSync('git', ['add', 'demo.txt'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'feat(obs): M01 initial commit'], { cwd: repoDir });
    const headSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    const commitDetail = await readGitCommitDetail(repoDir, headSha);
    expect(commitDetail).not.toBeNull();
    expect(commitDetail?.changedFiles).toEqual([{ added: 2, removed: 0, path: 'demo.txt' }]);
    expect(await readGitCommitDetail(repoDir, 'not-a-sha;rm -rf')).toBeNull();

    expect(isBlockedProbeUrl('http://169.254.169.254/latest/meta-data')).toBe(true);
    expect(isBlockedProbeUrl('http://127.0.0.1:8000/readyz')).toBe(true);
    expect(isBlockedProbeUrl('http://10.0.0.5/readyz')).toBe(true);
    expect(isBlockedProbeUrl('http://[::1]/readyz')).toBe(true);
    expect(isBlockedProbeUrl('http://[::ffff:127.0.0.1]/readyz')).toBe(true);
    expect(isBlockedProbeUrl('file:///etc/passwd')).toBe(true);
    expect(isBlockedProbeUrl('https://apps.moonwitness.biz.id/readyz')).toBe(false);
    expect(isBlockedProbeUrl('http://[2001:4860:4860::8888]/readyz')).toBe(false);
    expect(parseProbeUrl('https://example.test/readyz?verbose=1')?.search).toBe('?verbose=1');

    const blocked = await probeHttpTarget({
      id: 'meta',
      label: 'Metadata SSRF',
      url: 'http://169.254.169.254/latest/meta-data',
    });
    expect(blocked.status).toBe('blocked');
  });
});
