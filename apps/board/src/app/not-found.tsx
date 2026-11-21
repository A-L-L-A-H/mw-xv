import Link from "next/link";
import { Panel, Button } from "@moonwitness/ui/components";
import { MoonIcon } from "@moonwitness/ui/icons";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="panel surface=torn max-w-xl p-10 text-center">
        <MoonIcon className="mx-auto size-12 text-lime mb-4" />
        <p className="font-mono text-sm uppercase text-destructive">404 · Signal lost</p>
        <h1 className="ink-title mt-3 text-5xl">Page not found</h1>
        <p className="my-4 text-ink-soft">This address does not match a MoonWitness page.</p>
        <Button asChild>
          <Link className="underline" href="/">
            Return home
          </Link>
        </Button>
      </section>
    </main>
  );
}