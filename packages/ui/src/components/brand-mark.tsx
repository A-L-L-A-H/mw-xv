import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import {
  getBrandMarkAsset,
  type BrandMarkTone,
  type BrandMarkVariant,
} from '../lib/asset-registry.js';
import { cn } from '../lib/cn.js';

export type BrandMarkProps = Omit<ComponentPropsWithoutRef<'img'>, 'src'> & {
  variant?: BrandMarkVariant;
  tone?: BrandMarkTone;
  basePath?: string;
  decorative?: boolean;
};

const DEFAULT_DIMENSIONS: Record<BrandMarkVariant, { width: number; height: number }> = {
  symbol: { width: 64, height: 64 },
  wordmark: { width: 420, height: 80 },
  lockup: { width: 520, height: 80 },
};

/** Canonical MoonWitness crown symbol, wordmark, or lockup resolved through asset-registry. */
export const BrandMark = forwardRef<HTMLImageElement, BrandMarkProps>(function BrandMark(
  {
    variant = 'lockup',
    tone = 'dark',
    basePath = '',
    decorative = false,
    alt,
    width,
    height,
    className,
    decoding = 'async',
    ...props
  },
  ref
) {
  const asset = getBrandMarkAsset(variant, tone, { basePath });
  const dims = DEFAULT_DIMENSIONS[variant];

  return (
    <img
      ref={ref}
      src={asset.src}
      alt={decorative ? '' : (alt ?? asset.alt)}
      aria-hidden={decorative || undefined}
      width={width ?? dims.width}
      height={height ?? dims.height}
      decoding={decoding}
      data-slot="brand-mark"
      data-variant={variant}
      data-tone={tone}
      className={cn('mw-ui-brand-mark', className)}
      {...props}
    />
  );
});
