(() => {
  'use strict';

  /**
   * Accessible Live-HTML Manga Visual SFX Badges (never baked into raster art).
   * Renders stylized onomatopoeia cues synced to keyframe beats.
   */
  const SFX_CUES = {
    'ANIM-A-F02': { text: 'ZAP!', tone: 'cyan', pos: 'top-right' },
    'ANIM-A-F03': { text: 'CRACK—!', tone: 'magenta', pos: 'top-right' },
    'ANIM-B-F02': { text: 'FWOOSH!', tone: 'yellow', pos: 'top-left' },
    'ANIM-B-F04': { text: 'ZZZAP!!', tone: 'magenta', pos: 'top-right' },
    'ANIM-B-F05': { text: 'SKRRRT!', tone: 'cyan', pos: 'bottom-left' },
    'ANIM-C-F04': { text: 'HOLD.', tone: 'violet', pos: 'top-right' },
    'ANIM-C-F05': { text: 'TAP.', tone: 'yellow', pos: 'top-left' },
    'ANIM-D-F02': { text: 'CLIP!', tone: 'yellow', pos: 'top-left' },
    'ANIM-D-F04': { text: 'PING...', tone: 'cyan', pos: 'top-right' },
  };

  class MangaVisualSfxLayer {
    constructor(el) {
      this.el = el;
    }

    update(activeFrame, reducedMotion) {
      if (!this.el) return;
      const cue = activeFrame && SFX_CUES[activeFrame.frameId];
      if (!cue) {
        this.el.hidden = true;
        this.el.textContent = '';
        return;
      }
      this.el.hidden = false;
      this.el.textContent = cue.text;
      this.el.dataset.tone = cue.tone;
      this.el.dataset.pos = cue.pos;
      if (!reducedMotion) {
        this.el.classList.remove('sfx-pop');
        void this.el.offsetWidth;
        this.el.classList.add('sfx-pop');
      }
    }
  }

  window.MangaVisualSfxLayer = MangaVisualSfxLayer;
})();
