export type SceneAmbienceId = 'moon-city-night' | 'underground-hum' | 'archive-quiet' | 'street-rain';

export interface AmbienceAudioInstance {
  loop: boolean;
  volume: number;
  paused?: boolean;
  src?: string;
  play(): Promise<unknown>;
  pause(): void;
}

export interface SceneSoundscapeOptions {
  readonly sources?: Partial<Record<SceneAmbienceId, string>>;
  readonly maxVolume?: number;
  readonly createAudio?: (src: string) => AmbienceAudioInstance;
}

export interface SceneSoundscapeSnapshot {
  readonly muted: boolean;
  readonly activeSceneId: SceneAmbienceId | null;
  readonly playing: boolean;
}

export interface SceneSoundscapeController {
  setMuted(muted: boolean): SceneSoundscapeSnapshot;
  activateUserGesture(): SceneSoundscapeSnapshot;
  enterScene(sceneId: SceneAmbienceId): SceneSoundscapeSnapshot;
  stop(): SceneSoundscapeSnapshot;
  getSnapshot(): SceneSoundscapeSnapshot;
  subscribe(listener: (snapshot: SceneSoundscapeSnapshot) => void): () => void;
  dispose(): void;
}

const DEFAULT_SOURCES: Record<SceneAmbienceId, string> = {
  'moon-city-night': '/sounds/ui-signal.wav',
  'underground-hum': '/sounds/ui-signal.wav',
  'archive-quiet': '/sounds/ui-success.wav',
  'street-rain': '/sounds/ui-signal.wav',
};

/**
 * Policy-limited scene ambience controller:
 * - Muted by default until explicit user consent (`setMuted(false)` + user gesture).
 * - Strictly 1 active audio instance; switching scenes stops the previous track cleanly.
 * - Never coupled to hover or scroll, and audio errors never propagate.
 */
export function createSceneSoundscapeController(
  options: SceneSoundscapeOptions = {}
): SceneSoundscapeController {
  const sources = { ...DEFAULT_SOURCES, ...options.sources };
  const maxVolume = Math.max(0, Math.min(0.4, options.maxVolume ?? 0.18));
  const createAudio =
    options.createAudio ??
    ((src: string) => {
      const audio = new Audio(src);
      return audio;
    });

  let muted = true;
  let userActivated = false;
  let activeSceneId: SceneAmbienceId | null = null;
  let activeAudio: AmbienceAudioInstance | null = null;
  let disposed = false;
  const listeners = new Set<(snapshot: SceneSoundscapeSnapshot) => void>();

  const getSnapshot = (): SceneSoundscapeSnapshot => ({
    muted,
    activeSceneId,
    playing: Boolean(activeAudio && !muted && userActivated && !disposed),
  });

  const notify = () => {
    const snap = getSnapshot();
    for (const listener of listeners) listener(snap);
  };

  const stopCurrentAudio = () => {
    if (!activeAudio) return;
    try {
      activeAudio.pause();
    } catch {
      /* Audio failure never breaks UX. */
    }
    activeAudio = null;
  };

  const syncPlayback = () => {
    if (disposed || muted || !userActivated || !activeSceneId) {
      stopCurrentAudio();
      return;
    }
    stopCurrentAudio();
    const src = sources[activeSceneId];
    if (!src) return;
    try {
      const nextAudio = createAudio(src);
      nextAudio.loop = true;
      nextAudio.volume = maxVolume;
      activeAudio = nextAudio;
      void nextAudio.play().catch(() => {
        if (activeAudio === nextAudio) activeAudio = null;
        notify();
      });
    } catch {
      activeAudio = null;
    }
  };

  return {
    setMuted(nextMuted: boolean) {
      if (disposed) return getSnapshot();
      muted = Boolean(nextMuted);
      syncPlayback();
      notify();
      return getSnapshot();
    },
    activateUserGesture() {
      if (disposed) return getSnapshot();
      userActivated = true;
      syncPlayback();
      notify();
      return getSnapshot();
    },
    enterScene(sceneId: SceneAmbienceId) {
      if (disposed) return getSnapshot();
      if (activeSceneId !== sceneId) {
        activeSceneId = sceneId;
        syncPlayback();
        notify();
      }
      return getSnapshot();
    },
    stop() {
      activeSceneId = null;
      stopCurrentAudio();
      notify();
      return getSnapshot();
    },
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      stopCurrentAudio();
      listeners.clear();
    },
  };
}
