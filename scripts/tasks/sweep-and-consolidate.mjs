import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const AUDIT_TASKS = [
  {
    code: 'AUD-001',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NOW',
    horizon: 'next',
    title: 'Wire @moonwitness/ai-runtime to production job handlers in ai-corporation.routes.ts',
    summary: 'Replace stub handlers ai.agent_run.* with real AgentHarness and PCW verification',
    problem: 'Job handlers in apps/api/src/routes/ai-corporation.routes.ts:72-116 do not execute @moonwitness/ai-runtime, only incrementing step_count and marking completed.',
    proposedSolution: 'Connect ai.agent_run.execute and inspect to AgentHarness, DataClassificationRouter, CapabilityGateway, and verifyProofCarryingWork with incremental checkpointing.',
    category: 'architecture',
    type: 'feature',
    priority: 'p0',
    status: 'todo',
    human: false,
    owner: 'ai-team',
    assignee: null,
    risk: 'medium',
    effort: 'l',
    scores: { impact: 5, confidence: 5, strategicValue: 5, effort: 4, priorityScore: 31.3 },
    dependsOn: [],
    blocks: ['AUD-007', 'AUD-011', 'AUD-012'],
    tags: ['ai', 'jobs', 'pcw', 'runtime'],
    scope: {
      packages: ['@moonwitness/api', '@moonwitness/ai-runtime', '@moonwitness/orm-ai'],
      files: ['apps/api/src/routes/ai-corporation.routes.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'ai.agent_run.inspect executes MockProvider and repo.read@v1', done: false },
      { id: 'ac-2', text: 'ai.artifact_manifest records valid SHA-256 verified by verifyProofCarryingWork', done: false },
      { id: 'ac-3', text: 'AbortSignal and emergency stop halt execution cleanly', done: false }
    ],
    validation: {
      commands: ['pnpm --filter @moonwitness/api test', 'pnpm --filter @moonwitness/ai-runtime test'],
      expected: 'All agent execution and PCW verification tests pass'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['docs/decisions/0007-ai-corporation-addon-first-architecture.md'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-001' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-002',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NOW',
    horizon: 'now',
    title: 'Integrate all AI and Desktop packages to CI gate, unit runner, and docs generator',
    summary: 'Include 5 AI packages in test runners, addon conformance, and documentation',
    problem: '5 AI packages omitted from test:unit:built and run-unit-tests.mjs; run-unit-tests.mjs:91 still references dead @moonwitness/whatsapp; ci.yml lacks lint/format checks.',
    proposedSolution: 'Add AI and desktop packages to root package.json test scripts, run-unit-tests.mjs, addon conformance test, and docs generator; add lint & format checks to ci.yml.',
    category: 'dx',
    type: 'infrastructure',
    priority: 'p0',
    status: 'todo',
    human: false,
    owner: 'devops-team',
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: { impact: 5, confidence: 5, strategicValue: 5, effort: 3, priorityScore: 41.7 },
    dependsOn: [],
    blocks: ['AUD-005', 'AUD-008'],
    tags: ['ci', 'testing', 'conformance', 'dx'],
    scope: {
      packages: ['@moonwitness/orm-ai', '@moonwitness/ai-runtime', '@moonwitness/ai-mcp', '@moonwitness/ai-evaluation', '@moonwitness/desktop'],
      files: ['package.json', 'scripts/run-unit-tests.mjs', 'scripts/roadmap/addon-conformance.test.mjs', '.github/workflows/ci.yml']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'All workspace packages tested in test:unit:built and CI', done: false },
      { id: 'ac-2', text: 'generated-models.md contains 15 ai.* models', done: false },
      { id: 'ac-3', text: 'pnpm test:addon-conformance passes for orm-ai', done: false }
    ],
    validation: {
      commands: ['pnpm verify', 'pnpm test:addon-conformance', 'pnpm docs:check:built'],
      expected: 'All gates pass with zero unlisted packages'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['ROADMAP.md#M2.04', 'ROADMAP.md#M9.07'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-002' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-003',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NOW',
    horizon: 'now',
    title: 'Resolve AGPL-3.0-only license anomaly and workspace boundary in apps/todo',
    summary: 'Clarify or isolate apps/todo license and workspace boundary',
    problem: 'apps/todo/Cargo.toml declares license AGPL-3.0-only and apps/todo/web is in pnpm-workspace.yaml without CI coverage.',
    proposedSolution: 'Audit apps/todo codebase ownership; align license or cleanly isolate workspace and document in ADR.',
    category: 'governance',
    type: 'infrastructure',
    priority: 'p0',
    status: 'todo',
    human: true,
    owner: 'repo-owner',
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: { impact: 5, confidence: 5, strategicValue: 3, effort: 2, priorityScore: 37.5 },
    dependsOn: [],
    blocks: [],
    tags: ['license', 'compliance', 'governance'],
    scope: {
      packages: ['@moonwitness/todo'],
      files: ['apps/todo/Cargo.toml', 'pnpm-workspace.yaml']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'No unverified copyleft license contamination in monorepo', done: false },
      { id: 'ac-2', text: 'pnpm audit:workspace accurately covers 100% active apps', done: false }
    ],
    validation: {
      commands: ['pnpm audit:workspace'],
      expected: 'Clean workspace audit'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['apps/todo/Cargo.toml'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-003' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-004',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NOW',
    horizon: 'now',
    title: 'Harden multi-tier rate limiting and fix PostgresRateLimitStore timeWindow bug',
    summary: 'Protect all generic REST, JSON-RPC, AI and WhatsApp routes with TTL rate limiting',
    problem: 'Only 6 routes have rate limits; PostgresRateLimitStore.parseTimeWindowMs ignores string windows; _api_rate_limits lacks index on expires_at_ms and TTL pruning.',
    proposedSolution: 'Parse string windows in parseTimeWindowMs; add index expires_at_ms and cron pruning; enable rate limiting per companyId:userId across /api/:model, /jsonrpc, /api/ai/*.',
    category: 'security',
    type: 'fix',
    priority: 'p0',
    status: 'todo',
    human: false,
    owner: 'security-team',
    assignee: null,
    risk: 'low',
    effort: 'm',
    scores: { impact: 5, confidence: 5, strategicValue: 4, effort: 3, priorityScore: 33.3 },
    dependsOn: [],
    blocks: ['AUD-012'],
    tags: ['security', 'rate-limit', 'postgres'],
    scope: {
      packages: ['@moonwitness/api'],
      files: ['apps/api/src/plugins/rate-limit-store.ts', 'apps/api/src/app.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'parseTimeWindowMs parses 5 seconds and 15 minutes accurately', done: false },
      { id: 'ac-2', text: 'Burst requests on /jsonrpc and /api/ai/* return 429', done: false },
      { id: 'ac-3', text: 'Expired rate limit rows are pruned by scheduled job', done: false }
    ],
    validation: {
      commands: ['pnpm --filter @moonwitness/api test'],
      expected: 'Rate limit store tests pass'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['apps/api/src/plugins/rate-limit-store.ts'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-004' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-005',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Implement automated PostgreSQL FORCE ROW LEVEL SECURITY for zero-trust multi-tenancy',
    summary: 'Generate and enforce RLS policies in schema-sync.ts for all tenant-scoped tables',
    problem: 'Multi-tenant isolation currently exists only at the application layer via getRecordRuleDomain; raw app.db() queries bypass isolation.',
    proposedSolution: 'Emit FORCE RLS policies in schema-sync.ts on PostgreSQL for tables with company_id; set SET LOCAL app.company_id in transactional requests and job contexts.',
    category: 'security',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'backend-team',
    assignee: null,
    risk: 'medium',
    effort: 'l',
    scores: { impact: 5, confidence: 4, strategicValue: 5, effort: 4, priorityScore: 25.0 },
    dependsOn: ['AUD-002'],
    blocks: [],
    tags: ['security', 'postgres', 'multi-tenancy', 'rls'],
    scope: {
      packages: ['@moonwitness/orm', '@moonwitness/api', '@moonwitness/jobs'],
      files: ['packages/orm/src/schema-sync.ts', 'apps/api/src/routes/generic.routes.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'Raw SQL without WHERE company_id cannot read another company rows', done: false },
      { id: 'ac-2', text: 'All PostgreSQL integration tests pass with non-superuser role', done: false }
    ],
    validation: {
      commands: ['pnpm test:integration'],
      expected: 'PostgreSQL integration suite passes with RLS enabled'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['ROADMAP.md#M4.06', 'ROADMAP.md#M10.05'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-005' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-006',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Harden multi-replica auth with token_version and PG NOTIFY cache invalidation',
    summary: 'Instantaneous session and token revocation across multi-replica API instances',
    problem: 'changePassword does not immediately invalidate active access JWTs (900s window); authCache in-process lags up to 5s across replicas and flushes all 2,000 entries at once.',
    proposedSolution: 'Add token_version to base.user, increment on changePassword/revocation; switch authCache to LRU + PostgreSQL LISTEN/NOTIFY invalidation; lock x-company-id for agent principals.',
    category: 'security',
    type: 'fix',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'auth-team',
    assignee: null,
    risk: 'medium',
    effort: 'm',
    scores: { impact: 4, confidence: 4, strategicValue: 4, effort: 3, priorityScore: 21.3 },
    dependsOn: [],
    blocks: [],
    tags: ['auth', 'jwt', 'security', 'multi-replica'],
    scope: {
      packages: ['@moonwitness/auth', '@moonwitness/orm-base', '@moonwitness/api'],
      files: ['packages/auth/src/service.ts', 'apps/api/src/plugins/auth.plugin.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'Old access JWT rejected immediately after password change', done: false },
      { id: 'ac-2', text: 'Cache invalidation received across replicas via PG NOTIFY', done: false },
      { id: 'ac-3', text: 'Agent principal rejected on cross-company header', done: false }
    ],
    validation: {
      commands: ['pnpm --filter @moonwitness/auth test', 'pnpm --filter @moonwitness/api test'],
      expected: 'Auth revocation and multi-replica tests pass'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['docs/engineering/authentication-security.md'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-006' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-007',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Migrate @moonwitness/ai-mcp to official @modelcontextprotocol/sdk with PROV-AGENT lineage',
    summary: 'Standardize MCP transport on Streamable HTTP and stdio with verifiable provenance',
    problem: 'packages/ai-mcp/src/index.ts uses manual JSON-RPC parser without standard MCP transports; MALICIOUS_ARG_PATTERN regex blocks valid double-dashes.',
    proposedSolution: 'Wrap @modelcontextprotocol/sdk (Streamable HTTP + stdio) over CapabilityGateway; replace regex blocking with strict JSON Schema; record PROV-AGENT lineage per tool invocation.',
    category: 'innovation',
    type: 'refactor',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'ai-team',
    assignee: null,
    risk: 'medium',
    effort: 'l',
    scores: { impact: 5, confidence: 4, strategicValue: 5, effort: 4, priorityScore: 25.0 },
    dependsOn: ['AUD-001'],
    blocks: ['AUD-014'],
    tags: ['mcp', 'sdk', 'lineage', 'prov'],
    scope: {
      packages: ['@moonwitness/ai-mcp', '@moonwitness/api', '@moonwitness/desktop'],
      files: ['packages/ai-mcp/src/index.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'Standard MCP client connects and executes tools/list and tools/call', done: false },
      { id: 'ac-2', text: 'Markdown arguments containing -- pass validation safely', done: false },
      { id: 'ac-3', text: 'Tool calls generate PROV-AGENT records with SHA-256 evidence digests', done: false }
    ],
    validation: {
      commands: ['pnpm --filter @moonwitness/ai-mcp test'],
      expected: 'Official MCP protocol contract tests pass'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['arXiv:2508.02866'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-007' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-008',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NOW',
    horizon: 'now',
    title: 'Activate Turborepo build caching in workspace and CI pipeline',
    summary: 'Speed up local and CI builds by 40-70% using cached artifacts',
    problem: 'turbo.json exists in root but is unused; scripts/ci/build-workspace.mjs runs uncached pnpm -r build repeatedly in CI.',
    proposedSolution: 'Add turbo to root devDependencies; update build-workspace.mjs to invoke turbo run build; configure .turbo cache in .github/workflows/ci.yml.',
    category: 'dx',
    type: 'infrastructure',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'devops-team',
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: { impact: 4, confidence: 5, strategicValue: 4, effort: 2, priorityScore: 40.0 },
    dependsOn: ['AUD-002'],
    blocks: [],
    tags: ['turbo', 'build', 'dx', 'ci'],
    scope: {
      packages: ['root'],
      files: ['package.json', 'turbo.json', 'scripts/ci/build-workspace.mjs', '.github/workflows/ci.yml']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'Identical warm build finishes in under 2 seconds locally', done: false },
      { id: 'ac-2', text: 'CI workflow build time reduced by >= 40%', done: false },
      { id: 'ac-3', text: 'Workspace build diagnostics tests continue to pass', done: false }
    ],
    validation: {
      commands: ['pnpm build', 'node --test scripts/ci/workspace-build-diagnostics.test.mjs'],
      expected: 'Builds succeed with cache hits on repeated runs'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['turbo.json'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-008' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-009',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NOW',
    horizon: 'now',
    title: 'Fix logger synchronous file I/O and implement deep recursive secret redaction',
    summary: 'Eliminate event-loop blocking on logging and protect nested secrets in error traces',
    problem: 'packages/logger/src/index.ts uses sync: true on streams (blocking event loop) and shallow redaction limited to 8 fixed keys.',
    proposedSolution: 'Use sync: false in production destination with flush on shutdown; implement recursive redaction for token, secret, apiKey, MW_AI_*, and nested headers.',
    category: 'performance',
    type: 'fix',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'backend-team',
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: { impact: 4, confidence: 5, strategicValue: 3, effort: 2, priorityScore: 30.0 },
    dependsOn: [],
    blocks: [],
    tags: ['logger', 'performance', 'security', 'redaction'],
    scope: {
      packages: ['@moonwitness/logger', '@moonwitness/api'],
      files: ['packages/logger/src/index.ts', 'apps/api/src/server.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'Zero secret leakage down to 4 object levels in logger tests', done: false },
      { id: 'ac-2', text: 'Graceful shutdown flushes remaining buffered logs without loss', done: false }
    ],
    validation: {
      commands: ['pnpm --filter @moonwitness/logger test'],
      expected: 'Logger redaction and async destination tests pass'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['packages/logger/src/index.ts'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-009' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-010',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-LATER',
    horizon: 'later',
    title: 'Optimize PostgreSQL query engine (native ILIKE and pg_trgm) and post-transaction CONCURRENTLY index sync',
    summary: 'Fast trigram index scans and non-blocking index creation on large PostgreSQL tables',
    problem: 'domain.ts compiles ilike to LOWER(col) LIKE LOWER(?), defeating B-tree/GIN indexes; schema-sync.ts creates indexes inside transactions; advisory lock IDs differ.',
    proposedSolution: 'Use native ILIKE on PostgreSQL; add trigramIndex field option; create new indexes CONCURRENTLY outside transaction blocks with lock_timeout; unify advisory lock IDs.',
    category: 'performance',
    type: 'refactor',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: 'backend-team',
    assignee: null,
    risk: 'medium',
    effort: 'l',
    scores: { impact: 4, confidence: 4, strategicValue: 4, effort: 4, priorityScore: 16.0 },
    dependsOn: [],
    blocks: [],
    tags: ['orm', 'postgres', 'index', 'performance'],
    scope: {
      packages: ['@moonwitness/orm'],
      files: ['packages/orm/src/domain.ts', 'packages/orm/src/schema-sync.ts', 'packages/orm/src/addon.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'EXPLAIN ANALYZE on 100k row ilike query uses Bitmap Index Scan', done: false },
      { id: 'ac-2', text: 'Index creation does not hold long ACCESS EXCLUSIVE table locks', done: false }
    ],
    validation: {
      commands: ['pnpm --filter @moonwitness/orm test'],
      expected: 'Dual dialect query tests and schema sync pass'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['packages/orm/src/schema-sync.ts'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-010' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-011',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-EXPERIMENT',
    horizon: 'experiment',
    title: 'Implement CaMeL dual-LLM control and data flow separation with taint tracking in @moonwitness/ai-runtime',
    summary: 'Defense-by-design against indirect prompt injection for R1-R3 autonomous agent runs',
    problem: 'Single-loop autonomous agents remain vulnerable to indirect prompt injection from untrusted files, web results, and WhatsApp messages.',
    proposedSolution: 'Introduce strict_camel mode: Privileged LLM plans control flow from trusted specs; Quarantined LLM processes untrusted data without tool access; CapabilityGateway verifies TaintLabels before mutations.',
    category: 'innovation',
    type: 'experiment',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: 'ai-research',
    assignee: null,
    risk: 'medium',
    effort: 'xl',
    scores: { impact: 5, confidence: 3, strategicValue: 5, effort: 5, priorityScore: 15.0 },
    dependsOn: ['AUD-001'],
    blocks: [],
    tags: ['ai-security', 'camel', 'taint-tracking', 'prompt-injection'],
    scope: {
      packages: ['@moonwitness/ai-runtime', '@moonwitness/ai-evaluation'],
      files: ['packages/ai-runtime/src/agent-runner.ts', 'packages/ai-runtime/src/capability-gateway.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: '0% exfiltration and tool abuse on LMI-01..LMI-13 adversarial corpus in strict_camel mode', done: false }
    ],
    validation: {
      commands: ['pnpm --filter @moonwitness/ai-evaluation test'],
      expected: 'Adversarial evaluation passes zero breaches'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['arXiv:2503.18813', 'arXiv:2605.17634'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-011' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-012',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-LATER',
    horizon: 'later',
    title: 'Realtime eventing layer with PostgreSQL LISTEN/NOTIFY and Fastify SSE for Mission Control and Inbox',
    summary: 'Sub-50ms job wake-up and live push updates to Board and desktop clients',
    problem: 'Workers and outbox dispatchers poll the database periodically; Board Mission Control and Inbox require manual refresh.',
    proposedSolution: 'Emit pg_notify on job enqueue, outbox events, and AI run steps; expose authenticated GET /api/events/stream (Fastify SSE) filtered by company and user.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: 'backend-team',
    assignee: null,
    risk: 'medium',
    effort: 'l',
    scores: { impact: 4, confidence: 4, strategicValue: 4, effort: 4, priorityScore: 16.0 },
    dependsOn: ['AUD-001', 'AUD-004'],
    blocks: [],
    tags: ['realtime', 'sse', 'events', 'board'],
    scope: {
      packages: ['@moonwitness/jobs', '@moonwitness/api', '@moonwitness/board'],
      files: ['packages/jobs/src/runtime.ts', 'apps/api/src/routes/events.routes.ts']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'Job claim latency on PostgreSQL reduced to < 50ms', done: false },
      { id: 'ac-2', text: 'Board Mission Control receives live AgentRun step transitions without polling', done: false }
    ],
    validation: {
      commands: ['pnpm --filter @moonwitness/api test'],
      expected: 'SSE streaming integration tests pass with tenant isolation'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['docs/guide/how-to/jobs-outbox.md'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-012' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-013',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-LATER',
    horizon: 'later',
    title: 'Behavior-led decomposition of 4 core god-files (generic.routes.ts, list-view.tsx, base.model.ts, addon.ts)',
    summary: 'Refactor unwieldy 700-1577 LOC files into cohesive single-responsibility modules',
    problem: '4 core files have grown to 701-1,577 LOC, increasing cognitive load and regression risk during parallel feature work.',
    proposedSolution: 'Extract JSON-RPC and metadata routes from generic.routes.ts; query building from base.model.ts; toolbar and controller hooks from list-view.tsx while maintaining zero cycles.',
    category: 'architecture',
    type: 'refactor',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: 'core-team',
    assignee: null,
    risk: 'medium',
    effort: 'l',
    scores: { impact: 3, confidence: 5, strategicValue: 3, effort: 4, priorityScore: 11.3 },
    dependsOn: ['AUD-002', 'AUD-008'],
    blocks: [],
    tags: ['refactor', 'architecture', 'clean-code'],
    scope: {
      packages: ['@moonwitness/api', '@moonwitness/orm', '@moonwitness/board'],
      files: ['apps/api/src/routes/generic.routes.ts', 'packages/orm/src/base.model.ts', 'apps/board/src/components/views/list-view.tsx']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'No target file exceeds 600 LOC', done: false },
      { id: 'ac-2', text: 'pnpm audit:workspace reports 0 import cycles', done: false },
      { id: 'ac-3', text: 'Full API, ORM, and Board E2E test suites pass untouched', done: false }
    ],
    validation: {
      commands: ['pnpm verify', 'pnpm audit:workspace'],
      expected: 'All tests pass with zero cycles and reduced file sizes'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['docs/engineering/refactor-map.md'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-013' },
    url: '',
    comments: []
  },
  {
    code: 'AUD-014',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-LATER',
    horizon: 'later',
    title: 'End-to-end metadata reflection via orm:codegen v2 (OpenAPI 3.1, client SDK, and auto-MCP catalog)',
    summary: 'Single-source model reflection producing OpenAPI schemas, typed client hooks, and MCP descriptors',
    problem: 'OpenAPI only exposes generic /api/:model path templates without per-model property schemas; Board and third-party consumers lack auto-generated typed resource methods.',
    proposedSolution: 'Extend scripts/orm-codegen.mjs to generate OpenAPI 3.1 component schemas, typed client methods on @moonwitness/client, and safe MCP tool descriptors from defineModel AST.',
    category: 'dx',
    type: 'feature',
    priority: 'p3',
    status: 'todo',
    human: false,
    owner: 'core-team',
    assignee: null,
    risk: 'low',
    effort: 'l',
    scores: { impact: 4, confidence: 4, strategicValue: 4, effort: 4, priorityScore: 16.0 },
    dependsOn: ['AUD-007'],
    blocks: [],
    tags: ['codegen', 'openapi', 'mcp', 'sdk'],
    scope: {
      packages: ['@moonwitness/orm', '@moonwitness/client', '@moonwitness/ai-mcp'],
      files: ['scripts/orm-codegen.mjs']
    },
    acceptanceCriteria: [
      { id: 'ac-1', text: 'pnpm orm:codegen --check verifies deterministic byte-identical generation', done: false },
      { id: 'ac-2', text: 'Swagger UI displays exact property schemas for all installed non-internal models', done: false }
    ],
    validation: {
      commands: ['pnpm orm:codegen', 'pnpm --filter @moonwitness/client typecheck'],
      expected: 'Generated client and OpenAPI models pass typecheck'
    },
    evidence: {
      paths: [],
      detailFile: 'docs/superpowers/plans/2026-11-22-taskos-second-brain-centralization.md',
      commitSha: null
    },
    references: ['scripts/orm-codegen.mjs'],
    blockedReason: null,
    sourceRef: { file: 'scripts/tasks/sweep-and-consolidate.mjs', legacyId: 'AUD-014' },
    url: '',
    comments: []
  }
];

export async function sweepAndConsolidate({
  generatedAt = process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString(),
} = {}) {
  const tasks = [];
  const tasksByCode = new Map();

  function addTask(task) {
    if (!task || typeof task.code !== 'string' || !task.code.trim()) {
      throw new Error('TaskOS source produced a record without a stable task code.');
    }
    const existing = tasksByCode.get(task.code);
    if (existing) {
      throw new Error(
        `Duplicate TaskOS code "${task.code}" from "${existing.sourceRef?.file ?? 'unknown source'}" and "${task.sourceRef?.file ?? 'unknown source'}". Reconcile the source owners before generating the canonical registry.`
      );
    }
    tasksByCode.set(task.code, task);
    tasks.push(task);
    return true;
  }

  // 1. Ingest the authoritative M/K roadmap index and ROADMAP.md checklist (239 tasks).
  const roadmapTasksRaw = await fs.readFile(path.join(rootDir, 'docs/roadmap/tasks.json'), 'utf8');
  const roadmapTasks = JSON.parse(roadmapTasksRaw).tasks;
  const roadmapText = await fs.readFile(path.join(rootDir, 'ROADMAP.md'), 'utf8');

  const roadmapCheckState = new Map();
  for (const line of roadmapText.split(/\r?\n/)) {
    const match = /^\s*-\s*\[([ xX])\]\s+([A-Za-z0-9_.-]+)\b/.exec(line);
    if (match) {
      roadmapCheckState.set(match[2], match[1].toLowerCase() === 'x');
    }
  }

  for (const t of roadmapTasks) {
    const isChecked = roadmapCheckState.get(t.id) ?? false;
    let status = 'todo';
    if (isChecked) {
      status = 'done';
    } else if (t.status === 'in_progress') {
      status = 'doing';
    } else if (t.status === 'blocked') {
      status = 'blocked';
    }

    const series = t.id.startsWith('M') ? 'M' : t.id.startsWith('K') ? 'K' : 'ROADMAP';
    const horizon = isChecked ? 'now' : t.milestone?.startsWith('M1') || t.milestone?.startsWith('K1') ? 'now' : 'next';

    addTask({
      code: t.id,
      project: 'moonwitness',
      series,
      milestone: t.milestone ?? null,
      horizon,
      title: t.title,
      summary: t.title.slice(0, 140),
      problem: `Roadmap requirement defined in ${t.detailFile ?? 'ROADMAP.md'}`,
      proposedSolution: t.output ?? 'Implement verified deliverable according to roadmap specification.',
      category: series === 'K' ? 'research' : 'architecture',
      type: 'feature',
      priority: t.priority ?? 'p1',
      status,
      human: Boolean(t.id === 'M1.08' || t.id.startsWith('M8.03') || t.id.startsWith('M10.03')),
      owner: t.assignee ?? null,
      assignee: t.assignee ?? null,
      risk: 'medium',
      effort: 'm',
      scores: null,
      dependsOn: t.dependsOn ?? [],
      blocks: [],
      tags: [series.toLowerCase(), ...(t.labels ?? [])],
      scope: { packages: [], files: [] },
      acceptanceCriteria: [
        { id: `${t.id}-ac-1`, text: t.output ?? 'Deliverable accepted', done: isChecked }
      ],
      validation: {
        commands: ['pnpm verify'],
        expected: 'All acceptance criteria and evidence proven'
      },
      evidence: {
        paths: t.evidence ? [t.evidence] : [],
        detailFile: t.detailFile ?? null,
        commitSha: null
      },
      references: t.detailFile ? [t.detailFile] : [],
      blockedReason: status === 'blocked' ? 'Awaiting upstream dependency or CODEOWNER gate' : null,
      sourceRef: { file: 'docs/roadmap/tasks.json', legacyId: t.id },
      url: '',
      comments: []
    });
  }

  // 2. Ingest Audit Tasks (AUD-001..AUD-014)
  for (const aud of AUDIT_TASKS) {
    addTask(aud);
  }

  // 3. Ingest todo-wa.md (WhatsApp checklist)
  const todoWaPath = path.join(rootDir, 'todo-wa.md');
  try {
    const waText = await fs.readFile(todoWaPath, 'utf8');
    for (const line of waText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+\*\*(P[0-3]-\d+)\*\*\s+(.*)$/.exec(line);
      if (match) {
        const isDone = match[1].toLowerCase() === 'x';
        const rawCode = match[2];
        const title = match[3].trim();
        const code = `WA-${rawCode}`;
        const prio = rawCode.startsWith('P0') ? 'p0' : rawCode.startsWith('P1') ? 'p1' : rawCode.startsWith('P2') ? 'p2' : 'p3';

        addTask({
          code,
          project: 'moonwitness',
          series: 'WA',
          milestone: 'WHATSAPP',
          horizon: isDone ? 'now' : prio === 'p0' ? 'now' : 'next',
          title,
          summary: title.slice(0, 140),
          problem: `WhatsApp gateway requirement: ${title}`,
          proposedSolution: 'Verify and integrate GoWA gateway functionality according to specification.',
          category: 'product',
          type: 'feature',
          priority: prio,
          status: isDone ? 'done' : 'todo',
          human: false,
          owner: 'wa-team',
          assignee: null,
          risk: 'medium',
          effort: 'm',
          scores: null,
          dependsOn: [],
          blocks: [],
          tags: ['whatsapp', 'gowa', prio],
          scope: { packages: ['@moonwitness/orm-whatsapp', '@moonwitness/api'], files: [] },
          acceptanceCriteria: [
            { id: `${code}-ac-1`, text: title, done: isDone }
          ],
          validation: {
            commands: ['pnpm test:whatsapp'],
            expected: 'WhatsApp gateway test suites pass'
          },
          evidence: { paths: [], detailFile: 'todo-wa.md', commitSha: null },
          references: ['docs/operations/whatsapp.md'],
          blockedReason: null,
          sourceRef: { file: 'todo-wa.md', legacyId: rawCode },
          url: '',
          comments: []
        });
      }
    }
  } catch (error) {
    throw new Error(`Failed to ingest required WhatsApp task source "${todoWaPath}": ${error.message}`, { cause: error });
  }

  // Root todo.md is a navigation pointer. Verify it remains a pointer and never parse it as a backlog.
  const rootTodoPath = path.join(rootDir, 'todo.md');
  const rootTodoText = await fs.readFile(rootTodoPath, 'utf8');
  if (!rootTodoText.includes('docs/tasks/tasks.json')) {
    throw new Error('Root todo.md must remain a pointer to the canonical TaskOS registry.');
  }

  // Import only unchecked records from the archived MW checklist. They remain blocked until re-triaged.
  const legacyTodoPath = path.join(rootDir, 'docs/archive/todos/todo.md');
  try {
    const legacyTodoText = await fs.readFile(legacyTodoPath, 'utf8');
    for (const line of legacyTodoText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[ \]\s+\*\*(MW-[A-Za-z0-9_.-]+)\*\*\s+(.*)$/.exec(line);
      if (!match) continue;
      const code = match[1];
      const title = match[2].trim();
      addTask({
        code,
        project: 'moonwitness',
        series: 'MW',
        milestone: 'LEGACY-TRIAGE',
        horizon: 'later',
        title,
        summary: title.slice(0, 140),
        problem: `Unchecked item retained in archived legacy TODO: ${title}`,
        proposedSolution: 'Revalidate against current repository state and promote to an active roadmap/card only when still required.',
        category: 'governance',
        type: 'research',
        priority: 'p1',
        status: 'blocked',
        human: true,
        owner: 'repo-owner',
        assignee: null,
        risk: 'medium',
        effort: null,
        scores: null,
        dependsOn: [],
        blocks: [],
        tags: ['legacy', 'archive', 'triage-required'],
        scope: { packages: [], files: [] },
        acceptanceCriteria: [
          { id: `${code}-ac-1`, text: 'Current relevance and ownership are revalidated.', done: false }
        ],
        validation: { commands: ['pnpm automation:check:roadmap'], expected: 'Task is mapped to an active source or explicitly retired.' },
        evidence: { paths: [], detailFile: 'docs/archive/todos/todo.md', commitSha: null },
        references: ['docs/archive/todos/todo.md'],
        blockedReason: 'Archived legacy backlog item; requires owner revalidation before execution.',
        sourceRef: { file: 'docs/archive/todos/todo.md', legacyId: code },
        url: '',
        comments: []
      });
    }
  } catch (error) {
    throw new Error(`Failed to ingest required archived legacy TODO source "${legacyTodoPath}": ${error.message}`, { cause: error });
  }

  // Import the AI Corporation PR lifecycle IDs. Only PR.14 is still open and is a human approval gate.
  const aiCorporationTodoPath = path.join(
    rootDir,
    'moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md'
  );
  try {
    const aiTodoText = await fs.readFile(aiCorporationTodoPath, 'utf8');
    const importedApprovalCodes = new Set();
    for (const line of aiTodoText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+\*\*(PR\.\d+)\*\*\s+(.*)$/.exec(line);
      if (!match) continue;
      const isDone = match[1].toLowerCase() === 'x';
      const code = match[2];
      const title = match[3].trim();
      importedApprovalCodes.add(code);
      addTask({
        code,
        project: 'moonwitness',
        series: 'PR',
        milestone: 'PROMOTION-GOVERNANCE',
        horizon: 'now',
        title,
        summary: title.slice(0, 140),
        problem: 'Promotion governance requirement recorded in the AI Corporation checklist.',
        proposedSolution: 'Complete the approval/evidence requirement through the protected repository workflow.',
        category: 'governance',
        type: 'documentation',
        priority: 'p0',
        status: isDone ? 'done' : 'blocked',
        human: true,
        owner: 'repo-owner',
        assignee: null,
        risk: 'high',
        effort: 'xs',
        scores: null,
        dependsOn: [],
        blocks: [],
        tags: ['governance', 'promotion', 'ai-corporation'],
        scope: { packages: [], files: ['.github/workflows/promote.yml'] },
        acceptanceCriteria: [
          { id: `${code}-ac-1`, text: title, done: isDone }
        ],
        validation: { commands: ['pnpm promotion:approval-check'], expected: 'Required maintainer approval is present on the exact promotion candidate.' },
        evidence: { paths: [], detailFile: 'moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md', commitSha: null },
        references: ['docs/roadmap/evidence/M12.14.md'],
        blockedReason: isDone ? null : 'Maintainer approval is an explicit human gate; automation must not self-approve.',
        sourceRef: { file: 'moonwitness-ai-corporation-blueprint/docs/roadmap/todo-ai-corporation.md', legacyId: code },
        url: '',
        comments: []
      });
    }
    if (!importedApprovalCodes.has('PR.14')) {
      throw new Error('AI Corporation source is missing the expected PR.14 maintainer-approval gate.');
    }
  } catch (error) {
    throw new Error(`Failed to ingest required AI Corporation task source "${aiCorporationTodoPath}": ${error.message}`, { cause: error });
  }

  // 5. Ingest todo-desktop.md
  try {
    const dskText = await fs.readFile(path.join(rootDir, 'todo-desktop.md'), 'utf8');
    for (const line of dskText.split(/\r?\n/)) {
      const match = /^\s*-\s*\[([ xX])\]\s+\*\*(DSK-[0-9.]+)\*\*\s+(.*)$/.exec(line);
      if (match) {
        const isDone = match[1].toLowerCase() === 'x';
        const code = match[2];
        const title = match[3].trim();
        addTask({
          code,
          project: 'moonwitness',
          series: 'DSK',
          milestone: 'DESKTOP',
          horizon: isDone ? 'now' : 'next',
          title,
          summary: title.slice(0, 140),
          problem: title,
          proposedSolution: 'Complete desktop engineering track deliverable.',
          category: 'dx',
          type: 'feature',
          priority: 'p2',
          status: isDone ? 'done' : 'todo',
          human: false,
          owner: 'desktop-team',
          assignee: null,
          risk: 'low',
          effort: 's',
          scores: null,
          dependsOn: [],
          blocks: [],
          tags: ['desktop', 'tauri'],
          scope: { packages: ['@moonwitness/desktop'], files: [] },
          acceptanceCriteria: [{ id: `${code}-ac-1`, text: title, done: isDone }],
          validation: { commands: ['pnpm --filter @moonwitness/desktop test'], expected: 'Pass' },
          evidence: { paths: [], detailFile: 'todo-desktop.md', commitSha: null },
          references: [],
          blockedReason: null,
          sourceRef: { file: 'todo-desktop.md', legacyId: code },
          url: '',
          comments: []
        });
      }
    }
  } catch (error) {
    throw new Error(`Failed to ingest required Desktop task source todo-desktop.md: ${error.message}`, { cause: error });
  }

  // 6. Ingest evolution/backlog.json
  try {
    const evoText = await fs.readFile(path.join(rootDir, 'evolution/backlog.json'), 'utf8');
    const evo = JSON.parse(evoText);
    for (const candidate of evo.candidates ?? []) {
      const isDone = candidate.status === 'completed';
      const status = isDone ? 'done' : candidate.status === 'active' ? 'doing' : 'todo';
      addTask({
        code: candidate.id,
        project: 'moonwitness',
        series: 'EVO',
        milestone: 'EVOLUTION',
        horizon: isDone ? 'now' : 'now',
        title: candidate.title,
        summary: candidate.title.slice(0, 140),
        problem: candidate.title,
        proposedSolution: 'Fulfill architecture evolution requirement.',
        category: 'architecture',
        type: 'refactor',
        priority: candidate.priority === 'high' ? 'p0' : candidate.priority === 'medium' ? 'p1' : 'p2',
        status,
        human: false,
        owner: 'core-team',
        assignee: null,
        risk: 'low',
        effort: 's',
        scores: null,
        dependsOn: [],
        blocks: [],
        tags: ['evolution', candidate.category ?? 'architecture'],
        scope: { packages: [], files: candidate.targetFiles ?? [] },
        acceptanceCriteria: [{ id: `${candidate.id}-ac-1`, text: candidate.title, done: isDone }],
        validation: { commands: candidate.acceptanceCheck ? [candidate.acceptanceCheck] : [], expected: 'Pass' },
        evidence: { paths: [], detailFile: 'evolution/backlog.json', commitSha: null },
        references: [],
        blockedReason: null,
        sourceRef: { file: 'evolution/backlog.json', legacyId: candidate.id },
        url: '',
        comments: []
      });
    }
  } catch (error) {
    throw new Error(`Failed to ingest required evolution source evolution/backlog.json: ${error.message}`, { cause: error });
  }

  // Import the scoped Visual Universe execution graph without losing its
  // project-specific fields. The global TaskOS record owns lifecycle state;
  // metadata is retained for the generated work-package mirror.
  const visualPackPath = path.join(
    rootDir,
    'MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/task.json'
  );
  try {
    const visualPack = JSON.parse(await fs.readFile(visualPackPath, 'utf8'));
    if (!Array.isArray(visualPack.tasks) || visualPack.tasks.length === 0) {
      throw new Error('Visual Universe task.json has no task records.');
    }
    for (const sourceTask of visualPack.tasks) {
      const statusMap = {
        todo: 'todo',
        in_progress: 'doing',
        blocked: 'blocked',
        done: 'done',
        skipped: 'done'
      };
      if (!statusMap[sourceTask.status]) {
        throw new Error(`Unsupported status "${sourceTask.status}" for ${sourceTask.id}.`);
      }
      const isComplete = sourceTask.status === 'done' || sourceTask.status === 'skipped';
      const tags = ['visual-universe', sourceTask.phase, sourceTask.role].filter(Boolean);
      if (sourceTask.status === 'skipped') tags.push('status:skipped');
      addTask({
        code: sourceTask.id,
        project: 'visual-universe',
        series: sourceTask.phase,
        milestone: sourceTask.phase,
        horizon: 'later',
        title: sourceTask.title,
        summary: (sourceTask.objective ?? sourceTask.title).slice(0, 140),
        problem: sourceTask.objective ?? sourceTask.title,
        proposedSolution: (sourceTask.deliverables ?? []).join('; '),
        category: 'other',
        type: 'other',
        priority: sourceTask.priority === 'P0' ? 'p0' : 'p1',
        status: statusMap[sourceTask.status],
        human: sourceTask.human_approval_required === true,
        owner: sourceTask.role ?? null,
        assignee: null,
        risk: sourceTask.risk ?? null,
        effort: null,
        scores: null,
        dependsOn: sourceTask.depends_on ?? [],
        blocks: [],
        tags,
        scope: { packages: [], files: sourceTask.scope_hints ?? [] },
        acceptanceCriteria: (sourceTask.acceptance_criteria ?? []).map((text, index) => ({
          id: `${sourceTask.id}-ac-${index + 1}`,
          text,
          done: isComplete
        })),
        validation: {
          commands: sourceTask.verification ?? [],
          expected: 'All delegated work-package acceptance criteria are met.'
        },
        evidence: {
          paths: [...new Set((sourceTask.evidence ?? []).map((entry) => entry.artifact).filter(Boolean))],
          detailFile: `MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/tasks/${sourceTask.phase}/${sourceTask.id}.md`,
          commitSha: sourceTask.commit ?? null
        },
        references: sourceTask.scope_hints ?? [],
        blockedReason: sourceTask.status === 'blocked'
          ? sourceTask.notes || 'Blocked in the delegated Visual Universe work package.'
          : null,
        sourceRef: {
          file: 'MWXV_ULTRA_COMPLETE_VISUAL_UNIVERSE_AUTONOMOUS_PACK/task.json',
          legacyId: sourceTask.id
        },
        url: '',
        comments: [],
        metadata: sourceTask
      });
    }
  } catch (error) {
    throw new Error(`Failed to ingest required Visual Universe task source "${visualPackPath}": ${error.message}`, { cause: error });
  }

  // Populate reverse blocks graph
  const codeSet = new Set(tasks.map((t) => t.code));
  const blocksMap = new Map();
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (codeSet.has(dep)) {
        if (!blocksMap.has(dep)) blocksMap.set(dep, []);
        blocksMap.get(dep).push(t.code);
      }
    }
  }
  for (const t of tasks) {
    if (blocksMap.has(t.code)) {
      const merged = new Set([...t.blocks, ...blocksMap.get(t.code)]);
      t.blocks = [...merged];
    }
  }

  return {
    schemaVersion: '2.0.0',
    format: 'moonwitness-tasks/v2',
    generatedAt,
    projects: [
      {
        slug: 'moonwitness',
        name: 'MoonWitness Enterprise Platform',
        repos: ['A-L-L-A-H/mw-xv'],
        color: 'blue',
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done']
      },
      {
        slug: 'visual-universe',
        name: 'MoonWitness Visual Universe',
        repos: ['A-L-L-A-H/mw-xv'],
        color: 'purple',
        statuses: ['backlog', 'todo', 'doing', 'review', 'blocked', 'done']
      }
    ],
    tasks
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  (async () => {
    const targetFile = path.join(rootDir, 'docs/tasks/tasks.json');
    const checkOnly = process.argv.includes('--check');
    const writeEnabled = process.argv.includes('--write');
    if (checkOnly && writeEnabled) {
      throw new Error('Choose only one mode: --check or --write.');
    }

    let generatedAt;
    if (checkOnly) {
      const currentRaw = await fs.readFile(targetFile, 'utf8');
      if (!currentRaw.trim()) {
        throw new Error('TaskOS registry is empty; --check cannot compare against an unavailable canonical registry.');
      }
      generatedAt = JSON.parse(currentRaw).generatedAt;
      if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
        throw new Error('TaskOS registry has no valid generatedAt timestamp for deterministic comparison.');
      }
    }

    const result = await sweepAndConsolidate(
      checkOnly ? { generatedAt } : {}
    );
    const output = `${JSON.stringify(result, null, 2)}\n`;

    if (checkOnly) {
      const currentRaw = await fs.readFile(targetFile, 'utf8');
      if (currentRaw !== output) {
        throw new Error('TaskOS registry differs from deterministic source projection. Review the source inventory before writing.');
      }
      console.log(`TaskOS source projection matches ${result.tasks.length} tasks.`);
      return;
    }

    if (!writeEnabled) {
      console.log(`Dry run: source inventory resolves to ${result.tasks.length} task records. No files changed. Use --write only after reviewing the source inventory.`);
      return;
    }

    const schema = JSON.parse(
      await fs.readFile(path.join(rootDir, 'docs/tasks/tasks.schema.json'), 'utf8')
    );
    const require = createRequire(new URL('../../packages/knowledge/package.json', import.meta.url));
    const Ajv = require('ajv');
    const addFormats = require('ajv-formats');
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    if (!validate(result)) {
      throw new Error(`Refusing to write invalid TaskOS registry: ${JSON.stringify(validate.errors)}`);
    }

    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.writeFile(targetFile, output, 'utf8');
    console.log(`Wrote ${result.tasks.length} validated TaskOS records to ${targetFile}`);
  })().catch((error) => {
    console.error('TaskOS source projection failed:', error);
    process.exit(1);
  });
}
