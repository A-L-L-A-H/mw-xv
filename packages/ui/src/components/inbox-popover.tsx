'use client';

import type { ReactNode } from 'react';
import { InboxIcon } from '../icons/inbox.js';
import { NotificationIcon } from '../icons/notification.js';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { Popover, PopoverContent, PopoverTrigger } from './popover.js';

export type InboxPopoverProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  triggerLabel: string;
  triggerTitle?: string;
  triggerId?: string;
  triggerIcon?: ReactNode;
  unreadCount?: number;
  unavailable?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  error?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  emptyIcon?: ReactNode;
  isEmpty?: boolean;
  headerAction?: ReactNode;
  footer?: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
};

/** Shared header inbox popover shell with unread badge, loading, error/retry, and empty states. */
export function InboxPopover({
  open,
  onOpenChange,
  title,
  subtitle,
  triggerLabel,
  triggerTitle,
  triggerId,
  triggerIcon,
  unreadCount,
  unavailable = false,
  loading = false,
  loadingLabel = 'Loading…',
  error,
  onRetry,
  retryLabel = 'Retry',
  emptyTitle = 'You’re all caught up',
  emptyDescription,
  emptyIcon,
  isEmpty = false,
  headerAction,
  footer,
  align = 'end',
  className,
  contentClassName,
  children,
}: InboxPopoverProps) {
  const badgeText =
    unreadCount !== undefined && unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={triggerId}
          type="button"
          variant="outline"
          size="icon"
          className={cn('mw-ui-inbox-trigger', className)}
          aria-label={triggerLabel}
          title={triggerTitle ?? triggerLabel}
          data-slot="inbox-popover-trigger"
          data-unavailable={unavailable ? 'true' : undefined}
        >
          {triggerIcon ?? <NotificationIcon size={16} aria-hidden="true" />}
          {badgeText ? (
            <span aria-hidden="true" className="mw-ui-inbox-badge">
              {badgeText}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        data-slot="inbox-popover"
        className={cn('mw-ui-inbox-popover', contentClassName)}
      >
        <div className="mw-ui-inbox-header">
          <div className="mw-ui-inbox-heading">
            <h2 className="mw-ui-inbox-title">{title}</h2>
            {subtitle ? <p className="mw-ui-inbox-subtitle">{subtitle}</p> : null}
          </div>
          {headerAction ? <div className="mw-ui-inbox-header-action">{headerAction}</div> : null}
        </div>
        <div className="mw-ui-inbox-body">
          {loading && !children ? (
            <p className="mw-ui-inbox-status" role="status">
              {loadingLabel}
            </p>
          ) : error && !children ? (
            <div role="alert" className="mw-ui-inbox-error">
              <p>{error}</p>
              {onRetry ? (
                <Button type="button" size="xs" variant="outline" onClick={onRetry}>
                  {retryLabel}
                </Button>
              ) : null}
            </div>
          ) : isEmpty ? (
            <div className="mw-ui-inbox-empty">
              <span className="mw-ui-inbox-empty-icon" aria-hidden="true">
                {emptyIcon ?? <InboxIcon size={24} />}
              </span>
              <p className="mw-ui-inbox-empty-title">{emptyTitle}</p>
              {emptyDescription ? (
                <p className="mw-ui-inbox-empty-description">{emptyDescription}</p>
              ) : null}
            </div>
          ) : (
            <>
              {error ? (
                <p role="status" className="mw-ui-inbox-stale-banner">
                  {error}
                </p>
              ) : null}
              {children}
            </>
          )}
        </div>
        {footer ? <div className="mw-ui-inbox-footer">{footer}</div> : null}
      </PopoverContent>
    </Popover>
  );
}
