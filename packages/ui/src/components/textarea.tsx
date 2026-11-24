import * as React from 'react';
import { cn } from '../lib/cn.js';

/** Ink-bordered textarea; focus lifts it with an accent-backed hard shadow. */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'mw-ui-textarea w-full min-w-0 rounded-none border-2 border-ink bg-paper-raised px-3 py-2 text-base text-ink outline-none transition-[box-shadow,transform] placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:-translate-x-px focus-visible:-translate-y-px focus-visible:shadow-[3px_3px_0_0_var(--mw-yellow),5px_5px_0_0_var(--mw-ink)]',
        'aria-invalid:border-[var(--mw-error)] aria-invalid:shadow-[3px_3px_0_0_var(--mw-error)]',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
