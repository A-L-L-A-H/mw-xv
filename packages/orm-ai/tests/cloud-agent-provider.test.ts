import knex, { type Knex } from 'knex';
import { Model } from 'objection';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CapabilityGateway,
  CloudProviderAdapter,
  DataClassificationRouter,
  type AiToolCall,
  type CapabilityGateway as CapabilityGatewayContract,
  type JsonSchemaNode,
  type ToolExecutionContext,
  type TypedToolDefinition,
} from '@moonwitness/ai-runtime';
import { installAddons, type Addon } from '@moonwitness/orm';
import { Company, manifest as baseManifest } from '@moonwitness/orm-base';
import { jobsManifest } from '@moonwitness/jobs';
import { manifest as organizationManifest } from '@moonwitness/orm-organization';
import { manifest as workflowManifest } from '@moonwitness/orm-workflow';
import { manifest as storageManifest } from '@moonwitness/orm-storage';
import { manifest as notificationManifest } from '../../orm-notification/dist/index.js';
import { manifest as requestManifest } from '../../orm-request/dist/index.js';
import { manifest as integrationManifest } from '../../orm-integration/dist/index.js';
import { manifest as knowledgeManifest } from '../../orm-knowledge/dist/index.js';
import type { TrustedRunSnapshot } from '../src/agent-run-executor.js';
import {
  createGatewayToolExecutor,
  createTrustedProviderBinding,
  mapToolsToHarnessDefinitions,
} from '../src/cloud-agent-provider.js';
import { ModelProfile, ProviderProfile, manifest as aiManifest } from '../src/index.js';

const ADDONS: readonly Addon[] = [
  baseManifest,
  organizationManifest,
  jobsManifest,
  notificationManifest,
  workflowManifest,
  requestManifest,
  integrationManifest,
  storageManifest,
  knowledgeManifest,
  aiManifest,
];

const SECRET_REF = 'MW_AI_TEST_CLOUD_KEY';
const RAW_SECRET = 'sk-raw-secret-must-never-appear';

let db: Knex;

beforeEach(async () => {
  db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: {
      afterCreate(
        connection: { pragma(sql: string): unknown },
        done: (error: Error | null, connection: unknown) => void
      ) {
        connection.pragma('foreign_keys = ON');
        done(null, connection);
      },
    },
  });
  Model.knex(db);
  await installAddons(db, ADDONS);
});

afterEach(async () => {
  await db.destroy();
  delete process.env[SECRET_REF];
});

async function createCloudModelProfile(suffix: string) {
  const company = await Company.query().insertAndFetch({ name: `Cloud ${suffix}` });
  const provider = await ProviderProfile.query().insertAndFetch({
    company_id: company.id,
    code: `cloud_${suffix}`,
    name: `Cloud ${suffix}`,
    kind: 'freellmapi',
    endpoint_url: 'http://freellmapi:3001',
    secret_ref: SECRET_REF,
    data_classification: 'cloud_eligible',
    enabled: true,
  });
  const model = await ModelProfile.query().insertAndFetch({
    company_id: company.id,
    provider_profile_id: provider.id,
    code: `model_${suffix}`,
    name: `Model ${suffix}`,
    model_id: 'real-model-1',
    context_window: 32_768,
    max_output_tokens: 4_096,
    supports_tools: true,
    supports_streaming: true,
    supports_structured_output: true,
    modalities_json: '["text","json","not-a-modality"]',
    enabled: true,
  });
  return { company, provider, model };
}

function snapshotFor(
  modelProfileId: number,
  overrides: Partial<TrustedRunSnapshot> = {}
): TrustedRunSnapshot {
  return {
    runId: 501,
    companyId: 1,
    run: { model_profile_id: modelProfileId, status: 'running' },
    fingerprint: 'fp-trusted-snapshot',
    providerKind: 'freellmapi',
    classification: 'cloud_eligible',
    maxRiskTier: 'R1',
    allowedPaths: ['src'],
    secretRefName: SECRET_REF,
    ...overrides,
  };
}

/** Collects every reachable string, guarding against cycles in class instances. */
function collectStrings(
  value: unknown,
  seen = new WeakSet<object>(),
  out: string[] = []
): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectStrings(nested, seen, out);
  }
  return out;
}

