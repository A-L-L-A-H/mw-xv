/* global document, window, localStorage, history, PerformanceObserver, MutationObserver, ResizeObserver, HTMLElement, HTMLImageElement, HTMLCanvasElement, CanvasRenderingContext2D, AudioContext */

(() => {
  'use strict';

  const FX_CLASSES = [
    'fx-ink-wipe',
    'fx-chromatic-hit',
    'fx-chromatic-smear',
    'fx-impact-jolt',
    'fx-spark-hit',
    'fx-night-haze',
    'fx-pulse-glow',
  ];

  const state = {
    storyboard: null,
    candidate: null,
    clips: new Map(),
    preloadedUrls: new Set(),
    panelIndex: 0,
    frameIndex: 0,
    isPlaying: false,
    speed: 1.0,
    scope: 'EP-LAB-01',
    viewMode: 'stage', // 'stage' | 'static'
    reducedMotion: false,
    soundEnabled: false,
    drawerOpen: false,
    timerId: null,
  };

  const liveCanvasFx =
    typeof window.LiveComicCanvasFx === 'function'
      ? new window.LiveComicCanvasFx(document.getElementById('stage-live-fx'))
      : null;
  const foleySynth =
    typeof window.ComicFoleySynth === 'function' ? new window.ComicFoleySynth() : null;

  const els = {
    announcer: document.getElementById('status-announcer'),
    episodeTitle: document.getElementById('episode-title'),
    btnModeStage: document.getElementById('btn-mode-stage'),
    btnModeStatic: document.getElementById('btn-mode-static'),
    btnReducedMotion: document.getElementById('btn-reduced-motion'),
    btnSoundToggle: document.getElementById('btn-sound-toggle'),
    btnSourcesDrawer: document.getElementById('btn-sources-drawer'),
    btnCloseDrawer: document.getElementById('btn-close-drawer'),
    sourcesDrawer: document.getElementById('sources-drawer'),
    candidateInfo: document.getElementById('candidate-info'),
    theaterView: document.getElementById('theater-view'),
    staticGridView: document.getElementById('static-grid-view'),
    staticGridContainer: document.getElementById('static-grid-container'),
    comicStage: document.getElementById('comic-stage'),
    stageCamera: document.getElementById('stage-camera'),
    stageBackdrops: document.getElementById('stage-backdrops'),
    stageFrameImg: document.getElementById('stage-frame-img'),
    stageForegroundImg: document.getElementById('stage-foreground-img'),
    stageInsetCard: document.getElementById('stage-inset-card'),
    stageInsetLabel: document.getElementById('stage-inset-label'),
    stageInsetImg: document.getElementById('stage-inset-img'),
    stageTimelineBar: document.getElementById('stage-timeline-bar'),
    stageTimelineFill: document.getElementById('stage-timeline-fill'),
    metaPanelId: document.getElementById('meta-panel-id'),
    metaBeatId: document.getElementById('meta-beat-id'),
    metaFrameCounter: document.getElementById('meta-frame-counter'),
    metaShotType: document.getElementById('meta-shot-type'),
    metaTimecode: document.getElementById('meta-timecode'),
    metaPlaybackState: document.getElementById('meta-playback-state'),
    speechBubbleWrap: document.getElementById('speech-bubble-wrap'),
    captionSpeaker: document.getElementById('caption-speaker'),
    captionDialogue: document.getElementById('caption-dialogue'),
    captionText: document.getElementById('caption-text'),
    actingNoteText: document.getElementById('acting-note-text'),
    btnPlay: document.getElementById('btn-play'),
    btnPause: document.getElementById('btn-pause'),
    btnReplay: document.getElementById('btn-replay'),
    btnPrevFrame: document.getElementById('btn-prev-frame'),
    btnNextFrame: document.getElementById('btn-next-frame'),
    btnPrevPanel: document.getElementById('btn-prev-panel'),
    btnNextPanel: document.getElementById('btn-next-panel'),
    btnSpeedNormal: document.getElementById('btn-speed-normal'),
    btnSpeedSlow: document.getElementById('btn-speed-slow'),
    scopeSelect: document.getElementById('scope-select'),
    panelFilmstrip: document.getElementById('panel-filmstrip'),
  };

  function announce(message) {
    if (!els.announcer) return;
    els.announcer.textContent = '';
    window.requestAnimationFrame(() => {
      els.announcer.textContent = message;
    });
  }

  function resolveAssetPath(assetPath, clipPath) {
    if (!assetPath) return '';
    if (
      assetPath.startsWith('./') ||
      assetPath.startsWith('../') ||
      assetPath.startsWith('/') ||
      assetPath.startsWith('http://') ||
      assetPath.startsWith('https://') ||
      assetPath.startsWith('animations/') ||
      assetPath.startsWith('assets/') ||
      assetPath.startsWith('data/')
    ) {
      return assetPath;
    }
    if (clipPath) {
      const baseDir = clipPath.substring(0, clipPath.lastIndexOf('/') + 1);
      return baseDir + assetPath;
    }
    return assetPath;
  }

  async function loadClip(clipPath) {
    if (!clipPath) return null;
    if (state.clips.has(clipPath)) {
      return state.clips.get(clipPath);
    }
    const bundle = window.__MW_COMIC_LAB_BUNDLE__;
    if (window.location.protocol === 'file:' && bundle && bundle.clips && bundle.clips[clipPath]) {
      state.clips.set(clipPath, bundle.clips[clipPath]);
      return bundle.clips[clipPath];
    }
    try {
      const response = await fetch(clipPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const clipData = await response.json();
      state.clips.set(clipPath, clipData);
      return clipData;
    } catch {
      if (bundle && bundle.clips && bundle.clips[clipPath]) {
        state.clips.set(clipPath, bundle.clips[clipPath]);
        return bundle.clips[clipPath];
      }
      return null;
    }
  }

  function getPanelsInScope() {
    if (!state.storyboard || !Array.isArray(state.storyboard.panels)) return [];
    if (state.scope === 'EP-LAB-01') {
      return state.storyboard.panels;
    }
    const filtered = state.storyboard.panels.filter((p) => p.beatId === state.scope);
    return filtered.length > 0 ? filtered : state.storyboard.panels;
  }

  function getCurrentPanel() {
    const panels = getPanelsInScope();
    if (panels.length === 0) return null;
    const safeIdx = Math.max(0, Math.min(state.panelIndex, panels.length - 1));
    state.panelIndex = safeIdx;
    return panels[safeIdx];
  }

  function getFramesForPanel(panel, clip) {
    if (!panel) return [];
    if (state.reducedMotion) {
      const reducedAsset =
        resolveAssetPath(panel.staticFallbackAsset, panel.clipPath) ||
        (clip && clip.reducedMotionAlternative && clip.reducedMotionAlternative.asset
          ? resolveAssetPath(clip.reducedMotionAlternative.asset, panel.clipPath)
          : '');
      return [
        {
          frameId: 'REDUCED-STATIC',
          asset: reducedAsset,
          durationMs: panel.timingMs || 1800,
          poseLabel: 'Reduced-motion static frame',
          actingNote: panel.reducedMotionNote || panel.actingIntent || '',
          camera: { scale: 1, x: 0, y: 0, rotate: 0, fx: 'none' },
        },
      ];
    }

    if (clip && Array.isArray(clip.frames) && clip.frames.length > 0) {
      let selectedFrames = clip.frames;
      if (Array.isArray(panel.clipFrameIndices) && panel.clipFrameIndices.length > 0) {
        const mapped = panel.clipFrameIndices
          .map((idx) => clip.frames[idx])
          .filter(Boolean);
        if (mapped.length > 0) {
          selectedFrames = mapped;
        }
      }
      return selectedFrames.map((f) => ({
        ...f,
        asset: resolveAssetPath(f.asset, panel.clipPath),
      }));
    }

    return [
      {
        frameId: 'STATIC-01',
        asset: resolveAssetPath(panel.staticFallbackAsset, panel.clipPath),
        durationMs: panel.timingMs || 1800,
        poseLabel: panel.shotType || 'Static frame',
        actingNote: panel.actingIntent || '',
        camera: {
          scale: panel.panelId === 'P01' ? 1.035 : 1.0,
          x: 0,
          y: 0,
          rotate: 0,
          fx: panel.fx || 'none',
        },
      },
    ];
  }

  function preloadUrl(url) {
    if (!url || state.preloadedUrls.has(url)) return;
    state.preloadedUrls.add(url);
    const img = new Image();
    img.src = url;
  }

  async function preloadCurrentAndNext(panels, currentIdx) {
    const indices = [currentIdx, currentIdx + 1].filter((i) => i >= 0 && i < panels.length);
    for (const idx of indices) {
      const panel = panels[idx];
      const clip = panel.clipPath ? await loadClip(panel.clipPath) : null;
      const frames = getFramesForPanel(panel, clip);
      frames.forEach((f) => preloadUrl(f.asset));
      if (panel.foregroundAsset) {
        preloadUrl(resolveAssetPath(panel.foregroundAsset, panel.clipPath));
      }
      if (panel.insetAsset) {
        preloadUrl(resolveAssetPath(panel.insetAsset, panel.clipPath));
      }
    }
  }

  function clearPlaybackTimer() {
    if (state.timerId !== null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }

  function pausePlayback(reason) {
    clearPlaybackTimer();
    if (state.isPlaying) {
      state.isPlaying = false;
      updatePlaybackUi();
      if (reason) announce(reason);
    }
  }

  function updatePlaybackUi() {
    const label = state.isPlaying
      ? state.speed < 1
        ? 'PLAYING 0.45x'
        : 'PLAYING 1.0x'
      : 'PAUSED';
    els.metaPlaybackState.textContent = label;
    els.btnPlay.setAttribute('aria-pressed', String(state.isPlaying));
    els.btnPause.setAttribute('aria-pressed', String(!state.isPlaying));
  }

  function syncLiveCanvasMode(panel) {
    if (!liveCanvasFx) return;
    if (state.reducedMotion || state.viewMode === 'static' || document.hidden) {
      liveCanvasFx.setEnabled(false);
      return;
    }
    const beat = panel && panel.beatId;
    if (beat === 'ANIM-A') liveCanvasFx.setMode('signal');
    else if (beat === 'ANIM-B') liveCanvasFx.setMode('action');
    else if (beat === 'ANIM-C') liveCanvasFx.setMode('archive');
    else if (beat === 'ANIM-D' && (panel.panelId === 'P11' || panel.panelId === 'P12')) liveCanvasFx.setMode('relay');
    else if (beat === 'ANIM-D') liveCanvasFx.setMode('archive');
    else liveCanvasFx.setMode('night');
    liveCanvasFx.setEnabled(true);
  }

  function triggerFoleyForPanel(panel, frameIdx) {
    if (!foleySynth || !state.soundEnabled || !panel) return;
    if (panel.beatId === 'ANIM-A' && frameIdx <= 1) foleySynth.playCue('signal-spark');
    else if (panel.beatId === 'ANIM-B' && frameIdx === 0) foleySynth.playCue('courier-whoosh');
    else if (panel.beatId === 'ANIM-C' && frameIdx === 0) foleySynth.playCue('stylus-tap');
    else if (panel.panelId === 'P10' && frameIdx === 0) foleySynth.playCue('clip-seal');
    else if (panel.panelId === 'P11' && frameIdx === 0) foleySynth.playCue('relay-ping');
    else if (frameIdx === 0) foleySynth.playCue('page-cut');
  }

  function setSoundEnabled(enabled) {
    state.soundEnabled = Boolean(enabled);
    if (foleySynth) foleySynth.setEnabled(state.soundEnabled);
    if (els.btnSoundToggle) {
      els.btnSoundToggle.textContent = state.soundEnabled ? 'Sound: ON' : 'Sound: OFF';
      els.btnSoundToggle.setAttribute('aria-pressed', String(state.soundEnabled));
      els.btnSoundToggle.classList.toggle('is-active', state.soundEnabled);
    }
    announce(state.soundEnabled ? 'Procedural comic foley sound enabled.' : 'Sound muted.');
  }

  function applyCameraAndFx(panel, activeFrame, withTransition) {
    FX_CLASSES.forEach((cls) => els.comicStage.classList.remove(cls));

    if (state.reducedMotion || state.viewMode === 'static') {
      els.stageCamera.style.transform = 'none';
      return;
    }

    const cam = (activeFrame && activeFrame.camera) || { scale: 1, x: 0, y: 0, rotate: 0, fx: 'none' };
    const scale = typeof cam.scale === 'number' ? cam.scale : 1;
    const x = typeof cam.x === 'number' ? cam.x : 0;
    const y = typeof cam.y === 'number' ? cam.y : 0;
    const rotate = typeof cam.rotate === 'number' ? cam.rotate : 0;
    els.stageCamera.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotate(${rotate}deg)`;

    const frameFx = cam.fx && cam.fx !== 'none' ? cam.fx : panel.fx || 'none';
    void els.comicStage.offsetWidth;

    if (withTransition) {
      els.comicStage.classList.add('fx-ink-wipe');
    }
    if (frameFx === 'chromatic-hit') {
      els.comicStage.classList.add('fx-chromatic-hit');
    } else if (frameFx === 'chromatic-smear') {
      els.comicStage.classList.add('fx-chromatic-smear');
    } else if (frameFx === 'impact-jolt') {
      els.comicStage.classList.add('fx-impact-jolt');
    } else if (frameFx === 'spark-hit') {
      els.comicStage.classList.add('fx-spark-hit');
    } else if (frameFx === 'night-haze') {
      els.comicStage.classList.add('fx-night-haze');
    } else if (frameFx === 'pulse-glow') {
      els.comicStage.classList.add('fx-pulse-glow');
    }
  }

  function updateTimelineProgress(panels, panelIdx, frameIdx, totalFramesInPanel) {
    if (!panels.length) return;
    const totalMs = panels.reduce((sum, p) => sum + (p.timingMs || 1000), 0);
    let elapsedMs = 0;
    for (let i = 0; i < panelIdx; i += 1) {
      elapsedMs += panels[i].timingMs || 1000;
    }
    const curMs = panels[panelIdx].timingMs || 1000;
    const frameFrac = totalFramesInPanel > 1 ? frameIdx / totalFramesInPanel : 0;
    const currentMs = elapsedMs + curMs * frameFrac;
    const pct = Math.max(4, Math.min(100, Math.round(((panelIdx + (frameIdx + 1) / Math.max(1, totalFramesInPanel)) / panels.length) * 100)));

    if (els.stageTimelineFill) {
      els.stageTimelineFill.style.width = `${pct}%`;
    }
    if (els.stageTimelineBar) {
      els.stageTimelineBar.setAttribute('aria-valuenow', String(pct));
    }
    if (els.metaTimecode) {
      const curSec = (currentMs / 1000).toFixed(1).padStart(4, '0');
      const totSec = (totalMs / 1000).toFixed(1);
      els.metaTimecode.textContent = `${curSec}s / ${totSec}s`;
    }
  }

  async function renderCurrentFrame(withFx = false) {
    const panels = getPanelsInScope();
    const panel = getCurrentPanel();
    if (!panel) return;

    const clip = panel.clipPath ? await loadClip(panel.clipPath) : null;
    const frames = getFramesForPanel(panel, clip);
    const safeFrameIdx = Math.max(0, Math.min(state.frameIndex, frames.length - 1));
    state.frameIndex = safeFrameIdx;
    const activeFrame = frames[safeFrameIdx];

    // Backdrops
    els.stageBackdrops.innerHTML = '';
    if (Array.isArray(panel.backdropLayers)) {
      panel.backdropLayers.forEach((layer) => {
        const src = typeof layer === 'string' ? layer : layer && layer.asset;
        if (!src) return;
        const img = document.createElement('img');
        img.className = 'stage-backdrop-layer';
        img.src = resolveAssetPath(src, panel.clipPath);
        img.alt = '';
        els.stageBackdrops.appendChild(img);
      });
    }

    // Active studio WebP frame
    els.stageFrameImg.src = activeFrame ? activeFrame.asset : '';
    els.stageFrameImg.alt = `${panel.panelId}: ${panel.visualAction || panel.caption || 'Comic panel'}`;

    // Optional vector FX overlay (e.g., speed-lines only on peak action frames in ANIM-B)
    const showSpeedOverlay =
      panel.foregroundAsset &&
      (!state.reducedMotion || panel.foregroundAsset.endsWith('.svg')) &&
      (panel.beatId !== 'ANIM-B' || (safeFrameIdx >= 1 && safeFrameIdx <= 4));

    if (showSpeedOverlay) {
      els.stageForegroundImg.src = resolveAssetPath(panel.foregroundAsset, panel.clipPath);
      els.stageForegroundImg.hidden = false;
    } else {
      els.stageForegroundImg.hidden = true;
      els.stageForegroundImg.removeAttribute('src');
    }

    // Angled Comic Picture-in-Picture Macro Inset (P03 Receiver / P10 Sealed Folio)
    if (panel.insetAsset) {
      els.stageInsetImg.src = resolveAssetPath(panel.insetAsset, panel.clipPath);
      els.stageInsetImg.alt = `${panel.panelId} macro detail: ${panel.insetLabel || 'prop close-up'}`;
      els.stageInsetLabel.textContent = panel.insetLabel || 'MACRO';
      els.stageInsetCard.hidden = false;
    } else {
      els.stageInsetCard.hidden = true;
      els.stageInsetImg.removeAttribute('src');
    }

    applyCameraAndFx(panel, activeFrame, withFx);
    syncLiveCanvasMode(panel);
    if (withFx || state.isPlaying) {
      triggerFoleyForPanel(panel, safeFrameIdx);
    }
    updateTimelineProgress(panels, state.panelIndex, safeFrameIdx, frames.length);

    // Metadata
    els.metaPanelId.textContent = panel.panelId || `P${String(state.panelIndex + 1).padStart(2, '0')}`;
    els.metaBeatId.textContent = panel.beatId || 'ESTABLISHING';
    els.metaFrameCounter.textContent = `Frame ${safeFrameIdx + 1} / ${frames.length}`;
    els.metaShotType.textContent = panel.shotType || 'Panel';

    // Dialogue & Caption
    if (panel.dialogue && panel.dialogue.trim() !== '') {
      const speaker = panel.speaker || 'VOICE';
      els.speechBubbleWrap.hidden = false;
      els.speechBubbleWrap.dataset.speaker = speaker;
      els.captionSpeaker.textContent = speaker;
      els.captionDialogue.textContent = panel.dialogue;
    } else {
      els.speechBubbleWrap.hidden = true;
      els.captionSpeaker.textContent = '';
      els.captionDialogue.textContent = '';
    }

    els.captionText.textContent = panel.caption || panel.visualAction || '';
    const actingNote = (activeFrame && activeFrame.actingNote) || panel.actingIntent || '';
    const poseLabel = activeFrame && activeFrame.poseLabel ? `${activeFrame.poseLabel} — ` : '';
    els.actingNoteText.textContent = `${poseLabel}${actingNote}`.trim();

    updateFilmstripActive(panel.panelId);
    updatePlaybackUi();
    preloadCurrentAndNext(panels, state.panelIndex);
  }

  async function scheduleNextTick() {
    clearPlaybackTimer();
    if (!state.isPlaying || state.viewMode === 'static') return;

    const panels = getPanelsInScope();
    const panel = getCurrentPanel();
    if (!panel) {
      pausePlayback();
      return;
    }

    const clip = panel.clipPath ? await loadClip(panel.clipPath) : null;
    const frames = getFramesForPanel(panel, clip);
    const currentFrame = frames[state.frameIndex] || frames[0];
    const baseMs = (currentFrame && currentFrame.durationMs) || panel.timingMs || 1200;
    const delayMs = Math.max(90, Math.round(baseMs / state.speed));

    state.timerId = window.setTimeout(async () => {
      if (!state.isPlaying) return;

      if (state.frameIndex + 1 < frames.length) {
        state.frameIndex += 1;
        await renderCurrentFrame(false);
        scheduleNextTick();
        return;
      }

      if (state.panelIndex + 1 < panels.length) {
        state.panelIndex += 1;
        state.frameIndex = 0;
        await renderCurrentFrame(true);
        scheduleNextTick();
        return;
      }

      if (state.scope !== 'EP-LAB-01') {
        state.panelIndex = 0;
        state.frameIndex = 0;
        await renderCurrentFrame(true);
        scheduleNextTick();
      } else {
        pausePlayback('Reached end of episode EP-LAB-01.');
      }
    }, delayMs);
  }

  function startPlayback() {
    if (state.viewMode === 'static') {
      setViewMode('stage');
    }
    if (state.isPlaying) return;
    state.isPlaying = true;
    updatePlaybackUi();
    announce('Playback started.');
    scheduleNextTick();
  }

  async function replayFromStart() {
    pausePlayback();
    state.panelIndex = 0;
    state.frameIndex = 0;
    await renderCurrentFrame(true);
    announce('Replayed from start of current scope.');
  }

  async function stepFrame(delta) {
    pausePlayback();
    const panels = getPanelsInScope();
    const panel = getCurrentPanel();
    if (!panel) return;
    const clip = panel.clipPath ? await loadClip(panel.clipPath) : null;
    const frames = getFramesForPanel(panel, clip);

    const nextFrame = state.frameIndex + delta;
    if (nextFrame >= 0 && nextFrame < frames.length) {
      state.frameIndex = nextFrame;
      await renderCurrentFrame(false);
    } else if (delta > 0 && state.panelIndex + 1 < panels.length) {
      state.panelIndex += 1;
      state.frameIndex = 0;
      await renderCurrentFrame(true);
    } else if (delta < 0 && state.panelIndex > 0) {
      state.panelIndex -= 1;
      const prevPanel = panels[state.panelIndex];
      const prevClip = prevPanel.clipPath ? await loadClip(prevPanel.clipPath) : null;
      const prevFrames = getFramesForPanel(prevPanel, prevClip);
      state.frameIndex = Math.max(0, prevFrames.length - 1);
      await renderCurrentFrame(true);
    }
  }

  async function stepPanel(delta) {
    pausePlayback();
    const panels = getPanelsInScope();
    if (panels.length === 0) return;
    const nextIdx = Math.max(0, Math.min(state.panelIndex + delta, panels.length - 1));
    if (nextIdx !== state.panelIndex) {
      state.panelIndex = nextIdx;
      state.frameIndex = 0;
      await renderCurrentFrame(true);
      announce(`Moved to ${panels[nextIdx].panelId}.`);
    }
  }

  function setSpeed(speedValue) {
    state.speed = speedValue;
    els.btnSpeedNormal.classList.toggle('is-active', speedValue === 1.0);
    els.btnSpeedNormal.setAttribute('aria-pressed', String(speedValue === 1.0));
    els.btnSpeedSlow.classList.toggle('is-active', speedValue !== 1.0);
    els.btnSpeedSlow.setAttribute('aria-pressed', String(speedValue !== 1.0));
    updatePlaybackUi();
    if (state.isPlaying) {
      scheduleNextTick();
    }
    announce(`Playback speed set to ${speedValue}x.`);
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    const isStatic = mode === 'static';
    if (isStatic) {
      pausePlayback('Switched to static comic page view. Animation stopped.');
    }
    els.theaterView.hidden = isStatic;
    els.staticGridView.hidden = !isStatic;
    els.btnModeStage.classList.toggle('is-active', !isStatic);
    els.btnModeStage.setAttribute('aria-pressed', String(!isStatic));
    els.btnModeStatic.classList.toggle('is-active', isStatic);
    els.btnModeStatic.setAttribute('aria-pressed', String(isStatic));
  }

  async function setReducedMotion(enabled, silent = false) {
    state.reducedMotion = Boolean(enabled);
    document.documentElement.dataset.reducedMotion = state.reducedMotion ? 'true' : 'false';
    els.btnReducedMotion.textContent = state.reducedMotion ? 'Reduced Motion: ON' : 'Reduced Motion: OFF';
    els.btnReducedMotion.setAttribute('aria-pressed', String(state.reducedMotion));
    els.btnReducedMotion.classList.toggle('is-active', state.reducedMotion);
    state.frameIndex = 0;
    await renderCurrentFrame(false);
    if (!silent) {
      announce(
        state.reducedMotion
          ? 'Reduced-motion preview enabled. Holding static fallback frames.'
          : 'Reduced-motion preview disabled.'
      );
    }
  }

  function setDrawerOpen(open) {
    state.drawerOpen = Boolean(open);
    els.sourcesDrawer.hidden = !state.drawerOpen;
    els.btnSourcesDrawer.setAttribute('aria-expanded', String(state.drawerOpen));
  }

  function buildFilmstrip() {
    if (!state.storyboard || !Array.isArray(state.storyboard.panels)) return;
    els.panelFilmstrip.innerHTML = '';
    state.storyboard.panels.forEach((panel, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filmstrip-item';
      btn.dataset.panelId = panel.panelId;
      btn.setAttribute('role', 'listitem');
      const thumbSrc = resolveAssetPath(panel.staticFallbackAsset, panel.clipPath);
      btn.innerHTML = `
        <div class="filmstrip-thumb-wrap">
          <img class="filmstrip-thumb" src="${thumbSrc}" alt="${panel.panelId} thumbnail" loading="lazy" />
          <span class="filmstrip-badge">${panel.panelId}</span>
        </div>
        <div class="filmstrip-meta">
          <span class="filmstrip-beat">${panel.beatId || 'STATIC'}</span>
          <span class="filmstrip-shot">${panel.shotType || ''}</span>
        </div>
      `;
      btn.addEventListener('click', async () => {
        pausePlayback();
        if (state.scope !== 'EP-LAB-01') {
          state.scope = 'EP-LAB-01';
          els.scopeSelect.value = 'EP-LAB-01';
        }
        state.panelIndex = idx;
        state.frameIndex = 0;
        await renderCurrentFrame(true);
      });
      els.panelFilmstrip.appendChild(btn);
    });
  }

  function updateFilmstripActive(activePanelId) {
    const items = els.panelFilmstrip.querySelectorAll('.filmstrip-item');
    items.forEach((item) => {
      const isActive = item.dataset.panelId === activePanelId;
      item.classList.toggle('is-active', isActive);
      if (isActive) {
        item.setAttribute('aria-current', 'true');
      } else {
        item.removeAttribute('aria-current');
      }
    });
  }

  function buildStaticGrid() {
    if (!state.storyboard || !Array.isArray(state.storyboard.panels)) return;
    els.staticGridContainer.innerHTML = '';
    state.storyboard.panels.forEach((panel, idx) => {
      const card = document.createElement('article');
      card.className = 'static-panel-card';
      const fallbackSrc = resolveAssetPath(panel.staticFallbackAsset, panel.clipPath);
      const dialogueHtml = panel.dialogue
        ? `<p class="static-panel-dialogue"><strong>${panel.speaker || 'VOICE'}:</strong> ${panel.dialogue}</p>`
        : '';

      const grammarText = Array.isArray(panel.comicGrammar)
        ? panel.comicGrammar.join(' · ')
        : panel.comicGrammar || '';

      card.innerHTML = `
        <div class="static-panel-top">
          <span>${panel.panelId} · ${panel.shotType || ''}</span>
          <span class="static-panel-beat">${panel.beatId || 'STATIC'}</span>
        </div>
        <img class="static-panel-art" src="${fallbackSrc}" alt="${panel.panelId}: ${panel.visualAction || panel.caption || ''}" loading="lazy" />
        <div class="static-panel-body">
          ${dialogueHtml}
          <p class="static-panel-caption">${panel.caption || ''}</p>
          <p class="static-panel-grammar">${grammarText}</p>
        </div>
      `;

      card.addEventListener('click', async () => {
        state.scope = 'EP-LAB-01';
        els.scopeSelect.value = 'EP-LAB-01';
        state.panelIndex = idx;
        state.frameIndex = 0;
        setViewMode('stage');
        await renderCurrentFrame(false);
      });

      els.staticGridContainer.appendChild(card);
    });
  }

  function renderCandidateInfo() {
    if (!state.candidate) {
      els.candidateInfo.innerHTML = '<p>Non-canonical candidate record unavailable.</p>';
      return;
    }
    const name =
      state.candidate.title ||
      state.candidate.displayName ||
      state.candidate.candidateId ||
      'Proposed Candidate';
    const status = state.candidate.status || 'experimental-noncanonical-proposed';
    const role =
      (state.candidate.narrativeFunction && state.candidate.narrativeFunction.summary) ||
      state.candidate.role ||
      '';
    els.candidateInfo.innerHTML = `
      <p><strong>${name}</strong> (<code>${status}</code>)</p>
      <p>${role}</p>
    `;
  }

  function bindEvents() {
    els.btnPlay.addEventListener('click', startPlayback);
    els.btnPause.addEventListener('click', () => pausePlayback('Playback paused.'));
    els.btnReplay.addEventListener('click', replayFromStart);
    els.btnPrevFrame.addEventListener('click', () => stepFrame(-1));
    els.btnNextFrame.addEventListener('click', () => stepFrame(1));
    els.btnPrevPanel.addEventListener('click', () => stepPanel(-1));
    els.btnNextPanel.addEventListener('click', () => stepPanel(1));
    els.btnSpeedNormal.addEventListener('click', () => setSpeed(1.0));
    els.btnSpeedSlow.addEventListener('click', () => setSpeed(0.45));

    els.scopeSelect.addEventListener('change', async (e) => {
      pausePlayback();
      state.scope = e.target.value;
      state.panelIndex = 0;
      state.frameIndex = 0;
      await renderCurrentFrame(true);
      announce(`Scope changed to ${state.scope}.`);
    });

    els.btnModeStage.addEventListener('click', () => setViewMode('stage'));
    els.btnModeStatic.addEventListener('click', () => setViewMode('static'));
    els.btnReducedMotion.addEventListener('click', () => setReducedMotion(!state.reducedMotion));
    if (els.btnSoundToggle) {
      els.btnSoundToggle.addEventListener('click', () => setSoundEnabled(!state.soundEnabled));
    }
    els.btnSourcesDrawer.addEventListener('click', () => setDrawerOpen(!state.drawerOpen));
    els.btnCloseDrawer.addEventListener('click', () => setDrawerOpen(false));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pausePlayback('Playback paused because tab became hidden.');
        if (liveCanvasFx) liveCanvasFx.setEnabled(false);
        if (foleySynth && state.soundEnabled) foleySynth.setEnabled(false);
      } else {
        syncLiveCanvasMode(getCurrentPanel());
        if (foleySynth && state.soundEnabled) foleySynth.setEnabled(true);
      }
    });

    document.addEventListener('keydown', (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (state.isPlaying) pausePlayback('Playback paused.');
        else startPlayback();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrame(1);
      } else if (e.key === '[') {
        e.preventDefault();
        stepPanel(-1);
      } else if (e.key === ']') {
        e.preventDefault();
        stepPanel(1);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        replayFromStart();
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setSpeed(state.speed === 1.0 ? 0.45 : 1.0);
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        setViewMode(state.viewMode === 'static' ? 'stage' : 'static');
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setReducedMotion(!state.reducedMotion);
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setDrawerOpen(!state.drawerOpen);
      }
    });
  }

  async function init() {
    bindEvents();

    const prefersReduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      state.reducedMotion = true;
      document.documentElement.dataset.reducedMotion = 'true';
      els.btnReducedMotion.textContent = 'Reduced Motion: ON';
      els.btnReducedMotion.setAttribute('aria-pressed', 'true');
      els.btnReducedMotion.classList.add('is-active');
    }

    const bundle = window.__MW_COMIC_LAB_BUNDLE__;
    try {
      if (window.location.protocol === 'file:' && bundle && bundle.storyboard) {
        state.storyboard = bundle.storyboard;
      } else {
        const sbRes = await fetch('./data/storyboard.json');
        if (!sbRes.ok) throw new Error(`HTTP ${sbRes.status}`);
        state.storyboard = await sbRes.json();
      }
    } catch (err) {
      if (bundle && bundle.storyboard) {
        state.storyboard = bundle.storyboard;
      } else {
        els.captionText.textContent = `Unable to load storyboard data (${err.message}).`;
      }
    }

    if (state.storyboard) {
      if (state.storyboard.title) {
        els.episodeTitle.textContent = state.storyboard.title;
      }
      buildFilmstrip();
      buildStaticGrid();
      await renderCurrentFrame(false);
    }

    try {
      if (window.location.protocol === 'file:' && bundle && bundle.candidate) {
        state.candidate = bundle.candidate;
        renderCandidateInfo();
      } else {
        const candRes = await fetch('./data/proposed-character-candidate.json');
        if (candRes.ok) {
          state.candidate = await candRes.json();
          renderCandidateInfo();
        }
      }
    } catch {
      if (bundle && bundle.candidate) {
        state.candidate = bundle.candidate;
        renderCandidateInfo();
      }
    }
  }

  init();
})();
