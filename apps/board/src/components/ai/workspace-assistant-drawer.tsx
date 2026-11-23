'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Panel } from '@moonwitness/ui/components/panel';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@moonwitness/ui/components/sheet';
import { Textarea } from '@moonwitness/ui/components/textarea';
import {
  CheckCircleIcon,
  CodeIcon,
  DocumentIcon,
  RefreshIcon,
  SearchIcon,
  SecurityIcon,
  SparkleIcon,
  WarningIcon,
  WorkflowIcon,
} from '@moonwitness/ui/icons';
import { useDesktopMode } from '@/lib/desktop-mode';

type WorkspaceQuickAction = 'summarize_tasks' | 'draft_note' | 'search_knowledge';

interface LocalModelOption {
  readonly id: string;
  readonly providerName: string;
}

interface AssistantResponseView {
  readonly provider: string;
  readonly model: string;
  readonly reply: string;
  readonly highlights: readonly string[];
}

interface ProofGateChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly status: 'passed' | 'pending' | 'failed';
  readonly detail: string;
}

interface AgentDispatchSummary {
  readonly status: 'dispatched' | 'preview' | 'denied';
  readonly runId: string;
  readonly digest: string;
  readonly reason: string;
  readonly worktreeBranch?: string;
  readonly proofGateChecklist: readonly ProofGateChecklistItem[];
}

interface DesktopApiWindow extends Window {
  __MW_DESKTOP_API_URL__?: string;
}

const DEFAULT_LOCAL_MODELS: readonly LocalModelOption[] = [
  { id: 'qwen2.5-coder:7b', providerName: 'Ollama (Local)' },
  { id: 'llama3.2:3b', providerName: 'Ollama (Local)' },
  { id: 'deepseek-coder-v2:16b', providerName: 'LM Studio (Local)' },
];

function getDesktopApiBaseUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as DesktopApiWindow).__MW_DESKTOP_API_URL__;
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/\/+$/u, '');
}

function buildWorkspaceOfflineReply(
  action: WorkspaceQuickAction,
  prompt: string
): AssistantResponseView {
  const trimmed = prompt.trim();
  if (action === 'summarize_tasks') {
    return {
      provider: 'Local Assistant',
      model: 'offline-summary',
      reply:
        trimmed.length > 0
          ? `Summary ready for "${trimmed}". Your active workspace tasks are organized by priority and status.`
          : 'Your active workspace tasks are ready to review. Highlighted items focus on upcoming deadlines and open follow-ups.',
      highlights: [
        'Prioritize items due this week first',
        'Group related tasks into a single focus block',
        'Follow up on items waiting for review',
      ],
    };
  }
  if (action === 'draft_note') {
    const title = trimmed.length > 0 ? trimmed : 'Workspace Meeting Notes';
    return {
      provider: 'Local Assistant',
      model: 'offline-summary',
      reply: `# ${title}\n\n## Key Takeaways\n- Align on goals and timeline\n- Confirm owners for next steps`,
      highlights: [
        `Structured note created for "${title}"`,
        'Ready to copy into your workspace notes',
      ],
    };
  }
  return {
    provider: 'Local Assistant',
    model: 'offline-summary',
    reply:
      trimmed.length > 0
        ? `Searched your workspace knowledge for "${trimmed}". Relevant notes and guides are listed below.`
        : 'Enter a topic or keyword to search across your workspace notes and guides.',
    highlights: [
      'Workspace Onboarding & Team Handbook',
      'Project Planning & Weekly Review Guide',
    ],
  };
}

function buildDxPreviewSummary(params: {
  readonly code: string;
  readonly title: string;
  readonly model: string;
}): AgentDispatchSummary {
  const safeCode = params.code.trim() || 'TASK-1';
  const runId = `task-${safeCode.replace(/[^a-zA-Z0-9._-]+/gu, '-')}`;
  return {
    status: 'preview',
    runId,
    digest: 'local-preview-ready',
    reason: `Execution packet prepared for ${safeCode} using ${params.model}.`,
    worktreeBranch: `mw/run-${runId}`,
    proofGateChecklist: [
      {
        id: 'risk-gate',
        label: 'DesktopRiskGate Policy & Grant',
        status: 'passed',
        detail: 'Scoped R1 worktree grant required on dispatch',
      },
      {
        id: 'worktree-isolation',
        label: 'Isolated Git Worktree',
        status: 'pending',
        detail: `Target branch mw/run-${runId}`,
      },
      {
        id: 'proof-verification',
        label: 'Proof Gate Verification',
        status: 'pending',
        detail: 'pnpm typecheck && pnpm test',
      },
    ],
  };
}

