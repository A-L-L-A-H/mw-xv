'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { ConfirmDialog } from '@moonwitness/ui/components/confirm-dialog';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { WarningIcon } from '@moonwitness/ui/icons';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { cn } from '@/lib/utils';
import { AI_MISSION_CONTROL_ROUTES } from './ai-api';
import { DesktopHarnessDrawer } from './desktop-harness-drawer';

export type ProvenanceKind = 'persisted' | 'derived' | 'ephemeral';

export function ProvenanceBadge({ kind, className }: { kind: ProvenanceKind; className?: string }) {
  return (
    <Badge
      data-badge={kind}
      variant={kind === 'persisted' ? 'primary' : 'default'}
      className={cn('font-mono text-[11px] lowercase', className)}
    >
      {kind}
    </Badge>
  );
}

export function RiskTierBadge({ tier }: { tier: string }) {
  const isHighRisk = tier === 'R3' || tier === 'R4';
  return (
    <Badge
      variant={isHighRisk ? 'destructive' : tier === 'R0' ? 'primary' : 'default'}
      className="font-mono text-xs uppercase"
    >
      {tier}
    </Badge>
  );
}

export function MissionControlShell({
  activeRoute,
  title,
  accentTitle,
  description,
  breadcrumbLabel,
  actions,
  errorAlert,
  successNotice,
  children,
}: {
  activeRoute: string;
  title: string;
  accentTitle?: string;
  description: string;
  breadcrumbLabel: string;
  actions?: ReactNode;
  errorAlert?: string | null;
  successNotice?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title={title}
        accentTitle={accentTitle}
        description={description}
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: 'AI Corporation', to: '/board/ai/hq' }, { label: breadcrumbLabel }]}
          />
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DesktopHarnessDrawer />
            {actions}
          </div>
        }
      />

      {/* Mission Control Section Navigation + State Provenance Legend */}
      <div className="flex flex-col gap-3 border-2 border-ink bg-paper-raised p-3 shadow-ink-sm lg:flex-row lg:items-center lg:justify-between">
        <nav
          aria-label="AI Mission Control sections"
          className="flex flex-wrap items-center gap-1.5"
        >
          {AI_MISSION_CONTROL_ROUTES.map((route) => {
            const Icon = route.icon;
            const isActive = activeRoute === route.href;
            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 border-2 border-ink px-2.5 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors',
                  isActive
                    ? 'bg-magenta font-bold text-on-magenta'
                    : 'bg-paper text-ink hover:bg-ink/10'
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span>{route.shortLabel}</span>
              </Link>
            );
          })}
        </nav>

        <div
          className="flex flex-wrap items-center gap-2 border-t border-ink/20 pt-2 font-mono text-xs lg:border-t-0 lg:pt-0"
          aria-label="State provenance legend"
        >
          <span className="text-ink-faint uppercase">Provenance:</span>
          <ProvenanceBadge kind="persisted" />
          <ProvenanceBadge kind="derived" />
          <ProvenanceBadge kind="ephemeral" />
        </div>
      </div>

      {errorAlert ? (
        <div
          role="alert"
          className="flex items-start gap-3 border-2 border-ink bg-destructive/15 p-4 font-mono text-xs text-ink shadow-ink-sm"
        >
          <WarningIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1 break-words">
            <strong className="block font-display text-sm uppercase">
              Server Policy Denial / Action Failed
            </strong>
            <p className="mt-1">{errorAlert}</p>
          </div>
        </div>
      ) : null}

      {successNotice && !errorAlert ? (
        <div
          role="status"
          className="border-2 border-ink bg-paper-raised p-4 font-mono text-xs text-ink shadow-ink-sm"
        >
          {successNotice}
        </div>
      ) : null}

      {children}
    </div>
  );
}

export interface EmergencyConfirmModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly consequence: string;
  readonly isPending: boolean;
  readonly errorAlert?: string | null;
  readonly onConfirm: () => Promise<void>;
}

export function EmergencyConfirmModal({
  open,
  onOpenChange,
  title,
  consequence,
  isPending,
  errorAlert,
  onConfirm,
}: EmergencyConfirmModalProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={consequence}
      warningBanner="Non-optimistic execution: UI state updates only after the server confirms persistence and audit logging."
      error={errorAlert ?? undefined}
      destructive
      busy={isPending}
      confirmLabel={isPending ? 'Awaiting Server…' : 'Confirm & Proceed'}
      cancelLabel="Cancel"
      onConfirm={() => void onConfirm()}
    />
  );
}
