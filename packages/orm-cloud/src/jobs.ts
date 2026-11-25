import type { Knex } from 'knex';
import { registerJobHandler } from '@moonwitness/jobs';
import { MILLISECONDS_PER_MINUTE } from '@moonwitness/types';
import { probeCloudTargetsHealth } from './probe.js';

export const CLOUD_TARGETS_PROBE_JOB = 'cloud.targets.probe';

export function registerCloudJobHandlers(options?: {
  readonly adminToken?: string;
  readonly jwtSecret?: string;
  readonly fetchImpl?: typeof fetch;
}): () => void {
  return registerJobHandler({
    name: CLOUD_TARGETS_PROBE_JOB,
    version: 1,
    parse(payload: unknown): unknown {
      return payload ?? {};
    },
    async run(payload: unknown) {
      const companyId =
        payload && typeof payload === 'object' && 'companyId' in payload
          ? (payload as Record<string, unknown>).companyId
          : undefined;
      if (typeof companyId !== 'number') throw new Error('cloud.targets.probe requires companyId');
      await probeCloudTargetsHealth({
        companyId,
        adminToken: options?.adminToken,
        jwtSecret: options?.jwtSecret,
        fetchImpl: options?.fetchImpl,
      });
      return { companyId };
    },
  });
}

export async function ensureCloudCrons(db: Knex): Promise<void> {
  await db('crons')
    .insert({
      code: CLOUD_TARGETS_PROBE_JOB,
      name: 'Probe cloud deployment target health for HA failover',
      handler: CLOUD_TARGETS_PROBE_JOB,
      handler_version: 1,
      payload: '{}',
      cron_expression: '*/2 * * * *',
      timezone: 'UTC',
      enabled: true,
      next_run_at: new Date(Date.now() + MILLISECONDS_PER_MINUTE).toISOString(),
      misfire_policy: 'coalesce',
      concurrency_policy: 'forbid',
      max_catch_up: 1,
    })
    .onConflict('code')
    .ignore();
}
