'use client';

import type { ReactNode } from 'react';
import { ConfirmDialog as UiConfirmDialog } from '@moonwitness/ui/components/confirm-dialog';

export interface ConfirmDialogProps {
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
}

/** Board-scoped confirmation wrapper delegated to @moonwitness/ui/components/confirm-dialog. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return <UiConfirmDialog {...props} />;
}
