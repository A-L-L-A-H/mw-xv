import { Suspense, lazy, useState, useMemo, useEffect } from 'react';
import { Button } from '@moonwitness/ui/components/button';
import { SceneParticles, type SceneParticlePreset, type SceneParticleIntensity } from '@moonwitness/ui/components/scene-particles';
import { ComicSceneTransition, type ComicTransitionVariant } from '@moonwitness/ui/components/scene-transitions';
import { createSceneSoundscapeController, type SceneAmbienceId } from '@moonwitness/ui/lib/scene-soundscape';
import { getActiveSceneHarness } from '@moonwitness/ui/lib/scene-test-harness';

const SceneParticlesSuspense = lazy(() =>
  import('@moonwitness/ui/components/scene-particles').then((mod) => ({ default: mod.SceneParticles }))
);

export function FXLab() {
  const harness = getActiveSceneHarness() ?? {};
  const [preset, setPreset] = useState<SceneParticlePreset>('stars');
  const [intensity, setIntensity] = useState<SceneParticleIntensity>('medium');
  const [transition, setTransition] = useState<ComicTransitionVariant>('panel-reveal');
  const [ambience, setAmbience] = useState<SceneAmbienceId | null>('moon-city-night');
  const [muted, setMuted] = useState(true);
  const [userActivated, setUserActivated] = useState(false);
  const [activePreset, setActivePreset] = useState<SceneParticlePreset>('stars');
  const [transitionState, setTransitionState] = useState<'idle' | 'entering' | 'entered' | 'cancelled'>('entered');
  const soundscapeRef = useMemo(
    () => createSceneSoundscapeController({ maxVolume: 0.18 }),
    []
  );

  useEffect(() => {
    if (harness.reducedMotion) {
      soundscapeRef.setMuted(true);
    }
    return () => soundscapeRef.dispose();
  }, [harness.reducedMotion, soundscapeRef]);

  const handleActivateAudio = () => {
    soundscapeRef.activateUserGesture();
    setUserActivated(true);
  };

  const handleTransitionComplete = () => setTransitionState('entered');
  const handleTransitionCancel = () => setTransitionState('cancelled');

  useEffect(() => {
    if (!userActivated || muted) return;
    soundscapeRef.setMuted(muted);
    if (ambience) soundscapeRef.enterScene(ambience);
  }, [ambience, muted, userActivated, soundscapeRef]);

  const triggerTransition = () => {
    setTransitionState('entering');
    setTimeout(() => setTransitionState('entered'), 300);
  };

  const presetOptions: SceneParticlePreset[] = ['rain', 'dust', 'stars', 'sparks'];
  const intensityOptions: SceneParticleIntensity[] = ['subtle', 'medium', 'intense'];
  const transitionOptions: ComicTransitionVariant[] = ['ink-wipe', 'panel-reveal', 'cut-impact', 'soft'];
  const ambienceOptions: (SceneAmbienceId | null)[] = ['moon-city-night', 'underground-hum', 'archive-quiet', 'street-rain', null];

  return (
    <div className="fx-lab" data-testid="fx-lab">
      <div className="fx-lab-toolbar">
        <Button variant={preset === 'rain' ? 'magenta' : 'default'} size="sm" onClick={() => { setPreset('rain'); setActivePreset('rain'); }}>Rain</Button>
        <Button variant={preset === 'dust' ? 'magenta' : 'default'} size="sm" onClick={() => { setPreset('dust'); setActivePreset('dust'); }}>Dust</Button>
        <Button variant={preset === 'stars' ? 'magenta' : 'default'} size="sm" onClick={() => { setPreset('stars'); setActivePreset('stars'); }}>Stars</Button>
        <Button variant={preset === 'sparks' ? 'magenta' : 'default'} size="sm" onClick={() => { setPreset('sparks'); setActivePreset('sparks'); }}>Sparks</Button>

        <Button variant={intensity === 'subtle' ? 'magenta' : 'default'} size="sm" onClick={() => setIntensity('subtle')}>Subtle</Button>
        <Button variant={intensity === 'medium' ? 'magenta' : 'default'} size="sm" onClick={() => setIntensity('medium')}>Medium</Button>
        <Button variant={intensity === 'intense' ? 'magenta' : 'default'} size="sm" onClick={() => setIntensity('intense')}>Intense</Button>

        <Button size="sm" variant="default" onClick={handleActivateAudio} disabled={userActivated}>
          {userActivated ? 'Audio enabled' : 'Enable audio (gesture)'}
        </Button>
        <Button size="sm" variant={muted ? 'default' : 'magenta'} onClick={() => setMuted((m) => !m)}>
          {muted ? 'Unmute ambience' : 'Mute ambience'}
        </Button>
        <Button size="sm" variant="default" onClick={() => setAmbience('moon-city-night')}>Night</Button>
        <Button size="sm" variant="default" onClick={() => setAmbience('underground-hum')}>Underground</Button>
        <Button size="sm" variant="default" onClick={() => setAmbience('archive-quiet')}>Archive</Button>
        <Button size="sm" variant="default" onClick={() => setAmbience('street-rain')}>Street rain</Button>
        <Button size="sm" variant="default" onClick={() => setAmbience(null)}>None</Button>
      </div>

      <div className="fx-lab-grid">
        <div className="fx-lab-particles" data-testid="fx-particles">
          <h3>Scene Particles — {activePreset} / {intensity}</h3>
          <div className="fx-lab-particle-stage">
            <Suspense fallback={<p>Loading particles…</p>}>
              <SceneParticlesSuspense
                preset={activePreset}
                intensity={intensity}
                reducedMotion={Boolean(harness.reducedMotion)}
                style={{ width: '100%', height: 240 }}
              />
            </Suspense>
          </div>
          <p className="fx-lab-caption">
            Bounded to {36} max particles; offscreen paused; reduced-motion ⇒ static.
          </p>
        </div>

        <div className="fx-lab-transitions" data-testid="fx-transitions">
          <h3>Comic Transitions — {transition}</h3>
          <div className="fx-lab-transition-stage">
            <ComicSceneTransition
              variant={transition}
              active={transitionState === 'entering'}
              durationMs={300}
              reducedMotion={Boolean(harness.reducedMotion)}
              onComplete={handleTransitionComplete}
              style={{ width: '100%', height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                onClick={() => { setTransition(v); setTransitionState('entering'); }}
              >
                {v}
              </Button>
            ))}
            <Button size="sm" variant="default" onClick={triggerTransition}>
              Retrigger
            </Button>
          </div>
        </div>

        <div className="fx-lab-audio" data-testid="fx-audio">
          <h3>Scene Soundscape</h3>
          <div className="fx-lab-audio-status">
            Muted: {muted ? 'yes' : 'no'} · Active: {ambience ?? 'none'} · User gesture: {userActivated ? 'ok' : 'pending'}
          </div>
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
            <Button size="sm" variant="default" onClick={() => { setMuted((m) => !m); }}>
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button size="sm" variant="default" onClick={handleActivateAudio} disabled={userActivated}>
              {userActivated ? 'Gesture OK' : 'Enable gesture'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
