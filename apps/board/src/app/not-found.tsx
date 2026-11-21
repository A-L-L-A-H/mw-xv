import Link from 'next/link';
import { Button } from '@moonwitness/ui/components/button';
import { Panel } from '@moonwitness/ui/components/panel';
import { MoonIcon } from '@moonwitness/ui/icons';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Panel surface="paper" frame="torn" className="max-w-xl p-10 text-center">
        <MoonIcon aria-hidden="true" className="mx-auto mb-4 size-12 text-ink" />
        <p className="font-mono text-sm uppercase text-destructive">404 · Signal lost</p>
        <h1 className="ink-title mt-3 text-5xl">Page not found</h1>
        <p className="my-4 text-ink-soft">This address does not match a MoonWitness page.</p>
        <Button asChild>
          <Link href="/">Return home</Link>
        </Button>
      </Panel>
    </main>
  );
}
