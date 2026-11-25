(() => {
  'use strict';

  /**
   * Toggleable Director's Commentary Overlay for the 16:9 Comic Stage.
   * Displays live animation principles, virtual camera transform vector,
   * shot scale, and narrative World Rule anchor without baking text into artwork.
   */
  class DirectorCommentaryOverlay {
    constructor(containerEl) {
      this.el = containerEl;
      this.enabled = false;
    }

    setEnabled(flag) {
      this.enabled = Boolean(flag);
      if (this.el) this.el.hidden = !this.enabled;
    }

    update(panel, activeFrame) {
      if (!this.el) return;
      if (!this.enabled || !panel) {
        this.el.hidden = true;
        return;
      }
      this.el.hidden = false;
      const principles =
        (activeFrame && Array.isArray(activeFrame.principles) && activeFrame.principles.length > 0
          ? activeFrame.principles
          : panel.comicGrammar) || [];
      const cam = (activeFrame && activeFrame.camera) || { scale: 1, x: 0, y: 0, rotate: 0, fx: 'none' };
      const chips = principles.map((p) => `<span class="dir-chip">${p}</span>`).join('');
      this.el.innerHTML = `
        <div class="dir-head">DIRECTOR MODE · ${panel.panelId} (${panel.sceneId || ''})</div>
        <div class="dir-chips">${chips}</div>
        <div class="dir-meta">CAM: scale=${cam.scale ?? 1} x=${cam.x ?? 0} y=${cam.y ?? 0} rot=${cam.rotate ?? 0}° · FX=${cam.fx || panel.fx || 'none'}</div>
        <div class="dir-purpose">${panel.narrativePurpose || ''}</div>
      `;
    }
  }

  window.DirectorCommentaryOverlay = DirectorCommentaryOverlay;
})();
