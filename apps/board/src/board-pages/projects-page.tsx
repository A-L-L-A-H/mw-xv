'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AddonIcon,
  CheckCircleIcon,
  CodeIcon,
  ColumnsIcon,
  RefreshIcon,
  SparkleIcon,
  WarningIcon,
} from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { Panel } from '@moonwitness/ui/components/panel';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';
import {
  dispatchDesktopFlowPrime,
  useDesktopBridge,
  type DesktopGitWorktreeLease,
} from '@/lib/desktop-bridge';
import { scopedQueryKey } from '@/lib/query-scope';

interface ProjectSummary {
  id: number;
  code: string;
  name: string;
  status: string;
  due_date?: string | null;
}

interface StageSummary {
  id: number;
  code: string;
  name: string;
  sequence: number;
  wip_limit?: number | null;
}

interface MilestoneSummary {
  id: number;
  code: string;
  name: string;
  status: string;
  due_date?: string | null;
}

interface TaskSummary {
  id: number;
  code: string;
  external_ref?: string | null;
  title: string;
  description?: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: string;
  stage_id: number;
  blocked_reason?: string | null;
  due_date?: string | null;
}

interface DependencySummary {
  id: number;
  task_id: number;
  depends_on_id: number;
  kind: 'blocks' | 'relates_to';
}

interface DagNode {
  id: number;
  code: string;
  title: string;
  blocked_by_ids: number[];
  blocks_ids: number[];
  is_ready: boolean;
}

interface ProjectBoardPayload {
  project: ProjectSummary;
  stages: StageSummary[];
  milestones: MilestoneSummary[];
  tasks: TaskSummary[];
  dependencies: DependencySummary[];
  dag: {
    nodes: DagNode[];
    blocked_task_ids: number[];
    ready_task_ids: number[];
  };
}

