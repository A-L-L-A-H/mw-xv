import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCharacterAdapter,
  isCharacterIdentity,
  isCharacterPlaybackRequest,
} from '../dist/character-adapter.js';

test('isCharacterIdentity validates canonical character identity objects', () => {
  assert.equal(
    isCharacterIdentity({
      id: 'char-crew-01',
      slug: 'crew-01',
      label: 'Crew 01',
      depictionPolicy: 'human-non-erotic',
      canonicalSheet: 'assets/characters/crew-01/sheet.json',
    }),
    true
  );
  assert.equal(isCharacterIdentity({ id: '', slug: 'crew-01' }), false);
  assert.equal(isCharacterIdentity(null), false);
});

test('isCharacterPlaybackRequest validates playback requests and rejects invalid timing or rate', () => {
  assert.equal(
    isCharacterPlaybackRequest({
      characterId: 'char-crew-01',
      clipId: 'idle',
      timeMs: 250,
      reducedMotion: false,
      pinnedFrame: 1,
      playbackRate: 1,
    }),
    true
  );
  assert.equal(
    isCharacterPlaybackRequest({
      characterId: 'char-crew-01',
      clipId: 'idle',
      timeMs: -1,
    }),
    false
  );
  assert.equal(
    isCharacterPlaybackRequest({
      characterId: 'char-crew-01',
      clipId: 'idle',
      timeMs: 100,
      playbackRate: 0,
    }),
    false
  );
  assert.equal(
    isCharacterPlaybackRequest({
      characterId: 'char-crew-01',
      clipId: 'idle',
      timeMs: 100,
      pinnedFrame: 1.5,
    }),
    false
  );
});

test('isCharacterAdapter validates engine adapter implementations', () => {
  assert.equal(
    isCharacterAdapter({
      kind: 'sprite-sequence',
      supports: () => true,
      resolveFrame: () => ({
        frameIndex: 0,
        asset: '/a.png',
        isStaticFallback: false,
        completed: false,
        adapterKind: 'sprite-sequence',
      }),
    }),
    true
  );
  assert.equal(
    isCharacterAdapter({
      kind: 'rig-optional',
      supports: () => false,
    }),
    false
  );
  assert.equal(isCharacterAdapter(null), false);
});
