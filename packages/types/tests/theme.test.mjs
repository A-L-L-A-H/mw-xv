import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isColorMode, isSkinDensity, isSkinMetadata } from '../dist/index.js';

test('isColorMode validates light and dark modes', () => {
  assert.equal(isColorMode('light'), true);
  assert.equal(isColorMode('dark'), true);
  assert.equal(isColorMode('system'), false);
  assert.equal(isColorMode(null), false);
});

test('isSkinDensity validates comfortable and compact densities', () => {
  assert.equal(isSkinDensity('comfortable'), true);
  assert.equal(isSkinDensity('compact'), true);
  assert.equal(isSkinDensity('spacious'), false);
  assert.equal(isSkinDensity(undefined), false);
});

test('isSkinMetadata validates well-formed and malformed metadata objects', () => {
  assert.equal(
    isSkinMetadata({
      id: 'moonwitness-ink',
      label: 'MoonWitness Ink',
      description: 'Signature zine aesthetic',
      supportedModes: ['light', 'dark'],
      supportedDensities: ['comfortable', 'compact'],
      defaultMode: 'light',
      defaultDensity: 'comfortable',
      swatch: {
        background: '#f3efe4',
        surface: '#fffdf6',
        foreground: '#0d0d0d',
        accent: '#ffe031',
      },
    }),
    true
  );

  assert.equal(isSkinMetadata(null), false);
  assert.equal(isSkinMetadata({ id: '' }), false);
  assert.equal(
    isSkinMetadata({
      id: 'bad-skin',
      label: 'Bad Skin',
      description: 'Missing modes',
      supportedModes: [],
      supportedDensities: ['comfortable'],
      defaultMode: 'light',
      defaultDensity: 'comfortable',
      swatch: { background: '#fff', surface: '#fff', foreground: '#000', accent: '#ff0' },
    }),
    false
  );
});
