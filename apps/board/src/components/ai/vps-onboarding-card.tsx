'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckIcon,
  GlobeIcon,
  LockIcon,
  RefreshIcon,
  SecurityIcon,
  SignalIcon,
} from '@moonwitness/ui/icons';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { MetricTile } from '@moonwitness/ui/components/metric-tile';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { toast } from '@moonwitness/ui/components/toast';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';

export type VpsStackHealth = 'healthy' | 'degraded' | 'starting' | 'offline' | 'unknown';
export type VpsComposeActionKind = 'up' | 'restart' | 'rebuild' | 'down';

export interface VpsOnboardingStatusPayload {
  nodeId: string;
  meshIp: string;
  apiHealth: VpsStackHealth;
  boardHealth: VpsStackHealth;
  controlPlaneHealth: VpsStackHealth;
  superadminBootstrapped: boolean;
  composeServices: string[];
  redactedSummary?: string;
}

function healthVariant(
  health: VpsStackHealth
): 'primary' | 'cyan' | 'magenta' | 'destructive' | 'default' {
  if (health === 'healthy') return 'cyan';
  if (health === 'starting') return 'magenta';
  if (health === 'degraded' || health === 'offline') return 'destructive';
  return 'default';
}

export function VpsOnboardingCard() {
  const queryClient = useQueryClient();
  const [login, setLogin] = useState('admin');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('Superadmin');

  const statusQuery = useQuery({
    queryKey: scopedQueryKey(['desktop', 'vps', 'onboarding', 'status']),
    queryFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: VpsOnboardingStatusPayload;
      }>('/api/desktop/vps/onboarding/status');
      return response.data;
    },
  });

  const composeMutation = useMutation({
    mutationFn: async (action: VpsComposeActionKind) => {
      const response = await client.request<{
        success: boolean;
        data: { action: VpsComposeActionKind; status: string; output: string };
      }>('/api/desktop/vps/onboarding/compose', {
        method: 'POST',
        body: { action, services: ['postgres', 'api', 'board'] },
      });
      return response.data;
    },
    onSuccess: async (result) => {
      toast.success(`VPS Compose '${result.action}' completed (${result.status}).`);
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['desktop', 'vps', 'onboarding', 'status']),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Unable to execute VPS Compose action.');
    },
  });

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const response = await client.request<{
        success: boolean;
        data: { bootstrapped: boolean; login: string; message: string };
      }>('/api/desktop/vps/onboarding/superadmin', {
        method: 'POST',
        body: {
          login: login.trim(),
          password,
          displayName: displayName.trim() || undefined,
        },
      });
      return response.data;
    },
    onSuccess: async (result) => {
      setPassword('');
      toast.success(result.message || `Superadmin '${result.login}' bootstrapped.`);
      await queryClient.invalidateQueries({
        queryKey: scopedQueryKey(['desktop', 'vps', 'onboarding', 'status']),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Superadmin onboarding failed.');
    },
  });

  const status = statusQuery.data;
  const canBootstrap =
    login.trim().length >= 3 && password.length >= 12 && !bootstrapMutation.isPending;

  return (
    <Panel className="space-y-6 border-primary/20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <SecurityIcon className="size-5 text-primary" />
            <h2 className="text-base font-semibold">Remote VPS Onboarding &amp; Stack Control</h2>
            <Badge variant={status?.superadminBootstrapped ? 'cyan' : 'magenta'}>
              {status?.superadminBootstrapped ? 'Bootstrapped' : 'Onboarding Ready'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Private EasyTier mesh control plane for remote VPS health, Docker Compose lifecycle, and
            Superadmin bootstrap. Credentials remain redacted.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={statusQuery.isFetching}
          onClick={() => void statusQuery.refetch()}
        >
          <RefreshIcon className="mr-2 size-4" />
          {statusQuery.isFetching ? 'Refreshing...' : 'Refresh VPS Health'}
        </Button>
      </div>

      {statusQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="Mesh IP"
              value={status?.meshIp ?? '10.144.0.1'}
              icon={<GlobeIcon className="size-4 text-primary" />}
            />
            <MetricTile
              label="API Health"
              value={status?.apiHealth ?? 'unknown'}
              icon={<SignalIcon className="size-4 text-primary" />}
            />
            <MetricTile
              label="Board Health"
              value={status?.boardHealth ?? 'unknown'}
              icon={<CheckIcon className="size-4 text-primary" />}
            />
            <MetricTile
              label="Control Plane"
              value={status?.controlPlaneHealth ?? 'unknown'}
              icon={<LockIcon className="size-4 text-primary" />}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={healthVariant(status?.apiHealth ?? 'unknown')}>
              API: {status?.apiHealth ?? 'unknown'}
            </Badge>
            <Badge variant={healthVariant(status?.boardHealth ?? 'unknown')}>
              Board: {status?.boardHealth ?? 'unknown'}
            </Badge>
            <Badge variant={healthVariant(status?.controlPlaneHealth ?? 'unknown')}>
              Control Plane: {status?.controlPlaneHealth ?? 'unknown'}
            </Badge>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Docker Compose Stack Actions
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                size="sm"
                disabled={composeMutation.isPending}
                onClick={() => composeMutation.mutate('up')}
              >
                Start Stack (up)
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={composeMutation.isPending}
                onClick={() => composeMutation.mutate('restart')}
              >
                Restart Stack
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={composeMutation.isPending}
                onClick={() => composeMutation.mutate('rebuild')}
              >
                Rebuild &amp; Deploy
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={composeMutation.isPending}
                onClick={() => composeMutation.mutate('down')}
              >
                Stop Stack (down)
              </Button>
            </div>
          </div>

          <div className="space-y-3 border-t border-border/60 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Superadmin Onboarding
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                placeholder="Superadmin login"
                aria-label="Superadmin login"
              />
              <Input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Display name"
                aria-label="Superadmin display name"
              />
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Initial password (min 12 chars)"
                aria-label="Superadmin password"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Requires R3 approval via Desktop Risk Gate. Password is cleared immediately after
                submission.
              </p>
              <Button
                variant="default"
                size="sm"
                disabled={!canBootstrap}
                onClick={() => bootstrapMutation.mutate()}
              >
                <LockIcon className="mr-2 size-4" />
                {bootstrapMutation.isPending ? 'Bootstrapping...' : 'Bootstrap Superadmin'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
