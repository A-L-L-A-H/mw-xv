'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshIcon } from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Panel } from '@moonwitness/ui/components/panel';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

export interface SystemUpdatePayload {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  channel: string;
  releaseUrl?: string;
  publishedAt?: string;
  releaseNotes?: string;
  checkedAt?: string;
  status: 'idle' | 'updating' | 'restarting' | 'succeeded' | 'failed';
  targetVersion?: string;
  lastUpdateLog?: string;
  lastError?: string;
  composeFile?: string;
  canApply: boolean;
}

interface SystemUpdateEnvelope {
  success: boolean;
  data: SystemUpdatePayload;
}

const UPDATE_QUERY_KEY = ['cloud', 'system', 'update'] as const;

function badgeVariantFor(
  updateState: SystemUpdatePayload | undefined
): 'destructive' | 'primary' | 'cyan' {
  if (updateState?.status === 'failed') return 'destructive';
  if (
    updateState?.updateAvailable ||
    updateState?.status === 'updating' ||
    updateState?.status === 'restarting'
  ) {
    return 'primary';
  }
  return 'cyan';
}

function badgeLabelFor(updateState: SystemUpdatePayload | undefined, isError: boolean): string {
  if (updateState?.status && updateState.status !== 'idle') return updateState.status;
  if (updateState?.updateAvailable) return 'Update available';
  if (isError) return 'Unavailable';
  return 'Up to date';
}

export function PlatformUpdatePanel() {
  const queryClient = useQueryClient();

  const systemUpdateQuery = useQuery({
    queryKey: scopedQueryKey([...UPDATE_QUERY_KEY]),
    queryFn: async () => {
      const updateEnvelope = await client.request<SystemUpdateEnvelope>('/api/cloud/system/update');
      return updateEnvelope.data;
    },
    refetchInterval: (query) => {
      const currentPhase = query.state.data?.status;
      return currentPhase === 'updating' || currentPhase === 'restarting' ? 3000 : false;
    },
    retry: false,
  });

  const checkSystemUpdateMutation = useMutation({
    mutationFn: async () =>
      client.request<SystemUpdateEnvelope>('/api/cloud/system/update?force=true'),
    onSuccess: (checkEnvelope) => {
      const nextPayload = checkEnvelope.data;
      queryClient.setQueryData(scopedQueryKey([...UPDATE_QUERY_KEY]), nextPayload);
      toast.success(
        nextPayload.updateAvailable
          ? `Update available: ${nextPayload.latestVersion}`
          : `Up to date (${nextPayload.currentVersion})`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to check updates.');
    },
  });

  const applySystemUpdateMutation = useMutation({
    mutationFn: async (version?: string) =>
      client.request<SystemUpdateEnvelope>('/api/cloud/system/update/apply', {
        method: 'POST',
        body: version ? { version } : {},
      }),
    onSuccess: (applyEnvelope) => {
      const nextPayload = applyEnvelope.data;
      queryClient.setQueryData(scopedQueryKey([...UPDATE_QUERY_KEY]), nextPayload);
      toast.success(
        `Updating to ${nextPayload.targetVersion ?? nextPayload.latestVersion} — services will restart automatically.`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to apply update.');
    },
  });

  const updateState = systemUpdateQuery.data;
  const isApplying = updateState?.status === 'updating' || updateState?.status === 'restarting';

  return (
    <Panel
      title="Platform Updates"
      description="Coolify-style release detection & one-click pull + restart via Control Plane."
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-semibold">{updateState?.currentVersion ?? '—'}</span>
            {updateState?.latestVersion ? (
              <span className="text-ink-faint">
                → latest{' '}
                <span className="font-mono font-semibold text-ink">
                  {updateState.latestVersion}
                </span>
              </span>
            ) : null}
            <Badge variant={badgeVariantFor(updateState)}>
              {badgeLabelFor(updateState, systemUpdateQuery.isError)}
            </Badge>
          </div>
          {updateState?.lastError ? (
            <p className="text-xs text-error">{updateState.lastError}</p>
          ) : updateState?.releaseUrl ? (
            <a
              href={updateState.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline text-ink-faint hover:text-ink"
            >
              View GitHub Release Notes
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={checkSystemUpdateMutation.isPending}
            onClick={() => checkSystemUpdateMutation.mutate()}
          >
            <RefreshIcon className="mr-2 size-4" />
            Check Updates
          </Button>
          <Button
            variant={updateState?.updateAvailable ? 'default' : 'outline'}
            size="sm"
            disabled={
              applySystemUpdateMutation.isPending ||
              !updateState?.canApply ||
              (!updateState?.latestVersion && !updateState?.currentVersion)
            }
            onClick={() =>
              applySystemUpdateMutation.mutate(
                updateState?.latestVersion || updateState?.currentVersion
              )
            }
          >
            {isApplying
              ? 'Updating & Restarting…'
              : updateState?.updateAvailable
                ? `Update to ${updateState.latestVersion} & Restart`
                : 'Pull & Restart'}
          </Button>
        </div>
      </div>
      {updateState?.lastUpdateLog ? (
        <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-paper p-2 font-mono text-xs whitespace-pre-wrap">
          {updateState.lastUpdateLog}
        </pre>
      ) : null}
    </Panel>
  );
}
