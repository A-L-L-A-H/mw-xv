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
    let intensityLevel = 'riot'; // 'chill' | 'riot' | 'overdrive'

    function ensureContext() {
      if (audioCtx) return audioCtx;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      audioCtx = new AudioCtor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.56;
      masterGain.connect(audioCtx.destination);
      noiseBuffer = createNoiseBuffer(audioCtx);
      return audioCtx;
    }

    function createNoiseBuffer(ctx) {
      const len = Math.floor(ctx.sampleRate * 0.7);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const channel = buf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let idx = 0; idx < len; idx += 1) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.95 * b2 + white * 0.048;
        channel[idx] = (b0 + b1 + b2 + white * 0.2) * 0.72;
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
      osc.frequency.exponentialRampToValueAtTime(540, now + 0.14);
      osc.frequency.exponentialRampToValueAtTime(290, now + 0.34);

      lfo.frequency.setValueAtTime(25, now);
      lfoGain.gain.setValueAtTime(44, now);
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
      osc.frequency.setValueAtTime(780, now);
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
      filter.frequency.exponentialRampToValueAtTime(3000, now + 0.11);
      filter.frequency.exponentialRampToValueAtTime(460, now + 0.28);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.3, now + 0.08);
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
      const baseFreq = 920 + Math.random() * 360;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.09);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.13);

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

    // Anime Katana / Energy Blade SLASH (SHING!!)
    function playSlash(ctx, now) {
      if (noiseBuffer) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.Q.setValueAtTime(3.2, now);
        hp.frequency.setValueAtTime(3800, now);
        hp.frequency.exponentialRampToValueAtTime(950, now + 0.14);
        const nEnv = ctx.createGain();
        nEnv.gain.setValueAtTime(0.001, now);
        nEnv.gain.linearRampToValueAtTime(0.32, now + 0.015);
        nEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        src.connect(hp);
        hp.connect(nEnv);
        nEnv.connect(masterGain);
        src.start(now);
        src.stop(now + 0.18);
      }

      const blade = ctx.createOscillator();
      const bEnv = ctx.createGain();
      blade.type = 'triangle';
      blade.frequency.setValueAtTime(2550, now);
      blade.frequency.exponentialRampToValueAtTime(760, now + 0.06);
      blade.frequency.exponentialRampToValueAtTime(3300, now + 0.14);
      bEnv.gain.setValueAtTime(0.001, now);
      bEnv.gain.linearRampToValueAtTime(0.16, now + 0.01);
      bEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      blade.connect(bEnv);
      bEnv.connect(masterGain);
      blade.start(now);
      blade.stop(now + 0.18);
    }

    // Arcade Mega-Beam LASER (PEWWW!!)
    function playLaser(ctx, now) {
      const freqs = [1380, 1408];
      for (const startHz of freqs) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const env = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(startHz, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.24);
        filter.type = 'bandpass';
        filter.Q.setValueAtTime(2.0, now);
        filter.frequency.setValueAtTime(2400, now);
        filter.frequency.exponentialRampToValueAtTime(480, now + 0.24);
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.14, now + 0.012);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.connect(filter);
        filter.connect(env);
        env.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.27);
      }
    }

    // Metallic Anime Weapon CLASH (CLANG-KRASH!!)
    function playClash(ctx, now) {
      const ringFreqs = [1180, 1730, 2340, 3190];
      for (const hz of ringFreqs) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(hz, now);
        osc.frequency.exponentialRampToValueAtTime(hz * 0.86, now + 0.22);
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.075, now + 0.006);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.connect(env);
        env.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.25);
      }
      playPunch(ctx, now);
    }

    // Street-Brawler Cartoon PUNCH / KAPOW!!
    function playPunch(ctx, now) {
      const thud = ctx.createOscillator();
      const tEnv = ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(280, now);
      thud.frequency.exponentialRampToValueAtTime(44, now + 0.14);
      tEnv.gain.setValueAtTime(0.001, now);
      tEnv.gain.linearRampToValueAtTime(0.42, now + 0.008);
      tEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      thud.connect(tEnv);
      tEnv.connect(masterGain);
      thud.start(now);
      thud.stop(now + 0.19);

      if (noiseBuffer) {
        const crack = ctx.createBufferSource();
        crack.buffer = noiseBuffer;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1400, now);
        const cEnv = ctx.createGain();
        cEnv.gain.setValueAtTime(0.32, now);
        cEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
        crack.connect(bp);
        bp.connect(cEnv);
        cEnv.connect(masterGain);
        crack.start(now);
        crack.stop(now + 0.1);
      }
    }

    // Ninja / Jet Set Radio Speed-DASH (ZOOOM!!)
    function playDash(ctx, now) {
      const chirp = ctx.createOscillator();
      const env = ctx.createGain();
      chirp.type = 'triangle';
      chirp.frequency.setValueAtTime(260, now);
      chirp.frequency.exponentialRampToValueAtTime(1240, now + 0.09);
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.18, now + 0.015);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      chirp.connect(env);
      env.connect(masterGain);
      chirp.start(now);
      chirp.stop(now + 0.12);
    }

    // ALL-OUT TEAM RIOT ULTIMATE BARRAGE!!
    function playUltimate(ctx, now) {
      // 1. Rising power charge
      const charge = ctx.createOscillator();
      const chEnv = ctx.createGain();
      charge.type = 'sawtooth';
      charge.frequency.setValueAtTime(180, now);
      charge.frequency.exponentialRampToValueAtTime(1480, now + 0.22);
      chEnv.gain.setValueAtTime(0.001, now);
      chEnv.gain.linearRampToValueAtTime(0.18, now + 0.14);
      chEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      charge.connect(chEnv);
      chEnv.connect(masterGain);
      charge.start(now);
      charge.stop(now + 0.25);

      // 2. Massive impact clash + sub drop at +0.20s
      playClash(ctx, now + 0.2);
      playLaser(ctx, now + 0.22);

      // 3. Heroic riot brass power chord at +0.28s
      const riotChord = [220, 329.63, 440, 587.33, 659.25, 880];
      riotChord.forEach((freq, idx) => {
        const brass = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const env = ctx.createGain();
        const startAt = now + 0.26 + idx * 0.025;
        brass.type = 'sawtooth';
        brass.frequency.setValueAtTime(freq, startAt);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3200, startAt);
        filter.frequency.exponentialRampToValueAtTime(900, startAt + 0.5);
        env.gain.setValueAtTime(0.001, startAt);
        env.gain.linearRampToValueAtTime(0.11, startAt + 0.02);
        env.gain.exponentialRampToValueAtTime(0.001, startAt + 0.56);
        brass.connect(filter);
        filter.connect(env);
        env.connect(masterGain);
        brass.start(startAt);
        brass.stop(startAt + 0.58);
      });
    }

    // Magical chibi subagent SPAWN arpeggio!
    function playSpawn(ctx, now) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        const startAt = now + idx * 0.044;
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
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.16);
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.38, now + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(env);
      env.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.25);

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
        const startAt = now + idx * 0.05;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, startAt);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2600, startAt);

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
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.032);
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

    // 128 BPM Punk-Funk Anime Boss Breakbeat Sequencer (Jet Set Radio / Persona 5 energy!)
    const BASS_PATTERN = [
      110, 0, 110, 130.81, 0, 146.83, 164.81, 146.83, 110, 0, 196, 164.81, 146.83, 0, 130.81, 98,
    ];
    const BRASS_RIFF = new Map([
      [0, [220, 329.63, 440]],
      [3, [261.63, 392, 523.25]],
      [6, [293.66, 440, 587.33]],
      [10, [196, 293.66, 392]],
      [14, [246.94, 369.99, 493.88]],
    ]);

    function triggerBeatTick() {
      if (!beatEnabled || !audioCtx || audioCtx.state !== 'running') return;
      const now = audioCtx.currentTime;
      const step = beatStep % 16;
      const bar = Math.floor(beatStep / 16) % 4;
      beatStep += 1;

      const isOverdrive = intensityLevel === 'overdrive';
      const isChill = intensityLevel === 'chill';

      // Breakbeat Kick on 0, 3 (overdrive), 6, 8, 10
      const kickHit =
        step === 0 ||
        step === 6 ||
        step === 10 ||
        (step === 8 && !isChill) ||
        (step === 3 && isOverdrive);
      if (kickHit) {
        const kick = audioCtx.createOscillator();
        const kEnv = audioCtx.createGain();
        kick.type = 'sine';
        kick.frequency.setValueAtTime(150, now);
        kick.frequency.exponentialRampToValueAtTime(42, now + 0.11);
        kEnv.gain.setValueAtTime(0.3, now);
        kEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        kick.connect(kEnv);
        kEnv.connect(masterGain);
        kick.start(now);
        kick.stop(now + 0.16);
      }

      // Snappy Punk Breakbeat Snare on 4, 12 + ghost fill on bar 3 step 14-15
      const snareHit =
        step === 4 || step === 12 || (bar === 3 && (step === 14 || step === 15) && !isChill);
      if (snareHit && noiseBuffer) {
        const snare = audioCtx.createBufferSource();
        snare.buffer = noiseBuffer;
        const bp = audioCtx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1850, now);
        const sEnv = audioCtx.createGain();
        sEnv.gain.setValueAtTime(step === 4 || step === 12 ? 0.21 : 0.12, now);
        sEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        snare.connect(bp);
        bp.connect(sEnv);
        sEnv.connect(masterGain);
        snare.start(now);
        snare.stop(now + 0.11);
      }

      // Fast anime breakbeat hi-hats
      if (noiseBuffer && (isOverdrive || step % 2 === 0 || step === 15)) {
        const hat = audioCtx.createBufferSource();
        hat.buffer = noiseBuffer;
        const hp = audioCtx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(6600, now);
        const hEnv = audioCtx.createGain();
        hEnv.gain.setValueAtTime(step % 4 === 2 ? 0.08 : 0.04, now);
        hEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.036);
        hat.connect(hp);
        hp.connect(hEnv);
        hEnv.connect(masterGain);
        hat.start(now);
        hat.stop(now + 0.04);
      }

      // Crunchy Funky Slap-Bassline
      const bassHz = BASS_PATTERN[step];
      if (bassHz > 0) {
        const bass = audioCtx.createOscillator();
        const bFilter = audioCtx.createBiquadFilter();
        const bEnv = ctxGain(audioCtx);
        bass.type = 'sawtooth';
        bass.frequency.setValueAtTime(bar === 3 && step >= 12 ? bassHz * 1.122 : bassHz, now);
        bFilter.type = 'lowpass';
        bFilter.frequency.setValueAtTime(isOverdrive ? 1450 : 1080, now);
        bFilter.frequency.exponentialRampToValueAtTime(240, now + 0.11);
        bEnv.gain.setValueAtTime(0.16, now);
        bEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        bass.connect(bFilter);
        bFilter.connect(bEnv);
        bEnv.connect(masterGain);
        bass.start(now);
        bass.stop(now + 0.15);
      }

      // Crunchy Anime Synth-Brass Stabs
      const brassNotes = BRASS_RIFF.get(step);
      if (brassNotes && (!isChill || step === 0 || step === 10)) {
        for (const hz of brassNotes) {
          const synth = audioCtx.createOscillator();
          const filter = audioCtx.createBiquadFilter();
          const pEnv = audioCtx.createGain();
          synth.type = isOverdrive ? 'sawtooth' : 'triangle';
          synth.frequency.setValueAtTime(hz, now);
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(2100, now);
          pEnv.gain.setValueAtTime(0.001, now);
          pEnv.gain.linearRampToValueAtTime(isOverdrive ? 0.045 : 0.036, now + 0.012);
          pEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
          synth.connect(filter);
          filter.connect(pEnv);
          pEnv.connect(masterGain);
          synth.start(now);
          synth.stop(now + 0.28);
        }
      }
    }

    function ctxGain(ctx) {
      return ctx.createGain();
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
        case 'slash':
          playSlash(ctx, now);
          break;
        case 'laser':
          playLaser(ctx, now);
          break;
        case 'clash':
          playClash(ctx, now);
          break;
        case 'punch':
          playPunch(ctx, now);
          break;
        case 'dash':
          playDash(ctx, now);
          break;
        case 'ultimate':
          playUltimate(ctx, now);
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
        ambienceAudio.volume = 0.2;
        void ambienceAudio.play().catch(() => {});
      } catch {
        // Ignore audio playback failure
      }
    }

    function restartBeatTimer() {
      if (beatTimer) {
        clearInterval(beatTimer);
        beatTimer = null;
      }
      if (!beatEnabled) return;
      const stepMs = intensityLevel === 'overdrive' ? 108 : intensityLevel === 'chill' ? 132 : 117;
      beatTimer = setInterval(triggerBeatTick, stepMs);
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
      setIntensity(nextLevel) {
        if (nextLevel === 'chill' || nextLevel === 'riot' || nextLevel === 'overdrive') {
          intensityLevel = nextLevel;
          if (beatEnabled) restartBeatTimer();
        }
      },
      getIntensity() {
        return intensityLevel;
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
              restartBeatTimer();
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
