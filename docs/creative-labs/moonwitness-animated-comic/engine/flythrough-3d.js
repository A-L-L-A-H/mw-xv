/* global window, document */
/**
 * MW-XV 3D Page Fly-Through Camera Engine
 * Zero-dependency CSS 3D perspective stage with automatic prefers-reduced-motion fallback.
 */
(function initFlythrough3D() {
  const state = {
    enabled: false,
    reducedMotion: false,
    tiltX: 0,
    tiltY: 0,
  };

  function isReducedMotion() {
    return Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function applyTransform(stageEl, panelIndex = 0) {
    if (!stageEl) return;
    if (!state.enabled || isReducedMotion()) {
      stageEl.style.transform = '';
      stageEl.classList.remove('mw-flythrough-active');
      return;
    }
    stageEl.classList.add('mw-flythrough-active');
    const angleY = ((panelIndex % 2 === 0 ? -1 : 1) * 4.5 + state.tiltY).toFixed(2);
    const angleX = (1.5 + state.tiltX).toFixed(2);
    stageEl.style.transform = `perspective(1200px) rotateX(${angleX}deg) rotateY(${angleY}deg) translateZ(14px)`;
  }

  function setEnabled(next, stageEl, panelIndex = 0) {
    state.enabled = Boolean(next) && !isReducedMotion();
    state.reducedMotion = isReducedMotion();
    applyTransform(stageEl, panelIndex);
    return state.enabled;
  }

  function bindPointer(stageEl, getPanelIndex) {
    if (!stageEl) return;
    stageEl.addEventListener('pointermove', (ev) => {
      if (!state.enabled || isReducedMotion()) return;
      const rect = stageEl.getBoundingClientRect();
      const nx = (ev.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
      const ny = (ev.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
      state.tiltY = nx * 6;
      state.tiltX = -ny * 4;
      applyTransform(stageEl, typeof getPanelIndex === 'function' ? getPanelIndex() : 0);
    });
    stageEl.addEventListener('pointerleave', () => {
      state.tiltX = 0;
      state.tiltY = 0;
      applyTransform(stageEl, typeof getPanelIndex === 'function' ? getPanelIndex() : 0);
    });
  }

  window.MWFlythrough3D = {
    setEnabled,
    applyTransform,
    bindPointer,
    isEnabled: () => state.enabled,
  };
})();
