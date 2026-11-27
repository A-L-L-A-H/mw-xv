import { describe, expect, it } from 'vitest';

import * as pack from '../src/index.js';
import * as canonical_ai from '@moonwitness/orm-ai';
import * as canonical_a2a from '@moonwitness/orm-a2a';
import * as canonical_automation_core from '@moonwitness/orm-automation-core';
import * as canonical_bot_orchestrator from '@moonwitness/orm-bot-orchestrator';
import * as canonical_storage from '@moonwitness/orm-storage';
import * as canonical_observability from '@moonwitness/orm-observability';

describe('ai compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.ai).toBeTypeOf('object');
    expect(pack.aiManifest).toBe(canonical_ai.manifest);
  });
});

describe('a2a compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.a2a).toBeTypeOf('object');
    expect(pack.a2aManifest).toBe(canonical_a2a.manifest);
  });
});

describe('automation_core compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.automation_core).toBeTypeOf('object');
    expect(pack.automation_coreManifest).toBe(canonical_automation_core.automationCoreSeedManifest);
  });
});

describe('bot_orchestrator compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.bot_orchestrator).toBeTypeOf('object');
    expect(pack.bot_orchestratorManifest).toBe(canonical_bot_orchestrator.manifest);
  });
});

describe('storage compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.storage).toBeTypeOf('object');
    expect(pack.storageManifest).toBe(canonical_storage.manifest);
  });
});

describe('observability compatibility alias', () => {
  it('re-exports the canonical addon surface', () => {
    expect(pack.observability).toBeTypeOf('object');
    expect(pack.observabilityManifest).toBe(canonical_observability.manifest);
  });
});
