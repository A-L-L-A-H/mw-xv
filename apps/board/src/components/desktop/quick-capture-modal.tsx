'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@moonwitness/ui/components/select';
import { toast } from '@moonwitness/ui/components/toast';
import { CheckIcon, SignalIcon, SparkleIcon } from '@moonwitness/ui/icons';
import { client } from '@/lib/client';

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
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
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
      toast.success(`Captured task #${result.task.id}: ${result.task.name}`);
      setTitle('');
      setPriority('normal');
      setProjectCode('');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['desktop', 'sync', 'status'] });
    },
    onError: (error) => {
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
      toast.error('Task title is required.');
      return;
    }
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
                    ? ` · ${new Date(syncStatus.lastPlannedAt).toLocaleTimeString()}`
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
            <div className="space-y-1.5">
              <Label htmlFor="quick-capture-title">Title</Label>
              <Input
                id="quick-capture-title"
                placeholder="e.g. Review Q4 deployment checklist"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="quick-capture-priority">Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(value) => setPriority(value as CapturePriority)}
                >
                  <SelectTrigger id="quick-capture-priority">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quick-capture-project">Project Code</Label>
                <Input
                  id="quick-capture-project"
                  placeholder="Optional (e.g. CORE)"
                  value={projectCode}
                  onChange={(event) => setProjectCode(event.target.value)}
                />
              </div>
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
