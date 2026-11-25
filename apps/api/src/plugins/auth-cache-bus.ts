import { Client } from 'pg';

/**
 * Cross-process auth cache invalidation (AUD-006 / TASK-EX-01).
 *
 * The auth plugin keeps a short-TTL, in-process cache of role/membership data.
 * Within one process, `invalidateAuthCache()` is exact. Across replicas the
 * cache used to lag by up to its TTL, so a demotion or revocation applied by
 * one replica left other replicas honoring stale authorization for seconds.
 *
 * On PostgreSQL, this module owns a dedicated LISTEN connection and broadcasts
 * invalidations over `NOTIFY auth_cache_invalidate`, so every replica drops its
 * cached entry immediately. On non-PostgreSQL test backends, the bus is inert
 * and local invalidation remains the source of truth.
 */

const CHANNEL = 'auth_cache_invalidate';

export interface AuthCacheBus {
  /** Broadcast a cache invalidation to every connected replica. */
  broadcast(userId?: number): Promise<void>;
  /** Close the listener, if one was started. */
  close(): Promise<void>;
}

interface AuthCacheBusOptions {
  connectionString: string;
  logger?: { warn(message: string): void };
  /** Testing hook: called with the raw payload on every received notification. */
  onNotification?: (userId: number | undefined) => void;
}

function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

export function createAuthCacheBus(options: AuthCacheBusOptions): AuthCacheBus {
  if (!isPostgresUrl(options.connectionString)) {
    return { broadcast: async () => {}, close: async () => {} };
  }

  let listener: Client | null = null;
  let connecting: Promise<Client> | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const start = (): Promise<Client> => {
    if (closed) throw new Error('auth cache bus is closed');
    if (listener) return Promise.resolve(listener);
    if (connecting) return connecting;
    connecting = (async () => {
      const client = new Client({ connectionString: options.connectionString });
      client.on('error', (error: Error) => {
        options.logger?.warn(`auth cache listener error: ${error.message}`);
        listener = null;
        scheduleReconnect();
      });
      client.on('notification', (message) => {
        if (message.channel !== CHANNEL || !message.payload) return;
        try {
          const parsed = JSON.parse(message.payload) as { user_id?: number };
          options.onNotification?.(parsed.user_id);
        } catch {
          // Unparseable payloads from other replicas invalidate everything.
          options.onNotification?.(undefined);
        }
      });
      client.on('end', () => {
        listener = null;
        if (!closed) scheduleReconnect();
      });
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      listener = client;
      connecting = null;
      return client;
    })();
    return connecting;
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start().catch(() => {
        /* retried on the next broadcast */
      });
    }, 1_000);
    reconnectTimer.unref?.();
  };

  return {
    async broadcast(userId?: number): Promise<void> {
      if (closed) return;
      const payload = JSON.stringify({ user_id: userId ?? null, ts: Date.now() });
      try {
        const client = await start();
        await client.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
      } catch {
        // Listeners of other replicas keep their TTL fallback; local cache is
        // already invalidated by the caller. Reconnect in the background.
        listener = null;
        connecting = null;
        scheduleReconnect();
      }
    },
    async close(): Promise<void> {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (listener) {
        const client = listener;
        listener = null;
        await client.end().catch(() => {});
      }
    },
  };
}

export const AUTH_CACHE_INVALIDATION_CHANNEL = CHANNEL;
