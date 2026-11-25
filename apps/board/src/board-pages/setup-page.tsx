'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { client } from '@/lib/client';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { Panel } from '@moonwitness/ui/components/panel';
import { Badge } from '@moonwitness/ui/components/badge';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { ArrowRightIcon, CheckCircleIcon, LockIcon } from '@moonwitness/ui/icons';

type Step = 1 | 2;

/**
 * First-boot setup wizard.
 * Step 1: claim the seeded superadmin account.
 * Step 2: choose a domain mode (implemented in the following task).
 */
export function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await client.getSetupStatus();
        if (active && !status.setupRequired && step === 1) {
          router.replace('/login');
          return;
        }
      } catch {
        // Fail open on status errors; the claim endpoint enforces the real gate.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router, step]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '').trim();
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirm_password') ?? '');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await client.claimSetup({
        setup_token: value('setup_token'),
        login: value('login') || 'superadmin',
        password,
        name: value('name') || undefined,
        email: value('email') || undefined,
      });
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup claim failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center justify-center p-6">
        <Panel title="Server Setup" description="Checking first-boot status…">
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Panel>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center justify-center p-6">
        <Panel
          title="Step 2 — Server Access Mode"
          description="Root superadmin claimed. Choose how this instance will be reached."
        >
          <div className="flex items-center gap-2">
            <CheckCircleIcon aria-hidden />
            <Badge variant="cyan">Administrator claimed</Badge>
          </div>
          <p className="mt-4 text-sm opacity-80">
            Domain mode configuration is available in the Server Instance &amp; Domains panel.
          </p>
          <Button className="mt-4" onClick={() => router.replace('/board/cloud')} variant="default">
            Continue to PaaS Studio <ArrowRightIcon aria-hidden />
          </Button>
        </Panel>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center justify-center p-6">
      <Panel
        title="First-Boot Server Setup"
        description="Claim the root superadmin account to secure this instance."
      >
        {error ? (
          <ErrorState title="Setup failed" description={error} headingLevel={3} />
        ) : null}
        <form id="setup-form" onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="setup_token">Setup Token</Label>
            <Input id="setup_token" name="setup_token" required autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="login">Login</Label>
            <Input id="login" name="login" defaultValue="superadmin" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">Display Name (optional)</Label>
            <Input id="name" name="name" autoComplete="name" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email (optional)</Label>
            <Input id="email" name="email" type="email" autoComplete="email" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="new-password" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm_password">Confirm Password</Label>
            <Input
              id="confirm_password"
              name="confirm_password"
              type="password"
              required
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" disabled={busy} variant="default">
            <LockIcon aria-hidden />
            {busy ? 'Claiming…' : 'Claim Root Superadmin'}
          </Button>
        </form>
      </Panel>
    </main>
  );
}
