export type ObservatorySfxName =
  | 'boing'
  | 'pop'
  | 'whoosh'
  | 'zap'
  | 'slash'
  | 'laser'
  | 'clash'
  | 'punch'
  | 'dash'
  | 'ultimate'
  | 'spawn'
  | 'bonk'
  | 'levelup'
  | 'camera'
  | 'click';

export type ObservatoryIntensityLevel = 'chill' | 'riot' | 'overdrive';

export interface ObservatorySfxEngine {
  unlock(): Promise<boolean>;
  play(name: ObservatorySfxName): void;
  setSfxEnabled(next: boolean): void;
  setBeatEnabled(next: boolean): void;
  setIntensity(next: ObservatoryIntensityLevel): void;
  destroy(): void;
}

const BASS_PATTERN = [
  110, 0, 110, 130.81, 0, 146.83, 164.81, 146.83, 110, 0, 196, 164.81, 146.83, 0, 130.81, 98,
];
const BRASS_RIFF = new Map<number, readonly number[]>([
  [0, [220, 329.63, 440]],
  [3, [261.63, 392, 523.25]],
  [6, [293.66, 440, 587.33]],
  [10, [196, 293.66, 392]],
  [14, [246.94, 369.99, 493.88]],
]);

export function createObservatorySfxEngine(): ObservatorySfxEngine {
  let audioCtx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let sfxEnabled = false;
  let beatEnabled = false;
  let intensityLevel: ObservatoryIntensityLevel = 'riot';
  let beatTimer: ReturnType<typeof setInterval> | null = null;
  let beatStep = 0;

  function createNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.6);
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

  function ensureContext(): AudioContext | null {
    if (audioCtx) return audioCtx;
    if (typeof window === 'undefined') return null;
    const ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctor) return null;
    audioCtx = new ctor();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.45;
    masterGain.connect(audioCtx.destination);
    noiseBuffer = createNoise(audioCtx);
    return audioCtx;
  }

  async function unlock(): Promise<boolean> {
    const ctx = ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    return ctx.state === 'running';
  }

  function playTone(
    ctx: AudioContext,
    type: OscillatorType,
    startHz: number,
    endHz: number,
    durationSec: number,
    peakGain: number,
    delaySec = 0
  ): void {
    if (!masterGain) return;
    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), now + durationSec);
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + Math.min(0.014, durationSec * 0.2));
    env.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    osc.connect(env);
    env.connect(masterGain);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  function playNoiseBurst(
    ctx: AudioContext,
    filterType: BiquadFilterType,
    startHz: number,
    endHz: number,
    durationSec: number,
    peakGain: number,
    delaySec = 0
  ): void {
    if (!masterGain || !noiseBuffer) return;
    const now = ctx.currentTime + delaySec;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(startHz, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endHz), now + durationSec);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    src.connect(filter);
    filter.connect(env);
    env.connect(masterGain);
    src.start(now);
    src.stop(now + durationSec + 0.02);
  }

  function triggerBeatTick(): void {
    if (!beatEnabled || !audioCtx || audioCtx.state !== 'running') return;
    const step = beatStep % 16;
    const bar = Math.floor(beatStep / 16) % 4;
    beatStep += 1;

    const isOverdrive = intensityLevel === 'overdrive';
    const isChill = intensityLevel === 'chill';

    if (
      step === 0 ||
      step === 6 ||
      step === 10 ||
      (step === 8 && !isChill) ||
      (step === 3 && isOverdrive)
    ) {
      playTone(audioCtx, 'sine', 150, 42, 0.14, 0.28);
    }
    if (step === 4 || step === 12 || (bar === 3 && (step === 14 || step === 15) && !isChill)) {
      playNoiseBurst(audioCtx, 'bandpass', 1850, 1200, 0.09, step === 4 || step === 12 ? 0.18 : 0.1);
    }
    if (isOverdrive || step % 2 === 0 || step === 15) {
      playNoiseBurst(audioCtx, 'highpass', 6600, 6600, 0.036, step % 4 === 2 ? 0.07 : 0.035);
    }
    const bassHz = BASS_PATTERN[step] ?? 0;
    if (bassHz > 0) {
      const freq = bar === 3 && step >= 12 ? bassHz * 1.122 : bassHz;
      playTone(audioCtx, 'sawtooth', freq, freq * 0.98, 0.13, 0.12);
    }
    const brassNotes = BRASS_RIFF.get(step);
    if (brassNotes && (!isChill || step === 0 || step === 10)) {
      for (const hz of brassNotes) {
        playTone(audioCtx, isOverdrive ? 'sawtooth' : 'triangle', hz, hz, 0.22, 0.035);
      }
    }
  }

  function restartBeatTimer(): void {
    if (beatTimer) {
      clearInterval(beatTimer);
      beatTimer = null;
    }
    if (!beatEnabled) return;
    const stepMs = intensityLevel === 'overdrive' ? 108 : intensityLevel === 'chill' ? 132 : 117;
    beatTimer = setInterval(triggerBeatTick, stepMs);
  }

  function play(name: ObservatorySfxName): void {
    if (!sfxEnabled) return;
    const ctx = ensureContext();
    if (!ctx || ctx.state !== 'running') return;

    switch (name) {
      case 'boing':
        playTone(ctx, 'triangle', 165, 520, 0.28, 0.28);
        break;
      case 'pop':
        playTone(ctx, 'sine', 780, 210, 0.07, 0.24);
        break;
      case 'whoosh':
        playNoiseBurst(ctx, 'bandpass', 320, 2600, 0.24, 0.26);
        break;
      case 'zap':
        playTone(ctx, 'sawtooth', 980, 210, 0.13, 0.16);
        break;
      case 'slash':
        playNoiseBurst(ctx, 'bandpass', 3600, 950, 0.15, 0.25);
        playTone(ctx, 'triangle', 2400, 780, 0.14, 0.14);
        break;
      case 'laser':
        playTone(ctx, 'sawtooth', 1380, 220, 0.22, 0.15);
        break;
      case 'clash':
        playTone(ctx, 'square', 1180, 980, 0.18, 0.08);
        playTone(ctx, 'square', 2340, 1980, 0.18, 0.07);
        playTone(ctx, 'sine', 260, 44, 0.16, 0.32);
        break;
      case 'punch':
        playTone(ctx, 'sine', 280, 44, 0.15, 0.34);
        playNoiseBurst(ctx, 'bandpass', 1400, 900, 0.08, 0.24);
        break;
      case 'dash':
        playTone(ctx, 'triangle', 260, 1240, 0.1, 0.16);
        break;
      case 'ultimate':
        playTone(ctx, 'sawtooth', 180, 1480, 0.22, 0.16);
        playTone(ctx, 'sine', 280, 44, 0.2, 0.35, 0.2);
        [220, 329.63, 440, 587.33, 659.25].forEach((hz, idx) => {
          playTone(ctx, 'sawtooth', hz, hz, 0.45, 0.08, 0.24 + idx * 0.025);
        });
        break;
      case 'spawn':
        [523.25, 659.25, 783.99, 1046.5].forEach((hz, idx) => {
          playTone(ctx, idx % 2 === 0 ? 'square' : 'triangle', hz, hz, 0.14, 0.11, idx * 0.042);
        });
        break;
      case 'bonk':
        playTone(ctx, 'triangle', 320, 90, 0.2, 0.32);
        playTone(ctx, 'sawtooth', 980, 240, 0.16, 0.12, 0.06);
        break;
      case 'levelup':
        [523.25, 659.25, 783.99, 987.77, 1046.5].forEach((hz, idx) => {
          playTone(ctx, 'sawtooth', hz, hz, 0.36, 0.1, idx * 0.048);
        });
        break;
      case 'camera':
        playNoiseBurst(ctx, 'highpass', 1600, 1600, 0.08, 0.22);
        break;
      default:
        playTone(ctx, 'square', 640, 920, 0.036, 0.1);
        break;
    }
  }

  return {
    unlock,
    play,
    setSfxEnabled(next) {
      sfxEnabled = Boolean(next);
      if (sfxEnabled) void unlock();
    },
    setBeatEnabled(next) {
      beatEnabled = Boolean(next);
      if (beatEnabled) {
        void unlock().then((ready) => {
          if (ready && beatEnabled) restartBeatTimer();
        });
      } else if (beatTimer) {
        clearInterval(beatTimer);
        beatTimer = null;
      }
    },
    setIntensity(next) {
      intensityLevel = next;
      if (beatEnabled) restartBeatTimer();
    },
    destroy() {
      if (beatTimer) clearInterval(beatTimer);
      beatTimer = null;
      if (audioCtx) void audioCtx.close().catch(() => {});
      audioCtx = null;
    },
  };
}
