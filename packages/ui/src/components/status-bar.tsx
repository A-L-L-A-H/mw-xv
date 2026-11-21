import { cn } from '../lib/cn.js';

export type StatusBarState = 'active' | 'done' | 'disabled';
export type StatusBarStep = {
  id: string;
  label: string;
  state?: StatusBarState;
  count?: number;
};

export type StatusBarProps = {
  steps: readonly StatusBarStep[];
  className?: string;
};

export function StatusBar({ steps, className }: StatusBarProps) {
  return (
    <ol className={cn('mw-ui-status-bar', className)} data-slot="status-bar">
      {steps.map((step) => (
        <li
          aria-current={step.state === 'active' ? 'step' : undefined}
          className="mw-ui-status-step"
          data-count={step.count ?? undefined}
          data-state={step.state ?? 'disabled'}
          key={step.id}
        >
          <span aria-hidden="true" className="mw-ui-status-indicator" />
          <span className="mw-ui-status-label">{step.label}</span>
          {step.count !== undefined ? (
            <span className="mw-ui-status-count">{step.count}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
