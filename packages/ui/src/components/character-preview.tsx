import { useCallback, useState } from 'react';
import { Button } from './button.js';
import { StatusBar } from './status-bar.js';

export type CharacterPreviewProps = {
  /** Canonical manifest asset path for the clip JSON. */
  clipId: string;
  /** Canonical manifest asset path for the reduced-motion still fallback. */
  fallbackAsset: string;
};

export function CharacterPreview({ clipId, fallbackAsset }: CharacterPreviewProps) {
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);

  const reset = useCallback(() => {
    setFrameIndex(0);
    setPlaying(false);
  }, []);

  return (
    <div className="character-preview">
      <StatusBar steps={[{ id: 'playback', label: 'playback', state: playing ? 'active' : 'disabled' }]} />
      <div className="character-preview-surface">
        <img
          className="character-preview-frame"
          src={fallbackAsset}
          alt="crew-01 character preview (reduced-motion still)"
          loading="lazy"
          decoding="async"
          width="1024"
          height="1024"
        />
      </div>
      <div className="character-preview-controls">
        <Button variant="magenta" onClick={() => setPlaying(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button variant="default" onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
