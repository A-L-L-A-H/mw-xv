import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { installAddons, registerAddons, type Addon } from '@moonwitness/orm';
import { computeDesiredSchemaState } from '@moonwitness/orm';
import { manifest as baseAddon, initializeSuperadminPassword } from '@moonwitness/orm-base';
import { manifest as authAddon, createAuthService } from '@moonwitness/auth';
import { jobsManifest, registerJobHandler } from '@moonwitness/jobs';
import { CronExpressionParser } from 'cron-parser';
import { SqlTelemetryStore } from '@moonwitness/orm-observability';
import { manifest as notificationAddon } from '@moonwitness/orm-notification';
import { manifest as workflowAddon } from '@moonwitness/orm-workflow';
import { manifest as organizationAddon } from '@moonwitness/orm-organization';
import { manifest as projectAddon } from '@moonwitness/orm-project';
import { manifest as crmAddon } from '@moonwitness/orm-crm';
import { manifest as salesAddon } from '@moonwitness/orm-sales';
import { manifest as subscriptionAddon } from '@moonwitness/orm-subscription';
import { manifest as integrationAddon } from '@moonwitness/orm-integration';
import { manifest as requestAddon } from '@moonwitness/orm-request';
import { manifest as knowledgeAddon } from '@moonwitness/orm-knowledge';
import {
  manifest as aiAddon,
  ensureAiJobHandlersRegistered,
  hasCompanyAccess,
  isValidAiMutation,
  recordAiAudit,
} from '@moonwitness/orm-ai';
import { manifest as a2aAddon } from '@moonwitness/orm-a2a';
import { manifest as storageAddon, type AttachmentStorage } from '@moonwitness/orm-storage';
import { whatsappManifest } from '@moonwitness/orm-whatsapp';
import { manifest as ispAddon } from '@moonwitness/orm-isp';
import { manifest as cloudAddon } from '@moonwitness/orm-cloud';
import { manifest as observabilityAddon } from '@moonwitness/orm-observability';
import { createAttachmentScanner, type AttachmentScanner } from '../whatsapp/clamav-scanner.js';
import type { createVideoPoster } from '../whatsapp/media-thumbnail.js';
import { checkWhatsAppGatewayVersion } from '../whatsapp/version-guard.js';
import { ensureResearchReviewWorkflow } from '../research-review-workflow.js';
import { API_SCHEMA_VERSION, waitForSchemaReady } from '../database/schema-state.js';
import { healthRoutes } from '../routes/health.routes.js';
import { authRoutes } from '../routes/auth.routes.js';
import { genericRoutes } from '../routes/generic.routes.js';
import { bootstrapRoutes } from '../routes/bootstrap.routes.js';
import { menuRegistry } from './action-menu-registry.js';
import { jobsRoutes } from '../routes/jobs.routes.js';
import { canAccess, registerModelAccessPolicy } from '../auth/policy.js';
import { config } from '../config/env.js';
import { getRecordRuleDomain } from '../auth/rules.js';
import { installCloudAgentEffect } from '../ai-corporation/cloud-agent-effect-setup.js';

const OBSERVABILITY_MODELS = ['observability.telemetry_span', 'observability.telemetry_trace', 'observability.telemetry_log', 'observability.telemetry_metric_series', 'observability.telemetry_metric_point', 'observability.telemetry_state', 'observability.qoder_correlation', 'observability.ingest_credential'];
for (const model of OBSERVABILITY_MODELS) registerModelAccessPolicy(model, 'internal');
let observabilityPruneDb: Knex | undefined;
let lastObservabilityPrune = 0;
function ensureObservabilityPruneJob(db: Knex): void {
  if (observabilityPruneDb) return;
  observabilityPruneDb = db;
  registerJobHandler<Record<string, never>>({
    name: 'observability.retention.prune', version: 1,
    parse: (payload) => { if (typeof payload !== 'object' || payload === null || Object.keys(payload).length !== 0) throw new Error('Invalid observability prune payload'); return {} },
    run: async () => {
      if (Date.now() - lastObservabilityPrune < config.observability.pruneIntervalMs) return { skipped: true };
      const store = new SqlTelemetryStore(db, { closeDb: false, ...config.observability });
      const removed = await store.pruneExpired(); lastObservabilityPrune = Date.now(); return { removed };
    },
  });
}
async function ensureObservabilityCron(db: Knex): Promise<void> {
  const nextRunAt = CronExpressionParser.parse('* * * * *', { currentDate: new Date(), tz: 'UTC' }).next().toDate();
  await db('crons').insert({ code: 'observability.retention.prune', name: 'Prune expired observability telemetry', handler: 'observability.retention.prune', handler_version: 1, payload: '{}', cron_expression: '* * * * *', timezone: 'UTC', enabled: true, next_run_at: nextRunAt.toISOString(), misfire_policy: 'coalesce', concurrency_policy: 'forbid', max_catch_up: 1 }).onConflict('code').merge(['name', 'handler', 'handler_version', 'cron_expression', 'next_run_at']);
}

