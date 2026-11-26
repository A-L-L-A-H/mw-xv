'use client';

import { useState } from 'react';
import {
  ComicTheater,
  type ComicTheaterPanelItem,
} from '@moonwitness/ui/components/comic-theater';
import {
  EpistemicBranchPanel,
  type EpistemicBranchChoice,
} from '@moonwitness/ui/components/epistemic-branch-panel';

const STUDIO_COMIC_PANELS: ComicTheaterPanelItem[] = [
  {
    id: 'P01',
    beat: 'ACT I · SIGNAL RELAY',
    imageSrc: '/assets/illustrations/home-hero-desktop.webp',
    imageAlt: 'Moon City Signal Relay opening panel',
    speaker: 'Kuro Signal',
    dialogue: 'When the moon rises, we share a message — never invent what is missing.',
    dialogueId: 'Saat bulan terbit, kita berbagi pesan — jangan pernah mengarang yang hilang.',
    caption: 'EP-LAB-01 · Signal Relay Check',
  },
  {
    id: 'P02',
    beat: 'ACT II · WITNESS LEDGER',
    imageSrc: '/assets/illustrations/home-hero-desktop.webp',
    imageAlt: 'Vesper Ink archive workbench verification panel',
    speaker: 'Vesper Ink',
    dialogue: 'Mark every unknown gap explicitly so the archive remains auditable.',
    dialogueId: 'Tandai setiap celah tak pasti secara eksplisit agar arsip tetap dapat diaudit.',
    caption: 'EP-LAB-01 · Zine Ledger Verification',
  },
];

export function ComicTheaterSection() {
  const [branch, setBranch] = useState<EpistemicBranchChoice>('preserve-unknown');

  return (
    <div className="space-y-4">
      <ComicTheater
        episodeCode="EP-LAB-01"
        title="WHEN THE MOON RISES, WE SHARE A MESSAGE"
        panels={STUDIO_COMIC_PANELS}
      />
      <EpistemicBranchPanel
        selectedBranch={branch}
        gapCount={branch === 'preserve-unknown' ? 2 : 0}
        onSelectBranch={setBranch}
      />
    </div>
  );
}
