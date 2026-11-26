(() => {
  'use strict';

  /**
   * 2.5D Perspective Pointer & Timeline Parallax Rig.
   * Drives subtle hardware-accelerated depth shift on desktop pointer movement
   * while respecting Reduced Motion, Static mode, and Save-Data preferences.
   */
  class ParallaxStageRig {
    constructor(stageEl, cameraEl) {
      this.stage = stageEl;
      this.camera = cameraEl;
      this.enabled = true;
      this.baseTransform = { scale: 1, x: 0, y: 0, rotate: 0 };
      this.pointerX = 0;
      this.pointerY = 0;
      this.boundMove = this.onPointerMove.bind(this);
      this.boundLeave = this.onPointerLeave.bind(this);
      if (this.stage) {
        this.stage.addEventListener('pointermove', this.boundMove, { passive: true });
        this.stage.addEventListener('pointerleave', this.boundLeave, { passive: true });
      }
    }

    setEnabled(flag) {
      this.enabled = Boolean(flag);
      if (!this.enabled) {
        this.pointerX = 0;
        this.pointerY = 0;
        if (this.camera) this.camera.style.transform = 'none';
      } else {
        this.apply();
      }
    }

    setBaseTransform(cam) {
      this.baseTransform = {
        scale: typeof cam?.scale === 'number' ? cam.scale : 1,
        x: typeof cam?.x === 'number' ? cam.x : 0,
        y: typeof cam?.y === 'number' ? cam.y : 0,
        rotate: typeof cam?.rotate === 'number' ? cam.rotate : 0,
      };
      this.apply();
    }

    onPointerMove(e) {
      if (!this.enabled || !this.stage) return;
      const rect = this.stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      this.pointerX = Math.max(-1, Math.min(1, nx));
      this.pointerY = Math.max(-1, Math.min(1, ny));
      this.apply();
    }

    onPointerLeave() {
      this.pointerX = 0;
      this.pointerY = 0;
      this.apply();
    }

    apply() {
      if (!this.camera) return;
      if (!this.enabled) {
        this.camera.style.transform = 'none';
        return;
      }
      const { scale, x, y, rotate } = this.baseTransform;
      const px = (x - this.pointerX * 8).toFixed(1);
      const py = (y - this.pointerY * 5).toFixed(1);
      const effScale = Math.max(scale, this.pointerX !== 0 || this.pointerY !== 0 ? 1.03 : scale);
      this.camera.style.transform = `translate3d(${px}px, ${py}px, 0) scale(${effScale}) rotate(${rotate}deg)`;
    }
  }

  window.ParallaxStageRig = ParallaxStageRig;
})();
