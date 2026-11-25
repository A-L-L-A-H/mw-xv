import { defineAddon } from '@moonwitness/orm';
import { aiCorporationHttpPlugin } from './ai-corporation-http.js';
import { aiDesktopSyncHttpPlugin } from './ai-desktop-sync-http.js';
import { data } from './data.js';
import { evolutionHttpPlugin } from './evolution-http.js';
import { interactiveSessionsHttpPlugin } from './interactive-sessions-http.js';
import {
  AcceptanceCriterion,
  Agent,
  AgentProfile,
  AgentRun,
  AgentRunEffect,
  ArtifactManifest,
  CapabilityGrant,
  ExecutionPolicy,
  InteractiveSession,
  InteractiveSessionApproval,
  InteractiveSessionCommand,
  InteractiveSessionEvent,
  MemoryCandidate,
  ModelProfile,
  Obligation,
  ProviderProfile,
  SkillVersion,
  Taskforce,
  WorkContract,
  WorkforceAssignment,
} from './models.js';
import { views } from './views.js';

export const manifest = defineAddon({
  name: 'ai',
  version: '1.1.0',
  setup: async (trx) => {
    const client = String(trx.client.config.client);
    const postgres = client === 'pg';
    const sqlite = client === 'better-sqlite3' || client === 'sqlite3';
    if (!postgres && !sqlite) return;
    if (postgres) {
      await trx.raw(
        `CREATE OR REPLACE FUNCTION moonwitness_reject_interactive_event_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Interactive session events are immutable'; END; $$ LANGUAGE plpgsql`
      );
      await trx.raw(
        `CREATE OR REPLACE FUNCTION moonwitness_reject_terminal_session_mutation() RETURNS trigger AS $$ BEGIN IF OLD.status IN ('completed','failed','cancelled') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.last_sequence IS DISTINCT FROM OLD.last_sequence OR NEW.version IS DISTINCT FROM OLD.version OR NEW.terminal_at IS DISTINCT FROM OLD.terminal_at) THEN RAISE EXCEPTION 'Interactive session is terminal'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`
      );
      await trx.raw(
        'DROP TRIGGER IF EXISTS ai_interactive_events_immutable ON ai_interactive_session_events'
      );
      await trx.raw(
        'CREATE TRIGGER ai_interactive_events_immutable BEFORE UPDATE OR DELETE ON ai_interactive_session_events FOR EACH ROW EXECUTE FUNCTION moonwitness_reject_interactive_event_mutation()'
      );
      await trx.raw(
        'DROP TRIGGER IF EXISTS ai_interactive_sessions_terminal ON ai_interactive_sessions'
      );
      await trx.raw(
        'CREATE TRIGGER ai_interactive_sessions_terminal BEFORE UPDATE ON ai_interactive_sessions FOR EACH ROW EXECUTE FUNCTION moonwitness_reject_terminal_session_mutation()'
      );
      return;
    }
    await trx.raw(
      `CREATE TRIGGER IF NOT EXISTS ai_interactive_events_reject_update BEFORE UPDATE ON ai_interactive_session_events BEGIN SELECT RAISE(ABORT, 'Interactive session events are immutable'); END`
    );
    await trx.raw(
      `CREATE TRIGGER IF NOT EXISTS ai_interactive_events_reject_delete BEFORE DELETE ON ai_interactive_session_events BEGIN SELECT RAISE(ABORT, 'Interactive session events are immutable'); END`
    );
    await trx.raw(
      `CREATE TRIGGER IF NOT EXISTS ai_interactive_sessions_terminal BEFORE UPDATE ON ai_interactive_sessions WHEN OLD.status IN ('completed','failed','cancelled') AND (NEW.status != OLD.status OR NEW.last_sequence != OLD.last_sequence OR NEW.version != OLD.version OR NEW.terminal_at != OLD.terminal_at) BEGIN SELECT RAISE(ABORT, 'Interactive session is terminal'); END`
    );
  },
  depends: ['base', 'organization', 'jobs', 'workflow', 'orm-storage'],
  models: [
    ProviderProfile,
    ModelProfile,
    ExecutionPolicy,
    Agent,
    AgentProfile,
    WorkContract,
    AcceptanceCriterion,
    CapabilityGrant,
    AgentRun,
    AgentRunEffect,
    InteractiveSession,
    InteractiveSessionEvent,
    InteractiveSessionCommand,
    InteractiveSessionApproval,
    ArtifactManifest,
    Obligation,
    Taskforce,
    WorkforceAssignment,
    SkillVersion,
    MemoryCandidate,
  ],
  data,
  views,
  httpPlugins: [
    evolutionHttpPlugin,
    aiCorporationHttpPlugin,
    aiDesktopSyncHttpPlugin,
    interactiveSessionsHttpPlugin,
  ],
  menus: [
    { model: Agent.modelName, label: 'Agents', group: 'AI Corporation', sequence: 60 },
    {
      model: WorkContract.modelName,
      label: 'Work Contracts',
      group: 'AI Corporation',
      sequence: 61,
    },
    { model: AgentRun.modelName, label: 'Agent Runs', group: 'AI Corporation', sequence: 62 },
    { model: Obligation.modelName, label: 'Obligations', group: 'AI Corporation', sequence: 63 },
    {
      model: ProviderProfile.modelName,
      label: 'AI Providers',
      group: 'AI Corporation',
      sequence: 64,
    },
    {
      model: ExecutionPolicy.modelName,
      label: 'Execution Policies',
      group: 'AI Corporation',
      sequence: 65,
    },
    {
      model: CapabilityGrant.modelName,
      label: 'Capability Grants',
      group: 'AI Corporation',
      sequence: 66,
    },
    {
      model: Taskforce.modelName,
      label: 'Taskforces',
      group: 'AI Corporation',
      sequence: 67,
    },
    {
      model: AgentProfile.modelName,
      label: 'Agent Profiles',
      group: 'Technical',
      sequence: 540,
      developmentOnly: true,
    },
    {
      model: ModelProfile.modelName,
      label: 'AI Model Profiles',
      group: 'Technical',
      sequence: 541,
      developmentOnly: true,
    },
    {
      model: AcceptanceCriterion.modelName,
      label: 'Acceptance Criteria',
      group: 'Technical',
      sequence: 542,
      developmentOnly: true,
    },
    {
      model: ArtifactManifest.modelName,
      label: 'Artifact Manifests',
      group: 'Technical',
      sequence: 543,
      developmentOnly: true,
    },
    {
      model: SkillVersion.modelName,
      label: 'Skill Versions',
      group: 'Technical',
      sequence: 544,
      developmentOnly: true,
    },
    {
      model: MemoryCandidate.modelName,
      label: 'Memory Candidates',
      group: 'Technical',
      sequence: 545,
      developmentOnly: true,
    },
    {
      model: WorkforceAssignment.modelName,
      label: 'Workforce Assignments',
      group: 'Technical',
      sequence: 546,
      developmentOnly: true,
    },
  ],
});
