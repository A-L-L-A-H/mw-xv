import { useState } from 'react';
import {
  ComicTheater,
  type ComicTheaterPanelItem,
} from '@moonwitness/ui/components/comic-theater';
import {
  EpistemicBranchPanel,
  type EpistemicBranchChoice,
} from '@moonwitness/ui/components/epistemic-branch-panel';
import homeHeroDesktop from '@moonwitness/assets/illustrations/home-hero-desktop.webp';

const SPECIMEN_PANELS: ComicTheaterPanelItem[] = [
  {
    id: 'P01',
    beat: 'ACT I · SIGNAL',
    imageSrc: homeHeroDesktop,
    imageAlt: 'MoonWitness comic specimen panel 1',
    speaker: 'Kuro Signal',
    dialogue: 'When the moon rises, we share a message — never invent what is missing.',
    dialogueId: 'Saat bulan terbit, kita berbagi pesan — jangan pernah mengarang yang hilang.',
    caption: 'Signal relay check at Moon City workbench',
  },
  {
    id: 'P02',
    beat: 'ACT II · ARCHIVE',
    imageSrc: homeHeroDesktop,
    imageAlt: 'MoonWitness comic specimen panel 2',
    speaker: 'Vesper Ink',
    dialogue: 'Mark the gap clearly so every witness sees where certainty stops.',
    dialogueId: 'Tandai celahnya dengan jelas agar setiap saksi tahu batas kepastian.',
    caption: 'Zine ledger verification',
  },
];

export function ComicLab() {
  const [branch, setBranch] = useState<EpistemicBranchChoice>('preserve-unknown');

  return (
    <section aria-label="Comic Theater and Epistemic Branching Specimen" style={{ display: 'grid', gap: 16 }}>
      <ComicTheater
        episodeCode="EP-LAB-01"
        title="WHEN THE MOON RISES, WE SHARE A MESSAGE"
        panels={SPECIMEN_PANELS}
      />
      <EpistemicBranchPanel
        selectedBranch={branch}
        gapCount={branch === 'preserve-unknown' ? 2 : 0}
        onSelectBranch={setBranch}
      />
    </section>
  );
}
