import { defineAddon } from '@moonwitness/orm';
import { BotFlow, BotFlowStep, BotRun, BotRunQueue, BotSchedule, BotStepRun } from './models.js';
import { views } from './views.js';
import { botOrchestratorSeedManifest } from './seed-manifest.js';

export const manifest = defineAddon({
  name: 'bot-orchestrator',
  version: '1.0.0',
  depends: ['base'],
  models: [BotFlow, BotFlowStep, BotRun, BotStepRun, BotSchedule, BotRunQueue],
  views,
  menus: [
    { model: BotFlow.modelName, label: 'Bot Flows', group: 'Bots', sequence: 10 },
    { model: BotFlowStep.modelName, label: 'Flow Steps', group: 'Bots', sequence: 20 },
    { model: BotRun.modelName, label: 'Bot Runs', group: 'Bots', sequence: 30 },
    { model: BotStepRun.modelName, label: 'Step Runs', group: 'Bots', sequence: 40 },
    { model: BotSchedule.modelName, label: 'Schedules', group: 'Bots', sequence: 50 },
    { model: BotRunQueue.modelName, label: 'Run Queue', group: 'Bots', sequence: 60 },
  ],
});

export { botOrchestratorSeedManifest };
