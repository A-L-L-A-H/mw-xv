import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React, { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import {
  BACKGROUND_ASSETS,
  GAME_ASSETS,
  KURO_CLIP_IDS,
  KURO_EXPRESSIONS,
  KURO_POSES,
  RIOT_ALLEY_SCENE_PATH,
  STATE_ILLUSTRATIONS,
  STICKER_ASSETS,
  getBackgroundAsset,
  getBadgeAsset,
  getCharacterClip,
  getCharacterPortrait,
  getCharacterPose,
  getStateIllustration,
  getStickerAsset,
  resolveUniverseAsset,
} from '../dist/lib/asset-registry.js';
import { ComicPanel, MangaFrame } from '../dist/components/comic-panel.js';
import { SpeechBubble, StickerBadge } from '../dist/components/speech-bubble.js';
import { CharacterDisplay, CharacterReaction } from '../dist/components/character-stage.js';
import { AchievementBadge, QuestCard, RewardPanel } from '../dist/components/quest-card.js';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const componentCss = await readFile(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8'
);

test('package exports all visual universe subpaths', () => {
  for (const subpath of [
    './lib/asset-registry',
    './components/comic-panel',
    './components/speech-bubble',
    './components/character-stage',
    './components/quest-card',
  ]) {
    assert.ok(packageJson.exports[subpath], `Missing package export for ${subpath}`);
  }
});

test('asset-registry resolves canonical universe paths with optional basePath', () => {
  assert.equal(
    resolveUniverseAsset('illustrations/riot-universe/states/state-welcome.webp'),
    '/illustrations/riot-universe/states/state-welcome.webp'
  );
  assert.equal(
    resolveUniverseAsset('/scenes/riot-alley-scene.json', '/catalog/'),
    '/catalog/scenes/riot-alley-scene.json'
  );
  assert.equal(RIOT_ALLEY_SCENE_PATH, 'scenes/riot-alley-scene.json');

  assert.equal(KURO_EXPRESSIONS.length, 16);
  assert.equal(KURO_POSES.length, 12);
  assert.equal(STATE_ILLUSTRATIONS.length, 25);
  assert.equal(STICKER_ASSETS.length, 12);
  assert.equal(GAME_ASSETS.length, 13);
  assert.equal(BACKGROUND_ASSETS.length, 4);
  assert.equal(KURO_CLIP_IDS.length, 8);

  const kuroHappy = getCharacterPortrait('kuro-signal', 'happy');
  assert.equal(
    kuroHappy.path,
    'illustrations/riot-universe/characters/kuro-signal-expression-happy.webp'
  );
  assert.equal(
    kuroHappy.fallbackPath,
    'illustrations/riot-universe/characters/kuro-signal-expression-happy.png'
  );

  const vesper = getCharacterPortrait('vesper-ink');
  assert.equal(vesper.path, 'illustrations/riot-universe/characters/vesper-ink-portrait.webp');
  assert.equal(
    vesper.fallbackPath,
    'illustrations/riot-universe/characters/vesper-ink-portrait.png'
  );

  const pose = getCharacterPose('kuro-signal', 'pointing', { basePath: '/app' });
  assert.equal(
    pose.src,
    '/app/illustrations/riot-universe/characters/kuro-signal-pose-pointing.webp'
  );

  assert.equal(
    getStateIllustration('empty-dashboard').path,
    'illustrations/riot-universe/states/state-empty-dashboard.webp'
  );
  assert.equal(
    getStickerAsset('comic-boom').path,
    'illustrations/riot-universe/stickers/sticker-comic-boom.png'
  );
  assert.equal(
    getBadgeAsset('badge-signal-scout').path,
    'illustrations/riot-universe/game/badge-signal-scout.png'
  );
  assert.equal(
    getBackgroundAsset('riot-street-alley').path,
    'illustrations/riot-universe/backgrounds/bg-riot-street-alley.webp'
  );

  const clip = getCharacterClip('wave', { basePath: '/sub' });
  assert.equal(clip.frames.length, 4);
  assert.equal(clip.frames[0], '/sub/animation/kuro-signal-wave/kuro-signal-wave-frame-01.png');
  assert.equal(clip.frames[3], '/sub/animation/kuro-signal-wave/kuro-signal-wave-frame-04.png');
});

test('ComicPanel, MangaFrame, SpeechBubble, and StickerBadge render expected markup and attributes', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        ComicPanel,
        {
          panelNumber: '01',
          kicker: 'Issue 01',
          title: 'Alley Recon',
          surface: 'paper',
          frame: 'torn',
          accent: 'cyan',
          halftone: true,
        },
        'Panel body'
      ),
      React.createElement(
        MangaFrame,
        { surface: 'ink', frame: 'scuffed', accent: 'violet', title: 'Frame' },
        'Frame body'
      ),
      React.createElement(
        SpeechBubble,
        { variant: 'shout', tail: 'left', speaker: 'Kuro' },
        'Signal locked!'
      ),
      React.createElement(StickerBadge, { tone: 'magenta', tilt: 'right' }, 'NEW')
    )
  );

  assert.match(html, /class="mw-ui-comic-panel(?:\s|")/u);
  assert.match(html, /data-surface="paper"/u);
  assert.match(html, /data-frame="torn"/u);
  assert.match(html, /data-accent="cyan"/u);
  assert.match(html, /mw-ui-comic-panel-num">01</u);
  assert.match(html, /class="mw-ui-comic-panel mw-ui-manga-frame(?:\s|")/u);
  assert.match(html, /data-variant="shout"/u);
  assert.match(html, /data-tail="left"/u);
  assert.match(html, /mw-ui-speech-bubble-speaker">Kuro</u);
  assert.match(html, /class="mw-ui-sticker-badge" data-tilt="right" data-tone="magenta"/u);
});

