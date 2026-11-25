(() => {
  'use strict';

  /**
   * Lightweight 60fps HTML5 Canvas secondary-motion overlay for EP-LAB-01.
   * Keeps every held comic keyframe alive with scene-matched atmospheric FX
   * (night mist/stars, antenna sparks, parkour speed sparks, warm lamp dust,
   * and concentric rooftop radio pulses) while respecting reduced-motion and pause.
   */
  class LiveComicCanvasFx {
    constructor(canvasEl) {
      this.canvas = canvasEl;
      this.ctx = canvasEl ? canvasEl.getContext('2d') : null;
      this.mode = 'night';
      this.enabled = true;
      this.rafId = null;
      this.startTime = performance.now();
      this.particles = Array.from({ length: 28 }, (_, i) => ({
        x: ((i * 73) % 960) / 960,
        y: ((i * 41) % 540) / 540,
        r: 1.1 + (i % 3) * 0.8,
        vx: 0.004 + (i % 5) * 0.0025,
        vy: -0.002 - (i % 4) * 0.0015,
        phase: i * 0.7,
      }));
    }

    setMode(mode) {
      this.mode = mode || 'night';
    }

    setEnabled(flag) {
      this.enabled = Boolean(flag);
      if (!this.enabled) {
        this.stop();
        this.clear();
      } else {
        this.start();
      }
    }

    clear() {
      if (!this.ctx || !this.canvas) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    start() {
      if (!this.ctx || !this.enabled || this.rafId !== null) return;
      const tick = (now) => {
        if (!this.enabled) {
          this.rafId = null;
          return;
        }
        this.draw((now - this.startTime) / 1000);
        this.rafId = window.requestAnimationFrame(tick);
      };
      this.rafId = window.requestAnimationFrame(tick);
    }

    stop() {
      if (this.rafId !== null) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    draw(t) {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (this.mode === 'night') {
        // Subtle Moon City drifting night motes & star twinkle
        for (const p of this.particles) {
          const x = ((p.x + t * p.vx) % 1) * w;
          const y = ((p.y + t * p.vy + 1) % 1) * h;
          const alpha = 0.14 + 0.16 * Math.sin(t * 2.1 + p.phase);
          ctx.fillStyle = `rgba(243, 239, 228, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (this.mode === 'signal') {
        // Electric cyan/yellow radio interference rings & sparks
        const pulse = (t * 0.9) % 1;
        const cx = w * 0.68;
        const cy = h * 0.32;
        ctx.strokeStyle = `rgba(0, 229, 255, ${(0.32 * (1 - pulse)).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 18 + pulse * 130, 0, Math.PI * 2);
        ctx.stroke();

        for (let i = 0; i < 8; i += 1) {
          const p = this.particles[i];
          const x = ((p.x + t * 0.04) % 1) * w;
          const y = p.y * h * 0.7;
          const a = 0.25 + 0.25 * Math.sin(t * 9 + p.phase);
          ctx.fillStyle = i % 2 === 0 ? `rgba(0, 229, 255, ${a.toFixed(3)})` : `rgba(255, 224, 49, ${a.toFixed(3)})`;
          ctx.fillRect(x, y, 4, 2);
        }
      } else if (this.mode === 'action') {
        // Kinetic neon speed sparks left-to-right
        for (let i = 0; i < 16; i += 1) {
          const p = this.particles[i];
          const x = ((p.x + t * (0.45 + (i % 3) * 0.18)) % 1) * w;
          const y = p.y * h;
          ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 46, 136, 0.28)' : 'rgba(0, 229, 255, 0.28)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 36, y);
          ctx.stroke();
        }
      } else if (this.mode === 'archive') {
        // Warm amber desk-lamp dust motes + subtle CRT cyan scanline shimmer
        for (let i = 0; i < 18; i += 1) {
          const p = this.particles[i];
          const x = ((p.x + t * p.vx * 0.4) % 1) * w;
          const y = ((p.y + Math.sin(t * 0.7 + p.phase) * 0.02 + 1) % 1) * h;
          const alpha = 0.12 + 0.14 * Math.sin(t * 1.6 + p.phase);
          ctx.fillStyle = x < w * 0.38
            ? `rgba(0, 184, 240, ${alpha.toFixed(3)})`
            : `rgba(255, 224, 49, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(x, y, p.r * 1.15, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (this.mode === 'relay') {
        // Poetic slow concentric rooftop radio rings
        for (let ring = 0; ring < 2; ring += 1) {
          const p = (t * 0.42 + ring * 0.5) % 1;
          ctx.strokeStyle = `rgba(0, 229, 255, ${(0.36 * (1 - p)).toFixed(3)})`;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(w * 0.36, h * 0.48, 34 + p * 210, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  window.LiveComicCanvasFx = LiveComicCanvasFx;
})();
