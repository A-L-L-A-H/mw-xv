import { AddonConsolePage } from '../../../../board-pages/addon-console-page';

export default async function AddonDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly addon: string }>;
}) {
  const { addon } = await params;
  return <AddonConsolePage addon={addon} />;
}
