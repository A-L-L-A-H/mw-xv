'use client';

import { useEffect } from 'react';
import { ErrorState } from '@moonwitness/ui/components/error-state';

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
      <ErrorState
        code="Something interrupted this signal"
        title="Page unavailable"
        description="Your work is still here. Try loading this page again."
        stateSlug="error"
        onRetry={reset}
        retryLabel="Try again"
        className="max-w-xl"
      />
    </main>
  );
}
