import { useSyncExternalStore } from 'react';

const NAVIGATE_EVENT = 'mw:navigate';

function getLocationKey(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function subscribeLocation(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('popstate', callback);
  window.addEventListener(NAVIGATE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(NAVIGATE_EVENT, callback);
  };
}

export function navigate(href: string, options?: { replace?: boolean }): void {
  if (typeof window === 'undefined') return;
  const target = new URL(href, window.location.origin);
  const nextUrl = `${target.pathname}${target.search}${target.hash}`;
  if (options?.replace) {
    window.history.replaceState(null, '', nextUrl);
  } else {
    window.history.pushState(null, '', nextUrl);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function usePathname(): string {
  useSyncExternalStore(subscribeLocation, getLocationKey, () => '/');
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

export function useSearchParams(): URLSearchParams {
  useSyncExternalStore(subscribeLocation, getLocationKey, () => '/');
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function useParams<
  T extends Record<string, string | string[]> = Record<string, string>,
>(): T {
  const pathname = usePathname();
  const params: Record<string, string> = {};
  const modelMatch = /^\/board\/m\/([^/]+)(?:\/([^/]+))?\/?$/u.exec(pathname);
  if (modelMatch) {
    params.model = decodeURIComponent(modelMatch[1]);
    if (modelMatch[2]) {
      params.id = decodeURIComponent(modelMatch[2]);
    }
  }
  return params as T;
}

export function useRouter() {
  return {
    push: (href: string) => navigate(href, { replace: false }),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => {
      if (typeof window !== 'undefined') window.history.back();
    },
    forward: () => {
      if (typeof window !== 'undefined') window.history.forward();
    },
    refresh: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(NAVIGATE_EVENT));
      }
    },
    prefetch: async () => undefined,
  };
}

export function redirect(href: string): never {
  navigate(href, { replace: true });
  throw new Error(`Redirected to ${href}`);
}
