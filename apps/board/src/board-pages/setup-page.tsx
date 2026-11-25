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
import { ArrowRightIcon, CheckCircleIcon, GlobeIcon, LockIcon } from '@moonwitness/ui/icons';

type Step = 1 | 2;
type DomainMode = 'skip' | 'wildcard' | 'custom';

interface PaasSettings {
  publicIpv4?: string;
  instanceDomain?: string;
  wildcardDomain?: string;
  whatsappDomain?: string;
  publicPort?: number;
}

interface DnsVerifyResult {
  httpsReady?: { reachable?: boolean; tlsVerified?: boolean };
  instance?: { matched?: boolean; resolved?: string[] };
  wildcard?: { matched?: boolean };
  whatsapp?: { matched?: boolean };
}

/** Converts an IPv4 address to the sslip.io dashed wildcard domain. */
function sslipWildcard(ip: string): string {
  return `${ip.trim().replace(/\./gu, '-')}.sslip.io`;
}

/**
 * First-boot setup wizard.
 * Step 1: claim the seeded superadmin account.
 * Step 2: choose a domain mode (IP preview / sslip.io wildcard / custom domain).
 */
export function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2 state
  const [settings, setSettings] = useState<PaasSettings | null>(null);
  const [mode, setMode] = useState<DomainMode>('skip');
  const [instanceDomain, setInstanceDomain] = useState('');
  const [wildcardDomain, setWildcardDomain] = useState('');
  const [whatsappDomain, setWhatsappDomain] = useState('');
  const [dnsResult, setDnsResult] = useState<DnsVerifyResult | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (step !== 2) return;
    let active = true;
    void (async () => {
      try {
        const res = await client.request<{ data?: PaasSettings }>('/api/cloud/paas/settings');
        const loaded = res.data ?? (res as unknown as PaasSettings);
        if (!active) return;
        setSettings(loaded);
        const ip = loaded.publicIpv4?.trim() ?? '';
        setInstanceDomain(loaded.instanceDomain ?? (ip ? `${ip}.sslip.io` : ''));
        setWildcardDomain(loaded.wildcardDomain ?? (ip ? sslipWildcard(ip) : ''));
        setWhatsappDomain(loaded.whatsappDomain ?? '');
      } catch {
        // Settings are optional for the skip path; keep empty state.
      }
    })();
    return () => {
      active = false;
    };
  }, [step]);

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

  async function verifyDns() {
    setBusy(true);
    setError(null);
    setDnsResult(null);
    try {
      const res = await client.request<{ data: DnsVerifyResult }>(
        '/api/cloud/paas/settings/verify-dns',
        {
          method: 'POST',
          body: {
            instanceDomain: instanceDomain || undefined,
            wildcardDomain: wildcardDomain || undefined,
            whatsappDomain: whatsappDomain || undefined,
            checkHttps: true,
          },
        }
      );
      setDnsResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DNS verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveAndEnableHttps() {
    setBusy(true);
    setError(null);
    try {
      await client.request('/api/cloud/paas/settings/apply', {
        method: 'POST',
        body: {
          instanceDomain: instanceDomain || undefined,
          wildcardDomain: wildcardDomain || undefined,
          whatsappDomain: whatsappDomain || undefined,
          publicPortEnabled: true,
        },
      });
      setSavedUrl(instanceDomain ? `https://${instanceDomain}/board/cloud` : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save domain settings');
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
    const ip = settings?.publicIpv4?.trim() ?? '';
    const tlsReady = Boolean(dnsResult?.httpsReady?.reachable && dnsResult?.httpsReady?.tlsVerified);
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center justify-center p-6">
        <Panel
          title="Step 2 — Server Access Mode"
          description="Root superadmin claimed. Choose how this instance will be reached."
        >
          <div className="mb-5 flex items-center gap-2">
            <CheckCircleIcon aria-hidden />
            <Badge variant="cyan">Administrator claimed</Badge>
            {ip ? <Badge variant="default">Public IP {ip}</Badge> : null}
          </div>

          {error ? (
            <ErrorState title="Domain setup failed" description={error} headingLevel={3} />
          ) : null}

          <div className="space-y-4">
            {/* Option 1: skip / IP preview */}
            <Panel
              title="1. Skip — IP Preview"
              description={
                ip
                  ? `Continue on http://${ip}:8000 (preview ports 8001–8010).`
                  : 'Continue with the current IP-based preview listeners.'
              }
              density="compact"
              headingLevel={3}
            >
              <Button
                variant={mode === 'skip' ? 'default' : 'outline'}
                onClick={() => {
                  setMode('skip');
                  router.replace('/board/cloud');
                }}
              >
                Continue on IP <ArrowRightIcon aria-hidden />
              </Button>
            </Panel>

            {/* Option 2: instant free wildcard */}
            <Panel
              title="2. 1-Click Instant Free Wildcard"
              description={
                ip
                  ? `Use ${sslipWildcard(ip)} for both the instance and wildcard domain (DNS-only; no account required).`
                  : 'A public IPv4 address is required for the instant wildcard.'
              }
              density="compact"
              headingLevel={3}
            >
              <Button
                variant={mode === 'wildcard' ? 'default' : 'outline'}
                disabled={!ip}
                onClick={() => {
                  setMode('wildcard');
                  setInstanceDomain(`${ip}.sslip.io`);
                  setWildcardDomain(sslipWildcard(ip));
                }}
              >
                <GlobeIcon aria-hidden />
                Use Instant Free Wildcard
              </Button>
            </Panel>

            {/* Option 3: custom domain */}
            <Panel
              title="3. Custom Domain"
              description="Point your domains to this server, verify DNS, then save and enable HTTPS."
              density="compact"
              headingLevel={3}
            >
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="instanceDomain">Instance Domain</Label>
                  <Input
                    id="instanceDomain"
                    value={instanceDomain}
                    onChange={(e) => {
                      setMode('custom');
                      setInstanceDomain(e.target.value);
                    }}
                    placeholder="apps.example.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wildcardDomain">Wildcard Domain</Label>
                  <Input
                    id="wildcardDomain"
                    value={wildcardDomain}
                    onChange={(e) => {
                      setMode('custom');
                      setWildcardDomain(e.target.value);
                    }}
                    placeholder="*.apps.example.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="whatsappDomain">
                    WhatsApp Standalone Domain (optional)
                  </Label>
                  <Input
                    id="whatsappDomain"
                    value={whatsappDomain}
                    onChange={(e) => {
                      setMode('custom');
                      setWhatsappDomain(e.target.value);
                    }}
                    placeholder="wa.apps.example.com"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" disabled={busy} onClick={verifyDns}>
                    Verify DNS
                  </Button>
                  <Button variant="default" disabled={busy} onClick={saveAndEnableHttps}>
                    <LockIcon aria-hidden />
                    Save &amp; Enable HTTPS
                  </Button>
                </div>

                {dnsResult ? (
                  <div className="flex flex-wrap gap-2" aria-live="polite">
                    <Badge variant={dnsResult.instance?.matched ? 'cyan' : 'destructive'}>
                      Instance: {dnsResult.instance?.matched ? 'Matched' : 'Check A record'}
                    </Badge>
                    <Badge variant={dnsResult.wildcard?.matched ? 'cyan' : 'default'}>
                      Wildcard: {dnsResult.wildcard?.matched ? 'Matched' : 'Pending'}
                    </Badge>
                    <Badge variant={tlsReady ? 'cyan' : 'destructive'}>
                      HTTPS: {tlsReady ? 'Ready' : 'Not ready'}
                    </Badge>
                  </div>
                ) : null}

                {savedUrl ? (
                  <a className="block break-all underline" href={savedUrl}>
                    {savedUrl}
                  </a>
                ) : null}
              </div>
            </Panel>
          </div>
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
