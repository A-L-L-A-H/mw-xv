/* global window, document, EventSource, fetch, setTimeout, clearTimeout */
(function () {
  const obs = window.MWObservatory || {};
  const byId = (id) => document.getElementById(id);

  const appState = {
    snapshot: null,
    historyBuffer: [],
    replayIndex: null,
    streamPaused: false,
    activeTab: 'flow',
    selectedPlanId: null,
    selectedWave: 'all',
    selectedTaskId: null,
    expandedTasks: new Set(),
    dagViewMode: 'split',
    showCriticalPath: true,
    filterRuntime: 'all',
    filterStatus: 'all',
    workspaceOnly: false,
    agentSearch: '',
    agentSort: 'recent',
    agentView: 'cards',
    feedSearch: '',
    feedKind: 'all',
    taskSearch: '',
    taskStatusFilter: 'all',
    chaosLevel: 'riot',
    autoCam: false,
    comboCount: 1,
    lastHeadSha: null,
    lastErrorCount: 0,
    lastDoneCount: null,
  };

  let activeDrawerSketch = null;
  let cutInTimer = null;
  let cmdMatches = [];
  let cmdSelectedIdx = 0;

  // Cartoon SFX + Funky 112 BPM Anime Beat Engine
  const sfxEngine = obs.createSfxEngine();

  async function ensureAudioUnlocked() {
    const ok = await sfxEngine.unlock();
    if (ok) {
      byId('audioUnlockBanner')?.classList.add('hidden');
    }
    return ok;
  }

  // Unlock browser Web Audio automatically on first user gesture anywhere
  const handleFirstGesture = () => {
    void ensureAudioUnlocked().then((ready) => {
      if (ready) {
        sfxEngine.play('boing');
        document.removeEventListener('pointerdown', handleFirstGesture);
        document.removeEventListener('keydown', handleFirstGesture);
      }
    });
  };
  document.addEventListener('pointerdown', handleFirstGesture);
  document.addEventListener('keydown', handleFirstGesture);

  function bumpCombo(delta = 1) {
    appState.comboCount += delta;
    const countEl = byId('comboCount');
    const badgeEl = byId('comboBadge');
    if (countEl) countEl.textContent = `x${appState.comboCount}`;
    if (badgeEl) {
      badgeEl.classList.remove('pop');
      void badgeEl.offsetWidth;
      badgeEl.classList.add('pop');
    }
  }

  function showAnimeCutIn(kicker, headline, mood = 'celebrate') {
    const banner = byId('animeCutIn');
    const sprite = byId('cutinSprite');
    if (!banner) return;
    byId('cutinKicker').textContent = kicker;
    byId('cutinHeadline').textContent = headline;
    if (sprite) {
      sprite.src =
        mood === 'error'
          ? '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-angry.webp'
          : '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-celebrating.webp';
    }
    banner.classList.remove('hidden');
    if (cutInTimer) clearTimeout(cutInTimer);
    cutInTimer = setTimeout(() => {
      banner.classList.add('hidden');
    }, 2200);
  }

  function getDisplayedSnapshot() {
    if (appState.replayIndex !== null && appState.historyBuffer[appState.replayIndex]) {
      return appState.historyBuffer[appState.replayIndex];
    }
    return appState.snapshot;
  }

  function getActivePlan(snapshot) {
    if (!snapshot || !snapshot.plans || !snapshot.plans.length) return null;
    return (
      snapshot.plans.find((planEntry) => planEntry.id === appState.selectedPlanId) ||
      snapshot.plans[0]
    );
  }

  // Instantiate Full-Bleed Cinema Flow Stage + Quest DAG + Beat Lab Visualizers
  const flowCanvas = obs.createFlowCanvas(byId('flowCanvasHost'), byId('flowTooltip'), {
    onNodeClick(nodeEntry) {
      if (nodeEntry.kind === 'hub') {
        sfxEngine.play('clash');
        bumpCombo(3);
        return;
      }
      sfxEngine.play('boing');
      if (nodeEntry.kind === 'agent' && nodeEntry.sessionId) {
        void openSessionDrawer(nodeEntry.runtime, nodeEntry.sessionId);
      } else if (nodeEntry.kind === 'subagent' && nodeEntry.parentSessionId) {
        void openSessionDrawer(nodeEntry.runtime, nodeEntry.parentSessionId);
      } else if (nodeEntry.kind === 'plan-wave') {
        if (nodeEntry.waveTitle) appState.selectedWave = nodeEntry.waveTitle;
        switchTab('dag');
      } else if (nodeEntry.kind === 'infra' || nodeEntry.kind === 'workspace-area') {
        switchTab('infra');
      } else if (nodeEntry.kind === 'swarm') {
        switchTab('swarms');
      } else if (nodeEntry.kind === 'runtime') {
        appState.filterRuntime = nodeEntry.runtime;
        byId('filterRuntime').value = nodeEntry.runtime;
        switchTab('agents');
      }
    },
    onLivePulse(pulse) {
      bumpCombo(1);
      const toolTag = String(pulse.tool || '').toLowerCase();
      if (pulse.kind === 'error') {
        sfxEngine.play('bonk');
      } else if (pulse.kind === 'swarm') {
        sfxEngine.play('clash');
      } else if (pulse.kind === 'subagent') {
        sfxEngine.play('spawn');
      } else if (pulse.runtime === 'magpie') {
        sfxEngine.play('zap');
      } else if (
        pulse.runtime === 'opencode' ||
        toolTag.includes('edit') ||
        toolTag.includes('write')
      ) {
        sfxEngine.play('slash');
      } else if (
        toolTag.includes('bash') ||
        toolTag.includes('command') ||
        toolTag.includes('run')
      ) {
        sfxEngine.play('laser');
      } else if (pulse.kind === 'focus') {
        sfxEngine.play('pop');
      } else {
        sfxEngine.play('punch');
      }
    },
  });

  const dagCanvas = obs.createDagCanvas(byId('dagCanvasHost'), byId('dagTooltip'), {
    onTaskSelect(taskId) {
      sfxEngine.play('pop');
      appState.selectedTaskId = taskId;
      const snap = getDisplayedSnapshot();
      const plan = getActivePlan(snap);
      const taskEntry = plan?.tasks?.find((entry) => entry.id === taskId) || null;
      obs.renderTaskInspector(byId('dagTaskInspector'), taskEntry, plan);
    },
  });

  const telemetryViz = obs.createTelemetryViz(
    byId('oscCanvasHost'),
    byId('specCanvasHost'),
    byId('radarCanvasHost')
  );

  function syncReplayBar() {
    const barEl = byId('replayBar');
    const sliderEl = byId('replaySlider');
    const tsEl = byId('replayTimestamp');
    const totalFrames = appState.historyBuffer.length;
    const showBar = appState.streamPaused || appState.replayIndex !== null;
    barEl.classList.toggle('hidden', !showBar);
    sliderEl.max = String(Math.max(0, totalFrames - 1));
    const currentIdx =
      appState.replayIndex !== null ? appState.replayIndex : Math.max(0, totalFrames - 1);
    sliderEl.value = String(currentIdx);
    const frameSnap = appState.historyBuffer[currentIdx];
    const relTime = obs.utils?.relTime || (() => '—');
    tsEl.textContent = frameSnap
      ? `VHS ${currentIdx + 1}/${totalFrames} · ${new Date(frameSnap.generatedAt).toLocaleTimeString()} (${relTime(frameSnap.generatedAt)})`
      : 'VHS 0/0';
  }

  function renderAll() {
    const snapshot = getDisplayedSnapshot();
    if (!snapshot) return;

    const planSelect = byId('planSelect');
    if (!appState.selectedPlanId) appState.selectedPlanId = snapshot.defaultPlanId;
    const expectedOptions = (snapshot.plans || [])
      .map((planEntry) => `${planEntry.id}:${planEntry.done}/${planEntry.total}`)
      .join('|');
    if (planSelect.dataset.sig !== expectedOptions) {
      planSelect.dataset.sig = expectedOptions;
      const esc = obs.utils?.esc || ((val) => String(val ?? ''));
      planSelect.innerHTML = (snapshot.plans || [])
        .map(
          (planEntry) =>
            `<option value="${esc(planEntry.id)}">${esc(planEntry.id)} (${planEntry.done}/${planEntry.total})</option>`
        )
        .join('');
    }
    if (appState.selectedPlanId) planSelect.value = appState.selectedPlanId;

    const activePlan = getActivePlan(snapshot);
    obs.renderPanels(appState, snapshot, activePlan);
    flowCanvas.setSnapshot(snapshot);
    dagCanvas.setPlan(activePlan);
    dagCanvas.setSelectedTask(appState.selectedTaskId);
    telemetryViz.setSnapshot(snapshot);
    syncReplayBar();
  }

  function switchTab(tabName) {
    if (appState.activeTab !== tabName) sfxEngine.play('whoosh');
    appState.activeTab = tabName;
    document.querySelectorAll('.dock-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    const isCinemaOnly = tabName === 'flow';
    byId('overlayStage').classList.toggle('hidden', isCinemaOnly);
    for (const key of ['dag', 'telemetry', 'agents', 'swarms', 'infra']) {
      byId(`view-${key}`).classList.toggle('hidden', key !== tabName);
    }

    flowCanvas.setVisible(true); // Living cinema stays alive behind overlays!
    dagCanvas.setVisible(tabName === 'dag' && appState.dagViewMode !== 'list');
    telemetryViz.setVisible(tabName === 'telemetry');
    renderAll();
  }

  function destroyDrawerSketch() {
    if (activeDrawerSketch) {
      activeDrawerSketch.remove();
      activeDrawerSketch = null;
    }
  }

  async function openSessionDrawer(runtime, sessionId) {
    const esc = obs.utils?.esc || ((val) => String(val ?? ''));
    const fmtNum = obs.utils?.fmtNum || ((val) => String(val ?? 0));
    const relTime = obs.utils?.relTime || (() => '—');
    const portraitForSession = obs.utils?.portraitForSession;

    destroyDrawerSketch();
    sfxEngine.play('pop');
    byId('drawerBackdrop').classList.add('open');
    byId('drawerTitle').textContent = 'LOADING HERO DOSSIER…';
    byId('drawerSub').textContent = `${runtime} / ${sessionId}`;
    byId('drawerBody').innerHTML = '<div class="empty">Reading transcript tail…</div>';

    try {
      const httpResponse = await fetch(
        `/api/session?runtime=${encodeURIComponent(runtime)}&id=${encodeURIComponent(sessionId)}`
      );
      if (!httpResponse.ok) throw new Error(`HTTP ${httpResponse.status}`);
      const detailPayload = await httpResponse.json();

      if (portraitForSession && byId('drawerPortrait')) {
        byId('drawerPortrait').src = portraitForSession(detailPayload);
      }
      byId('drawerTitle').textContent = detailPayload.title || sessionId;
      byId('drawerSub').textContent =
        `${detailPayload.runtimeLabel} · ${detailPayload.model} · ${detailPayload.status.toUpperCase()} · ${fmtNum(detailPayload.tokens?.total || 0)} tok`;

      const eventsChrono = detailPayload.detail?.events || detailPayload.recentEvents || [];
      const eventsNewestFirst = eventsChrono.slice().reverse();
      const subagents = detailPayload.detail?.subagents || detailPayload.subagents || [];
      const toolCounts = Object.entries(
        detailPayload.detail?.toolCounts || detailPayload.toolCounts || {}
      )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10);

      byId('drawerBody').innerHTML = `
        <div class="probe-row">
          <div><strong>Stage Dir:</strong> <span class="brand-sub">${esc(detailPayload.cwd || '—')}</span></div>
          <div><strong>Branch:</strong> <span class="brand-sub">${esc(detailPayload.branch || '—')}</span></div>
        </div>
        <div class="probe-row">
          <div><strong>Power:</strong> <span class="brand-sub">in ${fmtNum(detailPayload.tokens?.input)} · cache ${fmtNum(detailPayload.tokens?.cached)} · out ${fmtNum(detailPayload.tokens?.output)}</span></div>
          <div><strong>Moves:</strong> <span class="brand-sub">${detailPayload.steps || 0}</span></div>
        </div>
        <div>
          <div class="kpi-label" style="margin-bottom:5px">LIVE EVENT CADENCE RIBBON (P5.JS)</div>
          <div id="drawerSessionStrip" class="p5-session-strip"></div>
        </div>
        ${
          toolCounts.length
            ? `<div><div class="kpi-label" style="margin-bottom:5px">SPECIAL MOVES</div><div class="subagent-strip no-border">${toolCounts
                .map(
                  ([toolName, callCount]) =>
                    `<span class="sub-pill">${esc(toolName)}: ${callCount}</span>`
                )
                .join('')}</div></div>`
            : ''
        }
        ${
          subagents.length
            ? `<div><div class="kpi-label" style="margin-bottom:5px">CHIBI SIDEKICKS (${subagents.length})</div><div class="subagent-strip no-border">${subagents
                .map(
                  (subEntry) =>
                    `<span class="sub-pill">★ ${esc(subEntry.role || subEntry.id)} (${esc(subEntry.type || 'sub')})</span>`
                )
                .join('')}</div></div>`
            : ''
        }
        <div class="kpi-label">ACTION LOG (${eventsNewestFirst.length})</div>
        <div class="stack-tight">
          ${
            eventsNewestFirst.length
              ? eventsNewestFirst
                  .map(
                    (ev) => `
                  <div class="feed-row ${ev.kind === 'error' ? 'error' : ''}">
                    <div class="feed-head"><span>${esc(ev.tool || ev.kind)}</span><span>${relTime(ev.at)}</span></div>
                    <div class="feed-msg">${esc(ev.summary)}</div>
                  </div>`
                  )
                  .join('')
              : '<div class="empty">No events captured</div>'
          }
        </div>
      `;

      const stripHost = byId('drawerSessionStrip');
      if (stripHost && typeof obs.createSessionStripSketch === 'function') {
        activeDrawerSketch = obs.createSessionStripSketch(stripHost, eventsChrono);
      }
    } catch (err) {
      byId('drawerBody').innerHTML =
        `<div class="empty">Failed to load detail: ${esc(err.message)}</div>`;
    }
  }

  async function inspectGitCommit(sha) {
    const esc = obs.utils?.esc || ((val) => String(val ?? ''));
    const panelEl = byId('commitDetailPanel');
    panelEl.classList.remove('hidden');
    byId('commitDetailTitle').textContent = `📼 COMMIT ${sha}`;
    byId('commitDetailBody').textContent = 'Loading git tape…';
    byId('commitChangedFiles').innerHTML = '';

    try {
      const httpResponse = await fetch(`/api/git/commit?sha=${encodeURIComponent(sha)}`);
      if (!httpResponse.ok) throw new Error(`HTTP ${httpResponse.status}`);
      const commitInfo = await httpResponse.json();
      byId('commitDetailBody').textContent = commitInfo.header || '';
      byId('commitChangedFiles').innerHTML = (commitInfo.changedFiles || [])
        .map(
          (fileRow) => `
          <div class="probe-row">
            <span class="brand-sub">${esc(fileRow.path)}</span>
            <span class="brand-sub">
              <span style="color:var(--green)">+${fileRow.added}</span> /
              <span style="color:var(--red)">-${fileRow.removed}</span>
            </span>
          </div>`
        )
        .join('');
    } catch (err) {
      byId('commitDetailBody').textContent = `Failed to load commit: ${err.message}`;
    }
  }

  // Command Palette
  function buildCommandCatalog(queryText) {
    const snap = getDisplayedSnapshot();
    const query = queryText.trim().toLowerCase();
    const catalog = [
      {
        kind: 'CINEMA',
        label: '🎬 Back to Live Cartoon Cinema Stage',
        sub: 'Full-bleed animated world',
        run: () => switchTab('flow'),
      },
      {
        kind: 'WARZONE',
        label: '⚔️ Warzone: Anime Cartoon Boss Battle Arena',
        sub: 'Heroes dash, laser, slash & clash against Plan Boss',
        run: () => {
          switchTab('flow');
          setFlowMode('warzone');
        },
      },
      {
        kind: 'SFX',
        label: '⚔️ Unleash ALL-OUT RIOT CLASH!! Team Ultimate',
        sub: 'Simultaneous multi-hero laser & slash barrage + SFX',
        run: () => triggerShowstopperCutIn(),
      },
      {
        kind: 'CHAOS',
        label: '🔥 Cycle Battle Chaos Intensity (CHILL / RIOT / MAX!!)',
        sub: 'Crank speedlines, battle cadence & breakbeat energy',
        run: () => cycleChaosLevel(),
      },
      {
        kind: 'BEAT',
        label: '🎵 Toggle 128 BPM Punk-Funk Anime Boss Breakbeat',
        sub: 'Breakbeat drums + slap bass + brass + night ambience',
        run: () => toggleFunkyBeat(),
      },
      {
        kind: 'CAST',
        label: '🔥 Filter Cast: OpenCode Ronin Sessions',
        sub: 'Inspect live OpenCode SQLite v2 sessions',
        run: () => {
          appState.filterRuntime = 'opencode';
          byId('filterRuntime').value = 'opencode';
          switchTab('agents');
        },
      },
      {
        kind: 'CAST',
        label: '🐦 Filter Cast: Magpie Hyper-Router Gateway',
        sub: 'Inspect routed providers, latency & 429 deflections',
        run: () => {
          appState.filterRuntime = 'magpie';
          byId('filterRuntime').value = 'magpie';
          switchTab('agents');
        },
      },
      {
        kind: 'STAGE',
        label: '🌙 Backdrop: MoonWitness Rooftop Crew',
        sub: 'crew-rooftop art',
        run: () => setBackdrop('rooftop'),
      },
      {
        kind: 'STAGE',
        label: '🌧️ Backdrop: Riot Street Alley',
        sub: 'Neon rain alley',
        run: () => setBackdrop('alley'),
      },
      {
        kind: 'STAGE',
        label: '🔭 Backdrop: Lunar Observatory Dome',
        sub: 'dna-lunar-observatory art',
        run: () => setBackdrop('observatory'),
      },
      {
        kind: 'STAGE',
        label: '🕹️ Backdrop: Riot Arcade Workbench',
        sub: 'bg-riot-arcade-workbench',
        run: () => setBackdrop('arcade'),
      },
      {
        kind: 'VIEW',
        label: '🗺️ Quest Map (p5.js Plan DAG)',
        sub: 'Interactive dependency graph',
        run: () => switchTab('dag'),
      },
      {
        kind: 'VIEW',
        label: '📻 Beat Lab (Oscilloscope, EQ, Radar)',
        sub: '3 live p5 instruments',
        run: () => switchTab('telemetry'),
      },
      {
        kind: 'VIEW',
        label: '👾 Crew Cast (Select Fighter)',
        sub: 'All 47 coding agents',
        run: () => switchTab('agents'),
      },
      {
        kind: 'VIEW',
        label: '📡 Moon City Infra & Git Reel',
        sub: 'VPS probes, ports, commits',
        run: () => switchTab('infra'),
      },
    ];

    if (snap) {
      for (const session of snap.sessions || []) {
        catalog.push({
          kind: session.runtimeLabel.toUpperCase(),
          label: session.title,
          sub: `${session.status} · ${session.model} · ${session.focus || session.lastTool || 'Chilling'}`,
          run: () => void openSessionDrawer(session.runtime, session.id),
        });
      }
      const plan = getActivePlan(snap);
      for (const taskEntry of plan?.tasks || []) {
        catalog.push({
          kind: `QUEST ${taskEntry.id}`,
          label: `${taskEntry.id} — ${taskEntry.title}`,
          sub: `${taskEntry.dagState} · ${taskEntry.wave}`,
          run: () => {
            appState.selectedTaskId = taskEntry.id;
            appState.expandedTasks.add(taskEntry.id);
            switchTab('dag');
          },
        });
      }
      for (const commitEntry of snap.git?.commits || []) {
        catalog.push({
          kind: 'COMMIT',
          label: `${commitEntry.sha} — ${commitEntry.subject}`,
          sub: `${commitEntry.author}`,
          run: () => {
            switchTab('infra');
            void inspectGitCommit(commitEntry.sha);
          },
        });
      }
    }

    if (!query) return catalog.slice(0, 18);
    return catalog
      .filter((entry) => `${entry.kind} ${entry.label} ${entry.sub}`.toLowerCase().includes(query))
      .slice(0, 22);
  }

  function renderCmdPalette() {
    const esc = obs.utils?.esc || ((val) => String(val ?? ''));
    cmdMatches = buildCommandCatalog(byId('cmdInput').value);
    cmdSelectedIdx = Math.min(cmdSelectedIdx, Math.max(0, cmdMatches.length - 1));
    byId('cmdResults').innerHTML = cmdMatches.length
      ? cmdMatches
          .map(
            (entry, idx) => `
          <div class="cmd-option ${idx === cmdSelectedIdx ? 'selected' : ''}" data-cmd-idx="${idx}">
            <div>
              <strong>${esc(entry.label)}</strong>
              <div class="brand-sub">${esc(entry.sub)}</div>
            </div>
            <span class="chip st-ready">${esc(entry.kind)}</span>
          </div>`
          )
          .join('')
      : '<div class="empty">No matching heroes, quests, or SFX</div>';
  }

  function openCmdPalette() {
    sfxEngine.play('pop');
    byId('cmdBackdrop').classList.remove('hidden');
    byId('cmdInput').value = '';
    cmdSelectedIdx = 0;
    renderCmdPalette();
    byId('cmdInput').focus();
  }

  function closeCmdPalette() {
    byId('cmdBackdrop').classList.add('hidden');
  }

  function setFlowMode(mode) {
    sfxEngine.play('boing');
    document.querySelectorAll('[data-flow-mode]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.flowMode === mode);
    });
    flowCanvas.setMode(mode);
  }

  function setBackdrop(bgKey) {
    sfxEngine.play('whoosh');
    document.querySelectorAll('[data-stage-bg]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.stageBg === bgKey);
    });
    flowCanvas.setBackdrop(bgKey);
  }

  function setDagViewMode(mode) {
    sfxEngine.play('click');
    appState.dagViewMode = mode;
    document.querySelectorAll('[data-dag-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.dagView === mode);
    });
    byId('dagCanvasSection').classList.toggle('hidden', mode === 'list');
    byId('planChecklistPanel').classList.toggle('hidden', mode === 'canvas');
    dagCanvas.setVisible(appState.activeTab === 'dag' && mode !== 'list');
  }

  function cycleChaosLevel() {
    const order = ['chill', 'riot', 'overdrive'];
    const nextIdx = (order.indexOf(appState.chaosLevel) + 1) % order.length;
    appState.chaosLevel = order[nextIdx];
    flowCanvas.setChaosLevel(appState.chaosLevel);
    sfxEngine.setIntensity(appState.chaosLevel);
    const btn = byId('chaosToggleBtn');
    if (btn) {
      btn.classList.remove('active-orange', 'active-magenta', 'active-cyan');
      if (appState.chaosLevel === 'chill') {
        btn.textContent = '🧊 CHILL';
        btn.classList.add('active-cyan');
        sfxEngine.play('pop');
      } else if (appState.chaosLevel === 'riot') {
        btn.textContent = '🔥 RIOT';
        btn.classList.add('active-orange');
        sfxEngine.play('dash');
      } else {
        btn.textContent = '💥 MAX!!';
        btn.classList.add('active-magenta');
        sfxEngine.play('clash');
        flowCanvas.triggerAllOutClash('MAX OVERDRIVE!!');
      }
    }
  }

  function toggleFunkyBeat() {
    const next = !sfxEngine.isBeatEnabled();
    sfxEngine.setBeatEnabled(next);
    const beatBtn = byId('beatToggleBtn');
    beatBtn.textContent = next ? '🎵 BEAT ON' : '🎵 BEAT';
    beatBtn.classList.toggle('active-cyan', next);
    if (next) byId('audioUnlockBanner')?.classList.add('hidden');
  }

  function triggerShowstopperCutIn() {
    void ensureAudioUnlocked().then(() => {
      sfxEngine.play('ultimate');
      flowCanvas.triggerAllOutClash('ALL-OUT CLASH!!');
      bumpCombo(10);
      showAnimeCutIn(
        'ALL-OUT RIOT CLASH!!',
        'OPENCODE · MAGPIE · KURO · VESPER ENGAGED!',
        'celebrate'
      );
    });
  }

  function togglePauseStream() {
    sfxEngine.play('click');
    appState.streamPaused = !appState.streamPaused;
    const pauseBtn = byId('pauseStreamBtn');
    pauseBtn.textContent = appState.streamPaused ? '▶ LIVE' : '⏸ VHS';
    pauseBtn.classList.toggle('active-magenta', appState.streamPaused);
    byId('liveDot').classList.toggle('paused', appState.streamPaused);
    if (!appState.streamPaused) {
      appState.replayIndex = null;
    } else if (appState.historyBuffer.length > 0) {
      appState.replayIndex = appState.historyBuffer.length - 1;
    }
    renderAll();
  }

  async function forceRefresh() {
    sfxEngine.play('whoosh');
    const httpResponse = await fetch('/api/state?fresh=1');
    if (httpResponse.ok) {
      ingestLiveSnapshot(await httpResponse.json());
    }
  }

  function ingestLiveSnapshot(nextSnapshot) {
    if (appState.snapshot) {
      if (
        appState.lastHeadSha &&
        nextSnapshot.git?.head &&
        nextSnapshot.git.head !== appState.lastHeadSha
      ) {
        sfxEngine.play('levelup');
        bumpCombo(3);
        const topCommit = nextSnapshot.git.commits?.[0];
        flowCanvas.triggerShowstopper('COMMIT!!');
        showAnimeCutIn(
          'NEW COMMIT LANDED!!',
          topCommit ? `${topCommit.sha} · ${topCommit.subject}` : nextSnapshot.git.head,
          'celebrate'
        );
      }
      if ((nextSnapshot.summary?.errorSessions || 0) > appState.lastErrorCount) {
        sfxEngine.play('bonk');
        flowCanvas.triggerShowstopper('BONK!!');
        showAnimeCutIn('GLITCH DETECTED!!', 'CHECK BONK ERROR LEDGER!', 'error');
      }
      const plan = getActivePlan(nextSnapshot);
      if (plan && appState.lastDoneCount !== null && plan.done > appState.lastDoneCount) {
        sfxEngine.play('levelup');
        bumpCombo(5);
        flowCanvas.triggerShowstopper('LEVEL UP!!');
        showAnimeCutIn(
          'QUEST CLEARED!!',
          `${plan.done}/${plan.total} (${plan.percent}%) COMPLETE!`,
          'celebrate'
        );
      }
    }

    appState.lastHeadSha = nextSnapshot.git?.head || appState.lastHeadSha;
    appState.lastErrorCount = nextSnapshot.summary?.errorSessions || 0;
    const planNow = getActivePlan(nextSnapshot);
    if (planNow) appState.lastDoneCount = planNow.done;

    appState.snapshot = nextSnapshot;
    appState.historyBuffer.push(nextSnapshot);
    if (appState.historyBuffer.length > 60) {
      appState.historyBuffer.shift();
      if (appState.replayIndex !== null && appState.replayIndex > 0) {
        appState.replayIndex -= 1;
      }
    }

    if (!appState.streamPaused && appState.replayIndex === null) {
      renderAll();
    } else {
      syncReplayBar();
    }
  }

  // Event bindings
  document.querySelectorAll('.dock-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll('[data-close-overlay]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab('flow'));
  });

  document.querySelectorAll('[data-stage-bg]').forEach((btn) => {
    btn.addEventListener('click', () => setBackdrop(btn.dataset.stageBg));
  });

  document.querySelectorAll('[data-flow-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setFlowMode(btn.dataset.flowMode));
  });

  document.querySelectorAll('[data-dag-view]').forEach((btn) => {
    btn.addEventListener('click', () => setDagViewMode(btn.dataset.dagView));
  });

  document.querySelectorAll('[data-agent-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sfxEngine.play('click');
      appState.agentView = btn.dataset.agentView;
      document.querySelectorAll('[data-agent-view]').forEach((other) => {
        other.classList.toggle('active', other === btn);
      });
      renderAll();
    });
  });

  byId('audioUnlockBanner')?.addEventListener('click', () => {
    void ensureAudioUnlocked().then(() => {
      sfxEngine.play('levelup');
      flowCanvas.triggerShowstopper('SFX ON!!');
    });
  });

  byId('sfxToggleBtn')?.addEventListener('click', () => {
    const next = !sfxEngine.isSfxEnabled();
    sfxEngine.setSfxEnabled(next);
    const btn = byId('sfxToggleBtn');
    btn.textContent = next ? '🔊 SFX' : '🔇 SFX';
    btn.classList.toggle('active-yellow', next);
    if (next) void ensureAudioUnlocked().then(() => sfxEngine.play('boing'));
  });

  byId('chaosToggleBtn')?.addEventListener('click', cycleChaosLevel);
  byId('beatToggleBtn')?.addEventListener('click', toggleFunkyBeat);
  byId('boomTestBtn')?.addEventListener('click', triggerShowstopperCutIn);

  byId('autoCamBtn')?.addEventListener('click', () => {
    appState.autoCam = !appState.autoCam;
    byId('autoCamBtn').classList.toggle('active-cyan', appState.autoCam);
    flowCanvas.setAutoCam(appState.autoCam);
    sfxEngine.play('click');
  });

  byId('toggleSubtitleBtn')?.addEventListener('click', () => {
    const box = byId('subtitleBox');
    const collapsed = box.classList.toggle('collapsed');
    byId('toggleSubtitleBtn').textContent = collapsed ? '+' : '—';
    sfxEngine.play('pop');
  });

  byId('flowFitBtn')?.addEventListener('click', () => {
    sfxEngine.play('whoosh');
    flowCanvas.fitView();
  });
  byId('flowSnapBtn')?.addEventListener('click', () => {
    sfxEngine.play('camera');
    flowCanvas.savePng();
  });

  byId('dagFitBtn')?.addEventListener('click', () => {
    sfxEngine.play('whoosh');
    dagCanvas.fitView();
  });
  byId('dagSnapBtn')?.addEventListener('click', () => {
    sfxEngine.play('camera');
    dagCanvas.savePng();
  });
  byId('dagCriticalBtn')?.addEventListener('click', () => {
    sfxEngine.play('click');
    appState.showCriticalPath = !appState.showCriticalPath;
    byId('dagCriticalBtn').classList.toggle('active-magenta', appState.showCriticalPath);
    dagCanvas.setShowCritical(appState.showCriticalPath);
  });

  byId('planSelect')?.addEventListener('change', (evt) => {
    sfxEngine.play('click');
    appState.selectedPlanId = evt.target.value;
    appState.selectedWave = 'all';
    appState.selectedTaskId = null;
    renderAll();
  });

  byId('pauseStreamBtn')?.addEventListener('click', togglePauseStream);
  byId('snapLiveBtn')?.addEventListener('click', () => {
    sfxEngine.play('pop');
    appState.streamPaused = false;
    appState.replayIndex = null;
    byId('pauseStreamBtn').textContent = '⏸ VHS';
    byId('pauseStreamBtn').classList.remove('active-magenta');
    byId('liveDot').classList.remove('paused');
    renderAll();
  });

  byId('replaySlider')?.addEventListener('input', (evt) => {
    appState.replayIndex = Number(evt.target.value);
    renderAll();
  });

  byId('cmdPaletteBtn')?.addEventListener('click', openCmdPalette);
  byId('refreshBtn')?.addEventListener('click', () => void forceRefresh());
  byId('closeCommitDetailBtn')?.addEventListener('click', () =>
    byId('commitDetailPanel').classList.add('hidden')
  );

  byId('feedSearch')?.addEventListener('input', (evt) => {
    appState.feedSearch = evt.target.value;
    renderAll();
  });
  byId('feedKindFilter')?.addEventListener('change', (evt) => {
    appState.feedKind = evt.target.value;
    renderAll();
  });
  byId('agentSearch')?.addEventListener('input', (evt) => {
    appState.agentSearch = evt.target.value;
    renderAll();
  });
  byId('filterRuntime')?.addEventListener('change', (evt) => {
    appState.filterRuntime = evt.target.value;
    renderAll();
  });
  byId('filterStatus')?.addEventListener('change', (evt) => {
    appState.filterStatus = evt.target.value;
    renderAll();
  });
  byId('agentSort')?.addEventListener('change', (evt) => {
    appState.agentSort = evt.target.value;
    renderAll();
  });
  byId('filterWorkspace')?.addEventListener('change', (evt) => {
    appState.workspaceOnly = evt.target.checked;
    renderAll();
  });
  byId('taskSearch')?.addEventListener('input', (evt) => {
    appState.taskSearch = evt.target.value;
    renderAll();
  });
  byId('taskStatusFilter')?.addEventListener('change', (evt) => {
    appState.taskStatusFilter = evt.target.value;
    renderAll();
  });

  byId('customProbeForm')?.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    sfxEngine.play('zap');
    const esc = obs.utils?.esc || ((val) => String(val ?? ''));
    const inputUrl = byId('customProbeInput').value.trim();
    const resultEl = byId('customProbeResult');
    resultEl.classList.remove('hidden');
    resultEl.innerHTML =
      '<div class="probe-row"><span>Zapping probe…</span><span class="brand-sub">wait</span></div>';
    try {
      const httpResponse = await fetch(`/api/probe?url=${encodeURIComponent(inputUrl)}`);
      const payload = await httpResponse.json();
      if (!httpResponse.ok) {
        sfxEngine.play('bonk');
        resultEl.innerHTML = `<div class="probe-row"><span style="color:var(--red)">Blocked: ${esc(payload.error)}</span></div>`;
        return;
      }
      sfxEngine.play(payload.status === 'up' ? 'pop' : 'bonk');
      resultEl.innerHTML = `
        <div class="probe-row">
          <span><span class="probe-dot ${esc(payload.status)}"></span><strong>${esc(payload.url)}</strong> ${payload.detail ? `· ${esc(payload.detail)}` : ''}</span>
          <span class="brand-sub">${payload.httpCode ? `HTTP ${payload.httpCode}` : payload.status.toUpperCase()} · ${payload.latencyMs}ms</span>
        </div>`;
    } catch (err) {
      sfxEngine.play('bonk');
      resultEl.innerHTML = `<div class="probe-row"><span style="color:var(--red)">Probe error: ${esc(err.message)}</span></div>`;
    }
  });

  document.addEventListener('click', (evt) => {
    const cmdOpt = evt.target.closest('[data-cmd-idx]');
    if (cmdOpt) {
      const chosen = cmdMatches[Number(cmdOpt.dataset.cmdIdx)];
      closeCmdPalette();
      if (chosen) chosen.run();
      return;
    }

    const jumpTask = evt.target.closest('[data-jump-task]');
    if (jumpTask) {
      sfxEngine.play('pop');
      appState.selectedTaskId = jumpTask.dataset.jumpTask;
      dagCanvas.setSelectedTask(appState.selectedTaskId);
      renderAll();
      return;
    }

    const commitTarget = evt.target.closest('[data-commit-sha]');
    if (commitTarget) {
      sfxEngine.play('click');
      switchTab('infra');
      void inspectGitCommit(commitTarget.dataset.commitSha);
      return;
    }

    const waveCard = evt.target.closest('.wave-card');
    if (waveCard) {
      sfxEngine.play('click');
      appState.selectedWave = waveCard.dataset.wave;
      renderAll();
      return;
    }

    const taskHead = evt.target.closest('.task-head');
    if (taskHead) {
      sfxEngine.play('pop');
      const taskId = taskHead.dataset.taskId;
      appState.selectedTaskId = taskId;
      if (appState.expandedTasks.has(taskId)) appState.expandedTasks.delete(taskId);
      else appState.expandedTasks.add(taskId);
      renderAll();
      return;
    }

    const sessionTarget = evt.target.closest('[data-runtime][data-id]');
    if (sessionTarget) {
      void openSessionDrawer(sessionTarget.dataset.runtime, sessionTarget.dataset.id);
    }
  });

  byId('drawerClose')?.addEventListener('click', () => {
    sfxEngine.play('click');
    destroyDrawerSketch();
    byId('drawerBackdrop').classList.remove('open');
  });
  byId('drawerBackdrop')?.addEventListener('click', (evt) => {
    if (evt.target === byId('drawerBackdrop')) {
      destroyDrawerSketch();
      byId('drawerBackdrop').classList.remove('open');
    }
  });
  byId('cmdBackdrop')?.addEventListener('click', (evt) => {
    if (evt.target === byId('cmdBackdrop')) closeCmdPalette();
  });
  byId('cmdInput')?.addEventListener('input', () => {
    cmdSelectedIdx = 0;
    renderCmdPalette();
  });
  byId('cmdInput')?.addEventListener('keydown', (evt) => {
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      cmdSelectedIdx = Math.min(cmdMatches.length - 1, cmdSelectedIdx + 1);
      renderCmdPalette();
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      cmdSelectedIdx = Math.max(0, cmdSelectedIdx - 1);
      renderCmdPalette();
    } else if (evt.key === 'Enter' && cmdMatches[cmdSelectedIdx]) {
      evt.preventDefault();
      const chosen = cmdMatches[cmdSelectedIdx];
      closeCmdPalette();
      chosen.run();
    }
  });

  document.addEventListener('keydown', (evt) => {
    const tag = evt.target?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'k') {
      evt.preventDefault();
      openCmdPalette();
      return;
    }
    if (evt.key === 'Escape') {
      closeCmdPalette();
      destroyDrawerSketch();
      byId('drawerBackdrop').classList.remove('open');
      if (appState.activeTab !== 'flow') switchTab('flow');
      return;
    }
    if (isTyping) return;

    const tabByKey = { 1: 'flow', 2: 'dag', 3: 'telemetry', 4: 'agents', 5: 'swarms', 6: 'infra' };
    if (tabByKey[evt.key]) {
      switchTab(tabByKey[evt.key]);
    } else if (evt.key === ' ') {
      evt.preventDefault();
      togglePauseStream();
    } else if (evt.key.toLowerCase() === 'f') {
      if (appState.activeTab === 'flow') flowCanvas.fitView();
      if (appState.activeTab === 'dag') dagCanvas.fitView();
    } else if (evt.key.toLowerCase() === 'r') {
      void forceRefresh();
    } else if (evt.key === '/') {
      evt.preventDefault();
      openCmdPalette();
    }
  });

  function connectSse() {
    const eventSource = new EventSource('/api/stream');
    eventSource.addEventListener('open', () => {
      byId('sseState').textContent = 'SSE LIVE';
      byId('liveDot').classList.remove('offline');
    });
    eventSource.addEventListener('snapshot', (evt) => {
      try {
        ingestLiveSnapshot(JSON.parse(evt.data));
      } catch {
        // Ignore malformed frame
      }
    });
    eventSource.addEventListener('error', () => {
      byId('sseState').textContent = 'RECONNECTING';
      byId('liveDot').classList.add('offline');
    });
  }

  connectSse();
})();
