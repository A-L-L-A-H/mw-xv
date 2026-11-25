import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './button.js';
import { StatusBar } from './status-bar.js';
import { SpritePlayer, type SpriteClipMetadata } from './sprite-player.js';
import { getActiveSceneHarness } from '../lib/scene-test-harness.js';
import { useReducedMotion } from '../lib/use-reduced-motion.js';

export type CharacterPreviewProps = {
  /** Canonical manifest asset path for the clip JSON. */
  clipId: string;
  /** Canonical manifest asset path for the reduced-motion still fallback. */
  fallbackAsset: string;
  /** Canonical manifest frame paths for the selected clip. */
  frames?: readonly string[];
  durationMs?: number;
};

export function CharacterPreview({
  clipId,
  fallbackAsset,
  frames = [fallbackAsset],
  durationMs = 1200,
}: CharacterPreviewProps) {
  const [playing, setPlaying] = useState(false);
  const [manualReducedMotion, setManualReducedMotion] = useState<boolean | undefined>(undefined);
  const harness = getActiveSceneHarness();
  const reducedMotion = useReducedMotion(manualReducedMotion);

  useEffect(() => {
    if (harness?.reducedMotion !== undefined) {
      setManualReducedMotion(undefined);
    }
  }, [harness?.reducedMotion]);

  const clip = useMemo<SpriteClipMetadata>(
    () => ({
      id: clipId,
      frames,
      durationMs,
      loop: true,
      pingPong: true,
      fallbackAsset,
      width: 1024,
      height: 1024,
    }),
    [clipId, frames, durationMs, fallbackAsset]
  );

  const reset = useCallback(() => {
    setPlaying(false);
  }, []);

  const togglePlayback = useCallback(() => {
    if (!playing || reducedMotion) {
      setManualReducedMotion(false);
      setPlaying(true);
      return;
    }
    setPlaying(false);
  }, [playing, reducedMotion]);

  return (
    <div className="character-preview">
      <StatusBar
        steps={[{ id: 'playback', label: 'playback', state: playing ? 'active' : 'disabled' }]}
      />
      <div className="character-preview-surface">
        <SpritePlayer
          clip={clip}
          playing={playing}
          reducedMotion={reducedMotion}
          label={`${clipId} character animation preview`}
          scale={0.65}
        />
      </div>
      <div className="character-preview-controls">
        <Button type="button" variant="magenta" onClick={togglePlayback}>
          {playing && !reducedMotion ? 'Pause' : 'Play'}
        </Button>
        <Button type="button" variant="default" onClick={reset}>
          Reset
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={() => setManualReducedMotion(!reducedMotion)}
          aria-pressed={reducedMotion}
        >
          {reducedMotion ? 'Reduced motion on' : 'Reduced motion off'}
        </Button>
      </div>
    </div>
  );
}
