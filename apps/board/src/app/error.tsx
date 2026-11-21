import { Panel, Button } from "@moonwitness/ui/components";
import { useEffect } from "react";

export default function AppError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="panel surface=brush text-error" role="alert">
        <p className="font-mono text-sm uppercase text-error">Something interrupted this signal</p>
        <h1 className="ink-title mt-3 text-5xl">Page unavailable</h1>
        <p className="my-4 text-ink-soft">Your work is still here. Try loading this page again.</p>
        <Button onClick={reset}>Try again</Button>
      </section>
    </main>
  );
}