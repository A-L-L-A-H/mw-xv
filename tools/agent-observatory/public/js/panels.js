/* global window, document */
(function () {
  window.MWObservatory = window.MWObservatory || {};

  function esc(rawText) {
    return String(rawText ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtNum(rawNumber) {
    const num = Number(rawNumber || 0);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return String(num);
  }

  function relTime(isoString) {
    if (!isoString) return '—';
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }

  function portraitForSession(session) {
    const base = '/mw-assets/illustrations/riot-universe/characters';
    if (session.status === 'error') return `${base}/kuro-signal-expression-angry.webp`;
    if (session.runtime === 'opencode') {
      return session.status === 'running'
        ? `${base}/kuro-signal-expression-determined.webp`
        : `${base}/kuro-signal-expression-victory.webp`;
    }
    if (session.runtime === 'magpie') {
      return '/mw-assets/illustrations/riot-universe/game/avatar-vesper.png';
    }
    if (session.runtime === 'claude') return `${base}/vesper-ink-portrait.webp`;
    if (session.runtime === 'codex') return `${base}/kuro-signal-expression-victory.webp`;
    if (session.runtime === 'qoder') return `${base}/kuro-signal-expression-laughing.webp`;
    if (session.runtime === 'gemini-cli') return `${base}/kuro-signal-expression-curious.webp`;
    if (session.status === 'running') return `${base}/kuro-signal-expression-excited.webp`;
    if (session.status === 'recent') return `${base}/kuro-signal-expression-determined.webp`;
    return `${base}/kuro-signal-expression-sleepy.webp`;
  }

  function renderProbes(containerEl, probes) {
    if (!containerEl) return;
    if (!probes || !probes.length) {
      containerEl.innerHTML = '<div class="empty">No probes configured</div>';
      return;
    }
    containerEl.innerHTML = probes
      .map(
        (probe) => `
      <div class="probe-row">
        <div>
          <span class="probe-dot ${esc(probe.status)}"></span>
          <strong>${esc(probe.label)}</strong>
          ${probe.detail ? `<span class="brand-sub"> · ${esc(probe.detail)}</span>` : ''}
        </div>
        <div class="brand-sub">
          ${probe.httpCode ? `HTTP ${probe.httpCode}` : probe.status.toUpperCase()} · ${probe.latencyMs ?? '—'}ms
        </div>
      </div>`
      )
      .join('');
  }

  function renderTaskInspector(inspectorEl, taskEntry, planEntry) {
    if (!inspectorEl) return;
    if (!taskEntry) {
      const nextTask = planEntry?.tasks?.find(
        (entry) => entry.dagState === 'active' || entry.dagState === 'ready'
      );
      if (!nextTask) {
        inspectorEl.innerHTML =
          '<div class="empty">Click any quest node in the p5 Quest Map to inspect details!</div>';
        return;
      }
      taskEntry = nextTask;
    }

    const depChips =
      (taskEntry.depIds || []).length > 0
        ? taskEntry.depIds
            .map(
              (depId) =>
                `<span class="sub-pill" data-jump-task="${esc(depId)}">← ${esc(depId)}</span>`
            )
            .join('')
        : '<span class="brand-sub">Root Quest</span>';

    const downstreamChips =
      (taskEntry.dependents || []).length > 0
        ? taskEntry.dependents
            .slice(0, 10)
            .map(
              (childId) =>
                `<span class="sub-pill" data-jump-task="${esc(childId)}">→ ${esc(childId)}</span>`
            )
            .join('')
        : '<span class="brand-sub">Final Boss Node</span>';

    inspectorEl.innerHTML = `
      <div class="agent-top">
        <div class="agent-badges">
          <span class="task-id">${esc(taskEntry.id)}</span>
          <span class="chip st-${esc(taskEntry.dagState || (taskEntry.done ? 'done' : 'blocked'))}">
            ${esc((taskEntry.dagState || (taskEntry.done ? 'done' : 'pending')).toUpperCase())}
          </span>
          ${taskEntry.commitSha ? `<span class="chip st-running" data-commit-sha="${esc(taskEntry.commitSha)}">${esc(taskEntry.commitSha)}</span>` : ''}
        </div>
      </div>
      <div class="agent-title">${esc(taskEntry.title)}</div>
      <div class="brand-sub">${esc(taskEntry.wave)}</div>
      <div>
        <div class="kpi-label">PREREQUISITES</div>
        <div class="subagent-strip no-border">${depChips}</div>
      </div>
      <div>
        <div class="kpi-label">UNLOCKS NEXT</div>
        <div class="subagent-strip no-border">${downstreamChips}</div>
      </div>
      ${taskEntry.ownerFiles ? `<div><div class="kpi-label">OWNER FILES</div><code>${esc(taskEntry.ownerFiles)}</code></div>` : ''}
      ${taskEntry.verify ? `<div><div class="kpi-label">VERIFY GATE</div><code>${esc(taskEntry.verify)}</code></div>` : ''}
      ${taskEntry.acceptance ? `<div><div class="kpi-label">ACCEPTANCE</div><div class="brand-sub">${esc(taskEntry.acceptance)}</div></div>` : ''}
      ${taskEntry.expected ? `<div><div class="kpi-label">EXPECTED</div><div class="brand-sub">${esc(taskEntry.expected)}</div></div>` : ''}
      ${taskEntry.spec ? `<div><div class="kpi-label">SPEC</div><div class="brand-sub">${esc(taskEntry.spec)}</div></div>` : ''}
    `;
  }

  function renderPanels(appState, snapshot, activePlan) {
    const byId = (id) => document.getElementById(id);

    // 1. Diegetic Top HUD Meters
    byId('repoMeta').textContent = `${snapshot.repoRoot} · ${relTime(snapshot.generatedAt)}`;
    const aheadBehind =
      snapshot.git.ahead || snapshot.git.behind
        ? ` ↑${snapshot.git.ahead}/↓${snapshot.git.behind}`
        : '';
    byId('gitBadge').textContent =
      `${snapshot.git.branch}@${snapshot.git.head || '—'}${aheadBehind}${snapshot.git.dirtyCount ? ` (${snapshot.git.dirtyCount} dirty)` : ''}`;

    const agBadge = byId('agApiBadge');
    agBadge.textContent = snapshot.antigravityApiConnected ? 'AG-LIVE' : 'FS-LIVE';

    const magpieBadge = byId('magpieBadge');
    const magpieInfo = snapshot.magpie;
    if (magpieBadge) {
      if (magpieInfo && (magpieInfo.connected || magpieInfo.totalRecentCalls > 0)) {
        const portHint = magpieInfo.addr ? `:${magpieInfo.addr.split(':').pop()}` : '';
        magpieBadge.textContent = `MAGPIE${portHint} · ${magpieInfo.totalRecentCalls}c${magpieInfo.rateLimit429 ? ` (${magpieInfo.rateLimit429}×429)` : ''}`;
        magpieBadge.className = `mini-tag ${magpieInfo.rateLimit429 > 0 ? 'orange' : 'magenta'}`;
      } else {
        magpieBadge.textContent = 'MAGPIE IDLE';
        magpieBadge.className = 'mini-tag';
      }
    }

    const bossHpEl = byId('kpiBossHp');
    if (bossHpEl) {
      bossHpEl.textContent = `${snapshot.battle?.bossHpPct ?? 100}%`;
    }

    const alerts = snapshot.alerts || [];
    const alertSiren = byId('alertSirenBadge');
    if (alertSiren) {
      if (alerts.length > 0) {
        const collisionCount = alerts.filter((entry) => entry.kind === 'collision').length;
        alertSiren.textContent =
          collisionCount > 0
            ? `⚠️ ${collisionCount} COLLISION${collisionCount > 1 ? 'S' : ''} · ${alerts.length} ALERTS`
            : `⚠️ ${alerts.length} ALERT${alerts.length > 1 ? 'S' : ''}`;
        alertSiren.classList.remove('hidden');
      } else {
        alertSiren.classList.add('hidden');
      }
    }

    if (activePlan) {
      byId('kpiPlanDone').textContent = `${activePlan.done}/${activePlan.total}`;
      byId('kpiPlanPct').textContent = `${activePlan.percent}%`;
      byId('kpiPlanBar').style.width = `${activePlan.percent}%`;
      const dagStats = activePlan.dag?.stats;
      byId('kpiPlanNext').textContent = activePlan.nextTaskId
        ? `${dagStats ? `${dagStats.ready} ready · ` : ''}NEXT: ${activePlan.nextTaskId} ${activePlan.nextTaskTitle}`
        : 'ALL QUESTS CLEARED!!';
      byId('tabPlanCount').textContent = `${activePlan.done}/${activePlan.total}`;
    }

    byId('kpiRunning').textContent = String(snapshot.summary.runningSessions);
    byId('kpiTotalSessions').textContent = `/${snapshot.summary.totalSessions}`;
    const runtimeCounts = snapshot.summary.runtimeCounts || {};
    byId('kpiRuntimeSplit').textContent =
      Object.entries(runtimeCounts)
        .map(([rtKey, rtCount]) => `${rtKey}:${rtCount}`)
        .join(' · ') || 'No heroes';
    byId('tabAgentsCount').textContent = String(snapshot.summary.totalSessions);

    byId('kpiSubagents').textContent = String(snapshot.summary.subagents);
    byId('kpiSwarms').textContent = String(snapshot.summary.swarms);
    const graphNodeCount = snapshot.flowGraph?.nodes?.length || 0;
    byId('tabFlowCount').textContent = String(graphNodeCount);
    byId('tabSwarmsCount').textContent = String(
      snapshot.summary.subagents + snapshot.summary.swarms
    );

    byId('kpiTokens').textContent = fmtNum(snapshot.summary.tokens.total);
    byId('kpiCachePct').textContent = `${snapshot.summary.tokens.cacheHitPct ?? 0}% cache`;

    byId('kpiHostCpu').textContent = `${snapshot.host.cpuPct ?? 0}%`;
    byId('kpiHostRam').textContent = `RAM ${snapshot.host.memUsedGb}/${snapshot.host.memTotalGb}G`;
    byId('kpiHostRamBar').style.width = `${snapshot.host.memPct ?? 0}%`;

    const vpsProbes = snapshot.probes?.vps || [];
    const upVpsProbes = vpsProbes.filter((probe) => probe.status === 'up');
    const pendingVps = vpsProbes.some((probe) => probe.status === 'pending');
    const vpsUp = upVpsProbes.length;
    const latencySample =
      upVpsProbes.length > 0
        ? upVpsProbes
        : vpsProbes.filter((probe) => typeof probe.latencyMs === 'number');
    const avgLatency =
      latencySample.length > 0
        ? Math.round(
            latencySample.reduce((acc, probe) => acc + (Number(probe.latencyMs) || 0), 0) /
              latencySample.length
          )
        : 0;
    byId('kpiVpsUp').textContent = `${vpsUp}/${vpsProbes.length} VPS`;
    byId('kpiVpsLatency').textContent = pendingVps ? 'probing…' : `${avgLatency}ms`;
    byId('tabInfraCount').textContent = `${vpsUp}/${vpsProbes.length}`;
    byId('tabTelemetryCount').textContent = String(snapshot.analytics?.errorLedger?.length || 0);
    byId('probeAge').textContent = relTime(snapshot.probes?.updatedAt);

    // 2. Manga Subtitle Live Feed Box
    const activeSessions = (snapshot.sessions || []).filter(
      (session) => session.status === 'running' || session.status === 'error'
    );
    byId('activePulseCount').textContent = `${activeSessions.length} active on stage`;

    const subtitleAvatar = byId('subtitleAvatar');
    if (subtitleAvatar && activeSessions[0]) {
      subtitleAvatar.src = portraitForSession(activeSessions[0]);
    }

    const stripEl = byId('activeQuickStrip');
    stripEl.innerHTML = activeSessions.length
      ? activeSessions
          .slice(0, 5)
          .map(
            (session) => `
          <div class="quick-agent" data-runtime="${esc(session.runtime)}" data-id="${esc(session.id)}"
               style="border-left-color:${session.status === 'error' ? 'var(--red)' : 'var(--green)'}">
            <div class="quick-agent-main">
              <div class="quick-agent-title">
                <span class="chip rt-${esc(session.runtime)}">${esc(session.runtimeLabel)}</span>
                ${esc(session.title)}
              </div>
              <div class="quick-agent-sub">${esc(session.focus || session.lastTool || 'In action…')}</div>
            </div>
            <span class="brand-sub">${relTime(session.updatedAt)}</span>
          </div>`
          )
          .join('')
      : '<div class="empty">Heroes chilling on the rooftop</div>';

    const feedQuery = (appState.feedSearch || '').trim().toLowerCase();
    const filteredFeed = (snapshot.activityFeed || []).filter((eventEntry) => {
      if (appState.feedKind !== 'all' && eventEntry.kind !== appState.feedKind) return false;
      if (
        feedQuery &&
        !`${eventEntry.runtimeLabel} ${eventEntry.sessionTitle} ${eventEntry.tool} ${eventEntry.summary}`
          .toLowerCase()
          .includes(feedQuery)
      ) {
        return false;
      }
      return true;
    });

    const feedEl = byId('activityFeed');
    feedEl.innerHTML = filteredFeed.length
      ? filteredFeed
          .slice(0, 45)
          .map(
            (eventEntry) => `
          <div class="feed-row clickable ${eventEntry.kind === 'error' ? 'error' : ''}"
               data-runtime="${esc(eventEntry.runtime)}" data-id="${esc(eventEntry.sessionId)}">
            <div class="feed-head">
              <span><span class="chip rt-${esc(eventEntry.runtime)}">${esc(eventEntry.runtimeLabel)}</span> ${esc(eventEntry.sessionTitle)}</span>
              <span>${relTime(eventEntry.at)}</span>
            </div>
            <div class="feed-msg">[${esc(eventEntry.tool || eventEntry.kind)}] ${esc(eventEntry.summary)}</div>
          </div>`
          )
          .join('')
      : '<div class="empty">No speech bubbles match filter</div>';

    renderProbes(byId('vpsProbeFull'), vpsProbes);

    // 3. Quest Map (DAG + Checklist)
    if (activePlan) {
      byId('planViewTitle').textContent =
        `🗺️ ${activePlan.title} (${activePlan.done}/${activePlan.total} · ${activePlan.percent}%)`;
      const dagStats = activePlan.dag?.stats;
      byId('dagStatsBadge').textContent = dagStats
        ? `CLEARED:${dagStats.done} · ACTIVE:${dagStats.active} · READY:${dagStats.ready} · LOCKED:${dagStats.blocked} · BOSS-CHAIN:${activePlan.dag.criticalPathIds.length}`
        : '';

      const selectedTask =
        activePlan.tasks.find((taskEntry) => taskEntry.id === appState.selectedTaskId) || null;
      renderTaskInspector(byId('dagTaskInspector'), selectedTask, activePlan);

      byId('waveGrid').innerHTML = [
        `<div class="wave-card ${appState.selectedWave === 'all' ? 'selected' : ''}" data-wave="all">
          <div style="font-weight:700;margin-bottom:3px">ALL CHAPTERS</div>
          <div class="brand-sub" style="color:var(--yellow)">${activePlan.done}/${activePlan.total} (${activePlan.percent}%)</div>
          <div class="bar-track"><div class="bar-fill" style="width:${activePlan.percent}%"></div></div>
        </div>`,
        ...activePlan.waves.map(
          (waveEntry) => `
          <div class="wave-card ${appState.selectedWave === waveEntry.title ? 'selected' : ''}" data-wave="${esc(waveEntry.title)}">
            <div style="font-weight:700;font-size:12px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(waveEntry.title)}</div>
            <div class="brand-sub">${waveEntry.done}/${waveEntry.total} (${waveEntry.percent}%)</div>
            <div class="bar-track"><div class="bar-fill" style="width:${waveEntry.percent}%"></div></div>
          </div>`
        ),
      ].join('');

      const query = (appState.taskSearch || '').trim().toLowerCase();
      const filteredTasks = activePlan.tasks.filter((taskEntry) => {
        if (appState.selectedWave !== 'all' && taskEntry.wave !== appState.selectedWave)
          return false;
        if (appState.taskStatusFilter === 'done' && !taskEntry.done) return false;
        if (appState.taskStatusFilter === 'pending' && taskEntry.done) return false;
        if (appState.taskStatusFilter === 'ready' && taskEntry.dagState !== 'ready') return false;
        if (appState.taskStatusFilter === 'active' && taskEntry.dagState !== 'active') return false;
        if (
          query &&
          !`${taskEntry.id} ${taskEntry.title} ${taskEntry.ownerFiles} ${taskEntry.wave}`
            .toLowerCase()
            .includes(query)
        ) {
          return false;
        }
        return true;
      });

      byId('taskTable').innerHTML = filteredTasks.length
        ? filteredTasks
            .map((taskEntry) => {
              const expanded = appState.expandedTasks.has(taskEntry.id);
              const badgeIcon =
                taskEntry.dagState === 'done'
                  ? '★'
                  : taskEntry.dagState === 'active'
                    ? '⚡'
                    : taskEntry.dagState === 'ready'
                      ? '▶'
                      : '○';
              return `
              <div class="task-row ${esc(taskEntry.dagState)}">
                <div class="task-head" data-task-id="${esc(taskEntry.id)}">
                  <div>
                    <span class="chip st-${esc(taskEntry.dagState)}" style="margin-right:7px">${badgeIcon} ${esc(taskEntry.dagState.toUpperCase())}</span>
                    <span class="task-id">${esc(taskEntry.id)}</span>
                    <span>${esc(taskEntry.title)}</span>
                  </div>
                  <div class="toolbar">
                    ${taskEntry.commitSha ? `<span class="chip st-running" data-commit-sha="${esc(taskEntry.commitSha)}">${esc(taskEntry.commitSha)}</span>` : ''}
                    <span class="brand-sub">${expanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                ${
                  expanded
                    ? `<div class="task-detail">
                        <div><strong>Chapter:</strong> ${esc(taskEntry.wave)}</div>
                        ${taskEntry.ownerFiles ? `<div><strong>Owner Files:</strong> <code>${esc(taskEntry.ownerFiles)}</code></div>` : ''}
                        ${taskEntry.dependsOn ? `<div><strong>Depends On:</strong> <code>${esc(taskEntry.dependsOn)}</code></div>` : ''}
                        ${taskEntry.acceptance ? `<div><strong>Acceptance:</strong> ${esc(taskEntry.acceptance)}</div>` : ''}
                        ${taskEntry.expected ? `<div><strong>Expected:</strong> ${esc(taskEntry.expected)}</div>` : ''}
                        ${taskEntry.verify ? `<div><strong>Verify:</strong> <code>${esc(taskEntry.verify)}</code></div>` : ''}
                        ${taskEntry.spec ? `<div><strong>Spec:</strong> ${esc(taskEntry.spec)}</div>` : ''}
                      </div>`
                    : ''
                }
              </div>`;
            })
            .join('')
        : '<div class="empty">No quests match filter</div>';
    }

    // 4. Beat & Telemetry Lab — Magpie Hyper-Router Gateway + Runtime Matrix + Tools
    const magpieSummaryBadge = byId('magpieSummaryBadge');
    const magpieProviderBars = byId('magpieProviderBars');
    const magpieRouteFeed = byId('magpieRouteFeed');
    if (magpieSummaryBadge && magpieProviderBars && magpieRouteFeed) {
      const mInfo = snapshot.magpie;
      if (mInfo && (mInfo.connected || mInfo.totalRecentCalls > 0)) {
        const memTxt = mInfo.memoryStats
          ? ` · mem ${mInfo.memoryStats.recalled}/${mInfo.memoryStats.searches} recall`
          : '';
        const p50Txt = mInfo.p50LatencyMs ? `p50 ${mInfo.p50LatencyMs}ms / ` : '';
        magpieSummaryBadge.textContent = `${mInfo.connected ? 'ONLINE' : 'STANDBY'} ${mInfo.addr || ''}${mInfo.version ? ` v${mInfo.version}` : ''} · ${mInfo.totalRecentCalls} calls (${mInfo.okCalls} ok, ${mInfo.rateLimit429}×429, ${mInfo.errorCalls} err) · ${p50Txt}avg ${mInfo.avgLatencyMs}ms / ttft ${mInfo.avgTtftMs}ms${memTxt}`;

        const provList = mInfo.providers || [];
        const maxProvCalls = Math.max(1, ...provList.map((prov) => prov.calls || 0));
        magpieProviderBars.innerHTML = provList.length
          ? provList
              .map((prov) => {
                const pct = Math.max(4, Math.round((prov.calls / maxProvCalls) * 100));
                const barCls = prov.rateLimits > 0 ? 'bar-violet' : 'bar-fill';
                return `
                  <div class="metric-bar-row">
                    <div class="metric-bar-head">
                      <span><span class="chip rt-magpie">${esc(prov.provider)}</span> ${esc((prov.models || []).slice(0, 2).join(', '))}</span>
                      <span>${prov.calls}c · ${fmtNum(prov.tokens)} tok · ${prov.avgMs}ms${prov.rateLimits ? ` · <strong style="color:var(--orange)">${prov.rateLimits}×429</strong>` : ''}</span>
                    </div>
                    <div class="bar-track"><div class="bar-fill ${barCls}" style="width:${pct}%"></div></div>
                  </div>`;
              })
              .join('')
          : '<div class="empty">Magpie gateway online — awaiting route traffic</div>';

        const routeRows = mInfo.recentRoutes || [];
        magpieRouteFeed.innerHTML = routeRows.length
          ? routeRows
              .slice(0, 18)
              .map(
                (hop) => `
                  <div class="feed-row ${hop.status >= 400 ? 'error' : ''}">
                    <div class="feed-head">
                      <span><span class="chip rt-${esc(hop.targetRuntime || 'magpie')}">${esc(hop.agent)}</span> → <strong>${esc(hop.provider)}</strong></span>
                      <span>HTTP ${hop.status} · ${hop.ms}ms (${hop.ttftMs}ms ttft)</span>
                    </div>
                    <div class="feed-msg">${esc(hop.model)} · ${fmtNum(hop.tokens)} tok${hop.cached ? ` (${fmtNum(hop.cached)} cached)` : ''} · ${relTime(hop.at)}</div>
                  </div>`
              )
              .join('')
          : '<div class="empty">No recent Magpie route hops in last 2h</div>';
      } else {
        magpieSummaryBadge.textContent = 'Magpie gateway not detected on host';
        magpieProviderBars.innerHTML =
          '<div class="empty">No Magpie usage telemetry detected</div>';
        magpieRouteFeed.innerHTML = '<div class="empty">No recent Magpie routes</div>';
      }
    }

    const analytics = snapshot.analytics || {};
    const runtimeRows = analytics.runtimeBreakdown || [];
    const maxRtTokens = Math.max(1, ...runtimeRows.map((row) => row.totalTokens || 0));
    byId('runtimeMatrix').innerHTML = runtimeRows.length
      ? runtimeRows
          .map((row) => {
            const pct = Math.max(4, Math.round(((row.totalTokens || 0) / maxRtTokens) * 100));
            return `
            <div class="metric-bar-row">
              <div class="metric-bar-head">
                <span><span class="chip rt-${esc(row.runtime)}">${esc(row.label)}</span> ${row.running}/${row.sessions} active · ${row.subagents} sidekicks</span>
                <span>${fmtNum(row.totalTokens)} tok · <strong style="color:var(--yellow)">${row.cacheHitPct}% cache</strong></span>
              </div>
              <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            </div>`;
          })
          .join('')
      : '<div class="empty">No runtime metrics yet</div>';

    const toolRows = analytics.toolFrequency || [];
    const maxToolCalls = Math.max(1, ...toolRows.map((toolEntry) => toolEntry.calls || 0));
    const modelRows = analytics.modelBreakdown || [];
    byId('toolModelBreakdown').innerHTML = `
      ${toolRows
        .slice(0, 8)
        .map((toolEntry) => {
          const pct = Math.max(4, Math.round((toolEntry.calls / maxToolCalls) * 100));
          return `
          <div class="metric-bar-row">
            <div class="metric-bar-head">
              <span><strong>${esc(toolEntry.name)}</strong> <span class="brand-sub">(${toolEntry.runtimes.join(', ')})</span></span>
              <span>${toolEntry.calls} hits${toolEntry.errors ? ` · <span style="color:var(--red)">${toolEntry.errors} bonk</span>` : ''}</span>
            </div>
            <div class="bar-track"><div class="bar-fill bar-violet" style="width:${pct}%"></div></div>
          </div>`;
        })
        .join('')}
      ${
        modelRows.length
          ? `<div class="subagent-strip">${modelRows
              .slice(0, 8)
              .map(
                (modelEntry) =>
                  `<span class="sub-pill">${esc(modelEntry.model)} · ${fmtNum(modelEntry.tokens)} tok (${modelEntry.sessions})</span>`
              )
              .join('')}</div>`
          : ''
      }
    `;

    const alertsRadarCount = byId('alertsRadarCount');
    const alertsRadarList = byId('alertsRadarList');
    if (alertsRadarCount && alertsRadarList) {
      alertsRadarCount.textContent = `${alerts.length} active alert${alerts.length === 1 ? '' : 's'}`;
      alertsRadarList.innerHTML = alerts.length
        ? alerts
            .map(
              (alertEntry) => `
            <div class="feed-row ${alertEntry.severity === 'high' ? 'error' : ''} ${alertEntry.sessionId ? 'clickable' : ''}"
                 ${alertEntry.sessionId ? `data-runtime="${esc(alertEntry.runtime)}" data-id="${esc(alertEntry.sessionId)}"` : ''}>
              <div class="feed-head">
                <span><span class="chip st-${alertEntry.severity === 'high' ? 'error' : 'active'}">${esc(alertEntry.title)}</span> <strong>${esc(alertEntry.target)}</strong></span>
                <span>${esc(alertEntry.kind.toUpperCase())}</span>
              </div>
              <div class="feed-msg">${esc(alertEntry.detail)}</div>
            </div>`
            )
            .join('')
        : '<div class="empty">ALL CLEAR!! ZERO COLLISIONS OR LOOPS DETECTED!</div>';
    }

    const errors = analytics.errorLedger || [];
    byId('errorLedgerCount').textContent = `${errors.length} bonk(s)`;
    byId('errorLedgerList').innerHTML = errors.length
      ? errors
          .map(
            (errEntry) => `
          <div class="feed-row error clickable" data-runtime="${esc(errEntry.runtime)}" data-id="${esc(errEntry.sessionId)}">
            <div class="feed-head">
              <span><span class="chip rt-${esc(errEntry.runtime)}">${esc(errEntry.runtimeLabel)}</span> ${esc(errEntry.sessionTitle)}</span>
              <span>${relTime(errEntry.at)}</span>
            </div>
            <div class="feed-msg">[${esc(errEntry.tool)}] ${esc(errEntry.message)}</div>
          </div>`
          )
          .join('')
      : '<div class="empty">ZERO BONKS!! ALL HEROES CLEAN!</div>';

    // 5. Cast Roster (Character Select Cards with REAL MoonWitness portraits!)
    const agentQuery = (appState.agentSearch || '').trim().toLowerCase();
    const filteredAgents = (snapshot.sessions || [])
      .filter((session) => {
        if (appState.filterRuntime !== 'all' && session.runtime !== appState.filterRuntime)
          return false;
        if (appState.filterStatus === 'running' && session.status !== 'running') return false;
        if (
          appState.filterStatus === 'recent' &&
          session.status !== 'running' &&
          session.status !== 'recent'
        ) {
          return false;
        }
        if (appState.filterStatus === 'error' && !session.lastError) return false;
        if (appState.workspaceOnly && !session.inCurrentWorkspace) return false;
        if (
          agentQuery &&
          !`${session.title} ${session.focus} ${session.model} ${session.branch || ''} ${session.lastTool} ${session.id}`
            .toLowerCase()
            .includes(agentQuery)
        ) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (appState.agentSort === 'tokens')
          return (right.tokens?.total || 0) - (left.tokens?.total || 0);
        if (appState.agentSort === 'steps') return (right.steps || 0) - (left.steps || 0);
        if (appState.agentSort === 'subagents') {
          return (right.subagents?.length || 0) - (left.subagents?.length || 0);
        }
        return right.mtimeMs - left.mtimeMs;
      });

    const agentListEl = byId('agentList');
    agentListEl.classList.toggle('table-mode', appState.agentView === 'table');

    if (!filteredAgents.length) {
      agentListEl.innerHTML = '<div class="empty">No heroes match current filters</div>';
    } else if (appState.agentView === 'table') {
      agentListEl.innerHTML = `
        <table class="fleet-table">
          <thead>
            <tr>
              <th>Hero</th>
              <th>Mood</th>
              <th>Mission</th>
              <th>Gear</th>
              <th>Moves</th>
              <th>Power</th>
              <th>Sidekicks</th>
              <th>Seen</th>
            </tr>
          </thead>
          <tbody>
            ${filteredAgents
              .map(
                (session) => `
              <tr class="clickable" data-runtime="${esc(session.runtime)}" data-id="${esc(session.id)}">
                <td><span class="chip rt-${esc(session.runtime)}">${esc(session.runtimeLabel)}</span></td>
                <td><span class="chip st-${esc(session.status)}">${esc(session.status.toUpperCase())}</span></td>
                <td><strong>${esc(session.title)}</strong><div class="brand-sub">${esc(session.focus || session.lastTool || 'Idle')}</div></td>
                <td class="brand-sub">${esc(session.model)}</td>
                <td class="brand-sub">${session.steps || 0}</td>
                <td class="brand-sub">${fmtNum(session.tokens?.total || 0)}</td>
                <td class="brand-sub">${(session.subagents || []).length}</td>
                <td class="brand-sub">${relTime(session.updatedAt)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`;
    } else {
      agentListEl.innerHTML = filteredAgents
        .map((session) => {
          const tokSum = Math.max(
            1,
            (session.tokens?.input || 0) +
              (session.tokens?.cached || 0) +
              (session.tokens?.output || 0)
          );
          const inPct = Math.round(((session.tokens?.input || 0) / tokSum) * 100);
          const cachePct = Math.round(((session.tokens?.cached || 0) / tokSum) * 100);
          const outPct = Math.max(0, 100 - inPct - cachePct);
          const subHtml =
            session.subagents && session.subagents.length
              ? `<div class="subagent-strip">${session.subagents
                  .slice(0, 5)
                  .map(
                    (subEntry) =>
                      `<span class="sub-pill">★ ${esc(subEntry.role || subEntry.type)}</span>`
                  )
                  .join(
                    ''
                  )}${session.subagents.length > 5 ? `<span class="sub-pill">+${session.subagents.length - 5} more</span>` : ''}</div>`
              : '';
          return `
            <article class="agent-card ${esc(session.status)}" data-runtime="${esc(session.runtime)}" data-id="${esc(session.id)}">
              <div class="cast-card-layout">
                <img class="cast-avatar" src="${esc(portraitForSession(session))}" alt="${esc(session.runtimeLabel)}" loading="lazy" />
                <div class="cast-body">
                  <div class="agent-top">
                    <div class="agent-badges">
                      ${session.health ? `<span class="rank-badge rank-${esc(session.health.rank)}" title="MAST Trajectory Health ${session.health.score}/100 (${session.health.mastClass})">${esc(session.health.rank)}</span>` : ''}
                      <span class="chip rt-${esc(session.runtime)}">${esc(session.runtimeLabel)}</span>
                      <span class="chip st-${esc(session.status)}">${esc(session.status.toUpperCase())}</span>
                      ${session.health?.silentLoop ? '<span class="chip st-error">🌀 SILENT LOOP</span>' : ''}
                      ${session.isCurrentSession ? '<span class="chip st-active">STAR HERO</span>' : ''}
                      ${session.swarmWorkers ? `<span class="chip rt-visual-swarm">SWARM:${session.swarmWorkers}</span>` : ''}
                    </div>
                    <span class="brand-sub">${relTime(session.updatedAt)}</span>
                  </div>
                  <div class="agent-title">${esc(session.title)}</div>
                  <div class="agent-focus">${esc(session.focus || session.lastTool || 'Chilling')}</div>
                  ${session.lastError ? `<div class="agent-focus" style="color:var(--red);margin-top:3px">BONK: ${esc(session.lastError)}</div>` : ''}
                  <div class="tok-bar" title="Tokens: input / cache / output">
                    <span class="tok-in" style="width:${inPct}%"></span>
                    <span class="tok-cache" style="width:${cachePct}%"></span>
                    <span class="tok-out" style="width:${outPct}%"></span>
                  </div>
                  <div class="agent-meta">
                    <span>gear:${esc(session.model)}</span>
                    ${session.branch ? `<span>branch:${esc(session.branch)}</span>` : ''}
                    ${typeof session.cost === 'number' && session.cost > 0 ? `<span>cost:$${session.cost.toFixed(3)}</span>` : ''}
                    ${session.health?.dietWastePct > 0 ? `<span style="color:var(--orange)">diet:~${session.health.dietWastePct}% bloat</span>` : ''}
                    <span>moves:${session.steps || 0}</span>
                    <span>tok:${fmtNum(session.tokens?.total || 0)}</span>
                  </div>
                  ${subHtml}
                </div>
              </div>
            </article>`;
        })
        .join('');
    }

    // 6. Swarms & Sidekicks
    byId('swarmList').innerHTML = (snapshot.swarms || []).length
      ? snapshot.swarms
          .map(
            (swarmEntry) => `
          <div class="agent-card">
            <div class="agent-top">
              <span class="chip rt-${esc(swarmEntry.runtime)}">${esc(swarmEntry.runtime)}</span>
              <span class="brand-sub">${(swarmEntry.workers || []).length} squad members</span>
            </div>
            <div class="agent-title">${esc(swarmEntry.title)}</div>
            <div class="agent-focus" style="white-space:normal">${esc(swarmEntry.line)}</div>
            <div class="subagent-strip">
              ${(swarmEntry.workers || [])
                .map(
                  (worker) =>
                    `<span class="sub-pill">${esc(worker.name)}: ${esc(worker.task || worker.status || '')}</span>`
                )
                .join('')}
            </div>
          </div>`
          )
          .join('')
      : '<div class="empty">No active swarm squads right now</div>';

    const parentsWithSubs = (snapshot.sessions || []).filter(
      (session) => session.subagents && session.subagents.length > 0
    );
    byId('subagentTree').innerHTML = parentsWithSubs.length
      ? parentsWithSubs
          .map(
            (parentSession) => `
          <div class="agent-card" data-runtime="${esc(parentSession.runtime)}" data-id="${esc(parentSession.id)}">
            <div class="agent-top">
              <div class="agent-badges">
                <span class="chip rt-${esc(parentSession.runtime)}">${esc(parentSession.runtimeLabel)}</span>
                <strong>${esc(parentSession.title)}</strong>
              </div>
              <span class="brand-sub">${parentSession.subagents.length} chibi sidekick(s)</span>
            </div>
            <div class="stack-tight" style="margin-top:8px;padding-left:14px;border-left:3px solid var(--yellow)">
              ${parentSession.subagents
                .map(
                  (subEntry) => `
                <div class="probe-row">
                  <div>
                    <strong>${esc(subEntry.role || subEntry.id)}</strong>
                    <span class="brand-sub">(${esc(subEntry.type || 'sidekick')} · ${esc(subEntry.model || 'inherit')})</span>
                  </div>
                  <span class="brand-sub">${relTime(subEntry.at)}</span>
                </div>`
                )
                .join('')}
            </div>
          </div>`
          )
          .join('')
      : '<div class="empty">No sidekick spawns yet</div>';

    // 7. Moon City Infra & Git Reel
    const diffStat = snapshot.git.diffStat || { filesChanged: 0, insertions: 0, deletions: 0 };
    byId('gitSummaryDetail').textContent =
      `branch: ${snapshot.git.branch} · ${snapshot.git.dirtyCount} dirty · ${snapshot.git.stashCount || 0} stash`;
    byId('gitDiffStatBadge').textContent =
      `${diffStat.filesChanged} tracked diff · +${diffStat.insertions} / -${diffStat.deletions}`;

    byId('gitCommitList').innerHTML = (snapshot.git.commits || []).length
      ? snapshot.git.commits
          .map(
            (commitEntry) => `
          <div class="feed-row clickable" data-commit-sha="${esc(commitEntry.sha)}">
            <div class="feed-head">
              <span>
                <strong style="color:var(--yellow)">${esc(commitEntry.sha)}</strong>
                ${commitEntry.taskId ? `<span class="chip st-running">${esc(commitEntry.taskId)}</span>` : ''}
                · ${esc(commitEntry.author)}
              </span>
              <span>${relTime(commitEntry.at)}</span>
            </div>
            <div class="feed-msg">${esc(commitEntry.subject)}</div>
          </div>`
          )
          .join('')
      : '<div class="empty">No commits found</div>';

    const dirtyAreas = Object.entries(snapshot.git.dirtyByArea || {}).sort(
      (left, right) => right[1] - left[1]
    );
    byId('dirtyAreaPills').innerHTML = dirtyAreas.length
      ? dirtyAreas
          .map(([area, count]) => `<span class="sub-pill">${esc(area)}: ${count}</span>`)
          .join('')
      : '<span class="brand-sub">Working tree spotless!</span>';

    byId('dirtyFilesList').innerHTML = (snapshot.git.dirtyFiles || []).length
      ? snapshot.git.dirtyFiles
          .slice(0, 40)
          .map(
            (fileEntry) => `
          <div class="probe-row">
            <span><span class="chip st-${fileEntry.status === 'deleted' ? 'error' : fileEntry.status === 'untracked' ? 'ready' : 'active'}">${esc(fileEntry.code)}</span> ${esc(fileEntry.path)}</span>
            <span class="brand-sub">${esc(fileEntry.area)}</span>
          </div>`
          )
          .join('')
      : '<div class="empty">Clean working tree</div>';

    byId('localPortGrid').innerHTML = (snapshot.probes?.localPorts || [])
      .map(
        (portEntry) => `
      <div class="probe-row">
        <span><span class="probe-dot ${portEntry.open ? 'up' : 'pending'}"></span>${esc(portEntry.label)}</span>
        <span class="brand-sub">${portEntry.open ? 'OPEN' : '—'}</span>
      </div>`
      )
      .join('');

    byId('hostDiagGrid').innerHTML = `
      <div class="probe-row"><span>Rig / OS</span><span class="brand-sub">${esc(snapshot.host.hostname)} · ${esc(snapshot.host.platform)}/${esc(snapshot.host.arch || '')}</span></div>
      <div class="probe-row"><span>Engine</span><span class="brand-sub">${snapshot.host.cpus} cores · ${esc(snapshot.host.cpuModel || '')}</span></div>
      <div class="probe-row"><span>Live CPU Turbo</span><span class="brand-sub" style="color:var(--yellow)">${snapshot.host.cpuPct ?? 0}%</span></div>
      <div class="probe-row"><span>Memory Tank</span><span class="brand-sub">${snapshot.host.memUsedGb} / ${snapshot.host.memTotalGb} GB (${snapshot.host.memPct}%)</span></div>
      <div class="probe-row"><span>Broadcast Uptime</span><span class="brand-sub">${snapshot.host.uptimeSec}s · ${snapshot.telemetryHistory?.length || 0} frames</span></div>
    `;

    // 8. Internal R&D Discovery & Monitoring Lab (Tab 7)
    const disc = snapshot.discovery;
    if (disc && disc.counts) {
      const totalDisc =
        (disc.counts.apps || 0) +
        (disc.counts.packages || 0) +
        (disc.counts.adrs || 0) +
        (disc.counts.skills || 0);
      const tabDiscEl = byId('tabDiscoveryCount');
      if (tabDiscEl) tabDiscEl.textContent = String(totalDisc);

      const vaultMetaEl = byId('discoveryVaultMeta');
      if (vaultMetaEl) {
        vaultMetaEl.textContent = `Apps:${disc.counts.apps} · Pkgs:${disc.counts.packages} · ADRs:${disc.counts.adrs} · Skills:${disc.counts.skills} · Compose:${disc.counts.composeStacks} · Magpie Vault:${disc.counts.magpieVaultCards} cards`;
      }

      const dQuery = (appState.discoverySearch || '').trim().toLowerCase();
      const matchStr = (text) =>
        !dQuery ||
        String(text || '')
          .toLowerCase()
          .includes(dQuery);

      const filteredAdrs = (disc.adrs || []).filter((entry) =>
        matchStr(`${entry.id} ${entry.title} ${entry.status}`)
      );
      if (byId('discoveryAdrCount'))
        byId('discoveryAdrCount').textContent = String(filteredAdrs.length);
      if (byId('discoveryAdrList')) {
        byId('discoveryAdrList').innerHTML = filteredAdrs.length
          ? filteredAdrs
              .map(
                (entry) => `
              <div class="feed-row clickable" data-doc-path="${esc(entry.relPath)}">
                <div class="feed-head">
                  <span><strong style="color:var(--yellow)">${esc(entry.id)}</strong></span>
                  <span class="chip st-${entry.status.toLowerCase().includes('accept') ? 'done' : 'ready'}">${esc(entry.status)}</span>
                </div>
                <div class="feed-msg">${esc(entry.title)}</div>
              </div>`
              )
              .join('')
          : '<div class="empty">No matching ADRs</div>';
      }

      const filteredSkills = (disc.skills || []).filter((entry) =>
        matchStr(`${entry.name} ${entry.description}`)
      );
      if (byId('discoverySkillCount'))
        byId('discoverySkillCount').textContent = String(filteredSkills.length);
      if (byId('discoverySkillsList')) {
        byId('discoverySkillsList').innerHTML = filteredSkills.length
          ? filteredSkills
              .map(
                (entry) => `
              <div class="feed-row clickable" data-doc-path="${esc(entry.relPath)}">
                <div class="feed-head">
                  <span><span class="chip rt-codex">SKILL</span> <strong>${esc(entry.name)}</strong></span>
                  <span>${esc(entry.relPath)}</span>
                </div>
                <div class="feed-msg">${esc(entry.description)}</div>
              </div>`
              )
              .join('')
          : '<div class="empty">No matching skills</div>';
      }

      const dirtyAreasMap = snapshot.git?.dirtyByArea || {};
      const renderPkgRow = (entry) => {
        const dirtyHits = dirtyAreasMap[entry.dir] || 0;
        return `
          <div class="probe-row">
            <span>
              <span class="chip ${entry.runtime === 'go' ? 'rt-opencode' : entry.kind === 'app' ? 'rt-antigravity' : 'rt-claude'}">${esc(entry.runtime.toUpperCase())}</span>
              <strong>${esc(entry.name)}</strong>
              <span class="brand-sub"> · ${esc(entry.dir)}</span>
            </span>
            <span class="brand-sub">
              ${dirtyHits > 0 ? `<span class="chip st-active">${dirtyHits} dirty</span> ` : ''}
              v${esc(entry.version)} · ${entry.scriptsCount} scr
            </span>
          </div>`;
      };

      const filteredApps = (disc.apps || []).filter((entry) =>
        matchStr(`${entry.name} ${entry.dir}`)
      );
      if (byId('discoveryAppCount'))
        byId('discoveryAppCount').textContent = String(filteredApps.length);
      if (byId('discoveryAppsList')) {
        byId('discoveryAppsList').innerHTML = filteredApps.length
          ? filteredApps.map(renderPkgRow).join('')
          : '<div class="empty">No matching apps</div>';
      }

      const filteredPkgs = (disc.packages || []).filter((entry) =>
        matchStr(`${entry.name} ${entry.dir}`)
      );
      if (byId('discoveryPkgCount'))
        byId('discoveryPkgCount').textContent = String(filteredPkgs.length);
      if (byId('discoveryPackagesList')) {
        byId('discoveryPackagesList').innerHTML = filteredPkgs.length
          ? filteredPkgs.map(renderPkgRow).join('')
          : '<div class="empty">No matching packages</div>';
      }

      const filteredCompose = (disc.composeStacks || []).filter((entry) => matchStr(entry.name));
      if (byId('discoveryComposeCount'))
        byId('discoveryComposeCount').textContent = String(filteredCompose.length);
      if (byId('discoveryComposeList')) {
        byId('discoveryComposeList').innerHTML = filteredCompose.length
          ? filteredCompose
              .map((entry) => `<span class="sub-pill">🐳 ${esc(entry.name)}</span>`)
              .join('')
          : '<span class="brand-sub">No compose files</span>';
      }
    }
  }

  window.MWObservatory.utils = { esc, fmtNum, relTime, portraitForSession };
  window.MWObservatory.renderPanels = renderPanels;
  window.MWObservatory.renderTaskInspector = renderTaskInspector;
})();