export interface ApiAddonRuntimeContext {
  db: Knex;
  observabilityIngestToken?: string;
  observabilityStoreOptions?: ConstructorParameters<typeof SqlTelemetryStore>[1];
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  loginRateMax: number;
  metricsToken?: string;
  attachmentStorage: AttachmentStorage;
  attachmentScanner?: AttachmentScanner | null;
  checkWhatsAppGateway?: () => Promise<boolean>;
  createVideoPoster?: typeof createVideoPoster;
  fetchContactAvatar?: typeof fetch;
}

export interface ApiAddonExperimentMetadata {
  readonly flagKey: string;
  readonly expiresAt: string;
  readonly proposalId: string;
}

export interface ApiAddonModule {
  readonly name: string;
  readonly manifest?: Addon;
  readonly experimental?: ApiAddonExperimentMetadata;
  readonly postInstall?: (db: Knex) => Promise<void>;
  readonly registerRoutes?: (app: FastifyInstance, ctx: ApiAddonRuntimeContext) => Promise<void>;
}

/**
 * Single declarative assembly registry for MoonWitness API addons.
 * All domain models and addon manifests live in workspace packages (`packages/*`);
 * `apps/api` remains a thin HTTP/lifecycle adapter over these registered addons.
 */
export const API_ADDONS: readonly ApiAddonModule[] = [
  {
    name: 'system-health',
    async registerRoutes(app, ctx) {
      await app.register(healthRoutes, {
        metricsToken: ctx.metricsToken,
        checkWhatsAppGateway: ctx.checkWhatsAppGateway ?? (() => checkWhatsAppGatewayVersion()),
        checkObservability: async () => new SqlTelemetryStore(ctx.db, { closeDb: false, ...ctx.observabilityStoreOptions }).status(),
        checkAttachmentStorage: async () => {
          await ctx.attachmentStorage.checkReady?.();
          return true;
        },
      });
    },
  },
  {
    name: 'base',
    manifest: baseAddon,
    async registerRoutes(app, ctx) {
      await app.register(genericRoutes, {
        attachmentStorage: ctx.attachmentStorage,
      });
      await app.register(bootstrapRoutes, {
        activeAddons: API_ADDONS.map((a) => a.name),
      });
    },
  },
  {
    name: 'auth',
    manifest: authAddon,
    async registerRoutes(app, ctx) {
      await app.register(authRoutes, {
        authService: createAuthService({
          refreshTtlSeconds: ctx.refreshTtlSeconds,
          refreshTokenSecret: ctx.jwtSecret,
        }),
        accessTtlSeconds: ctx.accessTtlSeconds,
        loginRateMax: ctx.loginRateMax,
      });
    },
  },
  {
    name: 'jobs',
    manifest: jobsManifest,
    async registerRoutes(app) {
      await app.register(jobsRoutes);
    },
  },
  {
    name: 'integration',
    manifest: integrationAddon,
  },
  {
    name: 'whatsapp',
    manifest: whatsappManifest,
  },
  {
    name: 'request',
    manifest: requestAddon,
  },
  {
    name: 'notification',
    manifest: notificationAddon,
  },
  {
    name: 'organization',
    manifest: organizationAddon,
  },
  {
    name: 'project',
    manifest: projectAddon,
  },
  {
    name: 'crm',
    manifest: crmAddon,
  },
  {
    name: 'sales',
    manifest: salesAddon,
  },
  {
    name: 'subscription',
    manifest: subscriptionAddon,
  },
  {
    name: 'workflow',
    manifest: workflowAddon,
  },
  {
    name: 'knowledge',
    manifest: knowledgeAddon,
    async postInstall(db) {
      await ensureResearchReviewWorkflow(db);
    },
  },
  {
    name: 'orm-storage',
    manifest: storageAddon,
  },
  {
    name: 'isp',
    manifest: ispAddon,
  },
  {
    name: 'cloud',
    manifest: cloudAddon,
  },
  {
    name: 'ai',
    manifest: aiAddon,
    async postInstall() {
      ensureAiJobHandlersRegistered();
    },
  },
  {
    name: 'a2a',
    manifest: a2aAddon,
  },
  {
    name: 'observability',
    manifest: observabilityAddon,
    async postInstall(db) {
      ensureObservabilityPruneJob(db);
      await ensureObservabilityCron(db);
    },
  },
];

export interface InstallApiAddonsOptions {
  /** Skip schema/seed DDL during boot when pre-deploy `db:migrate` has already run. */
  readonly skipBootMigrations?: boolean;
}

