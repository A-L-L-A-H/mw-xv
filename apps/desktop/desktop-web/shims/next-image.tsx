import type { ImgHTMLAttributes } from 'react';

export interface NextImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string | { src: string };
  alt: string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
  loader?: unknown;
}

export default function Image({
  src,
  alt,
  fill,
  priority: _priority,
  quality: _quality,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  unoptimized: _unoptimized,
  loader: _loader,
  style,
  ...rest
}: NextImageProps) {
  const resolvedSrc = typeof src === 'string' ? src : src.src;
  const mergedStyle = fill
    ? { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', ...style }
    : style;

  return <img src={resolvedSrc} alt={alt} style={mergedStyle} {...rest} />;
}
