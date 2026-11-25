import Link from 'next/link';
import { Button } from '@moonwitness/ui/components/button';
import { ErrorState } from '@moonwitness/ui/components/error-state';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <ErrorState
        role="region"
        aria-label="Page not found"
        code="404 · Signal lost"
        title="Page not found"
        description="This address does not match a MoonWitness page."
        stateSlug="not-found"
        primaryAction={
          <Button asChild>
            <Link href="/">Return home</Link>
          </Button>
        }
        className="max-w-xl"
      />
    </main>
  );
}
