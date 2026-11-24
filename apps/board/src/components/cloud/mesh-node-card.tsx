'use client';

import type { ReactNode } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { AddonIcon } from '@moonwitness/ui/icons';
import { cn } from '@/lib/utils';

export type MeshNodeBadgeVariant = 'default' | 'primary' | 'cyan' | 'magenta' | 'destructive';

export interface MeshNodeCardBadge {
  readonly key: string;
  readonly label: string;
  readonly variant?: MeshNodeBadgeVariant;
  readonly icon?: ReactNode;
}

export interface MeshNodeContainerItem {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly status: string;
  readonly health: 'healthy' | 'unhealthy' | 'starting' | 'unknown';
}

export interface MeshNodeCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly metaLines?: readonly string[];
  readonly statusLabel: string;
  readonly statusVariant: MeshNodeBadgeVariant;
  readonly footerBadges?: readonly MeshNodeCardBadge[];
  readonly containers?: readonly MeshNodeContainerItem[];
  readonly emptyContainersText?: string;
  readonly className?: string;
}

function getContainerHealthBadgeVariant(
  health: MeshNodeContainerItem['health']
): 'primary' | 'destructive' | 'magenta' | 'default' {
  if (health === 'healthy') return 'primary';
  if (health === 'unhealthy') return 'destructive';
  if (health === 'starting') return 'magenta';
  return 'default';
}

/** Shared mesh peer / remote node card used by MeshTopologyPanel and MeshFleetDrawer. */
export function MeshNodeCard({
  title,
  subtitle,
  metaLines,
  statusLabel,
  statusVariant,
  footerBadges,
  containers,
  emptyContainersText,
  className,
}: MeshNodeCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between gap-3 rounded-lg border border-border/60 bg-card/50 p-4',
        className
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            {subtitle ? (
              <div className="font-mono text-xs text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>

        {metaLines?.length ? (
          <div className="space-y-0.5 pt-0.5">
            {metaLines.map((line) => (
              <p key={line} className="font-mono text-xs text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {containers !== undefined ? (
        containers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {emptyContainersText ?? 'No remote containers reported.'}
          </p>
        ) : (
          <div className="space-y-2">
            {containers.map((container) => (
              <div
                key={container.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-background/60 px-3 py-2 text-xs"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <AddonIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{container.name}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {container.image}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{container.status}</span>
                  <Badge variant={getContainerHealthBadgeVariant(container.health)}>
                    {container.health}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {footerBadges?.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {footerBadges.map((badge) => (
            <Badge key={badge.key} variant={badge.variant ?? 'default'}>
              {badge.icon}
              {badge.label}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
