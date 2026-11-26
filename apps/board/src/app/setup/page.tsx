import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SetupPage } from '../../board-pages/setup-page';
import { BoardProviders } from '../../providers';

// Next.js route metadata must be exported from the route file alongside its component.
// oxlint-disable-next-line react/only-export-components
export const metadata: Metadata = {
  title: 'Server Setup',
  robots: { index: false, follow: false },
};

export default function SetupRoutePage() {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <BoardProviders>
        <SetupPage />
      </BoardProviders>
    </Suspense>
  );
}
