import { createHash } from 'node:crypto';
import {
  DEFAULT_LOCAL_AI_TIMEOUT_MS,
  discoverLocalAiProviders,
  isLoopbackEndpointUrl,
  type LocalAiDiscoveredModel,
  type LocalAiProviderKind,
} from './local-ai-discovery.js';
import { DesktopRiskGate } from './risk-gate.js';
import type {
  DesktopActionAuthContext,
  GitWorktreeLease,
  RiskEvaluationDecision,
  RiskTier,
} from './types.js';
import type { WorktreeSandbox } from './worktree-sandbox.js';

export type AssistantExperienceMode = 'workspace' | 'developer';

export type WorkspaceAssistantAction =
  'summarize_tasks' | 'draft_note' | 'search_knowledge' | 'chat';

export interface WorkspaceAssistantTaskContext {
  readonly id: string;
  readonly code?: string;
  readonly title: string;
  readonly status?: string;
  readonly priority?: string;
  readonly description?: string;
}

export interface WorkspaceAssistantKnowledgeItem {
  readonly id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly kind?: 'note' | 'knowledge';
}

export interface WorkspaceAssistantCitation {
  readonly id: string;
  readonly title: string;
  readonly kind: 'task' | 'note' | 'knowledge';
}

export interface WorkspaceAssistantInput {
  readonly mode: AssistantExperienceMode;
  readonly action: WorkspaceAssistantAction;
  readonly prompt: string;
  readonly tasks?: readonly WorkspaceAssistantTaskContext[];
  readonly knowledge?: readonly WorkspaceAssistantKnowledgeItem[];
  readonly endpoint?: string;
  readonly providerKind?: LocalAiProviderKind;
  readonly model?: string;
  readonly autoDiscover?: boolean;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface WorkspaceAssistantResult {
  readonly mode: AssistantExperienceMode;
  readonly action: WorkspaceAssistantAction;
  readonly riskTier: 'R0';
  readonly readOnly: true;
  readonly provider: 'ollama' | 'openai_compat' | 'offline_fallback';
  readonly model: string;
  readonly reply: string;
  readonly highlights: readonly string[];
  readonly citations: readonly WorkspaceAssistantCitation[];
  readonly digest: string;
  readonly durationMs: number;
  readonly fallbackReason?: string;
}

export interface TaskAgentProofGateItem {
  readonly id: string;
  readonly label: string;
  readonly status: 'passed' | 'pending' | 'failed';
  readonly detail: string;
}

export interface TaskAgentPacketPreview {
  readonly runId: string;
  readonly taskId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly model: string;
  readonly baseRef: string;
  readonly allowedPaths: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly steps: readonly string[];
}

export interface DispatchTaskAgentRunInput {
  readonly mode: AssistantExperienceMode;
  readonly taskId: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly runId?: string;
  readonly model?: string;
  readonly baseRef?: string;
  readonly allowedPaths?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly auth: DesktopActionAuthContext;
  readonly riskGate?: DesktopRiskGate;
  readonly sandbox?: WorktreeSandbox;
  readonly acquireWorktree?: boolean;
  readonly now?: Date;
}

export interface DispatchTaskAgentRunResult {
  readonly allowed: boolean;
  readonly status: 'dispatched' | 'preview' | 'denied';
  readonly mode: AssistantExperienceMode;
  readonly runId: string;
  readonly riskTier: RiskTier;
  readonly reasonCode: string;
  readonly reason: string;
  readonly digest: string;
  readonly packet: TaskAgentPacketPreview;
  readonly proofGateChecklist: readonly TaskAgentProofGateItem[];
  readonly decision?: RiskEvaluationDecision;
  readonly worktreeLease?: GitWorktreeLease;
}

function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeRunId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  const prefixed = /^[a-zA-Z0-9]/u.test(cleaned) ? cleaned : `run-${cleaned || 'task'}`;
  return prefixed.slice(0, 64);
}

