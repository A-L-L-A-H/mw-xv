import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateCharacterRegistry } from '../scripts/character-registry-schema.mjs';

const validRegistry = {
  schemaVersion: 1,
  pack: 'moon-city',
  domain: 'visual-universe',
  description: 'Canonical recurring character registry.',
  characters: [{
    characterId: 'crew-01',
    role: 'crew-member',
    depictionPolicy: 'anonymous-back-facing',
    silhouette: 'hooded crew figure, adult proportions, standard build',
    outfit: 'industrial workwear shirt and trousers',
    paletteTokens: ['ink-900','paper-white'],
    proportions: 'standard adult',
    signatureProps: ['tool-satchel','crew-badge'],
    allowedVariants: ['idle-standing','waving'],
    prohibitedVariants: ['recognizable-face','sacred-figure','real-person-likeness'],
    masterAssetIds: [],
    variantAssetIds: [],
    license: 'ISC',
    status: 'review',
  }],
};

test('validates a canonical character registry', () => {
  assert.deepEqual(validateCharacterRegistry(validRegistry), { characterCount: 1, characterIds: ['crew-01'] });
});

test('rejects missing required fields', () => {
  const broken = JSON.parse(JSON.stringify(validRegistry));
  delete broken.characters[0].silhouette;
  assert.throws(() => validateCharacterRegistry(broken), /characters\[0\].silhouette must be a non-empty string/u);
});

test('rejects unknown depiction policy and status', () => {
  const bad = JSON.parse(JSON.stringify(validRegistry));
  bad.characters[0].depictionPolicy = 'recognizable-face';
  assert.throws(() => validateCharacterRegistry(bad), /depictionPolicy must be one of/u);
  bad.characters[0].depictionPolicy = 'anonymous-back-facing';
  bad.characters[0].status = 'published';
  assert.throws(() => validateCharacterRegistry(bad), /status must be draft, review, approved, or blocked/u);
});

test('rejects duplicate character IDs', () => {
  const duplicate = JSON.parse(JSON.stringify(validRegistry));
  duplicate.characters.push({ ...duplicate.characters[0] });
  assert.throws(() => validateCharacterRegistry(duplicate), /characterId duplicates 0/u);
});

test('validates the checked-in registry', () => {
  const registry = JSON.parse(readFileSync(new URL('../source/world/characters/character-registry.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateCharacterRegistry(registry), { characterCount: 1, characterIds: ['crew-01'] });
});
