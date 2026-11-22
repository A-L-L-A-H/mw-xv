'use client';

import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { ChevronRightIcon as ChevronDownIcon } from '../icons/chevron-right.js';

export interface SmartButtonAction {
  /** Unique action identifier */
  id: string;
  /** Button label */
  label: string;
  /** Optional count badge */
  count?: number;
  /** Icon name (optional) */
  icon?: React.ReactNode;
  /** Button variant */
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';
  /** Button size */
  size?: 'xs' | 'sm' | 'default' | 'lg' | 'icon-sm' | 'icon-lg';
  /** Whether action is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Aria label */
  ariaLabel?: string;
  /** Whether this is the primary action */
  primary?: boolean;
  /** Tooltip / description */
  description?: string;
}

export interface SmartButtonBoxProps {
  /** Primary actions (always visible) */
  primaryActions?: SmartButtonAction[];
  /** Secondary actions (in dropdown) */
  secondaryActions?: SmartButtonAction[];
  /** Single-button shorthand label */
  label?: string;
  /** Single-button shorthand description */
  description?: string;
  /** Single-button shorthand count */
  count?: number;
  /** Single-button pending / busy state */
  pending?: boolean;
  /** Accessible label override */
  'aria-label'?: string;
  /** Whether the dropdown is open */
  open?: boolean;
  /** Callback when dropdown opens/closes */
  onOpenChange?: (open: boolean) => void;
  /** Custom class name */
  className?: string;
  /** Layout direction */
  direction?: 'horizontal' | 'vertical';
  /** Gap between buttons */
  gap?: number;
  /** Children (not used, for compatibility) */
  children?: React.ReactNode;
}

export function SmartButtonBox({
  primaryActions,
  secondaryActions = [],
  label,
  description,
  count,
  pending,
  'aria-label': ariaLabel,
  open: controlledOpen,
  onOpenChange,
  className,
  direction = 'horizontal',
  gap = 2,
}: SmartButtonBoxProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled ? onOpenChange : setUncontrolledOpen;

  const resolvedPrimaryActions: SmartButtonAction[] =
    primaryActions ??
    (label
      ? [
          {
            id: 'primary',
            label,
            description,
            count,
            ariaLabel,
          },
        ]
      : []);

  const hasSecondaryActions = secondaryActions.length > 0;

  return (
    <div
      className={cn(
        'mw-ui-smart-button-box',
        direction === 'vertical' && 'mw-ui-smart-button-box--vertical',
        className
      )}
      data-slot="smart-button-box"
      role="group"
      aria-label={ariaLabel ?? 'Actions'}
      aria-busy={pending ? 'true' : undefined}
    >
      <div className="mw-ui-smart-button-box-primary">
        {resolvedPrimaryActions.map((action) => (
          <Button
            key={action.id}
            variant={action.variant || (action.primary ? 'default' : 'outline')}
            size={action.size || 'default'}
            disabled={action.disabled}
            onClick={action.onClick}
            aria-label={action.ariaLabel}
            className="mw-ui-smart-button"
          >
            {action.icon && (
              <span className="mw-ui-smart-button-box-icon" aria-hidden="true">
                {action.icon}
              </span>
            )}
            <span className="mw-ui-smart-button-content">
              <span className="mw-ui-smart-button-label">{action.label}</span>
              {action.description ? (
                <span className="mw-ui-smart-button-description">{action.description}</span>
              ) : null}
            </span>
            {action.count !== undefined && action.count > 0 && (
              <span className="mw-ui-smart-button-count" aria-label={action.count + ' items'}>
                {action.count > 99 ? '99+' : action.count}
              </span>
            )}
          </Button>
        ))}
      </div>

      {hasSecondaryActions && (
        <div className="mw-ui-smart-button-box-secondary">
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => setOpen?.(!open)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label="More actions"
            className="mw-ui-smart-button"
          >
            <span className="mw-ui-smart-button-label">More</span>
            <ChevronDownIcon aria-hidden="true" />
          </Button>

          {open && (
            <div className="mw-ui-smart-button-box-dropdown" role="menu">
              {secondaryActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={action.disabled}
                  onClick={() => {
                    action.onClick?.();
                    setOpen?.(false);
                  }}
                  className="mw-ui-smart-button"
                >
                  {action.icon && <span aria-hidden="true">{action.icon}</span>}
                  <span className="mw-ui-smart-button-label">{action.label}</span>
                  {action.count !== undefined && action.count > 0 && (
                    <span className="mw-ui-smart-button-count">
                      {action.count > 99 ? '99+' : action.count}
                    </span>
                  )}
                  {action.description && (
                    <span className="mw-ui-smart-button-description">{action.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