function resolveChatEndpoint(rawEndpoint: string, providerKind: LocalAiProviderKind): string {
  const parsed = new URL(rawEndpoint);
  if (providerKind === 'ollama') {
    if (
      parsed.pathname === '' ||
      parsed.pathname === '/' ||
      parsed.pathname.endsWith('/api/tags')
    ) {
      parsed.pathname = '/api/chat';
    }
    return parsed.toString();
  }
  if (parsed.pathname === '' || parsed.pathname === '/' || parsed.pathname.endsWith('/v1/models')) {
    parsed.pathname = '/v1/chat/completions';
  }
  return parsed.toString();
}

function extractCitations(
  tasks: readonly WorkspaceAssistantTaskContext[],
  knowledge: readonly WorkspaceAssistantKnowledgeItem[],
  prompt: string
): WorkspaceAssistantCitation[] {
  const citations: WorkspaceAssistantCitation[] = [];
  const lowerPrompt = prompt.trim().toLowerCase();
  const terms = lowerPrompt
    .split(/\s+/u)
    .map((term) => term.replace(/[^a-z0-9_-]/gu, ''))
    .filter((term) => term.length >= 3);

  for (const task of tasks.slice(0, 8)) {
    citations.push({
      id: task.id,
      title: task.code ? `${task.code}: ${task.title}` : task.title,
      kind: 'task',
    });
  }

  for (const item of knowledge) {
    const haystack = `${item.title} ${item.excerpt}`.toLowerCase();
    const matches = terms.length === 0 || terms.some((term) => haystack.includes(term));
    if (matches) {
      citations.push({
        id: item.id,
        title: item.title,
        kind: item.kind ?? 'knowledge',
      });
    }
    if (citations.length >= 12) break;
  }

  return citations;
}

