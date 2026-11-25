import type { Metadata } from 'next';
import { PageHeader } from '@moonwitness/ui/components/page-header';
import { StickerBadge } from '@moonwitness/ui/components/speech-bubble';
import { EditorialStudioPanel } from '@/components/creative/editorial-studio-panel';

// oxlint-disable-next-line react/only-export-components
export const metadata: Metadata = {
  title: 'Creative & Editorial Studio | Board',
  robots: { index: false, follow: false },
};

export default function BoardStudioPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        treatment="brush"
        title="Editorial & Asmaul Husna"
        accentTitle="Studio"
        accent="magenta"
        description="Signal Riot Creative Universe · Artwork-first publication workflow for GOD PROMISE & ROCKSOUL alongside the Asmaul Husna thematic concept explorer."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StickerBadge tone="yellow" tilt="left">
              SIGNAL RIOT
            </StickerBadge>
            <StickerBadge tone="magenta" tilt="right">
              ARTWORK-FIRST
            </StickerBadge>
          </div>
        }
      />
      <EditorialStudioPanel />
    </div>
  );
}
