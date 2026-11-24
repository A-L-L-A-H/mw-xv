import { defineAddon } from '@moonwitness/orm';
import {
  Experiment,
  Hypothesis,
  Instrument,
  IprDisclosure,
  Patent,
  Protocol,
  ProtocolRun,
  Publication,
  Reagent,
  ResearchProgram,
  Sample,
} from './models.js';
import { views } from './views.js';
import { rndSeedManifest } from './seed-manifest.js';

export const manifest = defineAddon({
  name: 'rnd',
  version: '1.0.0',
  depends: ['base'],
  models: [
    ResearchProgram,
    Hypothesis,
    Protocol,
    Experiment,
    ProtocolRun,
    Instrument,
    Reagent,
    Sample,
    Publication,
    Patent,
    IprDisclosure,
  ],
  views,
  menus: [
    { model: ResearchProgram.modelName, label: 'Research Programs', group: 'R&D', sequence: 10 },
    { model: Experiment.modelName, label: 'Experiments', group: 'R&D', sequence: 20 },
    { model: Hypothesis.modelName, label: 'Hypotheses', group: 'R&D', sequence: 30 },
    { model: Protocol.modelName, label: 'Protocols', group: 'R&D', sequence: 40 },
    { model: ProtocolRun.modelName, label: 'Protocol Runs', group: 'R&D', sequence: 50 },
    { model: Instrument.modelName, label: 'Instruments', group: 'R&D', sequence: 60 },
    { model: Reagent.modelName, label: 'Reagents', group: 'R&D', sequence: 70 },
    { model: Sample.modelName, label: 'Samples', group: 'R&D', sequence: 80 },
    { model: Publication.modelName, label: 'Publications', group: 'R&D', sequence: 90 },
    { model: Patent.modelName, label: 'Patents', group: 'R&D', sequence: 100 },
    { model: IprDisclosure.modelName, label: 'IPR Disclosures', group: 'R&D', sequence: 110 },
  ],
});

export { rndSeedManifest };