test('CharacterDisplay and CharacterReaction support static portrait, SpritePlayer animation, and reduced-motion fallback', () => {
  const staticHtml = renderToStaticMarkup(
    React.createElement(CharacterDisplay, {
      characterId: 'kuro-signal',
      expression: 'curious',
      size: 'lg',
      basePath: '/cdn',
    })
  );
  assert.match(staticHtml, /data-animated="false"/u);
  assert.match(staticHtml, /kuro-signal-expression-curious\.webp/u);
  assert.match(staticHtml, /kuro-signal-expression-curious\.png/u);

  const animatedHtml = renderToStaticMarkup(
    React.createElement(CharacterDisplay, {
      characterId: 'kuro-signal',
      animated: true,
      clipId: 'celebrate',
      reducedMotion: false,
    })
  );
  assert.match(animatedHtml, /data-animated="true"/u);
  assert.match(animatedHtml, /data-sprite-clip="kuro-signal-celebrate"/u);

  const reducedHtml = renderToStaticMarkup(
    React.createElement(CharacterReaction, {
      characterId: 'kuro-signal',
      expression: 'determined',
      animated: true,
      clipId: 'celebrate',
      reducedMotion: true,
      speaker: 'Kuro Signal',
      message: 'Standing by.',
    })
  );
  assert.match(reducedHtml, /data-reduced-motion="true"/u);
  assert.match(reducedHtml, /data-animated="false"/u);
  assert.doesNotMatch(reducedHtml, /data-sprite-clip=/u);
  assert.match(reducedHtml, /role="status"/u);
  assert.match(reducedHtml, /Standing by\./u);
});

