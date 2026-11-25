import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildFlowGraph,
  buildPlanDag,
  collectPlans,
  computeAnalytics,
  createObservatoryServer,
  extractTaskDependencies,
  formatSnapshotMarkdown,
  redactSecrets,
  validateProbeUrl,
} from './server.mjs';

test('redactSecrets masks bearer tokens, API keys, passwords, and Postgres credentials', () => {
  const sample =
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig POSTGRES_PASSWORD=supersecretkey123 postgres://admin:topsecret@db.internal:5432/mw sk-proj-abcdef1234567890';
  const redacted = redactSecrets(sample);
  assert.equal(redacted.includes('supersecretkey123'), false);
  assert.equal(redacted.includes('topsecret'), false);
  assert.equal(redacted.includes('eyJhbGciOiJIUzI1NiJ9'), false);
  assert.equal(redacted.includes('sk-proj-abcdef1234567890'), false);
  assert.match(redacted, /Bearer \[REDACTED\]/);
  assert.match(redacted, /postgres:\/\/admin:\[REDACTED\]@db\.internal:5432\/mw/);
});

test('validateProbeUrl enforces http/https and blocks cloud metadata / link-local SSRF targets', () => {
  assert.equal(validateProbeUrl('https://apps.moonwitness.biz.id/readyz').valid, true);
  assert.equal(validateProbeUrl('http://127.0.0.1:4190/health').valid, true);
  assert.equal(validateProbeUrl('file:///etc/passwd').valid, false);
  assert.equal(validateProbeUrl('http://169.254.169.254/latest/meta-data/').valid, false);
  assert.equal(
    validateProbeUrl('http://metadata.google.internal/computeMetadata/v1/').valid,
    false
  );
  assert.equal(validateProbeUrl('http://0.0.0.0:8000/').valid, false);
});

test('extractTaskDependencies expands ranges and filters against valid task IDs', () => {
  const validIds = new Set(['D01', 'D02', 'D03', 'D04', 'D05', 'D06']);
  assert.deepEqual(extractTaskDependencies('D01–D03, D05, X99', validIds), [
    'D01',
    'D02',
    'D03',
    'D05',
  ]);
  assert.deepEqual(extractTaskDependencies('None', validIds), []);
});

