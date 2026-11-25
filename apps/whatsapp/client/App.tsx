import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge } from '@moonwitness/ui/components/badge';
import { Button } from '@moonwitness/ui/components/button';
import '@moonwitness/ui/styles/tokens.css';

interface DeviceStatus {
  deviceId: string;
  status: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'reconnecting';
  isConnected: boolean;
  isLoggedIn: boolean;
  jid: string | null;
  phoneNumber: string | null;
  qr: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  lastError: string | null;
}

interface OverviewPayload {
  service: string;
  driver: string;
  topology: { board: string; api: string; whatsapp: string };
  public_url: string;
  webhook_configured: boolean;
  counts: {
    accounts: number;
    conversations: number;
    messages: number;
    statuses: number;
  };
  devices: DeviceStatus[];
}

interface OrmConversation {
  id: number;
  account_id: number;
  jid: string;
  name: string;
  is_group: boolean;
  unread_count: number;
  last_message: string | null;
  last_message_at: string | null;
}

interface OrmMessage {
  id: number;
  external_id: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  content: string | null;
  status: string;
  sender_jid: string | null;
  sender_display_name: string | null;
  create_date: string;
}

const STORAGE_KEY = 'mw_whatsapp_auth_header';

function buildBasicHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

export function App() {
  const [authHeader, setAuthHeader] = useState<string>(() => {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [authMode, setAuthMode] = useState<'basic' | 'bearer'>('basic');
  const [username, setUsername] = useState('moonwitness');
  const [password, setPassword] = useState('moonwitness');
  const [apiKey, setApiKey] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [conversations, setConversations] = useState<OrmConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<OrmMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [newDeviceId, setNewDeviceId] = useState('default');
  const [pairingPhone, setPairingPhone] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('default');

  const [composerRecipient, setComposerRecipient] = useState('');
  const [composerText, setComposerText] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const apiFetch = useCallback(
    async <T,>(url: string, init: RequestInit = {}, overrideHeader?: string): Promise<T> => {
      const header = overrideHeader ?? authHeader;
      const headers = new Headers(init.headers);
      if (header) headers.set('authorization', header);
      if (init.body && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      const response = await fetch(url, { ...init, headers });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        data?: T;
      } & T;
      if (!response.ok) {
        if (response.status === 401) {
          setUnlocked(false);
        }
        throw new Error(payload.error || `Request failed (${response.status})`);
      }
      return payload;
    },
    [authHeader]
  );

  const refreshAll = useCallback(
    async (overrideHeader?: string) => {
      const [ovRes, convRes] = await Promise.all([
        apiFetch<{ data: OverviewPayload }>('/api/v1/overview', {}, overrideHeader),
        apiFetch<{ data: OrmConversation[] }>(
          `/api/v1/conversations?limit=50${searchQuery.trim() ? `&search=${encodeURIComponent(searchQuery.trim())}` : ''}`,
          {},
          overrideHeader
        ),
      ]);
      setOverview(ovRes.data);
      setConversations(convRes.data);
      setUnlocked(true);
      setErrorBanner(null);

      if (
        ovRes.data.devices.length > 0 &&
        !ovRes.data.devices.some((d) => d.deviceId === selectedDeviceId)
      ) {
        setSelectedDeviceId(ovRes.data.devices[0]!.deviceId);
      }

      if (selectedConversationId) {
        const msgRes = await apiFetch<{ data: OrmMessage[] }>(
          `/api/v1/conversations/${selectedConversationId}/messages?limit=100`,
          {},
          overrideHeader
        );
        setMessages(msgRes.data);
      }
    },
    [apiFetch, searchQuery, selectedConversationId, selectedDeviceId]
  );

  useEffect(() => {
    if (!authHeader) return;
    void refreshAll().catch((err: unknown) => {
      setErrorBanner(err instanceof Error ? err.message : 'Session unlock failed');
    });
  }, [authHeader, refreshAll]);

  const activeDevice = useMemo(() => {
    return (
      overview?.devices.find((d) => d.deviceId === selectedDeviceId) ?? overview?.devices[0] ?? null
    );
  }, [overview, selectedDeviceId]);

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    const header =
      authMode === 'basic'
        ? buildBasicHeader(username.trim(), password)
        : `Bearer ${apiKey.trim()}`;
    setBusyAction('unlock');
    try {
      await refreshAll(header);
      setAuthHeader(header);
      try {
        window.sessionStorage.setItem(STORAGE_KEY, header);
      } catch {
        // Ignore sessionStorage failures in restricted frames.
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusyAction(null);
    }
  }

  function handleLock() {
    setAuthHeader('');
    setUnlocked(false);
    setOverview(null);
    setConversations([]);
    setMessages([]);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  }

  async function handleConnectDevice(event: FormEvent) {
    event.preventDefault();
    setBusyAction('connect');
    try {
      const targetId = newDeviceId.trim() || 'default';
      await apiFetch('/api/v1/devices', {
        method: 'POST',
        body: JSON.stringify({
          device_id: targetId,
          ...(pairingPhone.trim() ? { phone_number: pairingPhone.trim() } : {}),
        }),
      });
      setSelectedDeviceId(targetId);
      await refreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Device connect failed');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeviceAction(action: 'reconnect' | 'logout' | 'pairing-code') {
    const targetId = activeDevice?.deviceId || selectedDeviceId || 'default';
    setBusyAction(action);
    try {
      if (action === 'pairing-code') {
        await apiFetch(`/api/v1/devices/${encodeURIComponent(targetId)}/pairing-code`, {
          method: 'POST',
          body: JSON.stringify({ phone: pairingPhone.trim() }),
        });
      } else {
        await apiFetch(`/api/v1/devices/${encodeURIComponent(targetId)}/${action}`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
      }
      await refreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : `Device ${action} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSelectConversation(conv: OrmConversation) {
    setSelectedConversationId(conv.id);
    setComposerRecipient(conv.jid);
    try {
      const msgRes = await apiFetch<{ data: OrmMessage[] }>(
        `/api/v1/conversations/${conv.id}/messages?limit=100`
      );
      setMessages(msgRes.data);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load messages');
    }
  }

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault();
    if (!composerText.trim()) return;
    setBusyAction('send');
    try {
      await apiFetch('/api/v1/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          device_id: activeDevice?.deviceId || selectedDeviceId || 'default',
          ...(composerRecipient.trim()
            ? { to: composerRecipient.trim() }
            : selectedConversationId
              ? { conversation_id: selectedConversationId }
              : {}),
          message: composerText.trim(),
        }),
      });
      setComposerText('');
      await refreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Message send failed');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="mw-shell">
      <header className="mw-header">
        <div>
          <Badge className="mw-badge">Standalone Gateway · Baileys Native</Badge>
          <h1>MoonWitness WhatsApp Service</h1>
          <p className="mw-topology">
            Topology: <code>apps/board</code> ↔ <code>apps/api</code> ↔ <code>apps/whatsapp</code>{' '}
            (@moonwitness/whatsapp)
          </p>
        </div>
        <div className="mw-header-actions">
          <a className="mw-link-btn" href="/docs" target="_blank" rel="noreferrer">
            OpenAPI Docs (/docs)
          </a>
          <a className="mw-link-btn" href="/healthz" target="_blank" rel="noreferrer">
            Health (/healthz)
          </a>
          {unlocked && (
            <Button type="button" variant="ghost" className="mw-btn mw-btn-ghost" onClick={handleLock}>
              Lock Session
            </Button>
          )}
        </div>
      </header>

      {errorBanner && <div className="mw-alert">{errorBanner}</div>}

      {!unlocked ? (
        <section className="mw-card mw-auth-card">
          <h2>Unlock Gateway Session</h2>
          <p className="mw-muted">
            Authenticate using GoWA Basic Auth or Bearer API Key to inspect devices and ORM state.
          </p>
          <div className="mw-tabs">
            <button
              type="button"
              className={authMode === 'basic' ? 'mw-tab active' : 'mw-tab'}
              onClick={() => setAuthMode('basic')}
            >
              Basic Auth
            </button>
            <button
              type="button"
              className={authMode === 'bearer' ? 'mw-tab active' : 'mw-tab'}
              onClick={() => setAuthMode('bearer')}
            >
              Bearer API Key
            </button>
          </div>
          <form onSubmit={handleUnlock} className="mw-form">
            {authMode === 'basic' ? (
              <>
                <label>
                  Gateway Username
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="moonwitness"
                  />
                </label>
                <label>
                  Gateway Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </label>
              </>
            ) : (
              <label>
                API Key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="WHATSAPP_API_KEY"
                />
              </label>
            )}
            <button type="submit" className="mw-btn" disabled={busyAction === 'unlock'}>
              {busyAction === 'unlock' ? 'Verifying...' : 'Unlock Console'}
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="mw-stats">
            <div className="mw-stat">
              <span>Driver</span>
              <strong>{overview?.driver ?? 'baileys'}</strong>
            </div>
            <div className="mw-stat">
              <span>ORM Accounts</span>
              <strong>{overview?.counts.accounts ?? 0}</strong>
            </div>
            <div className="mw-stat">
              <span>ORM Conversations</span>
              <strong>{overview?.counts.conversations ?? 0}</strong>
            </div>
            <div className="mw-stat">
              <span>ORM Messages</span>
              <strong>{overview?.counts.messages ?? 0}</strong>
            </div>
            <div className="mw-stat">
              <span>Webhook Forward</span>
              <strong>{overview?.webhook_configured ? 'Active' : 'Disabled'}</strong>
            </div>
          </section>

          <div className="mw-grid">
            <section className="mw-card">
              <div className="mw-card-head">
                <h2>Baileys Devices</h2>
                <button
                  type="button"
                  className="mw-btn mw-btn-ghost"
                  onClick={() => void refreshAll()}
                >
                  Refresh
                </button>
              </div>
              <form onSubmit={handleConnectDevice} className="mw-inline-form">
                <input
                  value={newDeviceId}
                  onChange={(e) => setNewDeviceId(e.target.value)}
                  placeholder="Device ID (e.g. default)"
                />
                <input
                  value={pairingPhone}
                  onChange={(e) => setPairingPhone(e.target.value)}
                  placeholder="Phone for pairing code (optional)"
                />
                <button type="submit" className="mw-btn" disabled={busyAction === 'connect'}>
                  Connect / QR
                </button>
              </form>

              <div className="mw-device-list">
                {(overview?.devices ?? []).map((device) => (
                  <button
                    key={device.deviceId}
                    type="button"
                    className={
                      device.deviceId === activeDevice?.deviceId
                        ? 'mw-device-item active'
                        : 'mw-device-item'
                    }
                    onClick={() => setSelectedDeviceId(device.deviceId)}
                  >
                    <span>{device.deviceId}</span>
                    <span className={`mw-pill status-${device.status}`}>{device.status}</span>
                  </button>
                ))}
              </div>

              {activeDevice && (
                <div className="mw-device-detail">
                  <div className="mw-meta-row">
                    <span>JID: {activeDevice.jid ?? 'Unpaired'}</span>
                    <span>Phone: {activeDevice.phoneNumber ?? '—'}</span>
                  </div>
                  {activeDevice.pairingCode && (
                    <div className="mw-pairing-code">
                      Pairing Code: <strong>{activeDevice.pairingCode}</strong>
                    </div>
                  )}
                  {activeDevice.qrDataUrl && (
                    <div className="mw-qr-box">
                      <img src={activeDevice.qrDataUrl} alt={`QR for ${activeDevice.deviceId}`} />
                    </div>
                  )}
                  <div className="mw-btn-row">
                    <button
                      type="button"
                      className="mw-btn mw-btn-ghost"
                      disabled={!pairingPhone.trim() || busyAction === 'pairing-code'}
                      onClick={() => void handleDeviceAction('pairing-code')}
                    >
                      Pairing Code
                    </button>
                    <button
                      type="button"
                      className="mw-btn mw-btn-ghost"
                      disabled={busyAction === 'reconnect'}
                      onClick={() => void handleDeviceAction('reconnect')}
                    >
                      Reconnect
                    </button>
                    <button
                      type="button"
                      className="mw-btn mw-btn-danger"
                      disabled={busyAction === 'logout'}
                      onClick={() => void handleDeviceAction('logout')}
                    >
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="mw-card">
              <div className="mw-card-head">
                <h2>ORM Conversations &amp; Messages</h2>
                <input
                  className="mw-search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search JID or name..."
                />
              </div>

              <div className="mw-inbox-split">
                <div className="mw-conv-list">
                  {conversations.length === 0 ? (
                    <p className="mw-muted">No conversations synced yet.</p>
                  ) : (
                    conversations.map((conv) => (
                      <button
                        key={conv.id}
                        type="button"
                        className={
                          conv.id === selectedConversationId
                            ? 'mw-conv-item active'
                            : 'mw-conv-item'
                        }
                        onClick={() => void handleSelectConversation(conv)}
                      >
                        <div className="mw-conv-top">
                          <strong>{conv.name}</strong>
                          {conv.unread_count > 0 && (
                            <span className="mw-unread">{conv.unread_count}</span>
                          )}
                        </div>
                        <small>{conv.jid}</small>
                        <p>{conv.last_message ?? 'No messages'}</p>
                      </button>
                    ))
                  )}
                </div>

                <div className="mw-msg-pane">
                  <div className="mw-msg-list">
                    {messages.length === 0 ? (
                      <p className="mw-muted">Select a conversation or send a new message below.</p>
                    ) : (
                      [...messages].reverse().map((msg) => (
                        <div
                          key={msg.id}
                          className={`mw-msg ${msg.direction === 'outbound' ? 'outbound' : 'inbound'}`}
                        >
                          <div className="mw-msg-meta">
                            <span>{msg.direction}</span>
                            <span>{msg.status}</span>
                          </div>
                          <div>{msg.content || `[${msg.message_type}]`}</div>
                        </div>
                      ))
                    )}
                  </div>

                  <form onSubmit={handleSendMessage} className="mw-composer">
                    <input
                      value={composerRecipient}
                      onChange={(e) => setComposerRecipient(e.target.value)}
                      placeholder="Recipient phone or JID (e.g. 6281234567890)"
                    />
                    <div className="mw-composer-row">
                      <input
                        value={composerText}
                        onChange={(e) => setComposerText(e.target.value)}
                        placeholder="Write WhatsApp message..."
                      />
                      <button type="submit" className="mw-btn" disabled={busyAction === 'send'}>
                        Send
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
