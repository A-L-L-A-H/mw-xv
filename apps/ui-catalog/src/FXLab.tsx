import { useState, useMemo, useEffect } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import {
  SceneParticles,
  type SceneParticlePreset,
  type SceneParticleIntensity,
} from '@moonwitness/ui/components/scene-particles';
import {
  ComicSceneTransition,
  type ComicTransitionVariant,
} from '@moonwitness/ui/components/scene-transitions';
import {
  createSceneSoundscapeController,
  type SceneAmbienceId,
} from '@moonwitness/ui/lib/scene-soundscape';
import { getActiveSceneHarness } from '@moonwitness/ui/lib/scene-test-harness';
import moonCityNightAmbience from '@moonwitness/assets/sounds/ambience-moon-city-night.wav';
import undergroundHumAmbience from '@moonwitness/assets/sounds/ambience-underground-hum.wav';
import archiveQuietAmbience from '@moonwitness/assets/sounds/ambience-archive-quiet.wav';
import streetRainAmbience from '@moonwitness/assets/sounds/ambience-street-rain.wav';

export function FXLab() {
  const harness = getActiveSceneHarness() ?? {};
  const [preset, setPreset] = useState<SceneParticlePreset>('stars');
  const [intensity, setIntensity] = useState<SceneParticleIntensity>('medium');
  const [transition, setTransition] = useState<ComicTransitionVariant>('panel-reveal');
  const [ambience, setAmbience] = useState<SceneAmbienceId | null>('moon-city-night');
  const [muted, setMuted] = useState(true);
  const [userActivated, setUserActivated] = useState(false);
  const [activePreset, setActivePreset] = useState<SceneParticlePreset>('stars');
  const [transitionState, setTransitionState] = useState<
    'idle' | 'entering' | 'entered' | 'cancelled'
  >('entered');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(preference.matches);
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);
  const reducedMotion =
    Boolean(harness.reducedMotion) ||
    prefersReducedMotion ||
    (typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const soundscapeRef = useMemo(
    () =>
      createSceneSoundscapeController({
        maxVolume: 0.18,
        sources: {
          'moon-city-night': moonCityNightAmbience,
          'underground-hum': undergroundHumAmbience,
          'archive-quiet': archiveQuietAmbience,
          'street-rain': streetRainAmbience,
        },
      }),
    []
  );

  useEffect(() => {
    if (reducedMotion) {
      soundscapeRef.setMuted(true);
    }
    return () => soundscapeRef.dispose();
  }, [reducedMotion, soundscapeRef]);

  const handleActivateAudio = () => {
    soundscapeRef.activateUserGesture();
    setUserActivated(true);
  };

  const handleTransitionComplete = () => setTransitionState('entered');

  useEffect(() => {
    if (!userActivated) return;
    soundscapeRef.setMuted(muted);
    if (muted) return;
    if (ambience) soundscapeRef.enterScene(ambience);
    else soundscapeRef.stop();
  }, [ambience, muted, userActivated, soundscapeRef]);

  const triggerTransition = () => {
    setTransitionState('entering');
    setTimeout(() => setTransitionState('entered'), 300);
  };

  const presetOptions: SceneParticlePreset[] = ['rain', 'dust', 'stars', 'sparks'];
  const intensityOptions: SceneParticleIntensity[] = ['subtle', 'medium', 'intense'];
  const transitionOptions: ComicTransitionVariant[] = [
    'ink-wipe',
    'panel-reveal',
    'cut-impact',
    'soft',
  ];
  const ambienceOptions: (SceneAmbienceId | null)[] = [
    'moon-city-night',
    'underground-hum',
    'archive-quiet',
    'street-rain',
    null,
  ];

  return (
    <div className="fx-lab" data-testid="fx-lab">
      <div className="fx-lab-toolbar">
        {presetOptions.map((p) => (
          <Button
            key={p}
            variant={preset === p ? 'magenta' : 'default'}
            size="sm"
            onClick={() => {
              setPreset(p);
              setActivePreset(p);
            }}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </Button>
        ))}
        {intensityOptions.map((i) => (
          <Button
            key={i}
            variant={intensity === i ? 'magenta' : 'default'}
            size="sm"
            onClick={() => setIntensity(i)}
          >
            {i.charAt(0).toUpperCase() + i.slice(1)}
          </Button>
        ))}

        <Button size="sm" variant="default" onClick={handleActivateAudio} disabled={userActivated}>
          {userActivated ? 'Audio enabled' : 'Enable audio (gesture)'}
        </Button>
        <Button
          size="sm"
          variant={muted ? 'default' : 'magenta'}
          onClick={() => setMuted((m) => !m)}
        >
          {muted ? 'Unmute ambience' : 'Mute ambience'}
        </Button>
        <Button size="sm" variant="default" onClick={() => setAmbience('moon-city-night')}>
          Night
        </Button>
        <Button size="sm" variant="default" onClick={() => setAmbience('underground-hum')}>
          Underground
        </Button>
        <Button size="sm" variant="default" onClick={() => setAmbience('archive-quiet')}>
          Archive
        </Button>
        <Button size="sm" variant="default" onClick={() => setAmbience('street-rain')}>
          Street rain
        </Button>
        <Button size="sm" variant="default" onClick={() => setAmbience(null)}>
          None
        </Button>
      </div>

      <div className="fx-lab-grid">
        <div className="fx-lab-particles" data-testid="fx-particles">
          <h3>
            Scene Particles — {activePreset} / {intensity}
          </h3>
          <div className="fx-lab-particle-stage">
            <SceneParticles
              preset={activePreset}
              intensity={intensity}
              reducedMotion={reducedMotion}
              style={{ width: '100%', height: 240 }}
            />
          </div>
          <p className="fx-lab-caption">
            Intended for restrained atmospheric depth. Avoid fast flashes or masking text and
            controls. Bounded to 36 particles; offscreen paused; reduced-motion uses static
            particles.
          </p>
        </div>

        <div className="fx-lab-transitions" data-testid="fx-transitions">
          <h3>Comic Transitions — {transition}</h3>
          <div className="fx-lab-transition-stage">
            <ComicSceneTransition
              variant={transition}
              active={transitionState === 'entering'}
              durationMs={300}
              reducedMotion={reducedMotion}
              onComplete={handleTransitionComplete}
              style={{
                width: '100%',
                height: 240,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div className="fx-lab-transition-content">Scene Content</div>
            </ComicSceneTransition>
          </div>
          <div className="fx-lab-toolbar">
            {transitionOptions.map((v) => (
              <Button
                key={v}
                size="sm"
                variant={transition === v ? 'magenta' : 'default'}
                onClick={() => {
                  setTransition(v);
                  setTransitionState(reducedMotion ? 'entered' : 'entering');
                }}
              >
                {v}
              </Button>
            ))}
            <Button size="sm" variant="default" onClick={triggerTransition}>
              Retrigger
            </Button>
          </div>
          <p className="fx-lab-caption">
            Use for short scene changes. Avoid stacking transitions or delaying navigation.
          </p>
        </div>

        <div className="fx-lab-audio" data-testid="fx-audio">
          <h3>Scene Soundscape</h3>
          <div className="fx-lab-audio-status">
            Muted: {muted ? 'yes' : 'no'} · Active: {ambience ?? 'none'} · User gesture:{' '}
            {userActivated ? 'ok' : 'pending'}
          </div>
          <p className="fx-lab-caption">
            Ambient sound is optional and consent-gated. Avoid autoplay, overlapping loops, or
            relying on audio to convey state.
          </p>
          <div className="fx-lab-toolbar">
            {ambienceOptions.map((v) => (
              <Button
                key={v ?? 'none'}
                size="sm"
                variant={ambience === v ? 'magenta' : 'default'}
                onClick={() => setAmbience(v)}
              >
                {v ?? 'None'}
              </Button>
            ))}
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                setMuted((m) => !m);
              }}
            >
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleActivateAudio}
              disabled={userActivated}
            >
              {userActivated ? 'Gesture OK' : 'Enable gesture'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