describe('trusted snapshot -> provider / tool bridge (orm-ai)', () => {
  it('builds a secret-free binding from the trusted snapshot and ORM model row', async () => {
    const { company, model } = await createCloudModelProfile('binding');
    process.env[SECRET_REF] = RAW_SECRET;
    const injectedResolver = () => 'sk-injected-secret-must-never-appear';

    const binding = await createTrustedProviderBinding({
      snapshot: snapshotFor(model.id, { companyId: company.id }),
      secretResolver: injectedResolver,
    });

    expect(binding.provider).toBeInstanceOf(CloudProviderAdapter);
    expect(binding.provider.kind).toBe('freellmapi');
    expect(binding.model).toEqual({
      id: String(model.id),
      providerId: String(model.provider_profile_id),
      providerKind: 'freellmapi',
      modelName: 'real-model-1',
      capabilities: {
        textGeneration: true,
        toolCall: true,
        streaming: true,
        structuredOutput: true,
      },
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      modalities: ['text', 'json'],
    });
    expect(binding.routingPolicy).toEqual({
      allowedClassification: 'cloud_eligible',
      allowCloudFallback: false,
    });
    expect(binding.router).toBeInstanceOf(DataClassificationRouter);
    expect(binding.router?.listTargets()).toHaveLength(1);

    const strings = collectStrings(binding);
    expect(strings).toContain(SECRET_REF);
    expect(strings).not.toContain(RAW_SECRET);
    expect(strings).not.toContain('sk-injected-secret-must-never-appear');
  });

  it('uses safe defaults when the ORM row has no usable limits or modalities', async () => {
    const { company, model } = await createCloudModelProfile('defaults');
    await ModelProfile.query().findById(model.id).patch({
      context_window: 0,
      max_output_tokens: -1,
      supports_tools: false,
      supports_streaming: false,
      supports_structured_output: false,
      modalities_json: 'not-json',
    });

    const binding = await createTrustedProviderBinding({
      snapshot: snapshotFor(model.id, { companyId: company.id }),
    });

    expect(binding.model.contextWindowTokens).toBe(8_192);
    expect(binding.model.maxOutputTokens).toBe(2_048);
    expect(binding.model.modalities).toEqual(['text']);
    expect(binding.model.capabilities).toEqual({
      textGeneration: true,
      toolCall: false,
      streaming: false,
      structuredOutput: false,
    });
  });

  it('fails closed for unsupported kinds, invalid classifications and missing rows', async () => {
    const { company, model } = await createCloudModelProfile('fail-closed');

    await expect(
      createTrustedProviderBinding({
        snapshot: snapshotFor(model.id, { companyId: company.id, providerKind: 'ollama' }),
      })
    ).rejects.toThrow(/unsupported provider kind/i);
    await expect(
      createTrustedProviderBinding({
        snapshot: snapshotFor(model.id, {
          companyId: company.id,
          classification: 'top-secret',
        }),
      })
    ).rejects.toThrow(/classification/i);
    await expect(
      createTrustedProviderBinding({
        snapshot: snapshotFor(987_654, { companyId: company.id }),
      })
    ).rejects.toThrow(/missing/i);
  });

  it('maps gateway tool definitions into harness definitions', () => {
    const inputSchema: JsonSchemaNode = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    };
    const tool = {
      name: 'repo.read@v1',
      description: 'Read a file from the allowed repository paths',
      inputSchema,
      strict: true,
    } as unknown as TypedToolDefinition;

    expect(mapToolsToHarnessDefinitions([tool])).toEqual([
      {
        name: 'repo.read@v1',
        description: 'Read a file from the allowed repository paths',
        inputSchema,
        strict: true,
      },
    ]);
    expect(mapToolsToHarnessDefinitions([])).toEqual([]);
  });

  it('executes allowed calls and attaches the abort signal to the tool context', async () => {
    const observed: { name?: string; args?: unknown; signal?: AbortSignal } = {};
    const gateway = {
      invoke: async (name: string, args: unknown, context: ToolExecutionContext) => {
        observed.name = name;
        observed.args = args;
        observed.signal = context.signal;
        return {
          allowed: true,
          toolName: name,
          capability: 'repo.read@v1',
          output: { content: 'hello' },
          auditRef: 'audit-1',
          idempotentReplay: false,
          untrustedOutputNotice: true,
        };
      },
    } as unknown as CapabilityGatewayContract;
    const context: ToolExecutionContext = {
      actorType: 'agent',
      actorId: 11,
      companyId: 1,
      runId: 'run-501',
      correlationId: 'corr-501',
      policyVersion: 1,
    };
    const call: AiToolCall = {
      id: 'call-1',
      name: 'repo.read@v1',
      arguments: { path: 'src/a.ts' },
    };
    const controller = new AbortController();

    const output = await createGatewayToolExecutor(gateway, context)(call, controller.signal);

    expect(output).toEqual({ content: 'hello' });
    expect(observed.name).toBe('repo.read@v1');
    expect(observed.args).toEqual({ path: 'src/a.ts' });
    expect(observed.signal).toBe(controller.signal);
    expect(context.signal).toBeUndefined();
  });

  it('throws an error containing the gateway reason code when a call is denied', async () => {
    const gateway = new CapabilityGateway();
    gateway.denyTool('blocked.write@v1');
    const context: ToolExecutionContext = {
      actorType: 'agent',
      actorId: 11,
      companyId: 1,
      runId: 'run-501',
      correlationId: 'corr-501',
      policyVersion: 1,
    };
    const call: AiToolCall = {
      id: 'call-2',
      name: 'blocked.write@v1',
      arguments: {},
    };

    await expect(
      createGatewayToolExecutor(gateway, context)(call, new AbortController().signal)
    ).rejects.toThrow(/R4_ALWAYS_DENIED/);
  });
});