test('collectPlans parses both bullet checklists (Mxx) and heading checklists (Dxx) + DAG states', async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'mw-obs-plan-'));
  try {
    const planDir = path.join(tmpRoot, '.plan');
    await mkdir(path.join(planDir, 'alpha-plan'), { recursive: true });
    await writeFile(
      path.join(planDir, 'alpha-plan.md'),
      [
        '# Alpha Dual Format Plan',
        '',
        '### Wave 1 — Core',
        '#### - [x] D01 — Define contracts',
        '- **Owner File(s):** `apps/desktop/types.ts`',
        '- **Depends On:** None',
        '- **Verify:** `bun test`',
        '',
        '#### - [ ] D02 — Build collector',
        '- **Owner File(s):** `apps/desktop/collector.ts`',
        '- **Depends On:** `D01`',
        '',
        '#### - [ ] D03 — Mount routes',
        '- **Owner File(s):** `apps/desktop/server.ts`',
        '- **Depends On:** `D02`',
      ].join('\n'),
      'utf8'
    );

    const bundle = await collectPlans(tmpRoot);
    assert.equal(bundle.plans.length, 1);
    const plan = bundle.plans[0];
    assert.equal(plan.total, 3);
    assert.equal(plan.done, 1);
    assert.equal(plan.tasks[0].ownerFiles, '`apps/desktop/types.ts`');

    const dag = buildPlanDag(plan.tasks, plan.waves, [], []);
    assert.equal(dag.stats.done, 1);
    assert.equal(dag.stats.ready, 1);
    assert.equal(dag.stats.blocked, 1);
    assert.deepEqual(dag.criticalPathIds, ['D02', 'D03']);
    assert.equal(dag.edges.length, 2);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test('buildFlowGraph and computeAnalytics synthesize real topology and analytics without mock rows', () => {
  const nowIso = new Date().toISOString();
  const sessions = [
    {
      id: 'sess-ag-1',
      runtime: 'antigravity',
      runtimeLabel: 'Antigravity',
      title: 'Implement D02 collector',
      status: 'running',
      model: 'gemini-4',
      focus: 'Writing D02 collector',
      lastTool: 'edit_file',
      lastError: '',
      errorCount: 0,
      steps: 12,
      tokens: { input: 2000, cached: 8000, output: 1000, total: 3000 },
      subagents: [
        {
          id: 'sub-1',
          role: 'Researcher',
          type: 'research',
          model: 'flash',
          status: 'running',
          at: nowIso,
        },
      ],
      toolCounts: { edit_file: 5, run_command: 3 },
      inCurrentWorkspace: true,
      updatedAt: nowIso,
      mtimeMs: Date.now(),
    },
  ];
  const feed = [
    {
      at: nowIso,
      runtime: 'antigravity',
      runtimeLabel: 'Antigravity',
      sessionId: 'sess-ag-1',
      sessionTitle: 'Implement D02 collector',
      kind: 'tool',
      tool: 'edit_file',
      summary: 'edit_file collector.ts',
    },
  ];
  const gitState = {
    branch: 'dev',
    head: 'abc1234',
    dirtyCount: 2,
    dirtyByArea: { 'tools/agent-observatory': 2 },
    commits: [],
  };
  const probes = {
    vps: [{ id: 'vps-1', label: 'VPS Ready', status: 'up', httpCode: 200, latencyMs: 42 }],
    localPorts: [],
  };

  const graph = buildFlowGraph(sessions, [], null, gitState, probes, feed, '/repo/mw-xv');
  assert.ok(graph.nodes.some((node) => node.id === 'hub:workspace'));
  assert.ok(graph.nodes.some((node) => node.id === 'rt:antigravity'));
  assert.ok(graph.nodes.some((node) => node.id === 'agent:antigravity:sess-ag-1'));
  assert.ok(graph.nodes.some((node) => node.kind === 'subagent'));
  assert.ok(graph.edges.length >= 4);
  assert.equal(graph.pulses.length, 1);

  const analytics = computeAnalytics(sessions, feed);
  assert.equal(analytics.runtimeBreakdown.length, 1);
  assert.equal(analytics.runtimeBreakdown[0].cacheHitPct, 80);
  assert.equal(analytics.toolFrequency[0].name, 'edit_file');
  assert.equal(analytics.activityBuckets.length, 24);
});

test('Observatory HTTP server serves static p5 bundle, state, export, SSRF-guarded probe, and SSE cleanly', async () => {
  const tmpHome = await mkdtemp(path.join(os.tmpdir(), 'mw-obs-home-'));
  const handle = await createObservatoryServer({
    host: '127.0.0.1',
    port: 0,
    homeDir: tmpHome,
    enableNetworkProbes: false,
    enableAntigravityApi: false,
    enableBackgroundTimers: false,
  });

  try {
    const baseUrl = `http://127.0.0.1:${handle.address.port}`;

    const healthResp = await fetch(`${baseUrl}/health`);
    assert.equal(healthResp.status, 200);
    const healthJson = await healthResp.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.version, 2);
    assert.equal(healthJson.p5Vendored, true);

    const p5Resp = await fetch(`${baseUrl}/vendor/p5.min.js`);
    assert.equal(p5Resp.status, 200);
    assert.match(p5Resp.headers.get('content-type') || '', /javascript/);
    const p5Size = (await p5Resp.arrayBuffer()).byteLength;
    assert.ok(p5Size > 500_000);

    // MoonWitness Riot fonts, sprites, art backdrops, and sounds must serve safely while blocking traversal
    const fontResp = await fetch(`${baseUrl}/mw-assets/fonts/MoonWitnessGrunge-latin.woff2`);
    assert.equal(fontResp.status, 200);
    assert.match(fontResp.headers.get('content-type') || '', /woff2/);

    const artResp = await fetch(`${baseUrl}/mw-art/crew-rooftop-1440.webp`);
    assert.equal(artResp.status, 200);
    assert.match(artResp.headers.get('content-type') || '', /webp/);

    const spriteResp = await fetch(
      `${baseUrl}/mw-assets/illustrations/riot-universe/characters/kuro-signal-pose-running.webp`
    );
    assert.equal(spriteResp.status, 200);

    const soundResp = await fetch(`${baseUrl}/mw-assets/sounds/ambience-moon-city-night.wav`);
    assert.equal(soundResp.status, 200);
    assert.match(soundResp.headers.get('content-type') || '', /wav/);

    const assetTraversalResp = await fetch(`${baseUrl}/mw-assets/../../package.json`);
    assert.equal(assetTraversalResp.status, 404);

    const traversalResp = await fetch(`${baseUrl}/../server.mjs`);
    assert.equal(traversalResp.status, 404);

    const stateResp = await fetch(`${baseUrl}/api/state`);
    assert.equal(stateResp.status, 200);
    const snapshot = await stateResp.json();
    assert.equal(snapshot.version, 2);
    assert.ok(Array.isArray(snapshot.plans));
    assert.ok(snapshot.flowGraph && Array.isArray(snapshot.flowGraph.nodes));
    assert.ok(snapshot.analytics && Array.isArray(snapshot.analytics.activityBuckets));
    assert.ok(Array.isArray(snapshot.telemetryHistory) && snapshot.telemetryHistory.length >= 1);

    // Ensure both real repository plans parsed tasks (including D01-D16 heading format!)
    const mergePlan = snapshot.plans.find(
      (planEntry) => planEntry.id === 'desktop-agent-observatory-merge'
    );
    if (mergePlan) {
      assert.equal(mergePlan.total, 16);
      assert.ok(mergePlan.dag && mergePlan.dag.edges.length > 0);
    }

    const mdResp = await fetch(`${baseUrl}/api/export?format=markdown`);
    assert.equal(mdResp.status, 200);
    const mdBody = await mdResp.text();
    assert.match(mdBody, /# MoonWitness Agent Observatory Report/);
    assert.equal(mdBody, formatSnapshotMarkdown(snapshot));

    const ssrfResp = await fetch(
      `${baseUrl}/api/probe?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data')}`
    );
    assert.equal(ssrfResp.status, 400);

    const badCommitResp = await fetch(`${baseUrl}/api/git/commit?sha=not-a-sha`);
    assert.equal(badCommitResp.status, 400);

    // Live SSE check with immediate abort
    const sseAbort = new globalThis.AbortController();
    const sseResp = await fetch(`${baseUrl}/api/stream`, { signal: sseAbort.signal });
    assert.equal(sseResp.status, 200);
    assert.match(sseResp.headers.get('content-type') || '', /text\/event-stream/);
    const reader = sseResp.body.getReader();
    const firstChunk = await reader.read();
    const decoded = new globalThis.TextDecoder().decode(firstChunk.value);
    assert.match(decoded, /retry: 2000/);
    sseAbort.abort();
    await reader.cancel().catch(() => {});
  } finally {
    await handle.stop();
    await rm(tmpHome, { recursive: true, force: true });
  }
});
