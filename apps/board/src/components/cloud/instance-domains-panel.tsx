'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { Input } from '@moonwitness/ui/components/input';
import { Label } from '@moonwitness/ui/components/label';
import { Badge } from '@moonwitness/ui/components/badge';
import { Panel } from '@moonwitness/ui/components/panel';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { EmptyState } from '@moonwitness/ui/components/empty-state';
import { ErrorState } from '@moonwitness/ui/components/error-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@moonwitness/ui/components/table';
import { ConfirmDialog } from '@moonwitness/ui/components/confirm-dialog';
import { GlobeIcon, CheckCircleIcon, ArrowRightIcon, LockIcon } from '@moonwitness/ui/icons';

export interface InstanceDomainsPanelProps {
  apiBase: string;
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  onSettingsApplied?: () => void | Promise<void>;
}

interface Settings {
  instanceDomain: string;
  wildcardDomain: string;
  whatsappDomain: string;
  publicIpv4: string;
  publicPort: number;
  publicPortEnabled: boolean;
  accessMode: string;
  routes?: Array<{ domain: string; upstream: string }>;
  previewListeners?: Array<{ slug: string; port: number; upstream: string }>;
  hasPreviewApps?: boolean;
}

interface DnsCheck {
  matched?: boolean;
  resolved?: string[];
  expected?: string;
  proxied?: boolean;
}

interface VerifyResult {
  allMatched?: boolean;
  expectedIpv4?: string;
  instance?: DnsCheck;
  wildcard?: DnsCheck;
  whatsapp?: DnsCheck;
  httpsReady?: { reachable?: boolean; tlsVerified?: boolean };
}

function dashedWildcard(ip: string): string {
  return `${ip.trim().replace(/\./gu, '-')}.sslip.io`;
}

function accessBadge(settings: Settings | null): { label: string; variant: 'default' | 'cyan' | 'primary' } {
  if (!settings) return { label: 'Unknown', variant: 'default' };
  if (!settings.publicPortEnabled) return { label: 'HTTPS Hardened', variant: 'primary' };
  if (settings.instanceDomain) return { label: 'Dual HTTP+HTTPS', variant: 'cyan' };
  return { label: 'IP Bootstrap :8000', variant: 'default' };
}

