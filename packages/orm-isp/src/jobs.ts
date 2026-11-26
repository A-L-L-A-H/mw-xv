import type { Knex } from 'knex';
import { registerJobHandler } from '@moonwitness/jobs';
import { isRecord, MILLISECONDS_PER_MINUTE } from '@moonwitness/types';
import {
  probeIspNasHealth,
  processIspRadiusOutbox,
  syncIspRuntimeSessions,
  type IspNasRecord,
  type NasHealthStatus,
} from './reconcile.js';

export const ISP_JOB_HANDLERS = {
  SESSIONS_RECONCILE: 'isp.sessions.reconcile',
  OUTBOX_PROCESS: 'isp.outbox.process',
  NAS_PROBE: 'isp.nas.probe',
} as const;

export interface IspJobPayload {
  readonly companyId?: number;
}

export interface RegisterIspJobHandlersOptions {
  readonly ispServiceUrl?: string;
  readonly adminToken?: string;
  readonly jwtSecret?: string;
  readonly fetchImpl?: typeof fetch;
  readonly probeFn?: (nas: IspNasRecord) => Promise<NasHealthStatus>;
}

export interface EnsureIspCronsOptions {
  readonly enabled?: boolean;
}

function parseIspJobPayload(payload: unknown): IspJobPayload {
  if (!isRecord(payload)) {
    throw new Error('ISP job payload must be an object');
  }
  for (const key of Object.keys(payload)) {
    if (key !== 'companyId') {
      throw new Error(`Unexpected ISP job payload key: ${key}`);
    }
  }
  if (payload.companyId === undefined) {
    return {};
  }
  if (
    typeof payload.companyId !== 'number' ||
    !Number.isSafeInteger(payload.companyId) ||
    payload.companyId <= 0
  ) {
    throw new Error('ISP job payload companyId must be a positive integer');
  }
  return { companyId: payload.companyId };
}

export function registerIspJobHandlers(options: RegisterIspJobHandlersOptions = {}): () => void {
  const disposers: Array<() => void> = [];
  try {
    disposers.push(
      registerJobHandler<IspJobPayload>({
        name: ISP_JOB_HANDLERS.SESSIONS_RECONCILE,
        version: 1,
        parse: parseIspJobPayload,
        async run(payload, context) {
          if (context.signal.aborted) {
            return {
              fetchedSessions: 0,
              upsertedSessions: 0,
              createdInvoiceLines: 0,
              totalAmountMinor: 0,
            };
          }
          return syncIspRuntimeSessions({
            companyId: payload.companyId ?? context.companyId,
            ispServiceUrl: options.ispServiceUrl,
            adminToken: options.adminToken,
            jwtSecret: options.jwtSecret,
            fetchImpl: options.fetchImpl,
          });
        },
      })
    );

    disposers.push(
      registerJobHandler<IspJobPayload>({
        name: ISP_JOB_HANDLERS.OUTBOX_PROCESS,
        version: 1,
        parse: parseIspJobPayload,
        async run(payload, context) {
          if (context.signal.aborted) {
            return { processed: 0, sent: 0, acknowledged: 0, failed: 0 };
          }
          return processIspRadiusOutbox({
            companyId: payload.companyId ?? context.companyId,
            ispServiceUrl: options.ispServiceUrl,
            adminToken: options.adminToken,
            jwtSecret: options.jwtSecret,
            fetchImpl: options.fetchImpl,
          });
        },
      })
    );

    disposers.push(
      registerJobHandler<IspJobPayload>({
        name: ISP_JOB_HANDLERS.NAS_PROBE,
        version: 1,
        parse: parseIspJobPayload,
        async run(payload, context) {
          if (context.signal.aborted) {
            return { probed: 0, healthy: 0, degraded: 0, offline: 0 };
          }
          return probeIspNasHealth({
            companyId: payload.companyId ?? context.companyId,
            probeFn: options.probeFn,
          });
        },
      })
    );
  } catch (error) {
    for (const dispose of disposers) {
      dispose();
    }
    throw error;
  }

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}

export async function ensureIspCrons(db: Knex, options: EnsureIspCronsOptions = {}): Promise<void> {
  if (!(await db.schema.hasTable('crons'))) {
    return;
  }

  const enabled = options.enabled ?? true;
  const nowIso = new Date().toISOString();
  const nextRunAt = new Date(Date.now() + MILLISECONDS_PER_MINUTE).toISOString();

  const definitions = [
    {
      code: ISP_JOB_HANDLERS.SESSIONS_RECONCILE,
      name: 'ISP Runtime Session Sync & Metering',
      handler: ISP_JOB_HANDLERS.SESSIONS_RECONCILE,
      handler_version: 1,
      payload: '{}',
      cron_expression: '*/2 * * * *',
      timezone: 'UTC',
      enabled,
      next_run_at: nextRunAt,
      misfire_policy: 'coalesce',
      concurrency_policy: 'forbid',
      max_catch_up: 1,
      active: true,
      create_date: nowIso,
      write_date: nowIso,
    },
    {
      code: ISP_JOB_HANDLERS.OUTBOX_PROCESS,
      name: 'ISP RADIUS Outbox & CoA Processor',
      handler: ISP_JOB_HANDLERS.OUTBOX_PROCESS,
      handler_version: 1,
      payload: '{}',
      cron_expression: '* * * * *',
      timezone: 'UTC',
      enabled,
      next_run_at: nextRunAt,
      misfire_policy: 'coalesce',
      concurrency_policy: 'forbid',
      max_catch_up: 1,
      active: true,
      create_date: nowIso,
      write_date: nowIso,
    },
    {
      code: ISP_JOB_HANDLERS.NAS_PROBE,
      name: 'ISP NAS Health Probe',
      handler: ISP_JOB_HANDLERS.NAS_PROBE,
      handler_version: 1,
      payload: '{}',
      cron_expression: '*/2 * * * *',
      timezone: 'UTC',
      enabled,
      next_run_at: nextRunAt,
      misfire_policy: 'coalesce',
      concurrency_policy: 'forbid',
      max_catch_up: 1,
      active: true,
      create_date: nowIso,
      write_date: nowIso,
    },
  ];

  for (const cron of definitions) {
    await db('crons').insert(cron).onConflict('code').ignore();
  }
}
