'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { SignalIcon, SignalOffIcon, SmartphoneIcon } from '@moonwitness/ui/icons';
import { toast } from '@moonwitness/ui/components/toast';
import { Button } from '@moonwitness/ui/components/button';
import { LiveIndicator } from '@moonwitness/ui/components/effects';
import { Skeleton } from '@moonwitness/ui/components/skeleton';
import { client } from '@/lib/client';
import { scopedQueryKey } from '@/lib/query-scope';
import { statusLabel, type Account } from '@/components/whatsapp/types';

interface PairingPanelProps {
  account: Account | undefined;
  status: string;
  connected: boolean;
  canManage: boolean;
}

export function PairingPanel({ account, status, connected, canManage }: PairingPanelProps) {
  const queryClient = useQueryClient();
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [disconnectConfirmKind, setDisconnectConfirmKind] = useState<'disconnect' | 'cancel'>(
    'disconnect'
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnectConfirmDialogRef = useRef<HTMLElement>(null);
  const [qr, setQr] = useState<{ code: string; image: string } | null>(null);

  useEffect(() => {
    if (!disconnectConfirmOpen) return;
    const dialog = disconnectConfirmDialogRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector =
      'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => element.getAttribute('aria-hidden') !== 'true'
      );
    focusables()[0]?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !disconnecting) {
        event.preventDefault();
        event.stopPropagation();
        setDisconnectConfirmOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusables();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [disconnectConfirmOpen, disconnecting]);

  useEffect(() => {
    let cancelled = false;
    const code = account?.qr_code;
    if (!code) return;
    if (code.startsWith('data:image/')) return;
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(code, { width: 256, margin: 1 }))
      .then((image) => {
        if (!cancelled) setQr({ code, image });
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.qr_code]);

  const connect = async () => {
    try {
      await client.request('/whatsapp/connect', { method: 'POST', body: {} });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start WhatsApp connection');
    }
  };

  const disconnect = async () => {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      await client.request('/whatsapp/disconnect', { method: 'POST', body: {} });
      setDisconnectConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(['whatsapp']) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disconnect WhatsApp');
    } finally {
      setDisconnecting(false);
    }
  };

  const statusIcon = connected ? (
    <SignalIcon className="size-4" />
  ) : (
    <SignalOffIcon className="size-4" />
  );

  const qrImage = account?.qr_code?.startsWith('data:image/')
    ? account.qr_code
    : qr && qr.code === account?.qr_code
      ? qr.image
      : null;

  return (
    <>
      {disconnectConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
          <section
            ref={disconnectConfirmDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="whatsapp-disconnect-title"
            className="w-full max-w-md border-2 border-ink bg-cream p-5 shadow-[6px_6px_0_#171717]"
          >
            <h2 id="whatsapp-disconnect-title" className="font-display text-xl uppercase">
              {disconnectConfirmKind === 'disconnect'
                ? 'Disconnect WhatsApp?'
                : 'Cancel WhatsApp connection?'}
            </h2>
            <p className="mt-2 text-sm">
              {disconnectConfirmKind === 'disconnect'
                ? 'This will sign out the linked device. You will need to scan a new QR code to reconnect.'
                : 'This will stop the current QR pairing attempt. You can start a new connection later.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={disconnecting}
                onClick={() => setDisconnectConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" disabled={disconnecting} onClick={() => void disconnect()}>
                {disconnecting
                  ? disconnectConfirmKind === 'disconnect'
                    ? 'Disconnecting…'
                    : 'Cancelling…'
                  : disconnectConfirmKind === 'disconnect'
                    ? 'Confirm disconnect'
                    : 'Confirm cancellation'}
              </Button>
            </div>
          </section>
        </div>
      )}
      <header className="flex flex-wrap items-center justify-between gap-4 border-2 border-ink bg-paper p-5 shadow-[4px_4px_0_0_var(--ink)]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">
            Company inbox
          </p>
          <h1 className="font-display text-3xl uppercase">WhatsApp</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {statusIcon}
            <span>{statusLabel[status] ?? status}</span>
            <LiveIndicator
              active={connected}
              label={connected ? 'ON AIR' : 'OFFLINE'}
              variant="on-air"
            />
            {account?.phone_number && <span className="font-mono">+{account.phone_number}</span>}
          </p>
          {account?.last_error && <p className="mt-2 text-sm text-red-700">{account.last_error}</p>}
          {connected && account?.webhook_configured === false && (
            <p role="status" className="mt-2 max-w-2xl text-sm text-amber-900 dark:text-amber-300">
              Live callbacks are not configured. Inbound messages update through periodic refresh.
              Configure WHATSAPP_WEBHOOK_URL and WHATSAPP_WEBHOOK_SECRET on the API deployment to
              enable GoWA callbacks.
            </p>
          )}
        </div>
        {!canManage ? (
          <span className="text-sm text-ink-faint">View-only WhatsApp access</span>
        ) : status === 'connected' ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/board/whatsapp/status">Create Status</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDisconnectConfirmKind('disconnect');
                setDisconnectConfirmOpen(true);
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : ['connected', 'connecting', 'qr', 'reconnecting'].includes(status) ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDisconnectConfirmKind(status === 'reconnecting' ? 'disconnect' : 'cancel');
              setDisconnectConfirmOpen(true);
            }}
          >
            {connected ? 'Disconnect' : 'Cancel connection'}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={connect}
            disabled={['connecting', 'qr', 'reconnecting'].includes(status)}
          >
            <SmartphoneIcon className="mr-2 size-4" />
            {status === 'qr_expired' ? 'Refresh QR code' : 'Connect WhatsApp'}
          </Button>
        )}
      </header>
      {status === 'qr' && (
        <section className="flex flex-col items-center border-2 border-ink bg-white p-6 text-center shadow-[4px_4px_0_0_var(--ink)]">
          <h2 className="font-display text-xl uppercase">Scan with WhatsApp</h2>
          <p className="mt-1 text-sm">Open Linked devices on your phone and scan this code.</p>
          {qrImage ? (
            <img
              src={qrImage}
              alt="WhatsApp connection QR code"
              className="mt-4 h-auto w-64 max-w-full"
            />
          ) : (
            <Skeleton className="mt-4 size-64" />
          )}
          <details className="mt-4 w-full max-w-md border-2 border-ink bg-paper p-3 text-left">
            <summary className="cursor-pointer font-display text-sm uppercase">
              QR scan help
            </summary>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
              <li>Open WhatsApp on the phone that owns this number.</li>
              <li>
                Android: open the menu and choose <strong>Linked devices</strong>. iPhone: open{' '}
                <strong>Settings</strong>, then <strong>Linked Devices</strong>.
              </li>
              <li>Choose Link a device, unlock your phone, and scan the code shown here.</li>
            </ol>
            <p className="mt-3 text-sm">
              This QR code expires after a short time. If it expires, choose Refresh QR code and
              scan the new code. If linking fails, update WhatsApp and remove an old linked device
              if your account has reached its device limit.
            </p>
            <p className="mt-2 text-sm font-semibold text-red-800">
              Keep this QR code private. Anyone who scans it can link a device to your WhatsApp
              account.
            </p>
            <a
              className="mt-3 inline-block text-sm underline"
              href="https://faq.whatsapp.com/378279804439436/"
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp linked devices help
            </a>
          </details>
        </section>
      )}
    </>
  );
}
