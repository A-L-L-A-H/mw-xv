'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn.js';
import { Badge } from './badge.js';
import { Button } from './button.js';
import { ComicPanel } from './comic-panel.js';

export type EpistemicBranchChoice = 'preserve-unknown' | 'patch-gap';

export type EpistemicBranchPanelProps = Omit<ComponentPropsWithoutRef<'section'>, 'children'> & {
  prompt?: string;
  selectedBranch: EpistemicBranchChoice;
  gapCount?: number;
  onSelectBranch: (branch: EpistemicBranchChoice) => void;
};

/**
 * Interactive epistemic branching decision overlay ("Preserve Unknown" vs "Patch the Gap")
 * aligned with MoonWitness epistemic integrity rules.
 */
export const EpistemicBranchPanel = forwardRef<HTMLElement, EpistemicBranchPanelProps>(
  function EpistemicBranchPanel(
    {
      prompt = 'An unverified signal gap was detected. Choose how the archive records it:',
      selectedBranch,
      gapCount = 0,
      onSelectBranch,
      className,
      ...props
    },
    ref
  ) {
    return (
      <ComicPanel
        ref={ref}
        kicker="EPISTEMIC DECISION"
        title={prompt}
        surface="ink"
        frame="scuffed"
        accent={selectedBranch === 'preserve-unknown' ? 'cyan' : 'magenta'}
        className={cn('mw-ui-epistemic-branch-panel', className)}
        actions={<Badge>{gapCount} open gaps</Badge>}
        {...props}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          <Button
            type="button"
            variant={selectedBranch === 'preserve-unknown' ? 'default' : 'ghost'}
            aria-pressed={selectedBranch === 'preserve-unknown'}
            onClick={() => onSelectBranch('preserve-unknown')}
          >
            Preserve Unknown (Witness Rule)
          </Button>
          <Button
            type="button"
            variant={selectedBranch === 'patch-gap' ? 'default' : 'ghost'}
            aria-pressed={selectedBranch === 'patch-gap'}
            onClick={() => onSelectBranch('patch-gap')}
          >
            Patch the Gap (Speculative)
          </Button>
        </div>
      </ComicPanel>
    );
  }
);
