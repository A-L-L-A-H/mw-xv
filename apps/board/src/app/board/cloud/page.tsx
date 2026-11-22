import type { Metadata } from 'next';
import { CloudIspPage } from '../../../board-pages/cloud-isp-page';

// oxlint-disable-next-line react/only-export-components
export const metadata: Metadata = {
  title: 'Cloud & ISP | Board',
  robots: { index: false, follow: false },
};

export default function CloudIspRoute() {
  return <CloudIspPage />;
}