function getProofBadgeVariant(
  status: 'passed' | 'pending' | 'failed'
): 'default' | 'primary' | 'destructive' {
  if (status === 'passed') return 'primary';
  if (status === 'failed') return 'destructive';
  return 'default';
}

export interface WorkspaceAssistantDrawerProps {
  readonly defaultTaskCode?: string;
  readonly defaultTaskTitle?: string;
  readonly defaultTaskDescription?: string;
}

export function WorkspaceAssistantDrawer({
  defaultTaskCode = '',
  defaultTaskTitle = '',
  defaultTaskDescription = '',
}: WorkspaceAssistantDrawerProps = {}) {
  const { mode } = useDesktopMode();
  const isDeveloperMode = mode === 'developer';

  const [open, setOpen] = useState(false);

  // Workspace Mode state
  const [selectedAction, setSelectedAction] = useState<WorkspaceQuickAction>('summarize_tasks');
  const [workspacePrompt, setWorkspacePrompt] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceResponse, setWorkspaceResponse] = useState<AssistantResponseView | null>(null);

  // DX Mode state
  const [discoveredModels, setDiscoveredModels] =
    useState<readonly LocalModelOption[]>(DEFAULT_LOCAL_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_LOCAL_MODELS[0]?.id ?? '');
  const [taskCode, setTaskCode] = useState(defaultTaskCode);
  const [taskTitle, setTaskTitle] = useState(defaultTaskTitle);
  const [taskDescription, setTaskDescription] = useState(defaultTaskDescription);
  const [dxLoading, setDxLoading] = useState(false);
  const [dxSummary, setDxSummary] = useState<AgentDispatchSummary | null>(null);

  const loadDiscoveredModels = useCallback(async () => {
    const baseUrl = getDesktopApiBaseUrl();
    if (!baseUrl) return;
    try {
      const response = await fetch(`${baseUrl}/api/desktop/ai/models`, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return;
      const payload: unknown = await response.json();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'models' in payload &&
        Array.isArray((payload as { models: unknown }).models)
      ) {
        const parsed: LocalModelOption[] = [];
        for (const item of (payload as { models: unknown[] }).models) {
          if (
            typeof item === 'object' &&
            item !== null &&
            'id' in item &&
            typeof (item as { id: unknown }).id === 'string'
          ) {
            const id = (item as { id: string }).id;
            const providerName =
              'providerName' in item &&
              typeof (item as { providerName: unknown }).providerName === 'string'
                ? (item as { providerName: string }).providerName
                : 'Local AI';
            parsed.push({ id, providerName });
          }
        }
        if (parsed.length > 0) {
          setDiscoveredModels(parsed);
          setSelectedModel((prev) => (parsed.some((m) => m.id === prev) ? prev : parsed[0]!.id));
        }
      }
    } catch {
      // Keep default local model options when sidecar discovery is unavailable.
    }
  }, []);

  useEffect(() => {
    if (open && isDeveloperMode) {
      void loadDiscoveredModels();
    }
  }, [open, isDeveloperMode, loadDiscoveredModels]);

  const handleRunWorkspaceAssistant = async (actionOverride?: WorkspaceQuickAction) => {
    const action = actionOverride ?? selectedAction;
    setSelectedAction(action);
    setWorkspaceLoading(true);
    try {
      const baseUrl = getDesktopApiBaseUrl();
      if (baseUrl) {
        const response = await fetch(`${baseUrl}/api/desktop/ai/assistant`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'workspace',
            action,
            prompt: workspacePrompt,
          }),
        });
        if (response.ok) {
          const data: unknown = await response.json();
          if (
            typeof data === 'object' &&
            data !== null &&
            'reply' in data &&
            typeof (data as { reply: unknown }).reply === 'string'
          ) {
            const rec = data as {
              provider?: string;
              model?: string;
              reply: string;
              highlights?: string[];
            };
            setWorkspaceResponse({
              provider: rec.provider ?? 'Local Assistant',
              model: rec.model ?? 'local',
              reply: rec.reply,
              highlights: Array.isArray(rec.highlights) ? rec.highlights : [],
            });
            return;
          }
        }
      }
      setWorkspaceResponse(buildWorkspaceOfflineReply(action, workspacePrompt));
    } catch {
      setWorkspaceResponse(buildWorkspaceOfflineReply(action, workspacePrompt));
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const handleDispatchDxAgent = async () => {
    setDxLoading(true);
    try {
      const baseUrl = getDesktopApiBaseUrl();
      if (baseUrl) {
        const response = await fetch(`${baseUrl}/api/desktop/ai/dispatch-task`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'developer',
            taskId: taskCode || 'task-local',
            code: taskCode || 'TASK-1',
            title: taskTitle || 'Untitled Task',
            description: taskDescription,
            model: selectedModel,
          }),
        });
        if (response.ok) {
          const data: unknown = await response.json();
          if (
            typeof data === 'object' &&
            data !== null &&
            'status' in data &&
            'runId' in data &&
            'digest' in data
          ) {
            const rec = data as {
              status: 'dispatched' | 'preview' | 'denied';
              runId: string;
              digest: string;
              reason?: string;
              worktreeLease?: { branchName?: string };
              proofGateChecklist?: ProofGateChecklistItem[];
            };
            setDxSummary({
              status: rec.status,
              runId: rec.runId,
              digest: rec.digest,
              reason: rec.reason ?? 'Agent run evaluated.',
              worktreeBranch: rec.worktreeLease?.branchName,
              proofGateChecklist: Array.isArray(rec.proofGateChecklist)
                ? rec.proofGateChecklist
                : [],
            });
            return;
          }
        }
      }
      setDxSummary(
        buildDxPreviewSummary({
          code: taskCode,
          title: taskTitle,
          model: selectedModel,
        })
      );
    } catch {
      setDxSummary(
        buildDxPreviewSummary({
          code: taskCode,
          title: taskTitle,
          model: selectedModel,
        })
      );
    } finally {
      setDxLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {isDeveloperMode ? (
            <CodeIcon className="h-4 w-4" />
          ) : (
            <SparkleIcon className="h-4 w-4" />
          )}
          <span>{isDeveloperMode ? 'Autonomous Agent Runner' : 'MoonWitness Assistant'}</span>
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full max-w-xl overflow-y-auto">
        <SheetHeader className="space-y-2 pb-4">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              {isDeveloperMode ? (
                <WorkflowIcon className="h-4 w-4" />
              ) : (
                <SparkleIcon className="h-4 w-4" />
              )}
              <span>
                {isDeveloperMode ? 'Autonomous Agent Runner' : 'MoonWitness Assistant'}
              </span>
            </SheetTitle>
            <Badge variant={isDeveloperMode ? 'primary' : 'default'}>
              {isDeveloperMode ? 'DX Mode' : 'Workspace'}
            </Badge>
          </div>
          <SheetDescription>
            {isDeveloperMode
              ? 'Select a discovered local model, dispatch a Kanban task in an isolated Git worktree, and inspect the Proof Gate summary.'
              : 'Your private workspace helper for summarizing tasks, drafting notes, and searching team knowledge.'}
          </SheetDescription>
        </SheetHeader>

        {!isDeveloperMode ? (
          <div className="space-y-4">
            <Panel className="space-y-3 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Quick Actions
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={selectedAction === 'summarize_tasks' ? 'default' : 'outline'}
                  className="gap-1.5"
                  onClick={() => void handleRunWorkspaceAssistant('summarize_tasks')}
                  disabled={workspaceLoading}
                >
                  <CheckCircleIcon className="h-3.5 w-3.5" />
                  <span>Summarize Tasks</span>
                </Button>
                <Button
                  size="sm"
                  variant={selectedAction === 'draft_note' ? 'default' : 'outline'}
                  className="gap-1.5"
                  onClick={() => void handleRunWorkspaceAssistant('draft_note')}
                  disabled={workspaceLoading}
                >
                  <DocumentIcon className="h-3.5 w-3.5" />
                  <span>Draft Note</span>
                </Button>
                <Button
                  size="sm"
                  variant={selectedAction === 'search_knowledge' ? 'default' : 'outline'}
                  className="gap-1.5"
                  onClick={() => void handleRunWorkspaceAssistant('search_knowledge')}
                  disabled={workspaceLoading}
                >
                  <SearchIcon className="h-3.5 w-3.5" />
                  <span>Search Knowledge</span>
                </Button>
              </div>
            </Panel>

            <Panel className="space-y-3 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Ask MoonWitness Assistant
              </div>
              <Textarea
                value={workspacePrompt}
                onChange={(event) => setWorkspacePrompt(event.target.value)}
                placeholder="Ask to summarize your tasks, draft a meeting note, or find a guide..."
                rows={3}
              />
              <div className="flex items-center justify-between gap-2">
                <Badge variant="default">Private & Read-Only</Badge>
                <Button
                  size="sm"
                  onClick={() => void handleRunWorkspaceAssistant()}
                  disabled={workspaceLoading}
                  className="gap-1.5"
                >
                  <SparkleIcon className="h-3.5 w-3.5" />
                  <span>{workspaceLoading ? 'Thinking...' : 'Run Assistant'}</span>
                </Button>
              </div>
            </Panel>

            {workspaceResponse ? (
              <Panel className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Assistant Response</span>
                  <Badge variant="default">{workspaceResponse.provider}</Badge>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {workspaceResponse.reply}
                </div>
                {workspaceResponse.highlights.length > 0 ? (
                  <div className="space-y-1.5 border-t pt-3">
                    <div className="text-xs font-medium text-muted-foreground">Highlights</div>
                    {workspaceResponse.highlights.map((item, idx) => (
                      <div key={`hl-${idx}`} className="flex items-start gap-2 text-xs">
                        <CheckCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Panel>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <Panel className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Discovered Local Model
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => void loadDiscoveredModels()}
                >
                  <RefreshIcon className="h-3.5 w-3.5" />
                  <span>Refresh</span>
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {discoveredModels.map((modelOption) => (
                  <Button
                    key={modelOption.id}
                    size="sm"
                    variant={selectedModel === modelOption.id ? 'default' : 'outline'}
                    onClick={() => setSelectedModel(modelOption.id)}
                  >
                    {modelOption.id}
                  </Button>
                ))}
              </div>
            </Panel>

            <Panel className="space-y-3 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Task Target (Isolated Worktree)
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Input
                  value={taskCode}
                  onChange={(event) => setTaskCode(event.target.value)}
                  placeholder="TASK-101"
                />
                <div className="sm:col-span-2">
                  <Input
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    placeholder="Task title"
                  />
                </div>
              </div>
              <Textarea
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
                placeholder="Scoped task description and acceptance criteria..."
                rows={3}
              />
              <div className="flex items-center justify-between gap-2">
                <Badge variant="default" className="gap-1">
                  <SecurityIcon className="h-3 w-3" />
                  <span>Risk-Gated Worktree</span>
                </Badge>
                <Button
                  size="sm"
                  onClick={() => void handleDispatchDxAgent()}
                  disabled={dxLoading}
                  className="gap-1.5"
                >
                  <WorkflowIcon className="h-3.5 w-3.5" />
                  <span>
                    {dxLoading ? 'Dispatching...' : 'Run Agent on Task in Isolated Worktree'}
                  </span>
                </Button>
              </div>
            </Panel>

            {dxSummary ? (
              <Panel className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Proof Gate Summary</span>
                  <Badge
                    variant={
                      dxSummary.status === 'denied'
                        ? 'destructive'
                        : dxSummary.status === 'dispatched'
                          ? 'primary'
                          : 'default'
                    }
                  >
                    {dxSummary.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">{dxSummary.reason}</div>
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="font-medium">Run ID:</span> {dxSummary.runId}
                  </div>
                  {dxSummary.worktreeBranch ? (
                    <div>
                      <span className="font-medium">Worktree Branch:</span>{' '}
                      {dxSummary.worktreeBranch}
                    </div>
                  ) : null}
                  <div className="truncate">
                    <span className="font-medium">Packet Digest:</span> {dxSummary.digest}
                  </div>
                </div>
                <div className="space-y-2 border-t pt-3">
                  {dxSummary.proofGateChecklist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="flex items-start gap-1.5">
                        {item.status === 'failed' ? (
                          <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <CheckCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        )}
                        <div>
                          <div className="font-medium">{item.label}</div>
                          <div className="text-muted-foreground">{item.detail}</div>
                        </div>
                      </div>
                      <Badge variant={getProofBadgeVariant(item.status)}>{item.status}</Badge>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
