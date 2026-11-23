import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from './next-navigation';

export interface NextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string | { pathname?: string; query?: Record<string, string | number | undefined> };
  replace?: boolean;
  prefetch?: boolean;
  scroll?: boolean;
}

function resolveHref(href: NextLinkProps['href']): string {
  if (typeof href === 'string') return href;
  const pathname = href.pathname ?? '/';
  if (!href.query) return pathname;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export default function Link({
  href,
  replace,
  prefetch: _prefetch,
  scroll: _scroll,
  onClick,
  target,
  ...rest
}: NextLinkProps) {
  const resolved = resolveHref(href);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (target && target !== '_self')
    ) {
      return;
    }
    if (resolved.startsWith('http://') || resolved.startsWith('https://') || resolved.startsWith('mailto:')) {
      return;
    }
    event.preventDefault();
    navigate(resolved, { replace });
  };

  return <a href={resolved} target={target} onClick={handleClick} {...rest} />;
}