function buildOfflineFallback(
  input: WorkspaceAssistantInput,
  citations: readonly WorkspaceAssistantCitation[]
): { readonly reply: string; readonly highlights: readonly string[] } {
  const tasks = input.tasks ?? [];
  const knowledge = input.knowledge ?? [];
  const trimmedPrompt = input.prompt.trim();

  if (input.action === 'summarize_tasks') {
    if (tasks.length === 0) {
      return {
        reply: 'No active tasks were provided to summarize.',
        highlights: ['Add or select tasks on your board to generate a summary.'],
      };
    }

    const statusCounts = new Map<string, number>();
    for (const task of tasks) {
      const key = (task.status ?? 'open').trim() || 'open';
      statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
    }

    const statusSummary = [...statusCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');

    const highlights = tasks.slice(0, 5).map((task) => {
      const label = task.code ? `${task.code} - ${task.title}` : task.title;
      const status = task.status ? ` [${task.status}]` : '';
      return `${label}${status}`;
    });

    return {
      reply: `Offline summary for ${tasks.length} task(s) (${statusSummary}).`,
      highlights,
    };
  }

  if (input.action === 'draft_note') {
    const heading = trimmedPrompt.length > 0 ? trimmedPrompt : 'Workspace Note';
    const taskLines = tasks.slice(0, 3).map((task) => `- ${task.title}`);
    const bodyParts = [
      `# ${heading}`,
      '',
      '## Key Points',
      ...(taskLines.length > 0 ? taskLines : ['- Capture goals, owners, and next steps.']),
    ];
    return {
      reply: bodyParts.join('\n'),
      highlights: [
        `Drafted structured note for "${heading}"`,
        `Referenced ${tasks.length} task(s) and ${knowledge.length} knowledge item(s)`,
      ],
    };
  }

  if (input.action === 'search_knowledge') {
    const queryTerms = trimmedPrompt
      .toLowerCase()
      .split(/\s+/u)
      .filter((term) => term.length >= 2);
    const matches = knowledge.filter((item) => {
      if (queryTerms.length === 0) return true;
      const text = `${item.title} ${item.excerpt}`.toLowerCase();
      return queryTerms.some((term) => text.includes(term));
    });

    if (matches.length === 0) {
      return {
        reply: `No local knowledge matches found for "${trimmedPrompt || 'your query'}".`,
        highlights: ['Try broader keywords or add notes to your workspace knowledge base.'],
      };
    }

    return {
      reply: `Found ${matches.length} matching knowledge item(s) for "${trimmedPrompt || 'workspace'}".`,
      highlights: matches.slice(0, 5).map((item) => `${item.title}: ${item.excerpt.slice(0, 120)}`),
    };
  }

  return {
    reply:
      trimmedPrompt.length > 0
        ? `Offline assistant response (read-only): reviewed ${tasks.length} task(s) and ${knowledge.length} knowledge item(s) for "${trimmedPrompt}".`
        : `Offline assistant ready (read-only): ${citations.length} workspace item(s) in context.`,
    highlights: citations.slice(0, 4).map((item) => `${item.kind}: ${item.title}`),
  };
}

function buildSystemPrompt(
  mode: AssistantExperienceMode,
  action: WorkspaceAssistantAction
): string {
  const role =
    mode === 'workspace'
      ? 'You are MoonWitness Assistant, a helpful read-only workspace assistant for tasks, notes, and knowledge. Avoid developer or shell jargon.'
      : 'You are MoonWitness Assistant operating in read-only R0 mode. Summarize tasks, draft notes, and answer questions concisely without executing commands.';
  return `${role} Current action: ${action}.`;
}

function buildUserContextPrompt(input: WorkspaceAssistantInput): string {
  const sections: string[] = [input.prompt.trim() || `Perform action: ${input.action}`];

  if (input.tasks && input.tasks.length > 0) {
    const taskLines = input.tasks.slice(0, 12).map((task) => {
      const codePrefix = task.code ? `[${task.code}] ` : '';
      const statusSuffix = task.status ? ` (${task.status})` : '';
      return `- ${codePrefix}${task.title}${statusSuffix}`;
    });
    sections.push(`Tasks:\n${taskLines.join('\n')}`);
  }

  if (input.knowledge && input.knowledge.length > 0) {
    const knowledgeLines = input.knowledge
      .slice(0, 8)
      .map((item) => `- ${item.title}: ${item.excerpt.slice(0, 240)}`);
    sections.push(`Knowledge:\n${knowledgeLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

function extractReplyFromOllama(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.message) && typeof payload.message.content === 'string') {
    const text = payload.message.content.trim();
    return text.length > 0 ? text : null;
  }
  if (typeof payload.response === 'string' && payload.response.trim().length > 0) {
    return payload.response.trim();
  }
  return null;
}

function extractReplyFromOpenAiCompat(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    return null;
  }
  const first = payload.choices[0];
  if (!isRecord(first)) return null;
  if (isRecord(first.message) && typeof first.message.content === 'string') {
    const text = first.message.content.trim();
    return text.length > 0 ? text : null;
  }
  if (typeof first.text === 'string' && first.text.trim().length > 0) {
    return first.text.trim();
  }
  return null;
}

async function queryLoopbackLlm(params: {
  readonly endpoint: string;
  readonly providerKind: LocalAiProviderKind;
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof fetch;
}): Promise<{ readonly provider: 'ollama' | 'openai_compat'; readonly reply: string }> {
  const resolvedUrl = resolveChatEndpoint(params.endpoint, params.providerKind);
  if (!isLoopbackEndpointUrl(resolvedUrl)) {
    throw new Error('Non-loopback endpoint rejected by loopback policy');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const isOllama = params.providerKind === 'ollama';
    const body = isOllama
      ? {
          model: params.model,
          stream: false,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
        }
      : {
          model: params.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
        };

    const response = await params.fetchImpl(resolvedUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Local LLM HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    const reply = isOllama
      ? extractReplyFromOllama(payload)
      : extractReplyFromOpenAiCompat(payload);

    if (!reply) {
      throw new Error('Local LLM returned empty response');
    }

    return {
      provider: isOllama ? 'ollama' : 'openai_compat',
      reply,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runWorkspaceAssistant(
  input: WorkspaceAssistantInput
): Promise<WorkspaceAssistantResult> {
  const startedAt = Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs =
    typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? Math.floor(input.timeoutMs)
      : DEFAULT_LOCAL_AI_TIMEOUT_MS;
  const tasks = input.tasks ?? [];
  const knowledge = input.knowledge ?? [];
  const citations = extractCitations(tasks, knowledge, input.prompt);

  let targetEndpoint = input.endpoint?.trim() ?? '';
  let targetProviderKind: LocalAiProviderKind = input.providerKind ?? 'ollama';
  let targetModel = input.model?.trim() ?? '';
  let fallbackReason: string | undefined;

  if (targetEndpoint.length > 0 && !isLoopbackEndpointUrl(targetEndpoint)) {
    fallbackReason = 'Non-loopback endpoint rejected by loopback policy';
    targetEndpoint = '';
  }

  if (!targetEndpoint && !fallbackReason && input.autoDiscover !== false) {
    try {
      const discovery = await discoverLocalAiProviders({
        timeoutMs,
        fetchImpl,
      });
      const chosen: LocalAiDiscoveredModel | undefined =
        discovery.models.find((m) => m.id === targetModel) ??
        discovery.models.find(
          (m) =>
            m.id ===
            (input.mode === 'developer'
              ? discovery.recommendedDevModel
              : discovery.recommendedWorkspaceModel)
        ) ??
        discovery.models[0];

      if (chosen) {
        targetEndpoint = chosen.endpoint;
        targetProviderKind = chosen.providerKind;
        targetModel = targetModel || chosen.id;
      } else {
        fallbackReason = 'No local loopback LLM detected';
      }
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : 'Local AI discovery failed';
    }
  }

  if (targetEndpoint && !fallbackReason) {
    try {
      const modelName = targetModel || 'llama3.2';
      const llmResult = await queryLoopbackLlm({
        endpoint: targetEndpoint,
        providerKind: targetProviderKind,
        model: modelName,
        systemPrompt: buildSystemPrompt(input.mode, input.action),
        userPrompt: buildUserContextPrompt(input),
        timeoutMs,
        fetchImpl,
      });

      const highlights = llmResult.reply
        .split(/\r?\n/u)
        .map((line) => line.replace(/^[-*•]\s*/u, '').trim())
        .filter((line) => line.length > 0)
        .slice(0, 5);

      const digest = sha256Hex(
        JSON.stringify({
          mode: input.mode,
          action: input.action,
          provider: llmResult.provider,
          model: modelName,
          reply: llmResult.reply,
        })
      );

      return {
        mode: input.mode,
        action: input.action,
        riskTier: 'R0',
        readOnly: true,
        provider: llmResult.provider,
        model: modelName,
        reply: llmResult.reply,
        highlights,
        citations,
        digest,
        durationMs: Math.max(0, Date.now() - startedAt),
      };
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : 'Local LLM request failed';
    }
  }

  const offline = buildOfflineFallback(input, citations);
  const digest = sha256Hex(
    JSON.stringify({
      mode: input.mode,
      action: input.action,
      provider: 'offline_fallback',
      reply: offline.reply,
    })
  );

  return {
    mode: input.mode,
    action: input.action,
    riskTier: 'R0',
    readOnly: true,
    provider: 'offline_fallback',
    model: 'offline-deterministic-v1',
    reply: offline.reply,
    highlights: offline.highlights,
    citations,
    digest,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

export async function dispatchTaskAgentRun(
  input: DispatchTaskAgentRunInput
): Promise<DispatchTaskAgentRunResult> {
  const runId = sanitizeRunId(input.runId ?? `task-${input.code || input.taskId}`);
  const model = input.model?.trim() || 'qwen2.5-coder:7b';
  const baseRef = input.baseRef?.trim() || 'HEAD';
  const allowedPaths = input.allowedPaths ?? [];
  const verificationCommands =
    input.verificationCommands && input.verificationCommands.length > 0
      ? input.verificationCommands
      : ['pnpm typecheck', 'pnpm test'];

  const packet: TaskAgentPacketPreview = {
    runId,
    taskId: input.taskId,
    code: input.code,
    title: input.title,
    description: input.description,
    model,
    baseRef,
    allowedPaths,
    verificationCommands,
    steps: [
      `Verify risk gate grant for ${input.code} (${input.title})`,
      `Acquire isolated Git worktree from ${baseRef}`,
      `Execute scoped plan with local model ${model}`,
      `Run proof-gate checks: ${verificationCommands.join(', ')}`,
    ],
  };

  const digest = sha256Hex(JSON.stringify(packet));

  if (input.mode !== 'developer') {
    const checklist: TaskAgentProofGateItem[] = [
      {
        id: 'mode-gate',
        label: 'Developer (DX) Mode Required',
        status: 'failed',
        detail: 'Workspace Mode is strictly R0 read-only; autonomous task agents are disabled.',
      },
      {
        id: 'worktree-isolation',
        label: 'Isolated Git Worktree',
        status: 'pending',
        detail: 'Skipped because Developer Mode is inactive.',
      },
      {
        id: 'proof-verification',
        label: 'Verification Commands',
        status: 'pending',
        detail: verificationCommands.join(', '),
      },
    ];

    return {
      allowed: false,
      status: 'denied',
      mode: input.mode,
      runId,
      riskTier: 'R1',
      reasonCode: 'WORKSPACE_MODE_READ_ONLY',
      reason: 'Autonomous task agent dispatch is only allowed in Developer (DX) mode.',
      digest,
      packet,
      proofGateChecklist: checklist,
    };
  }

  const riskGate = input.riskGate ?? new DesktopRiskGate();
  const decision = riskGate.evaluate({
    runId,
    action: 'worktree.create',
    companyId: input.auth.companyId,
    agentId: input.auth.agentId,
    workContractId: input.auth.workContractId,
    expectedPolicyVersion: input.auth.expectedPolicyVersion,
    dataClassification: input.auth.dataClassification,
    grant: input.auth.grant,
    humanApproval: input.auth.humanApproval,
    now: input.now,
  });

  if (!decision.allowed) {
    const checklist: TaskAgentProofGateItem[] = [
      {
        id: 'risk-gate',
        label: 'DesktopRiskGate Policy & Grant',
        status: 'failed',
        detail: `${decision.reasonCode}: ${decision.reason}`,
      },
      {
        id: 'worktree-isolation',
        label: 'Isolated Git Worktree',
        status: 'pending',
        detail: 'Not acquired because risk gate denied the request.',
      },
      {
        id: 'proof-verification',
        label: 'Verification Commands',
        status: 'pending',
        detail: verificationCommands.join(', '),
      },
    ];

    return {
      allowed: false,
      status: 'denied',
      mode: input.mode,
      runId,
      riskTier: decision.resolvedTier,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      digest,
      packet,
      proofGateChecklist: checklist,
      decision,
    };
  }

  let worktreeLease: GitWorktreeLease | undefined;
  const shouldAcquire = Boolean(input.sandbox) && input.acquireWorktree !== false;
  if (shouldAcquire && input.sandbox) {
    worktreeLease = await input.sandbox.acquire({
      runId,
      baseRef,
      ...(allowedPaths.length > 0 ? { allowedPaths } : {}),
    });
  }

  const checklist: TaskAgentProofGateItem[] = [
    {
      id: 'risk-gate',
      label: 'DesktopRiskGate Policy & Grant',
      status: 'passed',
      detail: `Allowed (${decision.resolvedTier}, grant ${input.auth.grant.grantId})`,
    },
    {
      id: 'worktree-isolation',
      label: 'Isolated Git Worktree',
      status: worktreeLease ? 'passed' : 'pending',
      detail: worktreeLease
        ? `Branch ${worktreeLease.branchName} at ${worktreeLease.worktreePath}`
        : 'Preview mode — worktree will be acquired on dispatch.',
    },
    {
      id: 'proof-verification',
      label: 'Verification Commands',
      status: 'pending',
      detail: verificationCommands.join(', '),
    },
  ];

  return {
    allowed: true,
    status: worktreeLease ? 'dispatched' : 'preview',
    mode: input.mode,
    runId,
    riskTier: decision.resolvedTier,
    reasonCode: decision.reasonCode,
    reason: worktreeLease
      ? `Task ${input.code} dispatched in isolated worktree ${worktreeLease.branchName}.`
      : `Deterministic execution packet preview ready for ${input.code}.`,
    digest,
    packet,
    proofGateChecklist: checklist,
    decision,
    ...(worktreeLease ? { worktreeLease } : {}),
  };
}
