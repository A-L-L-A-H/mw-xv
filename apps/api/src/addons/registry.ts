import type { FastifyInstance } from 'fastify';
import type { Knex } from 'knex';
import { installAddons, Registry, type Addon } from '@moonwitness/orm';
import { manifest as baseAddon, initializeSuperadminPassword } from '@moonwitness/orm-base';
import { manifest as authAddon, createAuthService } from '@moonwitness/auth';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as notificationAddon } from '@moonwitness/orm-notification';
import { manifest as workflowAddon } from '@moonwitness/orm-workflow';
import { manifest as organizationAddon } from '@moonwitness/orm-organization';
import { manifest as integrationAddon } from '@moonwitness/orm-integration';
import { manifest as requestAddon } from '@moonwitness/orm-request';
import { manifest as knowledgeAddon } from '@moonwitness/orm-knowledge';
import type { AttachmentStorage } from '@moonwitness/orm-storage';
import { whatsappManifest } from '../whatsapp/manifest.js';
import { createAttachmentScanner, type AttachmentScanner } from '../whatsapp/clamav-scanner.js';
import type { createVideoPoster } from '../whatsapp/media-thumbnail.js';
import { checkWhatsAppGatewayVersion } from '../whatsapp/version-guard.js';
import { ensureResearchReviewWorkflow } from '../research-review-workflow.js';
import { healthRoutes } from '../routes/health.routes.js';
import { authRoutes } from '../routes/auth.routes.js';
import { genericRoutes } from '../routes/generic.routes.js';
import { whatsappRoutes } from '../routes/whatsapp.routes.js';
import { jobsRoutes } from '../routes/jobs.routes.js';
import { notificationRoutes } from '../routes/notification.routes.js';
import { workflowRoutes } from '../routes/workflow.routes.js';
import { corpusRoutes } from '../routes/corpus.routes.js';
import { evidenceRoutes } from '../routes/evidence.routes.js';
import { researchExplanationRoutes } from '../routes/research-explanation.routes.js';
import { researchActorIdentityRoutes } from '../routes/research-actor-identity.routes.js';
import { researchDuplicateCandidateRoutes } from '../routes/research-duplicate-candidates.routes.js';
import { researchReviewRoutes } from '../routes/research-review.routes.js';
import { researchPrivacyRoutes } from '../routes/research-privacy.routes.js';
import { researchWitnessRoutes } from '../routes/research-witness.routes.js';
import { conceptProfileRoutes } from '../routes/concept-profile.routes.js';
import { storyWorkbenchRoutes } from '../routes/story-workbench.routes.js';
import { localRetrievalRoutes } from '../routes/local-retrieval.routes.js';
import { localAiSuggestionRoutes } from '../routes/local-ai-suggestion.routes.js';
import { childProtectionRoutes } from '../routes/child-protection.routes.js';
import { publicationRoutes } from '../routes/publication.routes.js';
import { bugCaseRoutes } from '../routes/bug-case.routes.js';

export interface ApiAddonRuntimeContext {
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
    async registerRoutes(app, ctx) {
      await app.register(whatsappRoutes, {
        attachmentStorage: ctx.attachmentStorage,
        attachmentScanner:
          ctx.attachmentScanner === undefined ? createAttachmentScanner() : ctx.attachmentScanner,
        createVideoPoster: ctx.createVideoPoster,
        fetchContactAvatar: ctx.fetchContactAvatar,
      });
    },
  },
  {
    name: 'request',
    manifest: requestAddon,
  },
  {
    name: 'notification',
    manifest: notificationAddon,
    async registerRoutes(app) {
      await app.register(notificationRoutes);
    },
  },
  {
    name: 'organization',
    manifest: organizationAddon,
  },
  {
    name: 'workflow',
    manifest: workflowAddon,
    async registerRoutes(app) {
      await app.register(workflowRoutes);
    },
  },
  {
    name: 'knowledge',
    manifest: knowledgeAddon,
    async postInstall(db) {
      await ensureResearchReviewWorkflow(db);
    },
    async registerRoutes(app) {
      await app.register(corpusRoutes);
      await app.register(evidenceRoutes);
      await app.register(researchExplanationRoutes);
      await app.register(researchActorIdentityRoutes);
      await app.register(researchDuplicateCandidateRoutes);
      await app.register(researchReviewRoutes);
      await app.register(researchPrivacyRoutes);
      await app.register(researchWitnessRoutes);
      await app.register(conceptProfileRoutes);
      await app.register(storyWorkbenchRoutes);
      await app.register(localRetrievalRoutes);
      await app.register(localAiSuggestionRoutes);
      await app.register(childProtectionRoutes);
      await app.register(publicationRoutes);
      await app.register(bugCaseRoutes);
    },
  },
];

export interface InstallApiAddonsOptions {
  /** Skip schema/seed DDL during boot when pre-deploy `db:migrate` has already run. */
  readonly skipBootMigrations?: boolean;
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
  const skipBootMigrations =
    installOptions.skipBootMigrations ?? process.env.SKIP_BOOT_MIGRATIONS === 'true';

  if (skipBootMigrations) {
    for (const addon of manifests) {
      for (const model of addon.models) {
        if (!Registry.has(model.modelName)) Registry.register(model);
      }
    }
    return;
  }

  await installAddons(db, manifests);
  for (const addon of addons) {
    await addon.postInstall?.(db);
  }
  await initializeSuperadminPassword(superadminPassword);
}

export async function registerApiAddonRoutes(
  app: FastifyInstance,
  ctx: ApiAddonRuntimeContext,
  addons: readonly ApiAddonModule[] = API_ADDONS
): Promise<void> {
  for (const addon of addons) {
    if (addon.manifest?.httpPlugins) {
      for (const httpPlugin of addon.manifest.httpPlugins) {
        await app.register(httpPlugin as Parameters<FastifyInstance['register']>[0], ctx);
      }
    }
    await addon.registerRoutes?.(app, ctx);
  }
}