function priorityVariant(
  priority: TaskSummary['priority']
): 'default' | 'primary' | 'magenta' | 'cyan' | 'destructive' {
  if (priority === 'urgent') return 'destructive';
  if (priority === 'high') return 'magenta';
  if (priority === 'normal') return 'cyan';
  return 'default';
}

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { isDesktop, bridge, snapshot, refreshSnapshot } = useDesktopBridge();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [todoCode, setTodoCode] = useState('TASK-0880');
  const [todoTitle, setTodoTitle] = useState('');
  const [todoPriority, setTodoPriority] = useState<'p0' | 'p1' | 'p2' | 'p3'>('p1');
  const [todoStatus, setTodoStatus] = useState<'todo' | 'doing' | 'blocked' | 'review' | 'done'>(
    'doing'
  );
  const [lastSyncedSnapshots, setLastSyncedSnapshots] = useState<Array<Record<string, unknown>>>(
    []
  );
  const [lastDispatchedContract, setLastDispatchedContract] = useState<{
    taskCode: string;
    contractId: number;
    code: string;
    created: boolean;
  } | null>(null);
  const [boundLeasesByTaskId, setBoundLeasesByTaskId] = useState<
    Record<number, DesktopGitWorktreeLease>
  >({});
  const [bindingTaskId, setBindingTaskId] = useState<number | null>(null);

  const projectsQuery = useQuery({
    queryKey: scopedQueryKey(['projects', 'list']),
    queryFn: async () => {
      const result = await client
        .model<ProjectSummary>('project.project')
        .searchRead({ limit: 50, order: 'id asc' });
      return result.records;
    },
  });

  const activeProjectId = selectedProjectId ?? projectsQuery.data?.[0]?.id ?? null;

  const boardQuery = useQuery({
    queryKey: scopedQueryKey(['projects', 'board', activeProjectId]),
    queryFn: async () => {
      const response = await client.request<{ success: boolean; data: ProjectBoardPayload }>(
        `/api/projects/${activeProjectId}/board`
      );
      return response.data;
    },
    enabled: Boolean(activeProjectId),
  });

  const moveStageMutation = useMutation({
    mutationFn: async ({ taskId, stageId }: { taskId: number; stageId: number }) =>
      client.model('project.task').write(taskId, { stage_id: stageId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Task stage updated.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to move task stage.');
    },
  });

  const dispatchContractMutation = useMutation({
    mutationFn: async (task: TaskSummary) => {
      const res = await client.request<{
        success: boolean;
        created: boolean;
        data: { id: number; code: string };
      }>(`/api/projects/tasks/${task.id}/work-contract`, {
        method: 'POST',
        body: {},
      });
      return {
        taskCode: task.code,
        contractId: res.data.id,
        code: res.data.code,
        created: res.created,
      };
    },
    onSuccess: (result) => {
      setLastDispatchedContract(result);
      toast.success(
        result.created
          ? `Dispatched AI WorkContract ${result.code} for ${result.taskCode}.`
          : `Linked existing WorkContract ${result.code} for ${result.taskCode}.`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to dispatch AI WorkContract.');
    },
  });

  const syncStageMutation = useMutation({
    mutationFn: async (task: TaskSummary) => {
      const res = await client.request<{
        success: boolean;
        data: {
          advanced: boolean;
          contract: { status: string };
          task: TaskSummary;
        };
      }>(`/api/projects/tasks/${task.id}/work-contract/sync-stage`, {
        method: 'POST',
        body: {},
      });
      return { taskCode: task.code, ...res.data };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(
        result.advanced
          ? `Synced ${result.taskCode} -> ${result.task.status} (contract: ${result.contract.status}).`
          : `${result.taskCode} already aligned (contract: ${result.contract.status}).`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to sync AI WorkContract stage.');
    },
  });

  const todoSyncMutation = useMutation({
    mutationFn: async () => {
      if (!activeProjectId) throw new Error('Select a project first.');
      const payload =
        todoTitle.trim().length > 0
          ? [
              {
                code: todoCode.trim(),
                title: todoTitle.trim(),
                priority: todoPriority,
                status: todoStatus,
              },
            ]
          : [];
      const res = await client.request<{
        success: boolean;
        data: { imported: number; updated: number; snapshots: Array<Record<string, unknown>> };
      }>(`/api/projects/${activeProjectId}/todo-sync`, {
        method: 'POST',
        body: { tasks: payload },
      });
      return res.data;
    },
    onSuccess: async (data) => {
      setLastSyncedSnapshots(data.snapshots);
      setTodoTitle('');
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(
        `TaskOS sync complete: ${data.imported} imported, ${data.updated} updated, ${data.snapshots.length} exported.`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'TaskOS sync failed.');
    },
  });

  const board = boardQuery.data;
  const activeDesktopLeases = useMemo(() => snapshot?.activeLeases ?? [], [snapshot?.activeLeases]);
  const dagNodeById = useMemo(
    () => new Map((board?.dag.nodes ?? []).map((node) => [node.id, node])),
    [board]
  );
  const taskById = useMemo(
    () => new Map((board?.tasks ?? []).map((task) => [task.id, task])),
    [board]
  );

  const findTaskLease = (task: TaskSummary): DesktopGitWorktreeLease | null => {
    const cached = boundLeasesByTaskId[task.id];
    if (cached && cached.status === 'active') return cached;
    const normalizedCode = task.code.toLowerCase().replace(/[^a-z0-9-_]/gu, '-');
    return (
      activeDesktopLeases.find(
        (lease) =>
          lease.status === 'active' &&
          (lease.runId.toLowerCase().includes(normalizedCode) ||
            lease.branchName.toLowerCase().includes(normalizedCode))
      ) ?? null
    );
  };

  const handleBindDesktopWorktree = async (task: TaskSummary) => {
    if (!isDesktop || !bridge) {
      toast.info(
        `Web-only mode: open MoonWitness Desktop to bind an isolated worktree for ${task.code}.`
      );
      return;
    }

    const existingLease = findTaskLease(task);
    const contractCode =
      lastDispatchedContract?.taskCode === task.code
        ? lastDispatchedContract.code
        : `WC-${task.code}`;

    if (existingLease) {
      dispatchDesktopFlowPrime({
        taskCode: task.code,
        taskTitle: task.title,
        runId: existingLease.runId,
        contractCode,
        scopePaths: existingLease.allowedPaths,
        openDrawer: true,
      });
      toast.success(
        `Opened FLOW Cockpit for ${task.code} on active lease ${existingLease.branchName}.`
      );
      return;
    }

    const sanitizedRunId = `task-${task.code.toLowerCase().replace(/[^a-z0-9-_]/gu, '-')}`;
    setBindingTaskId(task.id);
    try {
      if (bridge.worktree.acquire) {
        const lease = await bridge.worktree.acquire({
          runId: sanitizedRunId,
          taskCode: task.code,
          workContractId:
            lastDispatchedContract?.taskCode === task.code
              ? lastDispatchedContract.contractId
              : undefined,
        });
        setBoundLeasesByTaskId((prev) => ({ ...prev, [task.id]: lease }));
        await refreshSnapshot();
        dispatchDesktopFlowPrime({
          taskCode: task.code,
          taskTitle: task.title,
          runId: lease.runId,
          contractCode,
          scopePaths: lease.allowedPaths,
          openDrawer: true,
        });
        toast.success(`Bound Desktop worktree ${lease.branchName} for ${task.code}.`);
      } else {
        dispatchDesktopFlowPrime({
          taskCode: task.code,
          taskTitle: task.title,
          runId: activeDesktopLeases[0]?.runId,
          contractCode,
          openDrawer: true,
        });
        toast.info(
          `Primed FLOW Cockpit for ${task.code} (worktree.acquire not exposed in this preload build).`
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to bind worktree for ${task.code}.`);
    } finally {
      setBindingTaskId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        treatment="brush"
        accent="magenta"
        title="PROJECT COMMAND"
        accentTitle="// TASK OS"
        description="Zero-overlap Kanban stages, dependency DAG blocker radar, TaskOS sync, and 1-click AI WorkContract dispatch."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isDesktop ? 'cyan' : 'default'}>
              {isDesktop ? `Desktop Harness · ${activeDesktopLeases.length} lease(s)` : 'Web Mode'}
            </Badge>
            {(projectsQuery.data ?? []).map((project) => (
              <Button
                key={project.id}
                size="sm"
                variant={project.id === activeProjectId ? 'default' : 'outline'}
                onClick={() => setSelectedProjectId(project.id)}
              >
                {project.name}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void boardQuery.refetch()}
              disabled={boardQuery.isFetching}
            >
              <RefreshIcon className="mr-1.5 size-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          frame="torn"
          accent="cyan"
          label="TOTAL TASKS"
          value={board?.tasks.length ?? 0}
          icon={<ColumnsIcon className="size-4" />}
        />
        <MetricTile
          frame="torn"
          accent="green"
          label="READY IN DAG"
          value={board?.dag.ready_task_ids.length ?? 0}
          icon={<CheckCircleIcon className="size-4" />}
        />
        <MetricTile
          frame="torn"
          accent="magenta"
          label="BLOCKED IN DAG"
          value={board?.dag.blocked_task_ids.length ?? 0}
          icon={<WarningIcon className="size-4" />}
        />
        <MetricTile
          frame="torn"
          accent="yellow"
          label="MILESTONES"
          value={board?.milestones.length ?? 0}
          icon={<AddonIcon className="size-4" />}
        />
      </div>

      {lastDispatchedContract && (
        <Panel
          frame="grunge"
          density="compact"
          title={`AI WorkContract Linked · ${lastDispatchedContract.code}`}
          description={`Task ${lastDispatchedContract.taskCode} -> Contract #${lastDispatchedContract.contractId}`}
        >
          <p className="font-mono text-xs text-ink-soft">
            source_model: project.task · state: draft · criterion: task_completion
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {(board?.stages ?? []).map((stage, stageIndex) => {
          const stageTasks = (board?.tasks ?? []).filter((task) => task.stage_id === stage.id);
          const nextStage = board?.stages[stageIndex + 1] ?? null;
          return (
            <Panel
              key={stage.id}
              frame="scuffed"
              density="compact"
              title={`${stage.name} (${stageTasks.length})`}
              description={stage.wip_limit ? `WIP limit: ${stage.wip_limit}` : undefined}
            >
              <div className="space-y-3">
                {stageTasks.length === 0 ? (
                  <p className="font-mono text-xs text-ink-faint">Empty stage</p>
                ) : (
                  stageTasks.map((task) => {
                    const node = dagNodeById.get(task.id);
                    const taskLease = findTaskLease(task);
                    const blockerCodes = (node?.blocked_by_ids ?? [])
                      .map((id) => taskById.get(id)?.code ?? `#${id}`)
                      .join(', ');
                    return (
                      <article
                        key={task.id}
                        className="space-y-2 border-2 border-ink bg-paper p-3 shadow-ink-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="font-mono text-xs font-bold">{task.code}</span>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant={priorityVariant(task.priority)}>{task.priority}</Badge>
                            {blockerCodes ? (
                              <Badge variant="destructive">BLOCKED BY {blockerCodes}</Badge>
                            ) : node?.is_ready ? (
                              <Badge variant="cyan">READY</Badge>
                            ) : null}
                            {taskLease ? (
                              <Badge variant="primary">LEASE: {taskLease.branchName}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <p className="font-display text-sm uppercase leading-tight">{task.title}</p>
                        {task.description ? (
                          <p className="text-xs text-ink-soft line-clamp-2">{task.description}</p>
                        ) : null}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {nextStage ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={moveStageMutation.isPending}
                              onClick={() =>
                                moveStageMutation.mutate({ taskId: task.id, stageId: nextStage.id })
                              }
                            >
                              Move -&gt; {nextStage.name}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="default"
                            disabled={dispatchContractMutation.isPending}
                            onClick={() => dispatchContractMutation.mutate(task)}
                          >
                            <SparkleIcon className="mr-1 size-3.5" />
                            Dispatch AI
                          </Button>
                          {node?.is_ready ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={bindingTaskId === task.id}
                              onClick={() => void handleBindDesktopWorktree(task)}
                            >
                              <CodeIcon className="mr-1 size-3.5" />
                              {bindingTaskId === task.id
                                ? 'Binding…'
                                : taskLease
                                  ? 'Open FLOW'
                                  : isDesktop
                                    ? 'Bind Worktree'
                                    : 'Desktop Worktree'}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={syncStageMutation.isPending}
                            onClick={() => syncStageMutation.mutate(task)}
                          >
                            <RefreshIcon className="mr-1 size-3.5" />
                            Sync AI Stage
                          </Button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel
        frame="scuffed"
        title="TaskOS (apps/todo) Two-Way Sync"
        description="Upsert local TaskOS snapshots by code/external_ref and export aligned board state."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Input
            aria-label="TaskOS Code"
            value={todoCode}
            onChange={(e) => setTodoCode(e.target.value)}
            placeholder="TASK-0880"
          />
          <Input
            aria-label="TaskOS Title"
            value={todoTitle}
            onChange={(e) => setTodoTitle(e.target.value)}
            placeholder="New synced task title (optional for export-only)"
            className="md:col-span-2"
          />
          <SelectField
            aria-label="TaskOS Priority"
            value={todoPriority}
            onChange={(e) => setTodoPriority(e.target.value as typeof todoPriority)}
          >
            <option value="p0">p0 (urgent)</option>
            <option value="p1">p1 (high)</option>
            <option value="p2">p2 (normal)</option>
            <option value="p3">p3 (low)</option>
          </SelectField>
          <SelectField
            aria-label="TaskOS Status"
            value={todoStatus}
            onChange={(e) => setTodoStatus(e.target.value as typeof todoStatus)}
          >
            <option value="todo">todo</option>
            <option value="doing">doing</option>
            <option value="blocked">blocked</option>
            <option value="review">review</option>
            <option value="done">done</option>
          </SelectField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="default"
            onClick={() => todoSyncMutation.mutate()}
            disabled={!activeProjectId || todoSyncMutation.isPending}
          >
            Sync with TaskOS
          </Button>
          {lastSyncedSnapshots.length > 0 && (
            <span className="font-mono text-xs text-ink-soft">
              Last snapshot count: {lastSyncedSnapshots.length}
            </span>
          )}
        </div>
      </Panel>
    </div>
  );
}
