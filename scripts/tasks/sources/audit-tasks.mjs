// Source-owned audit backlog records. The TaskOS importer only transforms these records.
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-001' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-002' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-003' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-004' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-005' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-006' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-007' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-008' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-009' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-010' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-011' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-012' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-013' },
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
    sourceRef: { file: 'scripts/tasks/sources/audit-tasks.mjs', legacyId: 'AUD-014' },
    url: '',
    comments: []
  }
,
{
    code: 'AUD-015',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Extract a canonical asset review-status resolver for the UI Catalog',
    summary: 'Use one fail-closed resolver for manifest status and license provenance instead of inline status checks.',
    problem: 'AssetBrowser derives blocked status inline from a subset of licenses.json fields. SceneLab has no reusable resolver, so review/blocked/unknown semantics can drift.',
    proposedSolution: 'Create a pure resolver in apps/ui-catalog/src/asset-review-status.ts and route AssetBrowser\'s existing status presentation through it. Return approved, review, blocked or unverified; missing or conflicting metadata must never default to approved.',
    category: 'architecture',
    type: 'refactor',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'ui-catalog',
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [],
    blocks: [
      'AUD-016',
      'AUD-017',
      'AUD-018'
    ],
    tags: [
      'ui-catalog',
      'assets',
      'provenance',
      'review-status'
    ],
    scope: {
      packages: [
        '@moonwitness/ui-catalog',
        '@moonwitness/assets'
      ],
      files: [
        'apps/ui-catalog/src/asset-review-status.ts',
        'apps/ui-catalog/src/AssetBrowser.tsx'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-015-ac-1',
        text: 'One pure function maps manifest and license metadata to approved/review/blocked/unverified.',
        done: false
      },
      {
        id: 'AUD-015-ac-2',
        text: 'Blocked and unverified provenance can never be presented as approved.',
        done: false
      },
      {
        id: 'AUD-015-ac-3',
        text: 'AssetBrowser uses the helper instead of maintaining a second inline status rule.',
        done: false
      },
      {
        id: 'AUD-015-ac-4',
        text: 'Missing provenance is represented as unverified, not approved.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm --filter @moonwitness/ui-catalog build'
      ],
      expected: 'UI Catalog builds with one shared asset review-status resolver.'
    },
    evidence: {
      paths: [],
      detailFile: 'packages/assets/licenses.json',
      commitSha: null
    },
    references: [
      'packages/assets/manifest.json',
      'packages/assets/licenses.json',
      'apps/ui-catalog/src/AssetBrowser.tsx'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-015'
    },
    url: '',
    comments: []
  },
{
    code: 'AUD-016',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Add focused tests for asset review-status mapping',
    summary: 'Lock approved, review, blocked and fail-closed unknown cases in one test file.',
    problem: 'The review-status decision will be shared by AssetBrowser and SceneLab and needs regression coverage before new UI consumers are wired to it.',
    proposedSolution: 'Add one UI Catalog test file importing the pure resolver and covering approved metadata, review-only assets, blocked/unverified licenses, missing provenance and conflicting status.',
    category: 'architecture',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'ui-catalog',
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [
      'AUD-015'
    ],
    blocks: [],
    tags: [
      'ui-catalog',
      'assets',
      'unit-tests'
    ],
    scope: {
      packages: [
        '@moonwitness/ui-catalog'
      ],
      files: [
        'apps/ui-catalog/tests/asset-review-status.spec.ts'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-016-ac-1',
        text: 'Tests cover approved, review, blocked, unverified and conflicting metadata.',
        done: false
      },
      {
        id: 'AUD-016-ac-2',
        text: 'Missing provenance never resolves to approved.',
        done: false
      },
      {
        id: 'AUD-016-ac-3',
        text: 'The focused test runs without adding dependencies or a second application.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm --filter @moonwitness/ui-catalog test -- tests/asset-review-status.spec.ts'
      ],
      expected: 'Focused asset review-status tests pass.'
    },
    evidence: {
      paths: [],
      detailFile: 'packages/assets/licenses.json',
      commitSha: null
    },
    references: [
      'apps/ui-catalog/src/asset-review-status.ts',
      'packages/assets/licenses.json'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-016'
    },
    url: '',
    comments: []
  },
{
    code: 'AUD-017',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Create a reusable SceneLab asset review badge',
    summary: 'Render canonical review state with readable text and non-color-only status cues.',
    problem: 'AssetBrowser has an inline status label, but SceneLab\'s layer inspector does not expose whether an asset is approved, review-only, blocked or unverified.',
    proposedSolution: 'Create AssetReviewBadge.tsx using the shared resolver output. Keep it presentational: no fetching, manifest parsing or second status mapping.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'ui-catalog',
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [
      'AUD-015'
    ],
    blocks: [],
    tags: [
      'ui-catalog',
      'scene-lab',
      'accessibility'
    ],
    scope: {
      packages: [
        '@moonwitness/ui-catalog'
      ],
      files: [
        'apps/ui-catalog/src/AssetReviewBadge.tsx'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-017-ac-1',
        text: 'The component renders a distinct text label for approved, review, blocked and unverified.',
        done: false
      },
      {
        id: 'AUD-017-ac-2',
        text: 'Status is understandable without relying on color alone.',
        done: false
      },
      {
        id: 'AUD-017-ac-3',
        text: 'The component accepts resolved state as props and owns no metadata I/O.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm --filter @moonwitness/ui-catalog build'
      ],
      expected: 'UI Catalog builds with the reusable review badge.'
    },
    evidence: {
      paths: [],
      detailFile: 'packages/assets/licenses.json',
      commitSha: null
    },
    references: [
      'apps/ui-catalog/src/AssetBrowser.tsx',
      'packages/ui/README.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-017'
    },
    url: '',
    comments: []
  },
{
    code: 'AUD-018',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Create a read-only asset provenance details component',
    summary: 'Display creator, source, license, terms and review notes without making approval assumptions.',
    problem: 'licenses.json contains source, creator, license, generated date, terms and distribution notes, but SceneLab\'s inspector currently only shows layer geometry.',
    proposedSolution: 'Create AssetProvenanceDetails.tsx as a presentational component receiving a resolved provenance record. Display available fields and label missing fields as unknown; never synthesize license or approval decisions.',
    category: 'product',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: 'ui-catalog',
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [
      'AUD-015'
    ],
    blocks: [],
    tags: [
      'ui-catalog',
      'scene-lab',
      'provenance'
    ],
    scope: {
      packages: [
        '@moonwitness/ui-catalog',
        '@moonwitness/assets'
      ],
      files: [
        'apps/ui-catalog/src/AssetProvenanceDetails.tsx'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-018-ac-1',
        text: 'Available creator/source/license/terms/generatedOn/distribution fields are rendered.',
        done: false
      },
      {
        id: 'AUD-018-ac-2',
        text: 'Missing fields display an explicit unknown/not-recorded state.',
        done: false
      },
      {
        id: 'AUD-018-ac-3',
        text: 'The component is read-only and performs no network request or metadata mutation.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm --filter @moonwitness/ui-catalog build'
      ],
      expected: 'UI Catalog builds with the read-only provenance component.'
    },
    evidence: {
      paths: [],
      detailFile: 'packages/assets/licenses.json',
      commitSha: null
    },
    references: [
      'packages/assets/licenses.json',
      'apps/ui-catalog/src/AssetBrowser.tsx'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-018'
    },
    url: '',
    comments: []
  },
{
    code: 'AUD-019',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Wire review status and provenance into the SceneLab inspector',
    summary: 'Show canonical asset review state and source provenance beside every scene layer.',
    problem: 'SceneLab currently shows layer ID, z-order, pivot and parallax, while AssetBrowser already consumes manifest/license metadata. Users cannot inspect source/distribution status in the scene layer list.',
    proposedSolution: 'After the active canonical-scene work in GitHub issue #52 is complete, resolve each SceneLab layer to existing manifest/license records and render AssetReviewBadge plus AssetProvenanceDetails. Keep hidden/reorder/scrub controls local; do not create a second metadata registry.',
    category: 'product',
    type: 'feature',
    priority: 'p1',
    status: 'blocked',
    human: false,
    owner: 'ui-catalog',
    assignee: null,
    risk: 'medium',
    effort: 's',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'ui-catalog',
      'scene-lab',
      'asset-provenance'
    ],
    scope: {
      packages: [
        '@moonwitness/ui-catalog',
        '@moonwitness/assets'
      ],
      files: [
        'apps/ui-catalog/src/SceneLab.tsx'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-019-ac-1',
        text: 'Each displayed Moon City layer resolves to the matching canonical manifest and license record.',
        done: false
      },
      {
        id: 'AUD-019-ac-2',
        text: 'Every layer shows a review badge and available provenance details.',
        done: false
      },
      {
        id: 'AUD-019-ac-3',
        text: 'Missing mappings are displayed as unverified/unknown and never approved.',
        done: false
      },
      {
        id: 'AUD-019-ac-4',
        text: 'Existing preview, reorder, hide/show, timeline and mobile controls continue to work.',
        done: false
      },
      {
        id: 'AUD-019-ac-5',
        text: 'Do not edit SceneLab until issue #52 is complete; this task owns the inspector integration after that handoff.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm --filter @moonwitness/ui-catalog build',
        'pnpm --filter @moonwitness/ui-catalog test -- tests/scene-harness.spec.ts'
      ],
      expected: 'SceneLab builds and existing scene harness tests pass.'
    },
    evidence: {
      paths: [],
      detailFile: 'apps/ui-catalog/src/SceneLab.tsx',
      commitSha: null
    },
    references: [
      'apps/ui-catalog/src/SceneLab.tsx',
      'packages/assets/scenes/moon-city-scene.json',
      'packages/assets/manifest.json',
      'packages/assets/licenses.json'
    ],
    blockedReason: 'Canonical SceneLab integration is already owned by existing GitHub issue #53; retain this record for traceability only and do not execute independently. Issue #53 must wait for issue #52.',
    metadata: { supersededByIssue: 53, executionAllowed: false, externalPrerequisiteIssue: 52 },
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-019'
    },
    url: '',
    comments: []
  },
{
    code: 'AUD-020',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Add SceneLab review-status and provenance regression coverage',
    summary: 'Verify all review states and missing provenance are visible in the scene inspector.',
    problem: 'SceneLab needs a focused regression test proving review status and provenance render correctly after the inspector integration.',
    proposedSolution: 'Add one isolated UI Catalog Playwright spec that loads SceneLab and checks representative approved/review/blocked/unverified layer metadata plus the unknown fallback.',
    category: 'architecture',
    type: 'feature',
    priority: 'p2',
    status: 'blocked',
    human: false,
    owner: 'ui-catalog',
    assignee: null,
    risk: 'low',
    effort: 's',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'ui-catalog',
      'scene-lab',
      'e2e'
    ],
    scope: {
      packages: [
        '@moonwitness/ui-catalog'
      ],
      files: [
        'apps/ui-catalog/tests/scene-asset-review.spec.ts'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-020-ac-1',
        text: 'Spec verifies an approved, review, blocked and unverified/unknown layer state.',
        done: false
      },
      {
        id: 'AUD-020-ac-2',
        text: 'Spec verifies available source/license detail and missing-metadata fallback.',
        done: false
      },
      {
        id: 'AUD-020-ac-3',
        text: 'Existing SceneLab scene-harness tests remain unchanged and pass.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm --filter @moonwitness/ui-catalog test -- tests/scene-asset-review.spec.ts'
      ],
      expected: 'Focused SceneLab asset-review test passes.'
    },
    evidence: {
      paths: [],
      detailFile: 'apps/ui-catalog/tests/scene-harness.spec.ts',
      commitSha: null
    },
    references: [
      'apps/ui-catalog/src/SceneLab.tsx',
      'apps/ui-catalog/tests/scene-harness.spec.ts'
    ],
    blockedReason: 'The SceneLab status and missing-metadata tests are already included in existing GitHub issue #53; retain this record for traceability only and do not execute a duplicate task.',
    metadata: { supersededByIssue: 53, executionAllowed: false },
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-020'
    },
    url: '',
    comments: []
  },
{
    code: 'AUD-021',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Cover backward and end-boundary keyboard navigation in the homepage filmstrip',
    summary: 'Add focused keyboard assertions for ArrowLeft and End without changing the existing filmstrip implementation.',
    problem: 'The current public-home test verifies ArrowRight and Home for the horizontal filmstrip, but does not assert the matching backward and end-boundary keys implemented by the component.',
    proposedSolution: 'Add a separate Playwright spec for the existing named filmstrip region. Verify ArrowLeft and End in addition to ArrowRight and Home, without editing the component or existing public-home spec.',
    category: 'architecture',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: 'board-ui',
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'board',
      'homepage',
      'keyboard',
      'accessibility'
    ],
    scope: {
      packages: [
        '@moonwitness/board'
      ],
      files: [
        'apps/board/e2e/home-filmstrip-keyboard.spec.ts'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-021-ac-1',
        text: 'ArrowLeft moves the filmstrip back from a non-zero scroll position.',
        done: false
      },
      {
        id: 'AUD-021-ac-2',
        text: 'End moves to the last scroll position and Home returns to the first.',
        done: false
      },
      {
        id: 'AUD-021-ac-3',
        text: 'The filmstrip region retains keyboard focus after key handling.',
        done: false
      },
      {
        id: 'AUD-021-ac-4',
        text: 'No production component or existing E2E spec is modified.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm --filter @moonwitness/board exec playwright test e2e/home-filmstrip-keyboard.spec.ts --config playwright.config.ts'
      ],
      expected: 'The focused filmstrip keyboard test passes in Chromium.'
    },
    evidence: {
      paths: [],
      detailFile: 'apps/board/src/components/home/horizontal-filmstrip.tsx',
      commitSha: null
    },
    references: [
      'apps/board/src/components/home/horizontal-filmstrip.tsx',
      'apps/board/e2e/public-home.spec.ts'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-021'
    },
    url: '',
    comments: []
  },
{
    code: 'AUD-022',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NOW',
    horizon: 'now',
    title: 'Correct the outdated responsive accessibility coverage note in visual-direction.md',
    summary: 'Align visual-audit documentation with the current Axe checks in visual-audit.spec.ts.',
    problem: 'docs/design/visual-direction.md still says protected mobile/tablet screens are not included in automated Axe coverage, while the current protected-screen loop runs Axe across mobile, tablet and desktop sizes in light and dark themes.',
    proposedSolution: 'Update only the Visual audit coverage paragraph and stale accessibility finding. Record exact route/viewport/theme coverage from the current test; do not imply that automated Axe replaces keyboard or manual review.',
    category: 'documentation',
    type: 'documentation',
    priority: 'p1',
    status: 'todo',
    human: false,
    owner: 'docs',
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'documentation',
      'accessibility',
      'visual-audit'
    ],
    scope: {
      packages: [],
      files: [
        'docs/design/visual-direction.md'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-022-ac-1',
        text: 'The document accurately lists protected dashboard/list/form/profile/settings Axe coverage at 375×812, 768×1024 and 1440×1000.',
        done: false
      },
      {
        id: 'AUD-022-ac-2',
        text: 'The document accurately records light/dark theme coverage.',
        done: false
      },
      {
        id: 'AUD-022-ac-3',
        text: 'The document does not claim automated Axe replaces keyboard, focus, touch or manual review.',
        done: false
      },
      {
        id: 'AUD-022-ac-4',
        text: 'Only docs/design/visual-direction.md is modified.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm test:ui-design-check'
      ],
      expected: 'UI design checks pass and the stated coverage matches the current test source.'
    },
    evidence: {
      paths: [],
      detailFile: 'apps/board/e2e/visual-audit.spec.ts',
      commitSha: null
    },
    references: [
      'apps/board/e2e/visual-audit.spec.ts',
      'docs/design/visual-direction.md'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-022'
    },
    url: '',
    comments: []
  },
{
    code: 'AUD-023',
    project: 'moonwitness',
    series: 'AUD',
    milestone: 'AUDIT-NEXT',
    horizon: 'next',
    title: 'Verify desktop and mobile source selection for the homepage hero picture',
    summary: 'Add a focused responsive-image contract test for the existing HomeHeroArt picture element.',
    problem: 'The current public-home tests cover hero fallback and reveal, but do not explicitly assert that the picture source switches between mobile and desktop artwork at the declared 600px breakpoint.',
    proposedSolution: 'Add one Playwright spec that checks currentSrc selects home-hero-mobile.webp at 390px and home-hero-desktop.webp at 1440px. Keep the media rule and production component unchanged.',
    category: 'architecture',
    type: 'feature',
    priority: 'p2',
    status: 'todo',
    human: false,
    owner: 'board-ui',
    assignee: null,
    risk: 'low',
    effort: 'xs',
    scores: null,
    dependsOn: [],
    blocks: [],
    tags: [
      'board',
      'homepage',
      'responsive-images',
      'e2e'
    ],
    scope: {
      packages: [
        '@moonwitness/board'
      ],
      files: [
        'apps/board/e2e/home-hero-picture.spec.ts'
      ]
    },
    acceptanceCriteria: [
      {
        id: 'AUD-023-ac-1',
        text: 'At 390px, hero image currentSrc resolves to /illustrations/home-hero-mobile.webp.',
        done: false
      },
      {
        id: 'AUD-023-ac-2',
        text: 'At 1440px, hero image currentSrc resolves to /illustrations/home-hero-desktop.webp.',
        done: false
      },
      {
        id: 'AUD-023-ac-3',
        text: 'The test waits for successful image decode and changes no production files.',
        done: false
      },
      {
        id: 'AUD-023-ac-4',
        text: 'No duplicate fallback or hero animation test is introduced.',
        done: false
      }
    ],
    validation: {
      commands: [
        'pnpm --filter @moonwitness/board exec playwright test e2e/home-hero-picture.spec.ts --config playwright.config.ts'
      ],
      expected: 'The focused responsive image source test passes in Chromium.'
    },
    evidence: {
      paths: [],
      detailFile: 'apps/board/src/components/home/home-hero-art.tsx',
      commitSha: null
    },
    references: [
      'apps/board/src/components/home/home-hero-art.tsx',
      'apps/board/e2e/public-home.spec.ts'
    ],
    blockedReason: null,
    sourceRef: {
      file: 'scripts/tasks/sources/audit-tasks.mjs',
      legacyId: 'AUD-023'
    },
    url: '',
    comments: []
  }
];