export function InstanceDomainsPanel({
  apiBase,
  fetchFn,
  onSettingsApplied,
}: InstanceDomainsPanelProps) {
  const base = apiBase.replace(/\/+$/u, '');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [instanceDomain, setInstanceDomain] = useState('');
  const [wildcardDomain, setWildcardDomain] = useState('');
  const [whatsappDomain, setWhatsappDomain] = useState('');
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [lockdownOpen, setLockdownOpen] = useState(false);
  const [httpsReady, setHttpsReady] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFn(`${base}/settings`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
      const body = (await res.json()) as { success?: boolean; data?: Settings };
      const data = body.data ?? (body as unknown as Settings);
      setSettings(data);
      setInstanceDomain(data.instanceDomain ?? '');
      setWildcardDomain(data.wildcardDomain ?? '');
      setWhatsappDomain(data.whatsappDomain ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load instance settings');
    } finally {
      setLoading(false);
    }
  }, [base, fetchFn]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetchFn(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  }

  async function onVerifyDns() {
    setBusy(true);
    setError(null);
    try {
      const result = (await post('/settings/verify-dns', {
        instanceDomain: instanceDomain || undefined,
        wildcardDomain: wildcardDomain || undefined,
        whatsappDomain: whatsappDomain || undefined,
        checkHttps: true,
      })) as { data?: VerifyResult } & VerifyResult;
      setVerify(result.data ?? result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DNS verification failed');
    } finally {
      setBusy(false);
    }
  }

  async function onTestHttps() {
    setBusy(true);
    setError(null);
    try {
      const result = (await post('/settings/verify-dns', {
        instanceDomain: instanceDomain || undefined,
        checkHttps: true,
      })) as { data?: VerifyResult } & VerifyResult;
      const data = result.data ?? result;
      setVerify(data);
      setHttpsReady(Boolean(data.httpsReady?.reachable && data.httpsReady?.tlsVerified));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'HTTPS reachability check failed');
    } finally {
      setBusy(false);
    }
  }

  async function onLockdown() {
    setBusy(true);
    setError(null);
    try {
      await post('/settings/apply', {
        instanceDomain: instanceDomain || undefined,
        publicPortEnabled: false,
      });
      setLockdownOpen(false);
      await load();
      await onSettingsApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock down port 8000');
    } finally {
      setBusy(false);
    }
  }

  async function onReenable() {
    setBusy(true);
    setError(null);
    try {
      await post('/settings/apply', {
        instanceDomain: instanceDomain || undefined,
        publicPortEnabled: true,
      });
      await load();
      await onSettingsApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-enable port 8000');
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      await post('/settings/apply', {
        instanceDomain: instanceDomain || undefined,
        wildcardDomain: wildcardDomain || undefined,
        whatsappDomain: whatsappDomain || undefined,
        publicPortEnabled: settings?.publicPortEnabled ?? true,
      });
      await load();
      await onSettingsApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setBusy(false);
    }
  }

  async function onPromote() {
    setBusy(true);
    setError(null);
    try {
      await post('/settings/promote-wildcard', { wildcardDomain });
      await load();
      await onSettingsApplied?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote preview apps');
    } finally {
      setBusy(false);
    }
  }

  const badge = accessBadge(settings);

  if (loading) {
    return (
      <Panel title="Instance & Domains">
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Panel>
    );
  }

  if (error && !settings) {
    return (
      <Panel title="Instance & Domains">
        <ErrorState
          title="Unable to load instance settings"
          description={error}
          onRetry={() => void load()}
          headingLevel={3}
        />
      </Panel>
    );
  }

  const ip = settings?.publicIpv4?.trim() ?? '';

  return (
    <div className="space-y-4">
      <Panel
        title="Instance & Domains"
        description="Configure how this server is reached from the public Internet."
        actions={<Badge variant={badge.variant}>{badge.label}</Badge>}
      >
        {error ? <ErrorState title="Update failed" description={error} headingLevel={3} /> : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {ip ? <Badge variant="default">Public IPv4: {ip}</Badge> : null}
          {settings?.instanceDomain ? (
            <Badge variant="cyan">Instance: {settings.instanceDomain}</Badge>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={!ip}
            onClick={() => {
              setInstanceDomain(`${ip}.sslip.io`);
              setWildcardDomain(dashedWildcard(ip));
            }}
          >
            <GlobeIcon aria-hidden />
            Use Instant Free Wildcard ({ip ? dashedWildcard(ip) : '—'})
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="instanceDomain">Instance Domain</Label>
            <Input
              id="instanceDomain"
              value={instanceDomain}
              onChange={(e) => setInstanceDomain(e.target.value)}
              placeholder="apps.example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wildcardDomain">Wildcard Domain</Label>
            <Input
              id="wildcardDomain"
              value={wildcardDomain}
              onChange={(e) => setWildcardDomain(e.target.value)}
              placeholder="*.apps.example.com"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="whatsappDomain">WhatsApp Standalone Domain (optional)</Label>
            <Input
              id="whatsappDomain"
              value={whatsappDomain}
              onChange={(e) => setWhatsappDomain(e.target.value)}
              placeholder="wa.apps.example.com"
            />
          </div>
        </div>

        <div className="mt-4">
          <h3 className="text-sm font-semibold">DNS A records</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Proxy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{instanceDomain || '—'}</TableCell>
                <TableCell>A</TableCell>
                <TableCell>{ip || '—'}</TableCell>
                <TableCell>Grey cloud (DNS only)</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{wildcardDomain || '—'}</TableCell>
                <TableCell>A</TableCell>
                <TableCell>{ip || '—'}</TableCell>
                <TableCell>Grey cloud (DNS only)</TableCell>
              </TableRow>
              {whatsappDomain ? (
                <TableRow>
                  <TableCell>{whatsappDomain}</TableCell>
                  <TableCell>A</TableCell>
                  <TableCell>{ip || '—'}</TableCell>
                  <TableCell>Grey cloud (DNS only)</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs opacity-70">
            Keep Cloudflare in grey-cloud / DNS-only mode so the built-in Caddy can obtain and renew
            Let&apos;s Encrypt certificates directly.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void onVerifyDns()}>
            Verify DNS
          </Button>
          <Button variant="default" disabled={busy} onClick={() => void onSave()}>
            Save &amp; Reload Proxy
          </Button>
          {settings?.wildcardDomain && settings.hasPreviewApps ? (
            <Button variant="outline" disabled={busy} onClick={() => void onPromote()}>
              Promote IP-Preview Apps to Wildcard HTTPS <ArrowRightIcon aria-hidden />
            </Button>
          ) : null}
        </div>

        {verify ? (
          <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
            <Badge variant={verify.instance?.matched ? 'cyan' : 'destructive'}>
              Instance: {verify.instance?.matched ? 'Matched' : 'Different IP (Proxied?)'}
            </Badge>
            <Badge variant={verify.wildcard?.matched ? 'cyan' : 'default'}>
              Wildcard: {verify.wildcard?.matched ? 'Matched' : 'Unresolved'}
            </Badge>
            {whatsappDomain ? (
              <Badge variant={verify.whatsapp?.matched ? 'cyan' : 'default'}>
                WhatsApp: {verify.whatsapp?.matched ? 'Matched' : 'Unresolved'}
              </Badge>
            ) : null}
            {verify.instance?.resolved?.length ? (
              <Badge variant="default">Resolved: {verify.instance.resolved.join(', ')}</Badge>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel title="Active Caddy Routes" description="Routes currently served by the reverse proxy.">
        {settings?.routes?.length ? (
          <ul className="space-y-1 text-sm">
            {settings.routes.map((route) => (
              <li key={route.domain} className="flex flex-wrap justify-between gap-2">
                <span>{route.domain}</span>
                <Badge variant="default">{route.upstream}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No active routes" description="Configure a domain to create routes." />
        )}
        {settings?.previewListeners?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {settings.previewListeners.map((listener) => (
              <Badge key={`${listener.slug}-${listener.port}`} variant="default">
                Preview {listener.slug}:{listener.port}
              </Badge>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Port 8000 HTTPS-Only Hardening"
        description="Once HTTPS is verified on your instance domain, you can close the public :8000 bootstrap port. HTTPS remains available on :443."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void onTestHttps()}>
            Test HTTPS Reachability
          </Button>
          <Badge variant={httpsReady ? 'cyan' : 'default'}>
            HTTPS: {httpsReady ? 'Reachable & TLS verified' : 'Not verified'}
          </Badge>
          {settings?.publicPortEnabled === false ? (
            <Button variant="outline" disabled={busy} onClick={() => void onReenable()}>
              Re-enable Port 8000
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={busy || !settings?.instanceDomain || !httpsReady}
              onClick={() => setLockdownOpen(true)}
            >
              <LockIcon aria-hidden />
              Lock Down Port 8000
            </Button>
          )}
        </div>
        {!settings?.instanceDomain ? (
          <p className="mt-2 text-xs opacity-70">Save an instance domain before locking down the port.</p>
        ) : null}
      </Panel>

      <ConfirmDialog
        open={lockdownOpen}
        onOpenChange={setLockdownOpen}
        title="Lock down public port 8000?"
        description="This closes the HTTP bootstrap port :8000. Your instance must remain reachable over verified HTTPS on :443."
        warningBanner="Make sure HTTPS is working before continuing — you may lose browser access on :8000."
        consequence="If HTTPS breaks, recover from SSH with: bash /opt/moonwitness-xv/deploy/vps/install.sh --unlock-port"
        confirmLabel="Lock Down Port 8000"
        destructive
        busy={busy}
        onConfirm={() => void onLockdown()}
      />
    </div>
  );
}
