'use client';

import {
  forwardRef,
  useEffect,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import {
  getCharacterClip,
  getCharacterPortrait,
  getCharacterPose,
  type CharacterId,
  type KuroClipId,
  type KuroExpression,
  type KuroPose,
} from '../lib/asset-registry.js';
import { cn } from '../lib/cn.js';
import { getActiveSceneHarness } from '../lib/scene-test-harness.js';
import { SpeechBubble, type SpeechBubbleTail, type SpeechBubbleVariant } from './speech-bubble.js';
import { SpritePlayer } from './sprite-player.js';

export type CharacterDisplaySize = 'sm' | 'md' | 'lg';

export type CharacterDisplayProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  characterId?: CharacterId;
  expression?: KuroExpression;
  pose?: KuroPose;
  animated?: boolean;
  clipId?: KuroClipId;
  size?: CharacterDisplaySize;
  basePath?: string;
  alt?: string;
  decorative?: boolean;
  reducedMotion?: boolean;
};

function useSystemReducedMotion(explicit?: boolean): boolean {
  const harness = getActiveSceneHarness();
  const [systemReduced, setSystemReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystemReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return Boolean(explicit ?? harness?.reducedMotion ?? systemReduced);
}

/**
 * Displays a MoonWitness character portrait, full pose, or animated sprite clip.
 * Automatically falls back to a static portrait when prefers-reduced-motion is active.
 */
export const CharacterDisplay = forwardRef<HTMLDivElement, CharacterDisplayProps>(
  function CharacterDisplay(
    {
      characterId = 'kuro-signal',
      expression = 'determined',
      pose,
      animated = false,
      clipId = 'idle',
      size = 'md',
      basePath = '',
      alt,
      decorative = false,
      reducedMotion,
      className,
      ...props
    },
    ref
  ) {
    const isReducedMotion = useSystemReducedMotion(reducedMotion);
    const shouldAnimate = animated && characterId === 'kuro-signal' && !isReducedMotion;

    const staticAsset = useMemo(
      () =>
        pose && characterId === 'kuro-signal'
          ? getCharacterPose(characterId, pose, { basePath })
          : getCharacterPortrait(characterId, expression, { basePath }),
      [basePath, characterId, expression, pose]
    );

    const clip = useMemo(
      () => (shouldAnimate ? getCharacterClip(clipId, { basePath }) : null),
      [basePath, clipId, shouldAnimate]
    );

    const resolvedAlt = decorative ? '' : (alt ?? staticAsset.alt);

    return (
      <div
        ref={ref}
        aria-hidden={decorative ? 'true' : undefined}
        className={cn('mw-ui-character-stage', className)}
        data-animated={shouldAnimate ? 'true' : 'false'}
        data-character={characterId}
        data-reduced-motion={isReducedMotion ? 'true' : 'false'}
        data-size={size}
        {...props}
      >
        {shouldAnimate && clip ? (
          <SpritePlayer
            clip={clip}
            label={resolvedAlt}
            reducedMotion={isReducedMotion}
            className="mw-ui-character-stage-sprite"
          />
        ) : (
          <picture className="mw-ui-character-stage-media">
            {staticAsset.src !== staticAsset.fallbackSrc ? (
              <source srcSet={staticAsset.src} type="image/webp" />
            ) : null}
            <img
              className="mw-ui-character-stage-img"
              src={staticAsset.fallbackSrc}
              alt={resolvedAlt}
              decoding="async"
            />
          </picture>
        )}
      </div>
    );
  }
);

export type CharacterReactionProps = Omit<CharacterDisplayProps, 'children'> & {
  message: ReactNode;
  speaker?: ReactNode;
  bubbleVariant?: SpeechBubbleVariant;
  bubbleTail?: SpeechBubbleTail;
  statusLabel?: string;
  live?: 'polite' | 'assertive' | 'off';
};

/** Pairs CharacterDisplay with a directional SpeechBubble and accessible status region. */
export const CharacterReaction = forwardRef<HTMLDivElement, CharacterReactionProps>(
  function CharacterReaction(
    {
      message,
      speaker,
      bubbleVariant = 'speech',
      bubbleTail = 'left',
      statusLabel,
      live = 'polite',
      characterId = 'kuro-signal',
      className,
      expression,
      pose,
      animated,
      clipId,
      size,
      basePath,
      alt,
      decorative,
      reducedMotion,
      ...props
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={cn('mw-ui-character-reaction', className)}
        data-character={characterId}
        {...props}
      >
        <CharacterDisplay
          characterId={characterId}
          expression={expression}
          pose={pose}
          animated={animated}
          clipId={clipId}
          size={size}
          basePath={basePath}
          alt={alt}
          decorative={decorative}
          reducedMotion={reducedMotion}
        />
        <SpeechBubble
          variant={bubbleVariant}
          tail={bubbleTail}
          speaker={speaker}
          role={live !== 'off' ? 'status' : undefined}
          aria-live={live !== 'off' ? live : undefined}
          aria-label={statusLabel}
        >
          {message}
        </SpeechBubble>
      </div>
    );
  }
);
