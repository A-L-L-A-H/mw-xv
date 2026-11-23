import type { Metadata } from 'next';
import { PageHeader } from '@moonwitness/ui/components/page-header';
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
        title="Editorial & Asmaul Husna Studio"
        description="Wave F.32 + F.33 · Artwork-first publication workflow for GOD PROMISE & ROCKSOUL alongside the Asmaul Husna thematic concept explorer."
      />
      <EditorialStudioPanel />
    </div>
  );
}
