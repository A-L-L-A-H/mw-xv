import { createConnection } from 'node:net';
import { isRecord } from '@moonwitness/types';
import { ispAuthHeaders, resolveIspAdminToken } from './auth.js';
import { meterSessionsToSubscriptionInvoices } from './metering.js';
import { ISPNAS, ISPRadiusOutbox, ISPRadiusSession, ISPSubscriber } from './models/index.js';

export type IspNasRecord = InstanceType<typeof ISPNAS>;
export type NasHealthStatus = 'healthy' | 'degraded' | 'offline';

export interface SyncIspRuntimeSessionsOptions {
  readonly companyId?: number;
  readonly ispServiceUrl?: string;
  readonly adminToken?: string;
  readonly jwtSecret?: string;
  readonly pricePerGbMinor?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface SyncIspRuntimeSessionsResult {
  readonly fetchedSessions: number;
  readonly upsertedSessions: number;
  readonly createdInvoiceLines: number;
  readonly totalAmountMinor: number;
}

export interface ProcessIspRadiusOutboxOptions {
  readonly companyId?: number;
  readonly ispServiceUrl?: string;
  readonly adminToken?: string;
  readonly jwtSecret?: string;
  readonly fetchImpl?: typeof fetch;
  readonly limit?: number;
}

export interface ProcessIspRadiusOutboxResult {
  readonly processed: number;
  readonly sent: number;
  readonly failed: number;
}

export interface ProbeIspNasHealthOptions {
  readonly companyId?: number;
  readonly probeFn?: (nas: IspNasRecord) => Promise<NasHealthStatus>;
  readonly timeoutMs?: number;
}

export interface ProbeIspNasHealthResult {
  readonly probed: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly offline: number;
}

export interface DispatchIspDisconnectInput {
  readonly baseUrl: string;
  readonly token: string | undefined;
  readonly fetchImpl: typeof fetch;
  readonly username: string;
  readonly nasIp?: string | null;
  readonly acctSessionId?: string | null;
  readonly framedIp?: string | null;
  readonly timeoutMs?: number;
}

export interface DispatchIspDisconnectResult {
  readonly ok: boolean;
  readonly response?: string;
  readonly errorMessage?: string;
}

interface RuntimeRadiusSession {
  readonly session_id: string;
  readonly username: string;
  readonly nas_ip?: string | null;
  readonly nas_port?: string | null;
  readonly framed_ip?: string | null;
  readonly calling_station_id?: string | null;
  readonly acct_input_octets?: number | null;
  readonly acct_output_octets?: number | null;
  readonly acct_session_time?: number | null;
  readonly started_at?: string | null;
  readonly stopped_at?: string | null;
  readonly status?: string | null;
  readonly terminate_cause?: string | number | null;
}

function normalizeBaseUrl(ispServiceUrl?: string): string {
  return (ispServiceUrl ?? process.env.MW_ISP_URL ?? 'http://127.0.0.1:3002').replace(/\/+$/u, '');
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readOptionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return null;
}

function parseRuntimeSession(raw: unknown): RuntimeRadiusSession | null {
  if (!isRecord(raw)) return null;
  const sessionId = readOptionalString(raw.session_id);
  const username = readOptionalString(raw.username);
  if (!sessionId || !username) return null;

  const terminateCause =
    typeof raw.terminate_cause === 'string' || typeof raw.terminate_cause === 'number'
      ? raw.terminate_cause
      : null;

  return {
    session_id: sessionId,
    username,
    nas_ip: readOptionalString(raw.nas_ip),
    nas_port: readOptionalString(raw.nas_port),
    framed_ip: readOptionalString(raw.framed_ip),
    calling_station_id: readOptionalString(raw.calling_station_id),
    acct_input_octets: readOptionalInteger(raw.acct_input_octets),
    acct_output_octets: readOptionalInteger(raw.acct_output_octets),
    acct_session_time: readOptionalInteger(raw.acct_session_time),
    started_at: readOptionalString(raw.started_at),
    stopped_at: readOptionalString(raw.stopped_at),
    status: readOptionalString(raw.status),
    terminate_cause: terminateCause,
  };
}

export async function dispatchIspDisconnect(
  input: DispatchIspDisconnectInput
): Promise<DispatchIspDisconnectResult> {
  const timeoutMs = input.timeoutMs ?? 5_000;
  try {
    const suspendRes = await input.fetchImpl(
      `${input.baseUrl}/api/subscribers/${encodeURIComponent(input.username)}/suspend`,
      {
        method: 'POST',
        headers: ispAuthHeaders(input.token),
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (!suspendRes.ok) {
      return {
        ok: false,
        errorMessage: `ISP subscriber suspend failed (${suspendRes.status})`,
      };
    }

    const disconnectRes = await input.fetchImpl(`${input.baseUrl}/api/sessions/disconnect`, {
      method: 'POST',
      headers: ispAuthHeaders(input.token, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        username: input.username,
        nas_ip: input.nasIp ?? undefined,
        acct_session_id: input.acctSessionId ?? undefined,
        framed_ip: input.framedIp ?? undefined,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!disconnectRes.ok && disconnectRes.status !== 404) {
      return {
        ok: false,
        errorMessage: `ISP session disconnect failed (${disconnectRes.status})`,
      };
    }

    const disconnectBody = await disconnectRes.text().catch(() => '');
    return {
      ok: true,
      response: JSON.stringify({
        suspendStatus: suspendRes.status,
        disconnectStatus: disconnectRes.status,
        disconnectBody: disconnectBody.slice(0, 500),
      }),
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncIspRuntimeSessions(
  options: SyncIspRuntimeSessionsOptions = {}
): Promise<SyncIspRuntimeSessionsResult> {
  const baseUrl = normalizeBaseUrl(options.ispServiceUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = resolveIspAdminToken({
    adminToken: options.adminToken,
    jwtSecret: options.jwtSecret,
  });

  const response = await fetchImpl(`${baseUrl}/api/sessions`, {
    method: 'GET',
    headers: ispAuthHeaders(token),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`ISP runtime session fetch failed (${response.status})`);
  }

  const parsed: unknown = await response.json();
  const rows = Array.isArray(parsed) ? parsed : [];

  let upsertedSessions = 0;
  const affectedCompanyIds = new Set<number>();

  for (const rawRow of rows) {
    const session = parseRuntimeSession(rawRow);
    if (!session) continue;

    let subscriberQuery = ISPSubscriber.query().where({
      username: session.username,
      active: true,
    });
    if (options.companyId !== undefined) {
      subscriberQuery = subscriberQuery.where({ company_id: options.companyId });
    }
    const subscriber = await subscriberQuery.first();
    if (!subscriber) continue;

    const endReason =
      session.terminate_cause !== null && session.terminate_cause !== undefined
        ? String(session.terminate_cause)
        : null;

    const existing = await ISPRadiusSession.query().findOne({
      session_id: session.session_id,
    });

    if (existing) {
      if (existing.company_id !== subscriber.company_id) continue;
      await ISPRadiusSession.query()
        .findById(existing.id)
        .patch({
          nas_ip: session.nas_ip ?? existing.nas_ip ?? null,
          nas_port: session.nas_port ?? existing.nas_port ?? null,
          calling_station_id: session.calling_station_id ?? existing.calling_station_id ?? null,
          framed_ip_address: session.framed_ip ?? existing.framed_ip_address ?? null,
          acct_input_octets: session.acct_input_octets ?? existing.acct_input_octets ?? 0,
          acct_output_octets: session.acct_output_octets ?? existing.acct_output_octets ?? 0,
          acct_session_time: session.acct_session_time ?? existing.acct_session_time ?? 0,
          start_time: session.started_at ?? existing.start_time ?? null,
          stop_time: session.stopped_at ?? existing.stop_time ?? null,
          session_end_reason: endReason ?? existing.session_end_reason ?? null,
        });
    } else {
      await ISPRadiusSession.query().insert({
        company_id: subscriber.company_id,
        subscriber_id: subscriber.id,
        session_id: session.session_id,
        username: subscriber.username,
        nas_ip: session.nas_ip ?? null,
        nas_port: session.nas_port ?? null,
        calling_station_id: session.calling_station_id ?? null,
        framed_ip_address: session.framed_ip ?? null,
        acct_input_octets: session.acct_input_octets ?? 0,
        acct_output_octets: session.acct_output_octets ?? 0,
        acct_session_time: session.acct_session_time ?? 0,
        start_time: session.started_at ?? null,
        stop_time: session.stopped_at ?? null,
        session_end_reason: endReason,
      });
    }

    upsertedSessions += 1;
    affectedCompanyIds.add(subscriber.company_id);
  }

  let createdInvoiceLines = 0;
  let totalAmountMinor = 0;

  for (const companyId of affectedCompanyIds) {
    const metered = await meterSessionsToSubscriptionInvoices({
      companyId,
      pricePerGbMinor: options.pricePerGbMinor,
    });
    createdInvoiceLines += metered.createdInvoiceLines;
    totalAmountMinor += metered.totalAmountMinor;
  }

  return {
    fetchedSessions: rows.length,
    upsertedSessions,
    createdInvoiceLines,
    totalAmountMinor,
  };
}

export async function processIspRadiusOutbox(
  options: ProcessIspRadiusOutboxOptions = {}
): Promise<ProcessIspRadiusOutboxResult> {
  const baseUrl = normalizeBaseUrl(options.ispServiceUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = resolveIspAdminToken({
    adminToken: options.adminToken,
    jwtSecret: options.jwtSecret,
  });
  const limit = options.limit ?? 50;

  let query = ISPRadiusOutbox.query()
    .where({ active: true })
    .whereIn('status', ['pending', 'failed'])
    .orderBy('id', 'asc')
    .limit(limit);
  if (options.companyId !== undefined) {
    query = query.where({ company_id: options.companyId });
  }
  const rows = await query;

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    processed += 1;
    if (row.type !== 'disconnect') {
      await ISPRadiusOutbox.query()
        .findById(row.id)
        .patch({
          status: 'failed',
          error_message: `Unsupported outbox type: ${row.type}`,
        });
      failed += 1;
      continue;
    }

    const result = await dispatchIspDisconnect({
      baseUrl,
      token,
      fetchImpl,
      username: row.username,
      nasIp: row.nas_ip,
      acctSessionId: row.acct_session_id,
      framedIp: row.framed_ip_address,
    });

    if (result.ok) {
      await ISPRadiusOutbox.query()
        .findById(row.id)
        .patch({
          status: 'sent',
          sent_at: new Date().toISOString().slice(0, 19),
          response: result.response ?? null,
          error_message: null,
        });
      sent += 1;
    } else {
      await ISPRadiusOutbox.query()
        .findById(row.id)
        .patch({
          status: 'failed',
          error_message: result.errorMessage ?? 'ISP disconnect dispatch failed',
        });
      failed += 1;
    }
  }

  return { processed, sent, failed };
}

function resolveNasProbePort(): number {
  const raw = process.env.MW_ISP_NAS_PROBE_PORT?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed;
    }
  }
  return 8728;
}

function defaultTcpNasProbe(nas: IspNasRecord, timeoutMs: number): Promise<NasHealthStatus> {
  const port = resolveNasProbePort();
  return new Promise((resolve) => {
    let settled = false;
    let socket: ReturnType<typeof createConnection> | null = null;
    const finish = (status: NasHealthStatus) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(status);
    };
    try {
      socket = createConnection({ host: nas.ip_address, port });
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish('healthy'));
      socket.once('timeout', () => finish('offline'));
      socket.once('error', () => finish('offline'));
    } catch {
      finish('offline');
    }
  });
}

export async function probeIspNasHealth(
  options: ProbeIspNasHealthOptions = {}
): Promise<ProbeIspNasHealthResult> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  let query = ISPNAS.query().where({ is_active: true, active: true }).orderBy('id', 'asc');
  if (options.companyId !== undefined) {
    query = query.where({ company_id: options.companyId });
  }
  const devices = await query;

  let healthy = 0;
  let degraded = 0;
  let offline = 0;

  for (const nas of devices) {
    let status: NasHealthStatus;
    try {
      status = options.probeFn
        ? await options.probeFn(nas)
        : await defaultTcpNasProbe(nas, timeoutMs);
    } catch {
      status = 'offline';
    }

    if (nas.health_status !== status) {
      await ISPNAS.query().findById(nas.id).patch({ health_status: status });
    }

    if (status === 'healthy') {
      healthy += 1;
    } else if (status === 'degraded') {
      degraded += 1;
    } else {
      offline += 1;
    }
  }

  return {
    probed: devices.length,
    healthy,
    degraded,
    offline,
  };
}