function syncAddonMenusToRegistry(manifests: readonly Addon[]): void {
  for (const manifest of manifests) {
    if (!manifest.menus) continue;
    for (const [index, menu] of manifest.menus.entries()) {
      const menuObj = menu as {
        id?: string;
        parentId?: string;
        label?: string;
        name?: string;
        icon?: string;
        sequence?: number;
        actionId?: string;
        model?: string;
        groups?: readonly string[];
        developmentOnly?: boolean;
      };
      const id = menuObj.id ?? `${manifest.name}.${menuObj.model ?? index}`;
      menuRegistry.register({
        id,
        parentId: menuObj.parentId,
        label: menuObj.label ?? menuObj.name ?? id,
        icon: menuObj.icon,
        sequence: menuObj.sequence ?? (index + 1) * 10,
        actionId: menuObj.actionId,
        model: menuObj.model,
        groups: menuObj.groups,
        developmentOnly: menuObj.developmentOnly,
        addon: manifest.name,
      });
    }
  }
}

export async function installApiAddons(
  db: Knex,
  superadminPassword: string | undefined,
  addons: readonly ApiAddonModule[] = API_ADDONS,
  installOptions: InstallApiAddonsOptions = {}
): Promise<void> {
  const manifests = addons
    .map((addon) => addon.manifest)
    .filter((manifest): manifest is Addon => manifest !== undefined);
  syncAddonMenusToRegistry(manifests);
  if (addons.some((addon) => addon.name === 'ai')) installCloudAgentEffect();
  const skipBootMigrations =
    installOptions.skipBootMigrations ?? process.env.SKIP_BOOT_MIGRATIONS === 'true';

  if (skipBootMigrations) {
    // In-memory registration only: models, views, menus, security (no DDL/seed)
    await registerAddons(db, manifests);
    return;
  }

  await installAddons(db, manifests);
  for (const addon of addons) {
    await addon.postInstall?.(db);
  }
  await initializeSuperadminPassword(superadminPassword);
}

/** Extract canonical addon manifests from API_ADDONS for use in workers. */
export function getApiAddonManifests(
  addons: readonly ApiAddonModule[] = API_ADDONS
): readonly Addon[] {
  return addons
    .map((addon) => addon.manifest)
    .filter((manifest): manifest is Addon => manifest !== undefined);
}

export async function registerApiAddons(
  db: Knex,
  addons: readonly ApiAddonModule[] = API_ADDONS
): Promise<void> {
  const manifests = getApiAddonManifests(addons);
  syncAddonMenusToRegistry(manifests);
  await registerAddons(db, manifests);
}

export async function bootstrapApiWorker(
  db: Knex,
  options: {
    addons?: readonly ApiAddonModule[];
    waitForSchema?: (desired: ReturnType<typeof computeDesiredSchemaState>) => Promise<void>;
  } = {}
): Promise<void> {
  const addons = options.addons ?? API_ADDONS;
  const manifests = getApiAddonManifests(addons);
  const desired = computeDesiredSchemaState(manifests, API_SCHEMA_VERSION);
  if (options.waitForSchema) {
    await options.waitForSchema(desired);
  } else {
    await waitForSchemaReady(db, { desired });
  }
  await registerApiAddons(db, addons);
  // Job handlers are registered in-process. installApiAddons' postInstall only runs
  // in the API process, so the worker must register the AI handlers itself or an
  // enqueued ai.agent_run.* job would have no handler here.
  if (addons.some((addon) => addon.name === 'ai')) {
    installCloudAgentEffect();
    ensureAiJobHandlersRegistered();
  }
  if (addons.some((addon) => addon.name === 'observability')) ensureObservabilityPruneJob(db);
}

export async function registerApiAddonRoutes(
  app: FastifyInstance,
  ctx: ApiAddonRuntimeContext,
  addons: readonly ApiAddonModule[] = API_ADDONS
): Promise<void> {
  const hostContext = {
    ...ctx,
    attachmentScanner:
      ctx.attachmentScanner === undefined ? createAttachmentScanner() : ctx.attachmentScanner,
    canAccess,
    getRecordRuleDomain,
    hasCompanyAccess,
    recordAudit: recordAiAudit,
    validateModelMutation: (model: string, payload: Record<string, unknown>, trx?: unknown) =>
      isValidAiMutation(model, payload, undefined, trx as Parameters<typeof isValidAiMutation>[3]),
  };
  for (const addon of addons) {
    if (addon.manifest?.httpPlugins) {
      for (const httpPlugin of addon.manifest.httpPlugins) {
        await app.register(httpPlugin as Parameters<FastifyInstance['register']>[0], hostContext);
      }
    }
    await addon.registerRoutes?.(app, ctx);
  }
}