test('QuestCard, AchievementBadge, and RewardPanel render accessible progressbars and status text', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(QuestCard, {
        title: 'Calibrate Relay',
        description: 'Verify signal bounds.',
        completedSteps: 2,
        totalSteps: 4,
        status: 'active',
        badgeId: 'badge-signal-scout',
        rewardLabel: 'Scout Badge',
      }),
      React.createElement(AchievementBadge, {
        badgeId: 'badge-zero-drift',
        title: 'Zero Drift',
        unlocked: true,
        rank: 'Vanguard',
      }),
      React.createElement(RewardPanel, {
        completedCount: 3,
        totalCount: 5,
        badges: [
          { badgeId: 'badge-signal-scout', title: 'Signal Scout', unlocked: true },
          { badgeId: 'badge-archive-keeper', title: 'Archive Keeper', unlocked: false },
        ],
      })
    )
  );

  assert.match(
    html,
    /class="mw-ui-comic-panel mw-ui-panel mw-ui-quest-card" data-status="active"/u
  );
  assert.match(html, /role="progressbar"/u);
  assert.match(html, /aria-valuenow="2"/u);
  assert.match(html, /aria-valuemax="4"/u);
  assert.match(html, /2\/4 steps \(50%\)/u);
  assert.match(html, /data-unlocked="true"/u);
  assert.match(html, /Vanguard · Unlocked/u);
  assert.match(html, /3\/5 complete · 1 unlocked/u);
  assert.match(html, /badge-archive-keeper\.png/u);
});

test('components.css defines scene particle, comic transition, and visual universe rules', () => {
  assert.match(componentCss, /\.mw-ui-scene-particles\[data-particle-preset='rain'\]/u);
  assert.match(componentCss, /\.mw-ui-comic-transition\[data-transition-state='entering'\]/u);
  assert.match(componentCss, /\.mw-ui-comic-panel/u);
  assert.match(componentCss, /\.mw-ui-manga-frame/u);
  assert.match(componentCss, /\.mw-ui-sticker-badge/u);
  assert.match(componentCss, /\.mw-ui-character-stage/u);
  assert.match(componentCss, /\.mw-ui-quest-card/u);
  assert.match(componentCss, /\.mw-ui-achievement-badge/u);
  assert.match(componentCss, /\.mw-ui-reward-panel/u);
});

test('visual universe components forward DOM refs cleanly', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });

  try {
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const comicRef = createRef();
    const mangaRef = createRef();
    const bubbleRef = createRef();
    const stickerRef = createRef();
    const charRef = createRef();
    const reactionRef = createRef();
    const questRef = createRef();
    const badgeRef = createRef();
    const rewardRef = createRef();

    const root = createRoot(document.getElementById('root'));
    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ComicPanel, { ref: comicRef, title: 'C' }, 'Body'),
          React.createElement(MangaFrame, { ref: mangaRef, title: 'M' }, 'Body'),
          React.createElement(SpeechBubble, { ref: bubbleRef }, 'Hi'),
          React.createElement(StickerBadge, { ref: stickerRef }, 'Tag'),
          React.createElement(CharacterDisplay, { ref: charRef }),
          React.createElement(CharacterReaction, { ref: reactionRef, message: 'Ok' }),
          React.createElement(QuestCard, {
            ref: questRef,
            title: 'Q',
            completedSteps: 1,
            totalSteps: 2,
          }),
          React.createElement(AchievementBadge, {
            ref: badgeRef,
            badgeId: 'badge-signal-scout',
            title: 'B',
          }),
          React.createElement(RewardPanel, {
            ref: rewardRef,
            completedCount: 1,
            totalCount: 2,
          })
        )
      );
    });

    assert.equal(comicRef.current?.tagName, 'SECTION');
    assert.equal(mangaRef.current?.tagName, 'DIV');
    assert.equal(bubbleRef.current?.tagName, 'DIV');
    assert.equal(stickerRef.current?.tagName, 'SPAN');
    assert.equal(charRef.current?.tagName, 'DIV');
    assert.equal(reactionRef.current?.tagName, 'DIV');
    assert.equal(questRef.current?.tagName, 'ARTICLE');
    assert.equal(badgeRef.current?.tagName, 'DIV');
    assert.equal(rewardRef.current?.tagName, 'SECTION');
    await act(async () => root.unmount());
  } finally {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
  }
});
