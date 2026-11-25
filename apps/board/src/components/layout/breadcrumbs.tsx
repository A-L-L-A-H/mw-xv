import Link from 'next/link';
import {
  Breadcrumbs as UiBreadcrumbs,
  type BreadcrumbItem as UiBreadcrumbItem,
} from '@moonwitness/ui/components/breadcrumbs';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const trail: UiBreadcrumbItem[] = [
    { label: 'Dashboard', href: '/board' },
    ...items.map((item, idx) => {
      const isLast = idx === items.length - 1;
      return {
        label: item.label,
        href: isLast ? undefined : item.to,
        current: isLast || !item.to,
      };
    }),
  ];

  return (
    <UiBreadcrumbs
      items={trail}
      renderLink={(item, _index, className) => (
        <Link href={item.href ?? '/board'} className={className}>
          {item.label}
        </Link>
      )}
    />
  );
}
