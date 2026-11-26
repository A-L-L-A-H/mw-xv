(() => {
  'use strict';

  /**
   * 100% procedural WebAudio foley synthesizer for EP-LAB-01.
   * Mute-by-default (zero autoplay, zero external/copyrighted audio assets).
   * Activates ONLY after explicit user click on the Sound toggle.
   */
  class ComicFoleySynth {
    constructor() {
      this.ctx = null;
      this.enabled = false;
    }

    setEnabled(flag) {
      this.enabled = Boolean(flag);
      if (this.enabled) {
        if (!this.ctx) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) this.ctx = new AudioCtx();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
      } else if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    }

    playCue(cueName) {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;

      if (cueName === 'signal-spark') {
        this.tone(880, 1420, 0.14, 'triangle', 0.08, now);
        this.tone(1320, 660, 0.11, 'sine', 0.05, now + 0.07);
      } else if (cueName === 'courier-whoosh') {
        this.noiseBurst(0.18, 900, 0.09, now);
        this.tone(240, 110, 0.16, 'sawtooth', 0.04, now);
      } else if (cueName === 'stylus-tap') {
        this.tone(1680, 1100, 0.045, 'sine', 0.06, now);
      } else if (cueName === 'clip-seal') {
        this.tone(520, 780, 0.05, 'triangle', 0.07, now);
        this.tone(940, 1180, 0.06, 'sine', 0.05, now + 0.045);
      } else if (cueName === 'relay-ping') {
        this.tone(528, 528, 0.42, 'sine', 0.07, now);
        this.tone(792, 792, 0.34, 'sine', 0.04, now + 0.08);
      } else {
        // Subtle editorial page-cut tick
        this.tone(420, 320, 0.04, 'triangle', 0.035, now);
      }
    }

    tone(startFreq, endFreq, dur, type, gainPeak, startTime) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, startTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), startTime + dur);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + dur + 0.02);
    }

    noiseBurst(dur, cutoffHz, gainPeak, startTime) {
      const sampleRate = this.ctx.sampleRate;
      const length = Math.floor(sampleRate * dur);
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(cutoffHz, startTime);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(gainPeak, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(startTime);
    }
  }

  window.ComicFoleySynth = ComicFoleySynth;
})();
