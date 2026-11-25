'use client';

import type { ReactNode } from 'react';
import { Button } from './button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.js';
import { LoadingSpinner } from './effects.js';
import { WarningIcon } from '../icons/warning.js';
import { cn } from '../lib/cn.js';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  warningBanner?: ReactNode;
  consequence?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
  className?: string;
};

/** Shared confirmation dialog with busy guard, consequence notice, warning banner, and alert error slot. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  warningBanner,
  consequence,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
  className,
}: ConfirmDialogProps) {
  const handleClose = () => {
    if (busy) return;
    onOpenChange?.(false);
    onCancel?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange?.(true);
          return;
        }
        handleClose();
      }}
    >
      <DialogContent
        data-slot="confirm-dialog"
        data-destructive={destructive ? 'true' : 'false'}
        className={cn('mw-ui-confirm-dialog', className)}
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {warningBanner ? (
          <div
            className="mw-ui-confirm-dialog-warning"
            data-destructive={destructive ? 'true' : 'false'}
          >
            <WarningIcon size={16} aria-hidden="true" />
            <div>{warningBanner}</div>
          </div>
        ) : null}

        {consequence ? <div className="mw-ui-confirm-dialog-consequence">{consequence}</div> : null}

        {error ? (
          <div role="alert" className="mw-ui-confirm-dialog-error">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? <LoadingSpinner /> : null}
            <span>{confirmLabel}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
