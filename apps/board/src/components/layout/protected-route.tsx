'use client';

import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/hooks/use-auth-context';
import { client } from '@/lib/client';

const subscribeToNothing = () => () => {};
const getClientMountedSnapshot = () => true;
const getServerMountedSnapshot = () => false;

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getClientMountedSnapshot,
    getServerMountedSnapshot
  );
  const [authReady, setAuthReady] = useState(false);
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const safePathname = pathname ?? '/board';
  const query = search?.toString();
  const from = `${safePathname}${query ? `?${query}` : ''}`;
  useEffect(() => {
    let active = true;
    void client.ready().finally(() => {
      if (active) setAuthReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (mounted && authReady && !user && !client.isAuthenticated) {
      router.replace(`/login?returnTo=${encodeURIComponent(from)}`);
    }
  }, [authReady, from, mounted, router, user]);
  if (!mounted || !user) {
    return (
      <main className="min-h-dvh p-8" aria-busy="true">
        <Skeleton label="Loading workspace" className="h-12 w-48" />
      </main>
    );
  }
  return <AppShell>{children}</AppShell>;
}
