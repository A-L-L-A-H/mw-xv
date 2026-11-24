import { BrandMark } from '@moonwitness/ui/components/brand-mark';
import { cn } from '@/lib/utils';

/** Use the canonical generated lockup or symbol variant from @moonwitness/assets. */
export function Logo({
  className,
  compact = false,
  surface = 'dark',
  decorative = false,
}: {
  className?: string;
  compact?: boolean;
  surface?: 'light' | 'dark';
  decorative?: boolean;
}) {
  return (
    <BrandMark
      variant={compact ? 'symbol' : 'lockup'}
      tone={surface}
      decorative={decorative}
      alt={decorative ? '' : 'MoonWitness'}
      className={cn(compact ? 'size-8' : 'h-8 w-[12.5rem] object-contain object-left', className)}
    />
  );
}
