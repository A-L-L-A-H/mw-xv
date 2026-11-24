'use client';

import { type ComponentProps } from 'react';
import { Badge } from './badge.js';
import { Button } from './button.js';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog.js';
import { CheckCircleIcon, CloseIcon, CodeIcon, ColumnsIcon, SparkleIcon } from '../icons/index.js';

export type DesktopExperienceMode = 'workspace' | 'developer';

export type ModePickerProps = Omit<ComponentProps<'div'>, 'children' | 'onSelect'> & {
  currentMode?: DesktopExperienceMode;
  onSelect: (mode: DesktopExperienceMode) => void;
  onDismiss?: () => void;
  title?: string;
  description?: string;
};

interface ModeOption {
  id: DesktopExperienceMode;
  label: string;
  subtitle: string;
  badge: string;
  badgeVariant: 'primary' | 'cyan';
  highlights: readonly string[];
}

const MODE_OPTIONS: readonly ModeOption[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    subtitle: 'User Biasa · Focus & Productivity',
    badge: 'Recommended for daily work',
    badgeVariant: 'primary',
    highlights: [
      'Tasks & Kanban board',
      'Knowledge & Notes',
      'Stories & Workbench',
      'Offline-first, zero technical clutter',
    ],
  },
  {
    id: 'developer',
    label: 'DX / Developer',
    subtitle: 'Codex / Agent Harness',
    badge: 'Full Engineering Suite',
    badgeVariant: 'cyan',
    highlights: [
      'Full AI Mission Control',
      'Git Worktrees & Bounded PTY',
      'MCP Server & VPS Mesh Fleet',
      'Model Explorer & Dev Mode',
    ],
  },
];

export function ModePicker({
  currentMode,
  onSelect,
  onDismiss,
  title = 'Choose Your Desktop Experience',
  description = 'Pick the workspace layout that fits your workflow. You can switch anytime in the sidebar or Settings.',
  className,
  ...props
}: ModePickerProps) {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDismiss?.();
      }}
    >
      <DialogContent
        data-slot="mode-picker"
        aria-modal="true"
        className={['mw-ui-mode-picker max-w-2xl p-0 sm:max-w-2xl', className]
          .filter(Boolean)
          .join(' ')}
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (!onDismiss) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (!onDismiss) event.preventDefault();
        }}
        {...props}
      >
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4 border-b-2 border-dashed border-ink/25 pb-4">
            <div className="space-y-1">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">
                MoonWitness Desktop
              </p>
              <DialogTitle className="font-display text-2xl uppercase tracking-wide text-ink">
                {title}
              </DialogTitle>
              <DialogDescription className="text-sm text-ink-soft">
                {description}
              </DialogDescription>
            </div>
            {onDismiss ? (
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close mode selector"
                >
                  <CloseIcon className="size-4" aria-hidden="true" />
                </Button>
              </DialogClose>
            ) : null}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MODE_OPTIONS.map((option) => {
              const isSelected = currentMode === option.id;
              const Icon = option.id === 'workspace' ? ColumnsIcon : CodeIcon;
              return (
                <div
                  key={option.id}
                  data-mode-option={option.id}
                  data-selected={isSelected ? 'true' : 'false'}
                  className={`flex flex-col justify-between gap-4 border-2 p-4 transition-colors ${
                    isSelected
                      ? 'border-ink bg-primary/15 shadow-ink-sm'
                      : 'border-ink/40 bg-paper-raised hover:border-ink'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="grid size-10 shrink-0 place-items-center border-2 border-ink bg-paper text-ink shadow-ink-sm">
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                      <Badge variant={option.badgeVariant}>{option.badge}</Badge>
                    </div>

                    <div>
                      <h3 className="font-display text-lg uppercase tracking-wide text-ink">
                        {option.label}
                      </h3>
                      <p className="font-mono text-xs text-ink-faint">{option.subtitle}</p>
                    </div>

                    <ul className="space-y-1.5 text-xs text-ink-soft">
                      {option.highlights.map((item) => (
                        <li key={item} className="flex items-center gap-2">
                          {option.id === 'workspace' ? (
                            <CheckCircleIcon
                              className="size-3.5 shrink-0 text-ink"
                              aria-hidden="true"
                            />
                          ) : (
                            <SparkleIcon className="size-3.5 shrink-0 text-ink" aria-hidden="true" />
                          )}
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    className="w-full"
                    aria-pressed={isSelected}
                    onClick={() => onSelect(option.id)}
                  >
                    {isSelected ? `Active: ${option.label}` : `Use ${option.label}`}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
