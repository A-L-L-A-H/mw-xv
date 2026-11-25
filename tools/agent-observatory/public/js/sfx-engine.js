/* global window, Audio, setInterval, clearInterval */
(function () {
  window.MWObservatory = window.MWObservatory || {};

  function createSfxEngine() {
    let audioCtx = null;
    let masterGain = null;
    let sfxEnabled = true;
    let beatEnabled = false;
    let unlocked = false;
    let beatTimer = null;
    let beatStep = 0;
    let noiseBuffer = null;
    let ambienceAudio = null;
    let ambienceMode = 'off';

    function ensureContext() {
      if (audioCtx) return audioCtx;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      audioCtx = new AudioCtor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.55;
      masterGain.connect(audioCtx.destination);
      noiseBuffer = createNoiseBuffer(audioCtx);
      return audioCtx;
    }

    function createNoiseBuffer(ctx) {
      const len = ctx.sampleRate * 0.6;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let idx = 0; idx < len; idx += 1) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.95 * b2 + white * 0.048;
        ch[idx] = (b0 + b1 + b2 + white * 0.18) * 0.7;
      }
      return buf;
    }

    async function unlock() {
      const ctx = ensureContext();
      if (!ctx) return false;
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          return false;
        }
      }
      unlocked = ctx.state === 'running';
      return unlocked;
    }

    // Classic rubbery cartoon spring BOING!
    function playBoing(ctx, now) {
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const env = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(165, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(290, now + 0.34);

      lfo.frequency.setValueAtTime(24, now);
      lfoGain.gain.setValueAtTime(42, now);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.32, now + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      osc.connect(env);
      env.connect(masterGain);
      osc.start(now);
      lfo.start(now);
      osc.stop(now + 0.4);
      lfo.stop(now + 0.4);
    }

    // Crisp comic bubble POP!
    function playPop(ctx, now) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(760, now);
      osc.frequency.exponentialRampToValueAtTime(210, now + 0.065);
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.28, now + 0.006);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(env);
      env.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.09);
    }

    // Anime speedline WHOOSH!
    function playWhoosh(ctx, now) {
      if (!noiseBuffer) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(2.6, now);
      filter.frequency.setValueAtTime(320, now);
      filter.frequency.exponentialRampToValueAtTime(2900, now + 0.11);
      filter.frequency.exponentialRampToValueAtTime(480, now + 0.28);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.32, now + 0.08);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      src.connect(filter);
      filter.connect(env);
      env.connect(masterGain);
      src.start(now);
      src.stop(now + 0.32);
    }

    // Electric anime tool ZAP!
    function playZap(ctx, now) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sawtooth';
      const baseFreq = 920 + Math.random() * 340;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.09);
      osc.frequency.exponentialRampToValueAtTime(640, now + 0.13);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3600, now);

      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.18, now + 0.008);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(filter);
      filter.connect(env);
      env.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.16);
    }

    // Magical chibi subagent SPAWN arpeggio!
    function playSpawn(ctx, now) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const startAt = now + idx * 0.048;
        osc.type = idx % 2 === 0 ? 'square' : 'triangle';
        osc.frequency.setValueAtTime(freq, startAt);
        env.gain.setValueAtTime(0.001, startAt);
        env.gain.linearRampToValueAtTime(0.13, startAt + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, startAt + 0.16);
        osc.connect(env);
        env.connect(masterGain);
        osc.start(startAt);
        osc.stop(startAt + 0.17);
      });
    }

    // Cartoon comic BONK + vinyl record-scratch on error!
    function playBonk(ctx, now) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(310, now);
      osc.frequency.exponentialRampToValueAtTime(92, now + 0.16);
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.38, now + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(env);
      env.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.25);

      // Vinyl scratch chirp
      const scratch = ctx.createOscillator();
      const sEnv = ctx.createGain();
      scratch.type = 'sawtooth';
      scratch.frequency.setValueAtTime(980, now + 0.06);
      scratch.frequency.exponentialRampToValueAtTime(240, now + 0.15);
      scratch.frequency.exponentialRampToValueAtTime(760, now + 0.22);
      sEnv.gain.setValueAtTime(0.001, now + 0.06);
      sEnv.gain.linearRampToValueAtTime(0.14, now + 0.09);
      sEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      scratch.connect(sEnv);
      sEnv.connect(masterGain);
      scratch.start(now + 0.06);
      scratch.stop(now + 0.25);
    }

    // Funky anime LEVEL UP!! chord fanfare!
    function playLevelUp(ctx, now) {
      const chord = [523.25, 659.25, 783.99, 987.77, 1046.5];
      chord.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const startAt = now + idx * 0.055;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, startAt);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2400, startAt);

        env.gain.setValueAtTime(0.001, startAt);
        env.gain.linearRampToValueAtTime(0.14, startAt + 0.014);
        env.gain.exponentialRampToValueAtTime(0.001, startAt + 0.42);
        osc.connect(filter);
        filter.connect(env);
        env.connect(masterGain);
        osc.start(startAt);
        osc.stop(startAt + 0.45);
      });
    }

    // Arcade menu chunky CLICK
    function playClick(ctx, now) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.032);
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.12, now + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(env);
      env.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.045);
    }

    // Retro camera shutter
    function playCamera(ctx, now) {
      if (!noiseBuffer) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1600, now);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.28, now);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      src.connect(filter);
      filter.connect(env);
      env.connect(masterGain);
      src.start(now);
      src.stop(now + 0.1);
    }

    // Procedural Funky Anime Beat Step Sequencer (112 BPM Dorian Slap-Bass + Boom-Bap)
    const BASS_PATTERN = [
      110, 0, 110, 130.81, 0, 146.83, 164.81, 0, 110, 0, 196, 164.81, 146.83, 0, 130.81, 98,
    ];
    const CHORD_STEPS = new Map([
      [0, [220, 261.63, 329.63, 392]],
      [6, [246.94, 293.66, 369.99, 440]],
      [10, [196, 246.94, 293.66, 392]],
    ]);

    function triggerBeatTick() {
      if (!beatEnabled || !audioCtx || audioCtx.state !== 'running') return;
      const now = audioCtx.currentTime;
      const step = beatStep % 16;
      beatStep += 1;

      // Punchy Kick on 0, 5, 8, 10
      if (step === 0 || step === 5 || step === 8 || step === 10) {
        const kick = audioCtx.createOscillator();
        const kEnv = audioCtx.createGain();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(135, now);
        kick.frequency.exponentialRampToValueAtTime(42, now + 0.12);
        kEnv.gain.setValueAtTime(0.28, now);
        kEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        kick.connect(kEnv);
        kEnv.connect(masterGain);
        kick.start(now);
        kick.stop(now + 0.17);
      }

      // Snappy Snare on 4, 12
      if ((step === 4 || step === 12) && noiseBuffer) {
        const snare = audioCtx.createBufferSource();
        snare.buffer = noiseBuffer;
        const hp = audioCtx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.setValueAtTime(1700, now);
        const sEnv = audioCtx.createGain();
        sEnv.gain.setValueAtTime(0.18, now);
        sEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        snare.connect(hp);
        hp.connect(sEnv);
        sEnv.connect(masterGain);
        snare.start(now);
        snare.stop(now + 0.12);
      }

      // Funky hi-hat swing on even/off steps
      if (noiseBuffer && (step % 2 === 0 || step === 15)) {
        const hat = audioCtx.createBufferSource();
        hat.buffer = noiseBuffer;
        const hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(6200, now);
        const hEnv = audioCtx.createGain();
        hEnv.gain.setValueAtTime(step % 4 === 2 ? 0.08 : 0.045, now);
        hEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        hat.connect(hp);
        hp.connect(hEnv);
        hEnv.connect(masterGain);
        hat.start(now);
        hat.stop(now + 0.045);
      }

      // Funky Slap Bassline
      const bassHz = BASS_PATTERN[step];
      if (bassHz > 0) {
        const bass = audioCtx.createOscillator();
        const bFilter = audioCtx.createBiquadFilter();
        const bEnv = audioCtx.createGain();
        bass.type = 'sawtooth';
        bass.frequency.setValueAtTime(bassHz, now);
        bFilter.type = 'lowpass';
        bFilter.frequency.setValueAtTime(980, now);
        bFilter.frequency.exponentialRampToValueAtTime(220, now + 0.12);
        bEnv.gain.setValueAtTime(0.15, now);
        bEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        bass.connect(bFilter);
        bFilter.connect(bEnv);
        bEnv.connect(masterGain);
        bass.start(now);
        bass.stop(now + 0.16);
      }

      // Warm Rhodes Funky Chord Stabs
      const chordNotes = CHORD_STEPS.get(step);
      if (chordNotes) {
        for (const hz of chordNotes) {
          const pad = audioCtx.createOscillator();
          const pEnv = audioCtx.createGain();
          pad.type = 'triangle';
          pad.frequency.setValueAtTime(hz, now);
          pEnv.gain.setValueAtTime(0.001, now);
          pEnv.gain.linearRampToValueAtTime(0.038, now + 0.015);
          pEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
          pad.connect(pEnv);
          pEnv.connect(masterGain);
          pad.start(now);
          pad.stop(now + 0.36);
        }
      }
    }

    function play(sfxName) {
      if (!sfxEnabled) return;
      const ctx = ensureContext();
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      switch (sfxName) {
        case 'boing':
          playBoing(ctx, now);
          break;
        case 'pop':
          playPop(ctx, now);
          break;
        case 'whoosh':
          playWhoosh(ctx, now);
          break;
        case 'zap':
          playZap(ctx, now);
          break;
        case 'spawn':
          playSpawn(ctx, now);
          break;
        case 'bonk':
          playBonk(ctx, now);
          break;
        case 'levelup':
          playLevelUp(ctx, now);
          break;
        case 'camera':
          playCamera(ctx, now);
          break;
        default:
          playClick(ctx, now);
          break;
      }
    }

    function setAmbience(nextMode) {
      ambienceMode = nextMode;
      if (ambienceAudio) {
        ambienceAudio.pause();
        ambienceAudio = null;
      }
      if (nextMode === 'off') return;
      const trackByMode = {
        night: '/mw-assets/sounds/ambience-moon-city-night.wav',
        rain: '/mw-assets/sounds/ambience-street-rain.wav',
        hum: '/mw-assets/sounds/ambience-underground-hum.wav',
      };
      const url = trackByMode[nextMode];
      if (!url || typeof Audio === 'undefined') return;
      try {
        ambienceAudio = new Audio(url);
        ambienceAudio.loop = true;
        ambienceAudio.volume = 0.22;
        void ambienceAudio.play().catch(() => {});
      } catch {
        // Ignore audio playback failure
      }
    }

    return {
      unlock,
      isUnlocked() {
        return unlocked && audioCtx?.state === 'running';
      },
      play,
      setSfxEnabled(next) {
        sfxEnabled = Boolean(next);
      },
      isSfxEnabled() {
        return sfxEnabled;
      },
      setBeatEnabled(next) {
        beatEnabled = Boolean(next);
        if (beatTimer) {
          clearInterval(beatTimer);
          beatTimer = null;
        }
        if (beatEnabled) {
          void unlock().then((ready) => {
            if (ready && beatEnabled) {
              // 112 BPM 16th note = 133.9ms
              beatTimer = setInterval(triggerBeatTick, 134);
              setAmbience('night');
            }
          });
        } else {
          setAmbience('off');
        }
      },
      isBeatEnabled() {
        return beatEnabled;
      },
      setAmbience,
      getAmbience() {
        return ambienceMode;
      },
      destroy() {
        if (beatTimer) clearInterval(beatTimer);
        setAmbience('off');
        if (audioCtx) void audioCtx.close().catch(() => {});
      },
    };
  }

  window.MWObservatory.createSfxEngine = createSfxEngine;
})();
