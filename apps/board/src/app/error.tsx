'use client';

import { useEffect } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { Panel } from '@moonwitness/ui/components/panel';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Panel surface="paper" frame="torn" className="max-w-xl p-10 text-center" role="alert">
        <p className="font-mono text-sm uppercase text-destructive">
          Something interrupted this signal
        </p>
        <h1 className="ink-title mt-3 text-5xl">Page unavailable</h1>
        <p className="my-4 text-ink-soft">Your work is still here. Try loading this page again.</p>
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      </Panel>
    </main>
  );
}
