(() => {
  'use strict';

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
    drawerOpen: false,
    timerId: null,
  };

  const els = {
    announcer: document.getElementById('status-announcer'),
    episodeTitle: document.getElementById('episode-title'),
    btnModeStage: document.getElementById('btn-mode-stage'),
    btnModeStatic: document.getElementById('btn-mode-static'),
    btnReducedMotion: document.getElementById('btn-reduced-motion'),
    btnSourcesDrawer: document.getElementById('btn-sources-drawer'),
    btnCloseDrawer: document.getElementById('btn-close-drawer'),
    sourcesDrawer: document.getElementById('sources-drawer'),
    candidateInfo: document.getElementById('candidate-info'),
    theaterView: document.getElementById('theater-view'),
    staticGridView: document.getElementById('static-grid-view'),
    staticGridContainer: document.getElementById('static-grid-container'),
    comicStage: document.getElementById('comic-stage'),
    stageBackdrops: document.getElementById('stage-backdrops'),
    stageFrameImg: document.getElementById('stage-frame-img'),
    stageForegroundImg: document.getElementById('stage-foreground-img'),
    metaPanelId: document.getElementById('meta-panel-id'),
    metaBeatId: document.getElementById('meta-beat-id'),
    metaFrameCounter: document.getElementById('meta-frame-counter'),
    metaShotType: document.getElementById('meta-shot-type'),
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
    try {
      const response = await fetch(clipPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const clipData = await response.json();
      state.clips.set(clipPath, clipData);
      return clipData;
    } catch {
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
        (clip && clip.reducedMotionAlternative && clip.reducedMotionAlternative.asset
          ? resolveAssetPath(clip.reducedMotionAlternative.asset, panel.clipPath)
          : '') ||
        resolveAssetPath(panel.staticFallbackAsset, panel.clipPath);
      return [
        {
          frameId: 'REDUCED-STATIC',
          asset: reducedAsset,
          durationMs: panel.timingMs || 1800,
          poseLabel: 'Reduced-motion static frame',
          actingNote: panel.reducedMotionNote || panel.actingIntent || '',
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
      if (Array.isArray(panel.backdropLayers)) {
        panel.backdropLayers.forEach((layer) => {
          const src = typeof layer === 'string' ? layer : layer && layer.asset;
          preloadUrl(resolveAssetPath(src, panel.clipPath));
        });
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

  function triggerStageFx() {
    if (state.reducedMotion || state.viewMode === 'static') return;
    els.comicStage.classList.remove('fx-ink-wipe');
    void els.comicStage.offsetWidth;
    els.comicStage.classList.add('fx-ink-wipe');
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

    // Active frame
    els.stageFrameImg.src = activeFrame ? activeFrame.asset : '';
    els.stageFrameImg.alt = `${panel.panelId}: ${panel.visualAction || panel.caption || 'Comic panel'}`;

    // Optional foreground overlay
    if (panel.foregroundAsset) {
      els.stageForegroundImg.src = resolveAssetPath(panel.foregroundAsset, panel.clipPath);
      els.stageForegroundImg.hidden = false;
    } else {
      els.stageForegroundImg.hidden = true;
      els.stageForegroundImg.removeAttribute('src');
    }

    if (withFx) {
      triggerStageFx();
    }

    // Metadata
    els.metaPanelId.textContent = panel.panelId || `P${String(state.panelIndex + 1).padStart(2, '0')}`;
    els.metaBeatId.textContent = panel.beatId || 'STATIC/ESTABLISHING';
    els.metaFrameCounter.textContent = `Frame ${safeFrameIdx + 1} / ${frames.length}`;
    els.metaShotType.textContent = panel.shotType || 'Panel';

    // Dialogue & Caption
    if (panel.dialogue && panel.dialogue.trim() !== '') {
      els.speechBubbleWrap.hidden = false;
      els.captionSpeaker.textContent = panel.speaker || 'VOICE';
      els.captionDialogue.textContent = panel.dialogue;
    } else {
      els.speechBubbleWrap.hidden = true;
      els.captionSpeaker.textContent = '';
      els.captionDialogue.textContent = '';
    }

    els.captionText.textContent = panel.caption || panel.visualAction || '';
    const actingNote = (activeFrame && activeFrame.actingNote) || panel.actingIntent || '';
    const grammarText = Array.isArray(panel.comicGrammar)
      ? panel.comicGrammar.join(' · ')
      : panel.comicGrammar || '';
    const grammar = grammarText ? `[${grammarText}] ` : '';
    els.actingNoteText.textContent = `${grammar}${actingNote}`.trim();

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
    const delayMs = Math.max(80, Math.round(baseMs / state.speed));

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

      // End of scope
      if (state.scope !== 'EP-LAB-01') {
        // Loop individual beat
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
      pausePlayback('Switched to static comic storyboard grid. Animation stopped.');
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
          ? 'Reduced-motion preview enabled. Showing static fallback frames.'
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
      btn.innerHTML = `
        <span class="filmstrip-id">${panel.panelId}</span>
        <span class="filmstrip-beat">${panel.beatId || 'STATIC'}</span>
        <span class="filmstrip-shot">${panel.shotType || ''}</span>
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
      state.candidate.name ||
      state.candidate.candidateId ||
      'Proposed Candidate';
    const status = state.candidate.status || 'experimental-noncanonical-proposed';
    const role =
      (state.candidate.narrativeFunction && state.candidate.narrativeFunction.summary) ||
      state.candidate.proposedRole ||
      state.candidate.role ||
      state.candidate.summary ||
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
    els.btnSourcesDrawer.addEventListener('click', () => setDrawerOpen(!state.drawerOpen));
    els.btnCloseDrawer.addEventListener('click', () => setDrawerOpen(false));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pausePlayback('Playback paused because tab became hidden.');
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

    try {
      const sbRes = await fetch('./data/storyboard.json');
      if (!sbRes.ok) throw new Error(`HTTP ${sbRes.status}`);
      state.storyboard = await sbRes.json();
      if (state.storyboard.title) {
        els.episodeTitle.textContent = state.storyboard.title;
      }
      buildFilmstrip();
      buildStaticGrid();
      await renderCurrentFrame(false);
    } catch (err) {
      els.captionText.textContent = `Unable to load storyboard data (${err.message}).`;
    }

    try {
      const candRes = await fetch('./data/proposed-character-candidate.json');
      if (candRes.ok) {
        state.candidate = await candRes.json();
        renderCandidateInfo();
      }
    } catch {
      // Optional candidate file
    }
  }

  init();
})();
