import { useState } from 'react';
import {
  ComicTheater,
  type ComicTheaterPanelItem,
} from '@moonwitness/ui/components/comic-theater';
import {
  EpistemicBranchPanel,
  type EpistemicBranchChoice,
} from '@moonwitness/ui/components/epistemic-branch-panel';

const DESKTOP_OFFLINE_PANELS: ComicTheaterPanelItem[] = [
  {
    id: 'P01',
    beat: 'ACT I · LOCAL ARCHIVE',
    imageSrc: '/assets/illustrations/home-hero-desktop.webp',
    imageAlt: 'MoonWitness offline desktop comic panel 1',
    speaker: 'Kuro Signal',
    dialogue: 'Offline relay active — every panel and witness note stays local-first.',
    dialogueId: 'Relay luring aktif — setiap panel dan catatan saksi tetap local-first.',
    caption: 'EP-LAB-01 · Offline Desktop Reader',
  },
  {
    id: 'P02',
    beat: 'ACT II · EXPORT PIPELINE',
    imageSrc: '/assets/illustrations/home-hero-desktop.webp',
    imageAlt: 'MoonWitness offline desktop comic panel 2',
    speaker: 'Vesper Ink',
    dialogue: 'Ready for Print Zine PDF, 9:16 Reels WebM, and 1200x630 OG Card export.',
    dialogueId: 'Siap ekspor Print Zine PDF, Reels 9:16 WebM, dan kartu OG 1200x630.',
    caption: 'EP-LAB-01 · Local CLI Exporter',
  },
];

/**
 * Local-first offline comic reader and epistemic branch preview for apps/desktop.
 */
export function DesktopComicReader() {
  const [branch, setBranch] = useState<EpistemicBranchChoice>('preserve-unknown');

  return (
    <section aria-label="Offline Comic Reader" style={{ display: 'grid', gap: 16 }}>
      <ComicTheater
        episodeCode="EP-LAB-01"
        title="WHEN THE MOON RISES, WE SHARE A MESSAGE"
        panels={DESKTOP_OFFLINE_PANELS}
      />
      <EpistemicBranchPanel
        selectedBranch={branch}
        gapCount={branch === 'preserve-unknown' ? 2 : 0}
        onSelectBranch={setBranch}
      />
    </section>
  );
}
