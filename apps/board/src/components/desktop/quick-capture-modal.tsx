'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSfx } from '@moonwitness/ui/components/audio';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@moonwitness/ui/components/dialog';
import { Field } from '@moonwitness/ui/components/field';
import { Input } from '@moonwitness/ui/components/input';
import { SelectField } from '@moonwitness/ui/components/select-field';
import { toast } from '@moonwitness/ui/components/toast';
import { CheckIcon, SignalIcon, SparkleIcon } from '@moonwitness/ui/icons';
import { client } from '@/lib/client';
import { formatDateTime } from '@/lib/date-format';

interface SyncEngineStatus {
  nodeId: string;
  lamportClock: number;
  pendingOutboxCount: number;
  tombstoneCount: number;
  lastBatchSha256: string | null;
  lastPlannedAt: string | null;
}

interface QuickCaptureResponse {
  task: {
    id: number;
    name: string;
    description: string;
    projectId: number;
    stageId: number;
  };
}

type CapturePriority = 'low' | 'normal' | 'high' | 'urgent';

export function QuickCaptureModal() {
  const queryClient = useQueryClient();
  const { play } = useSfx();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [priority, setPriority] = useState<CapturePriority>('normal');
  const [projectCode, setProjectCode] = useState('');

  const syncStatusQuery = useQuery({
    queryKey: ['desktop', 'sync', 'status'],
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: SyncEngineStatus;
      }>('/api/desktop/sync/status');
      return response.data;
    },
    refetchInterval: 15_000,
    retry: false,
  });

  const captureMutation = useMutation({
    mutationFn: async (payload: {
      title: string;
      priority: CapturePriority;
      projectCode: string;
    }) => {
      const response = await client.request<{
        success: boolean;
        data: QuickCaptureResponse;
      }>('/api/desktop/quick-capture', {
        method: 'POST',
        body: {
          title: payload.title,
          priority: payload.priority,
          projectCode: payload.projectCode || undefined,
          source: 'ctrl_shift_space',
        },
      });
      return response.data;
    },
    onSuccess: (result) => {
      play('success');
      toast.success(`Captured task #${result.task.id}: ${result.task.name}`);
      setTitle('');
      setTitleError(undefined);
      setPriority('normal');
      setProjectCode('');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['desktop', 'sync', 'status'] });
    },
    onError: (error) => {
      play('alert');
      toast.error(error instanceof Error ? error.message : 'Quick capture failed.');
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.code === 'Space') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError('Task title is required.');
      play('alert');
      toast.error('Task title is required.');
      return;
    }
    setTitleError(undefined);
    captureMutation.mutate({
      title: trimmedTitle,
      priority,
      projectCode: projectCode.trim(),
    });
  };

  const syncStatus = syncStatusQuery.data;
  const pendingCount = syncStatus?.pendingOutboxCount ?? 0;

  return (
    <>
      <div className="fixed bottom-4 left-4 z-30 flex items-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label="Open Quick Capture (Ctrl+Shift+Space)"
          title="Quick Capture (Ctrl+Shift+Space)"
          className="gap-1.5 border-2 border-ink shadow-ink-sm"
        >
          <SparkleIcon className="size-3.5" />
          <span className="font-mono text-xs uppercase">Quick Capture</span>
        </Button>

        <Badge
          variant={pendingCount > 0 ? 'primary' : 'cyan'}
          className="flex items-center gap-1.5 border-2 border-ink px-2 py-1 font-mono text-[11px] shadow-ink-sm"
          title={
            syncStatus
              ? `Node ${syncStatus.nodeId} | Lamport clock ${syncStatus.lamportClock} | Last synced: ${syncStatus.lastPlannedAt ?? 'never'}`
              : 'Offline sync status'
          }
        >
          <SignalIcon className="size-3" />
          <span>
            {syncStatus
              ? `${pendingCount} pending · L${syncStatus.lamportClock}${
                  syncStatus.lastPlannedAt
                    ? ` · ${formatDateTime(syncStatus.lastPlannedAt, 'time')}`
                    : ''
                }`
              : 'Sync ready'}
          </span>
        </Badge>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wide">
              Quick Capture Task
            </DialogTitle>
            <DialogDescription>
              Add an offline-first inbox task immediately. Shortcut: Ctrl+Shift+Space.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Title" htmlFor="quick-capture-title" required error={titleError}>
              <Input
                placeholder="e.g. Review Q4 deployment checklist"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (titleError) setTitleError(undefined);
                }}
                autoFocus
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Priority" htmlFor="quick-capture-priority">
                <SelectField
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as CapturePriority)}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </SelectField>
              </Field>

              <Field label="Project Code" htmlFor="quick-capture-project">
                <Input
                  placeholder="Optional (e.g. CORE)"
                  value={projectCode}
                  onChange={(event) => setProjectCode(event.target.value)}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={captureMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={captureMutation.isPending}>
                <CheckIcon className="mr-1.5 size-4" />
                {captureMutation.isPending ? 'Saving...' : 'Capture'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
