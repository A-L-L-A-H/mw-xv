import { WhatsAppStatusPage } from '../../../../board-pages/whatsapp-status-page';
import type { Metadata } from 'next';

// Next.js route metadata must be exported from the route file alongside its component.
// oxlint-disable-next-line react/only-export-components
export const metadata: Metadata = {
  title: 'WhatsApp Status | Board',
  robots: { index: false, follow: false },
};

export default function WhatsAppStatusRoute() {
  return <WhatsAppStatusPage />;
}
