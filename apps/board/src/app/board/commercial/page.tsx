import type { Metadata } from 'next';
import { CommercialPage } from '../../../board-pages/commercial-page';

// oxlint-disable-next-line react/only-export-components
export const metadata: Metadata = {
  title: 'Commercial Pipeline | Board',
  robots: { index: false, follow: false },
};

export default function CommercialRoute() {
  return <CommercialPage />;
}
