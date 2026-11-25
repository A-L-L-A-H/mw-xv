/* global window, p5, ResizeObserver */
(function () {
  window.MWObservatory = window.MWObservatory || {};

  // Authentic MoonWitness Riot Universe palette
  const INK = [13, 13, 13];
  const PAPER = [243, 239, 228];
  const YELLOW = [255, 224, 49];
  const MAGENTA = [255, 46, 136];
  const CYAN = [0, 184, 240];
  const VIOLET = [192, 132, 252];
  const LIME = [180, 255, 57];
  const RED = [255, 59, 92];

  const RUNTIME_COLORS = Object.freeze({
    hub: YELLOW,
    antigravity: CYAN,
    claude: YELLOW,
    codex: LIME,
    qoder: VIOLET,
    'gemini-cli': [96, 165, 250],
    'visual-swarm': MAGENTA,
    plan: YELLOW,
    git: MAGENTA,
    infra: [74, 222, 128],
  });

  const STAGE_BACKDROPS = Object.freeze({
    rooftop: '/mw-art/crew-rooftop-1440.webp',
    alley: '/mw-assets/illustrations/riot-universe/backgrounds/bg-riot-street-alley.webp',
    observatory: '/mw-art/dna-lunar-observatory-1440.webp',
    arcade: '/mw-assets/illustrations/riot-universe/backgrounds/bg-riot-arcade-workbench.webp',
  });

  const SPRITE_URLS = Object.freeze({
    kuroRun:
      '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-excited.webp',
    kuroWork:
      '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-determined.webp',
    kuroGaming:
      '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-victory.webp',
    kuroCelebrate:
      '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-celebrating.webp',
    kuroAngry:
      '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-angry.webp',
    kuroCurious:
      '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-curious.webp',
    kuroSleepy:
      '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-sleepy.webp',
    vesper: '/mw-assets/illustrations/riot-universe/characters/vesper-ink-portrait.webp',
    stickerBoom: '/mw-assets/illustrations/riot-universe/stickers/sticker-comic-boom.png',
    stickerBolt: '/mw-assets/illustrations/riot-universe/stickers/sticker-lightning-bolt.png',
    stickerStar: '/mw-assets/illustrations/riot-universe/stickers/sticker-riot-star.png',
  });

  const SFX_WORDS = Object.freeze({
    tool: ['ZAP!!', 'SLASH!', 'WHIRRR!', 'CLACK!', 'BZZT!'],
    subagent: ['SUMMON!!', 'SQUAD UP!', 'POOF!!', 'CLONE!'],
    swarm: ['SWARM!!', 'RIOT MODE!', 'MEGA!!'],
    focus: ['AHA!!', 'THINK!', 'LOCK ON!'],
    error: ['BONK!!', 'GLITCH!!', 'OOPS!!', 'CRASH!'],
    message: ['YO!!', 'CHECK!', 'DONE!'],
    user: ['ORDER!!', 'GO!!'],
  });

  function colorForNode(nodeEntry) {
    if (nodeEntry.status === 'error') return RED;
    if (nodeEntry.kind === 'swarm') return MAGENTA;
    return RUNTIME_COLORS[nodeEntry.runtime] || PAPER;
  }

  function radiusForNode(nodeEntry) {
    if (nodeEntry.kind === 'hub') return 42;
    if (nodeEntry.kind === 'runtime') return 30;
    if (nodeEntry.kind === 'agent')
      return nodeEntry.status === 'running' ? 30 : nodeEntry.status === 'recent' ? 24 : 15;
    if (nodeEntry.kind === 'swarm') return 26;
    if (nodeEntry.kind === 'subagent') return 11;
    return 18;
  }

  function createFlowCanvas(hostEl, tooltipEl, callbacks = {}) {
    if (!hostEl || typeof p5 === 'undefined') {
      return {
        setSnapshot() {},
        setMode() {},
        setBackdrop() {},
        setAutoCam() {},
        setOptions() {},
        setVisible() {},
        triggerShowstopper() {},
        fitView() {},
        resetPins() {},
        savePng() {},
        destroy() {},
      };
    }

    let layoutMode = 'stage';
    let stageBackdropKey = 'rooftop';
    let autoCamEnabled = false;
    let showSubagents = true;
    let showTargets = true;
    let showIdle = true;
    let flowSpeed = 1.05;
    let isVisible = true;

    let rawGraph = { nodes: [], edges: [], pulses: [] };
    let filteredNodes = [];
    let filteredEdges = [];
    const nodePositions = new Map();
    const seenPulseIds = new Set();

    // Living cartoon visual FX pools
    const ambientPackets = [];
    const burstComets = [];
    const comicBursts = []; // { x, y, text, rgb, life, maxLife, rot, scale }
    const speechBubbles = new Map(); // nodeId -> { text, rgb, bornAt, durationMs }
    const inkSplashes = []; // { x, y, vx, vy, r, rgb, alpha }
    const rainDrops = [];
    let screenShake = 0;

    // Camera state
    let camX = 0;
    let camY = 0;
    let camScale = 1;
    let targetCamX = 0;
    let targetCamY = 0;
    let targetCamScale = 1;
    let hasAutoFitted = false;

    // Pointer interaction
    let hoveredNodeId = null;
    let draggedNodeId = null;
    let isPanning = false;
    let pointerMoved = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let lastClickTime = 0;
    let lastClickedNodeId = null;

    // Loaded MoonWitness image caches
    const backdropImgs = {};
    const spriteImgs = {};
    let sketchInstance = null;
    let resizeObserver = null;

    function screenToWorld(sx, sy) {
      return {
        x: (sx - camX) / camScale,
        y: (sy - camY) / camScale,
      };
    }

    function upsertTarget(nodeId, tx, ty) {
      const existing = nodePositions.get(nodeId);
      if (!existing) {
        nodePositions.set(nodeId, {
          x: tx,
          y: ty,
          tx,
          ty,
          pinned: false,
          bouncePhase: Math.random() * 6.28,
        });
      } else {
        existing.tx = tx;
        existing.ty = ty;
      }
    }

    function relaxOverlaps(nodesList, iterations = 5) {
      for (let iter = 0; iter < iterations; iter += 1) {
        for (let leftIdx = 0; leftIdx < nodesList.length; leftIdx += 1) {
          const leftNode = nodesList[leftIdx];
          const leftPos = nodePositions.get(leftNode.id);
          if (!leftPos || leftPos.pinned) continue;
          const leftRad = radiusForNode(leftNode);
          for (let rightIdx = leftIdx + 1; rightIdx < nodesList.length; rightIdx += 1) {
            const rightNode = nodesList[rightIdx];
            const rightPos = nodePositions.get(rightNode.id);
            if (!rightPos || rightPos.pinned) continue;
            const minGap = leftRad + radiusForNode(rightNode) + 22;
            const dx = rightPos.tx - leftPos.tx;
            const dy = rightPos.ty - leftPos.ty;
            const distSq = dx * dx + dy * dy;
            if (distSq < minGap * minGap) {
              const dist = Math.max(0.5, Math.sqrt(distSq));
              const push = (minGap - dist) * 0.44;
              leftPos.tx -= (dx / dist) * push;
              leftPos.ty -= (dy / dist) * push;
              rightPos.tx += (dx / dist) * push;
              rightPos.ty += (dy / dist) * push;
            }
          }
        }
      }
    }

    function applyFilterAndTargets(width, height) {
      const nodes = rawGraph.nodes || [];
      const edges = rawGraph.edges || [];

      filteredNodes = nodes.filter((nodeEntry) => {
        if (!showSubagents && (nodeEntry.kind === 'subagent' || nodeEntry.kind === 'swarm'))
          return false;
        if (
          !showTargets &&
          (nodeEntry.kind === 'plan-wave' ||
            nodeEntry.kind === 'workspace-area' ||
            nodeEntry.kind === 'infra')
        ) {
          return false;
        }
        if (!showIdle && nodeEntry.kind === 'agent' && nodeEntry.status === 'idle') return false;
        return true;
      });

      const activeIds = new Set(filteredNodes.map((nodeEntry) => nodeEntry.id));
      filteredEdges = edges.filter(
        (edgeEntry) => activeIds.has(edgeEntry.from) && activeIds.has(edgeEntry.to)
      );

      const safeTop = 148;
      const safeBottom = 94;
      const safeLeft = 90;
      const safeRight = 385; // Keep right breathing room for collapsible manga subtitle box
      const stageW = Math.max(660, width - safeLeft - safeRight);
      const stageH = Math.max(380, height - safeTop - safeBottom);
      const stageCx = safeLeft + stageW * 0.5;
      const stageCy = safeTop + stageH * 0.52;

      if (layoutMode === 'stage') {
        // ANIME CINEMA STAGE: Giant Lunar Reactor in sky center-left, Active Hero Actors front-and-center
        // on the rooftop/street floor, Chibi Sidekicks hovering overhead, Street Quest Billboards on flanks!
        upsertTarget('hub:workspace', stageCx, safeTop + stageH * 0.16);

        const runtimes = filteredNodes.filter((entry) => entry.kind === 'runtime');
        const activeAgents = filteredNodes.filter(
          (entry) => entry.kind === 'agent' && entry.status !== 'idle'
        );
        const idleAgents = filteredNodes.filter(
          (entry) => entry.kind === 'agent' && entry.status === 'idle'
        );
        const subs = filteredNodes.filter(
          (entry) => entry.kind === 'subagent' || entry.kind === 'swarm'
        );
        const targets = filteredNodes.filter(
          (entry) =>
            entry.kind === 'plan-wave' || entry.kind === 'workspace-area' || entry.kind === 'infra'
        );

        // Runtimes as glowing rooftop relay beacons flanking upper sky arc
        for (let idx = 0; idx < runtimes.length; idx += 1) {
          const frac = runtimes.length === 1 ? 0.5 : idx / (runtimes.length - 1);
          const rx = safeLeft + stageW * (0.14 + frac * 0.72);
          const ry = safeTop + stageH * 0.34 - Math.sin(frac * Math.PI) * 34;
          upsertTarget(runtimes[idx].id, rx, ry);
        }

        // Active Hero Actors front-center stage (big, expressive, dramatic!)
        const heroCoords = new Map();
        for (let idx = 0; idx < activeAgents.length; idx += 1) {
          const frac = activeAgents.length === 1 ? 0.5 : idx / (activeAgents.length - 1);
          const hx = safeLeft + stageW * (0.18 + frac * 0.64);
          const hy = safeTop + stageH * 0.65 + (idx % 2 === 0 ? -18 : 22);
          heroCoords.set(activeAgents[idx].sessionId, { x: hx, y: hy });
          upsertTarget(activeAgents[idx].id, hx, hy);
        }

        // Background Crowd / Idle Agents neatly arranged along bottom street bench arc
        for (let idx = 0; idx < idleAgents.length; idx += 1) {
          const frac = idleAgents.length === 1 ? 0.5 : idx / (idleAgents.length - 1);
          const ix = safeLeft + stageW * (0.08 + frac * 0.84);
          const iy = safeTop + stageH * 0.91 + (idx % 2 === 0 ? -14 : 10);
          upsertTarget(idleAgents[idx].id, ix, iy);
        }

        // Chibi Subagents & Swarms orbiting their parent hero
        for (let idx = 0; idx < subs.length; idx += 1) {
          const sub = subs[idx];
          const parentPt = sub.parentSessionId ? heroCoords.get(sub.parentSessionId) : null;
          if (parentPt) {
            const angle = -Math.PI * 0.85 + (idx % 7) * 0.42;
            upsertTarget(
              sub.id,
              parentPt.x + Math.cos(angle) * 86,
              parentPt.y + Math.sin(angle) * 74
            );
          } else {
            const frac = subs.length === 1 ? 0.5 : idx / (subs.length - 1);
            upsertTarget(sub.id, safeLeft + stageW * (0.12 + frac * 0.76), safeTop + stageH * 0.48);
          }
        }

        // Quest Waves, Dirty Zones & VPS Towers mounted like neon billboards along left/right skyline edges
        for (let idx = 0; idx < targets.length; idx += 1) {
          const onLeft = idx % 2 === 0;
          const row = Math.floor(idx / 2);
          const rowsTotal = Math.max(1, Math.ceil(targets.length / 2));
          const tx = onLeft ? safeLeft + 18 : safeLeft + stageW - 18;
          const ty = safeTop + stageH * (0.14 + (row / Math.max(1, rowsTotal - 1 || 1)) * 0.62);
          upsertTarget(targets[idx].id, tx, ty);
        }

        relaxOverlaps(filteredNodes, 4);
      } else if (layoutMode === 'pipeline') {
        const byTier = new Map();
        for (const nodeEntry of filteredNodes) {
          const tierIdx = nodeEntry.tier ?? 2;
          if (!byTier.has(tierIdx)) byTier.set(tierIdx, []);
          byTier.get(tierIdx).push(nodeEntry);
        }
        const tierList = Array.from(byTier.keys()).sort((left, right) => left - right);
        const colCount = Math.max(1, tierList.length);
        for (let colIdx = 0; colIdx < tierList.length; colIdx += 1) {
          const tierNodes = byTier.get(tierList[colIdx]);
          const colX = colCount === 1 ? stageCx : safeLeft + (colIdx / (colCount - 1)) * stageW;
          const rowCount = tierNodes.length;
          const twoCols = rowCount > 9;
          const perCol = twoCols ? Math.ceil(rowCount / 2) : rowCount;
          const spacing = Math.min(78, Math.max(46, stageH / Math.max(1, perCol)));
          const totalSpan = spacing * Math.max(0, perCol - 1);
          for (let idx = 0; idx < rowCount; idx += 1) {
            const subCol = twoCols ? idx % 2 : 0;
            const rIdx = twoCols ? Math.floor(idx / 2) : idx;
            upsertTarget(
              tierNodes[idx].id,
              colX + (twoCols ? (subCol === 0 ? -56 : 56) : 0),
              stageCy - totalSpan / 2 + rIdx * spacing + (subCol === 1 ? spacing * 0.35 : 0)
            );
          }
        }
      } else if (layoutMode === 'orbital') {
        upsertTarget('hub:workspace', stageCx, stageCy);
        const runtimes = filteredNodes.filter((entry) => entry.kind === 'runtime');
        const agents = filteredNodes.filter((entry) => entry.kind === 'agent');
        const subs = filteredNodes.filter(
          (entry) => entry.kind === 'subagent' || entry.kind === 'swarm'
        );
        const targets = filteredNodes.filter(
          (entry) =>
            entry.kind === 'plan-wave' || entry.kind === 'workspace-area' || entry.kind === 'infra'
        );

        const agentsByRt = new Map();
        for (const agent of agents) {
          if (!agentsByRt.has(agent.runtime)) agentsByRt.set(agent.runtime, []);
          agentsByRt.get(agent.runtime).push(agent);
        }
        const weights = runtimes.map((rt) =>
          Math.max(2.2, (agentsByRt.get(rt.runtime)?.length || 1) * 0.75)
        );
        const totalW = weights.reduce((acc, val) => acc + val, 0) || 1;
        const rtSector = new Map();
        const r1 = Math.min(stageW, stageH) * 0.24;
        let angleCursor = -Math.PI * 0.75;
        for (let idx = 0; idx < runtimes.length; idx += 1) {
          const span = (weights[idx] / totalW) * Math.PI * 2;
          const mid = angleCursor + span / 2;
          rtSector.set(runtimes[idx].runtime, {
            start: angleCursor + 0.08,
            end: angleCursor + span - 0.08,
            mid,
          });
          upsertTarget(
            runtimes[idx].id,
            stageCx + Math.cos(mid) * r1,
            stageCy + Math.sin(mid) * r1
          );
          angleCursor += span;
        }
        const r2 = Math.min(stageW, stageH) * 0.44;
        const agentCoords = new Map();
        for (const [rtName, rtAgents] of agentsByRt.entries()) {
          const sec = rtSector.get(rtName) || { start: 0, end: Math.PI * 2 };
          for (let idx = 0; idx < rtAgents.length; idx += 1) {
            const frac = rtAgents.length === 1 ? 0.5 : idx / (rtAgents.length - 1);
            const angle = sec.start + frac * Math.max(0.25, sec.end - sec.start);
            const jitter = rtAgents.length > 6 ? (idx % 2 === 0 ? -24 : 34) : 0;
            const ax = stageCx + Math.cos(angle) * (r2 + jitter);
            const ay = stageCy + Math.sin(angle) * (r2 + jitter);
            agentCoords.set(rtAgents[idx].sessionId, { x: ax, y: ay, angle });
            upsertTarget(rtAgents[idx].id, ax, ay);
          }
        }
        for (let idx = 0; idx < subs.length; idx += 1) {
          const sub = subs[idx];
          const pPt = sub.parentSessionId ? agentCoords.get(sub.parentSessionId) : null;
          if (pPt) {
            const ang = pPt.angle + ((idx % 5) - 2) * 0.16;
            upsertTarget(sub.id, pPt.x + Math.cos(ang) * 74, pPt.y + Math.sin(ang) * 74);
          } else {
            const ang = (idx / Math.max(1, subs.length)) * Math.PI * 2;
            upsertTarget(
              sub.id,
              stageCx + Math.cos(ang) * r2 * 1.32,
              stageCy + Math.sin(ang) * r2 * 1.32
            );
          }
        }
        for (let idx = 0; idx < targets.length; idx += 1) {
          const ang = (idx / Math.max(1, targets.length)) * Math.PI * 2 + 0.2;
          upsertTarget(
            targets[idx].id,
            stageCx + Math.cos(ang) * r2 * 1.44,
            stageCy + Math.sin(ang) * r2 * 1.44
          );
        }
        relaxOverlaps(filteredNodes, 5);
      } else {
        // Race Lanes
        const runtimes = filteredNodes.filter((entry) => entry.kind === 'runtime');
        const laneCount = Math.max(1, runtimes.length);
        const laneH = Math.max(115, stageH / laneCount);
        const topStart = stageCy - (laneH * laneCount) / 2;
        upsertTarget('hub:workspace', safeLeft, stageCy);
        const laneY = new Map();
        for (let idx = 0; idx < runtimes.length; idx += 1) {
          const y = topStart + laneH * (idx + 0.5);
          laneY.set(runtimes[idx].runtime, y);
          upsertTarget(runtimes[idx].id, safeLeft + 115, y);
        }
        const byRt = new Map();
        for (const ag of filteredNodes.filter((entry) => entry.kind === 'agent')) {
          if (!byRt.has(ag.runtime)) byRt.set(ag.runtime, []);
          byRt.get(ag.runtime).push(ag);
        }
        for (const [rtName, list] of byRt.entries()) {
          const ly = laneY.get(rtName) ?? stageCy;
          const rows = list.length > 7 ? 2 : 1;
          const cols = Math.ceil(list.length / rows);
          for (let idx = 0; idx < list.length; idx += 1) {
            const r = rows === 1 ? 0 : Math.floor(idx / cols);
            const c = idx % cols;
            const frac = cols === 1 ? 0.35 : c / (cols - 1);
            upsertTarget(
              list[idx].id,
              safeLeft + 230 + frac * stageW * 0.54,
              ly + (rows === 1 ? 0 : r === 0 ? -24 : 24)
            );
          }
        }
        const subs = filteredNodes.filter(
          (entry) => entry.kind === 'subagent' || entry.kind === 'swarm'
        );
        for (let idx = 0; idx < subs.length; idx += 1) {
          const ly = laneY.get(subs[idx].runtime) ?? stageCy;
          upsertTarget(
            subs[idx].id,
            safeLeft + stageW * 0.82 + (idx % 2) * 32,
            ly + ((idx % 5) - 2) * 18
          );
        }
        const targets = filteredNodes.filter(
          (entry) =>
            entry.kind === 'plan-wave' || entry.kind === 'workspace-area' || entry.kind === 'infra'
        );
        for (let idx = 0; idx < targets.length; idx += 1) {
          upsertTarget(
            targets[idx].id,
            safeLeft + stageW,
            topStart + ((idx + 0.5) / Math.max(1, targets.length)) * laneH * laneCount
          );
        }
      }

      const desiredPackets = Math.min(84, filteredEdges.length * 2);
      while (ambientPackets.length < desiredPackets && filteredEdges.length > 0) {
        const edgeIdx = ambientPackets.length % filteredEdges.length;
        ambientPackets.push({
          edgeId: filteredEdges[edgeIdx].id,
          progress: Math.random(),
          speed: 0.0035 + Math.random() * 0.005,
          size: 3 + Math.random() * 2.2,
        });
      }
      if (ambientPackets.length > desiredPackets) ambientPackets.length = desiredPackets;

      if (!hasAutoFitted && filteredNodes.length > 0 && sketchInstance) {
        hasAutoFitted = true;
        fitViewToGraph();
      }
    }

    function spawnInkSplash(x, y, rgb, count = 12) {
      for (let idx = 0; idx < count; idx += 1) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 1.6 + Math.random() * 5.2;
        inkSplashes.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 1.2,
          r: 2.5 + Math.random() * 5,
          rgb,
          alpha: 245,
        });
      }
      if (inkSplashes.length > 180) inkSplashes.splice(0, inkSplashes.length - 180);
    }

    function spawnComicBurst(x, y, text, rgb) {
      comicBursts.push({
        x,
        y,
        text,
        rgb,
        life: 0,
        maxLife: 88,
        rot: (Math.random() - 0.5) * 0.28,
      });
      if (comicBursts.length > 14) comicBursts.shift();
    }

    function ingestNewPulses(pulses) {
      const isInitial = seenPulseIds.size === 0;
      let newestHotNodeId = null;

      for (const pulse of pulses || []) {
        if (seenPulseIds.has(pulse.id)) continue;
        seenPulseIds.add(pulse.id);
        if (seenPulseIds.size > 400) {
          seenPulseIds.delete(seenPulseIds.values().next().value);
        }

        const rgb =
          pulse.kind === 'error'
            ? RED
            : pulse.kind === 'subagent' || pulse.kind === 'swarm'
              ? MAGENTA
              : pulse.kind === 'focus'
                ? YELLOW
                : RUNTIME_COLORS[pulse.runtime] || CYAN;

        // Seed live manga speech bubbles for initial top active pulses too!
        if (pulse.toNode && pulse.summary) {
          const shortBubble = `${pulse.tool ? `[${pulse.tool}] ` : ''}${pulse.summary}`.slice(
            0,
            44
          );
          speechBubbles.set(pulse.toNode, {
            text: shortBubble,
            rgb,
            bornAt: Date.now(),
            durationMs: 11000,
          });
        }

        if (isInitial && burstComets.length >= 4) continue;

        burstComets.push({
          fromId: pulse.fromNode,
          toId: pulse.toNode,
          progress: 0,
          speed: 0.02 + Math.random() * 0.012,
          rgb,
        });

        const targetPos = nodePositions.get(pulse.toNode);
        if (targetPos) {
          const wordPool = SFX_WORDS[pulse.kind] || SFX_WORDS.tool;
          const word = wordPool[Math.floor(Math.random() * wordPool.length)];
          spawnComicBurst(targetPos.x + (Math.random() - 0.5) * 32, targetPos.y - 44, word, rgb);
          spawnInkSplash(targetPos.x, targetPos.y, rgb, pulse.kind === 'error' ? 18 : 10);
          if (pulse.kind === 'error') screenShake = Math.max(screenShake, 12);
          newestHotNodeId = pulse.toNode;
        }

        if (!isInitial && typeof callbacks.onLivePulse === 'function') {
          callbacks.onLivePulse(pulse);
        }
      }

      if (autoCamEnabled && newestHotNodeId && sketchInstance) {
        const focusPos = nodePositions.get(newestHotNodeId);
        if (focusPos) {
          targetCamScale = 1.18;
          targetCamX = sketchInstance.width * 0.44 - focusPos.x * targetCamScale;
          targetCamY = sketchInstance.height * 0.52 - focusPos.y * targetCamScale;
        }
      }
    }

    function fitViewToGraph() {
      if (!sketchInstance || filteredNodes.length === 0) return;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const nodeEntry of filteredNodes) {
        const pos = nodePositions.get(nodeEntry.id);
        if (!pos) continue;
        const rad = radiusForNode(nodeEntry);
        minX = Math.min(minX, pos.x - rad - 44);
        maxX = Math.max(maxX, pos.x + rad + 44);
        minY = Math.min(minY, pos.y - rad - 44);
        maxY = Math.max(maxY, pos.y + rad + 44);
      }
      if (!Number.isFinite(minX)) return;
      const usableW = Math.max(380, sketchInstance.width - 390);
      const usableH = Math.max(300, sketchInstance.height - 220);
      const spanW = Math.max(260, maxX - minX);
      const spanH = Math.max(200, maxY - minY);
      const scale = Math.min(1.12, Math.max(0.45, Math.min(usableW / spanW, usableH / spanH)));
      targetCamScale = scale;
      targetCamX = usableW / 2 + 24 - ((minX + maxX) / 2) * scale;
      targetCamY = 128 + usableH / 2 - ((minY + maxY) / 2) * scale;
    }

    function pickSpriteForNode(nodeEntry) {
      if (nodeEntry.status === 'error') return spriteImgs.kuroAngry;
      if (nodeEntry.runtime === 'claude') return spriteImgs.vesper;
      if (nodeEntry.runtime === 'codex') return spriteImgs.kuroGaming;
      if (nodeEntry.runtime === 'qoder' || nodeEntry.runtime === 'gemini-cli')
        return spriteImgs.kuroCurious;
      if (nodeEntry.kind === 'swarm') return spriteImgs.kuroCelebrate;
      if (nodeEntry.status === 'running') return spriteImgs.kuroRun;
      if (nodeEntry.status === 'recent') return spriteImgs.kuroWork;
      return spriteImgs.kuroSleepy;
    }

    function findNodeAtWorld(wx, wy) {
      for (let idx = filteredNodes.length - 1; idx >= 0; idx -= 1) {
        const nodeEntry = filteredNodes[idx];
        const pos = nodePositions.get(nodeEntry.id);
        if (!pos) continue;
        const rad = radiusForNode(nodeEntry) + 10;
        const dx = wx - pos.x;
        const dy = wy - pos.y;
        if (dx * dx + dy * dy <= rad * rad) return nodeEntry;
      }
      return null;
    }

    function updateTooltip(nodeEntry, mouseX, mouseY) {
      if (!tooltipEl) return;
      if (!nodeEntry) {
        tooltipEl.classList.add('hidden');
        return;
      }
      const esc = window.MWObservatory.utils?.esc || ((val) => String(val ?? ''));
      const fmtNum = window.MWObservatory.utils?.fmtNum || ((val) => String(val ?? 0));
      const lines = [];
      if (nodeEntry.model) lines.push(`GEAR: ${nodeEntry.model}`);
      if (nodeEntry.metrics?.tokens)
        lines.push(`POWER: ${fmtNum(nodeEntry.metrics.tokens)} tokens`);
      if (nodeEntry.metrics?.steps) lines.push(`MOVES: ${nodeEntry.metrics.steps} steps`);
      if (nodeEntry.metrics?.subagents) lines.push(`SIDEKICKS: ${nodeEntry.metrics.subagents}`);
      if (nodeEntry.focus) lines.push(`ACTION: ${nodeEntry.focus}`);
      if (nodeEntry.lastError) lines.push(`BONK: ${nodeEntry.lastError}`);

      tooltipEl.innerHTML = `
        <div class="canvas-tooltip-title">${esc(nodeEntry.label)}</div>
        <div class="canvas-tooltip-sub">${esc(nodeEntry.kind.toUpperCase())} · ${esc(nodeEntry.sublabel || nodeEntry.status)}</div>
        <div class="canvas-tooltip-body">${lines.map((line) => esc(line)).join('<br/>') || 'Click to open Manga Dossier!'}</div>
      `;
      tooltipEl.classList.remove('hidden');
      tooltipEl.style.left = `${Math.min(hostEl.clientWidth - 325, Math.max(12, mouseX + 18))}px`;
      tooltipEl.style.top = `${Math.min(hostEl.clientHeight - 150, Math.max(84, mouseY + 16))}px`;
    }

    function bezierPoint(p0, p1, p2, p3, t) {
      const inv = 1 - t;
      return inv * inv * inv * p0 + 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t * p3;
    }

    sketchInstance = new p5((sketch) => {
      sketch.setup = () => {
        const w = Math.max(360, hostEl.clientWidth || window.innerWidth);
        const h = Math.max(360, hostEl.clientHeight || window.innerHeight);
        const canvas = sketch.createCanvas(w, h);
        canvas.parent(hostEl);
        sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        sketch.textFont('Anton, Impact, sans-serif');

        // Load authentic MoonWitness art backdrops & Riot character sprites asynchronously
        for (const [key, url] of Object.entries(STAGE_BACKDROPS)) {
          sketch.loadImage(url, (loadedImg) => {
            backdropImgs[key] = loadedImg;
          });
        }
        for (const [key, url] of Object.entries(SPRITE_URLS)) {
          sketch.loadImage(url, (loadedImg) => {
            spriteImgs[key] = loadedImg;
          });
        }

        // Seed stylized anime neon rain streaks
        for (let idx = 0; idx < 42; idx += 1) {
          rainDrops.push({
            x: Math.random() * w,
            y: Math.random() * h,
            len: 14 + Math.random() * 24,
            spd: 7 + Math.random() * 8,
            tint: idx % 3 === 0 ? MAGENTA : idx % 3 === 1 ? CYAN : YELLOW,
          });
        }
        applyFilterAndTargets(w, h);
      };

      sketch.draw = () => {
        if (!isVisible) return;
        const w = sketch.width;
        const h = sketch.height;
        const timeSec = sketch.millis() * 0.001;

        sketch.background(14, 14, 16);

        // 1. PARALLAX MOONWITNESS ART BACKDROP
        const activeBg = backdropImgs[stageBackdropKey];
        if (activeBg) {
          const parallaxX = ((sketch.mouseX - w / 2) / Math.max(1, w)) * -18;
          const parallaxY = ((sketch.mouseY - h / 2) / Math.max(1, h)) * -12;
          const coverScale = Math.max((w + 48) / activeBg.width, (h + 48) / activeBg.height);
          const drawW = activeBg.width * coverScale;
          const drawH = activeBg.height * coverScale;
          sketch.push();
          sketch.imageMode(sketch.CENTER);
          sketch.tint(255, 165);
          sketch.image(activeBg, w / 2 + parallaxX, h / 2 + parallaxY, drawW, drawH);
          sketch.noTint();
          sketch.pop();
        }

        // 2. BEN-DAY HALFTONE COMIC NIGHT OVERLAY + STYLIZED ANIME NEON RAIN
        sketch.noStroke();
        sketch.fill(10, 10, 14, 92);
        sketch.rect(0, 0, w, h);

        // Subtle anime rain / street neon streaks
        for (const drop of rainDrops) {
          drop.y += drop.spd * flowSpeed;
          drop.x -= drop.spd * 0.16 * flowSpeed;
          if (drop.y > h + 20) {
            drop.y = -20;
            drop.x = Math.random() * (w + 160);
          }
          sketch.stroke(drop.tint[0], drop.tint[1], drop.tint[2], 58);
          sketch.strokeWeight(1.5);
          sketch.line(drop.x, drop.y, drop.x - drop.len * 0.16, drop.y + drop.len);
        }

        // Smooth camera + screen-shake decay
        camX = sketch.lerp(camX, targetCamX, 0.15);
        camY = sketch.lerp(camY, targetCamY, 0.15);
        camScale = sketch.lerp(camScale, targetCamScale, 0.15);
        let shakeX = 0;
        let shakeY = 0;
        if (screenShake > 0.2) {
          shakeX = (Math.random() - 0.5) * screenShake * 1.8;
          shakeY = (Math.random() - 0.5) * screenShake * 1.8;
          screenShake *= 0.86;
        }

        // Spring node positions + lively cartoon bounce for active actors
        for (let idx = 0; idx < filteredNodes.length; idx += 1) {
          const nodeEntry = filteredNodes[idx];
          const pos = nodePositions.get(nodeEntry.id);
          if (!pos || pos.pinned) continue;
          const bounceAmp =
            nodeEntry.status === 'running' ? 6.5 : nodeEntry.status === 'recent' ? 3 : 0.8;
          const bounceY =
            Math.sin(timeSec * (nodeEntry.status === 'running' ? 5.2 : 2.1) + pos.bouncePhase) *
            bounceAmp;
          pos.x = sketch.lerp(pos.x, pos.tx, 0.12);
          pos.y = sketch.lerp(pos.y, pos.ty + bounceY, 0.14);
        }

        // Highlight neighborhood on hover
        const litNodes = new Set();
        const litEdges = new Set();
        if (hoveredNodeId) {
          litNodes.add(hoveredNodeId);
          for (const edgeEntry of filteredEdges) {
            if (edgeEntry.from === hoveredNodeId || edgeEntry.to === hoveredNodeId) {
              litEdges.add(edgeEntry.id);
              litNodes.add(edgeEntry.from);
              litNodes.add(edgeEntry.to);
            }
          }
        }

        sketch.push();
        sketch.translate(camX + shakeX, camY + shakeY);
        sketch.scale(camScale);

        // 3. CEL-SHADED INK-OUTLINED NEON ENERGY CONDUITS
        const edgeMap = new Map();
        for (const edgeEntry of filteredEdges) {
          edgeMap.set(edgeEntry.id, edgeEntry);
          const fromPos = nodePositions.get(edgeEntry.from);
          const toPos = nodePositions.get(edgeEntry.to);
          if (!fromPos || !toPos) continue;
          const rgb = RUNTIME_COLORS[edgeEntry.runtime] || CYAN;
          const isLit = !hoveredNodeId || litEdges.has(edgeEntry.id);

          const midX = (fromPos.x + toPos.x) * 0.5;
          const archOffset = layoutMode === 'stage' ? -36 : 0;
          const ctrlSpan = Math.max(46, Math.abs(toPos.x - fromPos.x) * 0.42);
          const cx1 =
            layoutMode === 'stage'
              ? midX
              : fromPos.x + (toPos.x >= fromPos.x ? ctrlSpan : -ctrlSpan);
          const cy1 =
            layoutMode === 'stage' ? Math.min(fromPos.y, toPos.y) + archOffset : fromPos.y;
          const cx2 =
            layoutMode === 'stage' ? midX : toPos.x - (toPos.x >= fromPos.x ? ctrlSpan : -ctrlSpan);
          const cy2 = layoutMode === 'stage' ? Math.min(fromPos.y, toPos.y) + archOffset : toPos.y;

          sketch.noFill();
          // Comic black ink casing behind active beam
          if (edgeEntry.active && isLit) {
            sketch.stroke(INK[0], INK[1], INK[2], 210);
            sketch.strokeWeight(6.5);
            sketch.bezier(fromPos.x, fromPos.y, cx1, cy1, cx2, cy2, toPos.x, toPos.y);
          }
          sketch.stroke(rgb[0], rgb[1], rgb[2], isLit ? (edgeEntry.active ? 225 : 90) : 22);
          sketch.strokeWeight(edgeEntry.active ? 3.2 : 1.4);
          sketch.bezier(fromPos.x, fromPos.y, cx1, cy1, cx2, cy2, toPos.x, toPos.y);
        }

        // 4. FLOWING COMIC ENERGY ORBS & LIVE EVENT COMETS
        for (const packet of ambientPackets) {
          const edgeEntry = edgeMap.get(packet.edgeId);
          if (!edgeEntry) continue;
          const fromPos = nodePositions.get(edgeEntry.from);
          const toPos = nodePositions.get(edgeEntry.to);
          if (!fromPos || !toPos) continue;
          packet.progress =
            (packet.progress + packet.speed * (edgeEntry.active ? 1.55 : 0.45) * flowSpeed) % 1;
          if (hoveredNodeId && !litEdges.has(edgeEntry.id)) continue;

          const midX = (fromPos.x + toPos.x) * 0.5;
          const archOffset = layoutMode === 'stage' ? -36 : 0;
          const ctrlSpan = Math.max(46, Math.abs(toPos.x - fromPos.x) * 0.42);
          const cx1 =
            layoutMode === 'stage'
              ? midX
              : fromPos.x + (toPos.x >= fromPos.x ? ctrlSpan : -ctrlSpan);
          const cy1 =
            layoutMode === 'stage' ? Math.min(fromPos.y, toPos.y) + archOffset : fromPos.y;
          const cx2 =
            layoutMode === 'stage' ? midX : toPos.x - (toPos.x >= fromPos.x ? ctrlSpan : -ctrlSpan);
          const cy2 = layoutMode === 'stage' ? Math.min(fromPos.y, toPos.y) + archOffset : toPos.y;

          const px = bezierPoint(fromPos.x, cx1, cx2, toPos.x, packet.progress);
          const py = bezierPoint(fromPos.y, cy1, cy2, toPos.y, packet.progress);
          const rgb = RUNTIME_COLORS[edgeEntry.runtime] || YELLOW;

          sketch.stroke(INK[0], INK[1], INK[2], 220);
          sketch.strokeWeight(1.8);
          sketch.fill(rgb[0], rgb[1], rgb[2], edgeEntry.active ? 245 : 145);
          sketch.circle(px, py, packet.size * 2.2);
        }

        for (let idx = burstComets.length - 1; idx >= 0; idx -= 1) {
          const comet = burstComets[idx];
          comet.progress += comet.speed * Math.max(0.6, flowSpeed);
          if (comet.progress >= 1) {
            burstComets.splice(idx, 1);
            continue;
          }
          const fromPos = nodePositions.get(comet.fromId);
          const toPos = nodePositions.get(comet.toId);
          if (!fromPos || !toPos) {
            burstComets.splice(idx, 1);
            continue;
          }
          const cx = sketch.lerp(fromPos.x, toPos.x, comet.progress);
          const cy =
            sketch.lerp(fromPos.y, toPos.y, comet.progress) -
            Math.sin(comet.progress * Math.PI) * 48;
          sketch.stroke(INK[0], INK[1], INK[2], 240);
          sketch.strokeWeight(2.5);
          sketch.fill(comet.rgb[0], comet.rgb[1], comet.rgb[2], 255);
          drawComicStar(sketch, cx, cy, 11, 5, 5, timeSec * 7);
        }

        // 5. SPRAY-PAINT INK SPLATTER PARTICLES
        for (let idx = inkSplashes.length - 1; idx >= 0; idx -= 1) {
          const drop = inkSplashes[idx];
          drop.x += drop.vx;
          drop.y += drop.vy;
          drop.vy += 0.14;
          drop.alpha -= 6.5;
          if (drop.alpha <= 4) {
            inkSplashes.splice(idx, 1);
            continue;
          }
          sketch.stroke(INK[0], INK[1], INK[2], drop.alpha);
          sketch.strokeWeight(1.5);
          sketch.fill(drop.rgb[0], drop.rgb[1], drop.rgb[2], drop.alpha);
          sketch.circle(drop.x, drop.y, drop.r * 2);
        }

        // 6. LIVING ANIMATED CARTOON CHARACTERS, HERO NODES & BILLBOARDS
        const nowMs = Date.now();
        for (let idx = 0; idx < filteredNodes.length; idx += 1) {
          const nodeEntry = filteredNodes[idx];
          const pos = nodePositions.get(nodeEntry.id);
          if (!pos) continue;
          const rad = radiusForNode(nodeEntry);
          const rgb = colorForNode(nodeEntry);
          const isHovered = hoveredNodeId === nodeEntry.id;
          const isLit = !hoveredNodeId || litNodes.has(nodeEntry.id);
          const alphaMul = isLit ? 1 : 0.28;

          // Squash-and-stretch factor for lively cartoon animation!
          const isEnergetic = nodeEntry.status === 'running' || nodeEntry.kind === 'swarm';
          const squashWave = isEnergetic ? Math.sin(timeSec * 6.4 + pos.bouncePhase) * 0.08 : 0;
          const scaleX = (isHovered ? 1.16 : 1) * (1 - squashWave);
          const scaleY = (isHovered ? 1.16 : 1) * (1 + squashWave);

          sketch.push();
          sketch.translate(pos.x, pos.y);
          sketch.scale(scaleX, scaleY);

          // Anime action aura rings for running heroes
          if (isEnergetic || nodeEntry.status === 'error' || isHovered) {
            const pulse = (Math.sin(timeSec * 5 + idx) + 1) * 0.5;
            sketch.noFill();
            sketch.stroke(rgb[0], rgb[1], rgb[2], (115 + pulse * 120) * alphaMul);
            sketch.strokeWeight(3);
            sketch.circle(0, 0, (rad + 7 + pulse * 7) * 2);
          }

          if (nodeEntry.kind === 'hub') {
            // Giant Lunar Astrolabe Core Reactor
            sketch.noFill();
            sketch.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 210 * alphaMul);
            sketch.strokeWeight(2.5);
            sketch.push();
            sketch.rotate(timeSec * 0.5);
            sketch.ellipse(0, 0, rad * 2.9, rad * 1.15);
            sketch.rotate(Math.PI / 3);
            sketch.stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 195 * alphaMul);
            sketch.ellipse(0, 0, rad * 2.9, rad * 1.15);
            sketch.pop();

            // Hard comic drop shadow + ink circle
            sketch.noStroke();
            sketch.fill(INK[0], INK[1], INK[2], 220 * alphaMul);
            sketch.circle(5, 5, rad * 2);
            sketch.fill(CYAN[0], CYAN[1], CYAN[2], 245 * alphaMul);
            sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaMul);
            sketch.strokeWeight(4);
            sketch.circle(0, 0, rad * 2);

            // Crescent Moon emblem inside core
            sketch.noStroke();
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 255 * alphaMul);
            sketch.circle(-3, -2, rad * 1.05);
            sketch.fill(CYAN[0], CYAN[1], CYAN[2], 255 * alphaMul);
            sketch.circle(6, -6, rad * 0.85);
          } else if (nodeEntry.kind === 'agent' || nodeEntry.kind === 'swarm') {
            // REAL ANIMATED MOONWITNESS CARTOON CHARACTER MEDALLION + SPRITE!
            const sprite = pickSpriteForNode(nodeEntry);
            // Offset comic ink shadow
            sketch.noStroke();
            sketch.fill(INK[0], INK[1], INK[2], 225 * alphaMul);
            sketch.circle(4, 5, rad * 2);

            // Bright cel-shaded comic frame backing
            sketch.fill(
              PAPER[0],
              PAPER[1],
              PAPER[2],
              (nodeEntry.status === 'idle' ? 190 : 250) * alphaMul
            );
            sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaMul);
            sketch.strokeWeight(3.5);
            sketch.circle(0, 0, rad * 2);

            // Colored inner neon rim
            sketch.noFill();
            sketch.stroke(rgb[0], rgb[1], rgb[2], 240 * alphaMul);
            sketch.strokeWeight(3);
            sketch.circle(0, 0, (rad - 3) * 2);

            if (sprite) {
              sketch.push();
              sketch.imageMode(sketch.CENTER);
              if (alphaMul < 0.9) sketch.tint(255, Math.round(255 * alphaMul));
              const imgScale = (rad * 2.15) / Math.max(sprite.width, sprite.height);
              sketch.image(sprite, 0, -2, sprite.width * imgScale, sprite.height * imgScale);
              sketch.noTint();
              sketch.pop();
            }

            // Live status lightning / star badge on corner
            if (nodeEntry.status === 'running') {
              sketch.stroke(INK[0], INK[1], INK[2], 255);
              sketch.strokeWeight(2);
              sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 255);
              drawComicStar(sketch, rad * 0.78, -rad * 0.78, 9, 4, 4, timeSec * 4);
            } else if (nodeEntry.status === 'error') {
              sketch.stroke(INK[0], INK[1], INK[2], 255);
              sketch.strokeWeight(2);
              sketch.fill(RED[0], RED[1], RED[2], 255);
              sketch.triangle(
                rad * 0.55,
                -rad * 0.45,
                rad * 0.95,
                -rad * 0.45,
                rad * 0.75,
                -rad * 1.05
              );
            }
          } else if (nodeEntry.kind === 'runtime') {
            // Street-punk tilted diamond beacon
            sketch.noStroke();
            sketch.fill(INK[0], INK[1], INK[2], 220 * alphaMul);
            sketch.rectMode(sketch.CENTER);
            sketch.push();
            sketch.rotate(Math.PI / 4);
            sketch.rect(4, 4, rad * 1.45, rad * 1.45, 5);
            sketch.fill(rgb[0], rgb[1], rgb[2], 240 * alphaMul);
            sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaMul);
            sketch.strokeWeight(3.5);
            sketch.rect(0, 0, rad * 1.45, rad * 1.45, 5);
            sketch.pop();
            sketch.rectMode(sketch.CORNER);
          } else if (nodeEntry.kind === 'subagent') {
            // Bouncy chibi riot star-drone
            sketch.stroke(INK[0], INK[1], INK[2], 240 * alphaMul);
            sketch.strokeWeight(2.2);
            sketch.fill(rgb[0], rgb[1], rgb[2], 235 * alphaMul);
            drawComicStar(sketch, 0, 0, rad + 3, rad * 0.52, 5, timeSec * 1.5 + idx);
          } else {
            // Neon Street Billboard (Plan Wave / Dirty Repo / VPS Tower)
            sketch.rectMode(sketch.CENTER);
            sketch.noStroke();
            sketch.fill(INK[0], INK[1], INK[2], 230 * alphaMul);
            sketch.rect(4, 4, rad * 2.5, rad * 1.55, 4);
            sketch.fill(23, 23, 28, 245 * alphaMul);
            sketch.stroke(rgb[0], rgb[1], rgb[2], 245 * alphaMul);
            sketch.strokeWeight(3);
            sketch.rect(0, 0, rad * 2.5, rad * 1.55, 4);
            sketch.noStroke();
            sketch.fill(rgb[0], rgb[1], rgb[2], 235 * alphaMul);
            sketch.rect(0, -rad * 0.5, rad * 2.1, 4, 2);
            sketch.rectMode(sketch.CORNER);
          }

          sketch.pop();

          // Crisp comic nameplate tape under important nodes
          const isImportantAgent =
            nodeEntry.kind === 'agent' &&
            (nodeEntry.status === 'running' ||
              nodeEntry.status === 'error' ||
              nodeEntry.status === 'recent');
          const showLabel =
            nodeEntry.kind === 'hub' ||
            nodeEntry.kind === 'runtime' ||
            nodeEntry.kind === 'swarm' ||
            nodeEntry.kind === 'plan-wave' ||
            nodeEntry.kind === 'workspace-area' ||
            nodeEntry.kind === 'infra' ||
            isImportantAgent ||
            isHovered ||
            camScale > 1.25;

          if (showLabel) {
            const labelText =
              nodeEntry.label.length > 20 ? `${nodeEntry.label.slice(0, 19)}…` : nodeEntry.label;
            sketch.textFont('JetBrains Mono, Consolas, monospace');
            sketch.textSize(nodeEntry.kind === 'hub' ? 11.5 : 9.5);
            const pillW = Math.min(168, sketch.textWidth(labelText) + 14);
            const pillY = pos.y + rad + 7;
            sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaMul);
            sketch.strokeWeight(2);
            sketch.fill(
              nodeEntry.status === 'running' ? YELLOW[0] : 18,
              nodeEntry.status === 'running' ? YELLOW[1] : 18,
              nodeEntry.status === 'running' ? YELLOW[2] : 24,
              240 * alphaMul
            );
            sketch.rect(pos.x - pillW / 2, pillY, pillW, 17, 2);
            sketch.noStroke();
            sketch.textAlign(sketch.CENTER, sketch.CENTER);
            sketch.fill(
              nodeEntry.status === 'running' ? INK[0] : PAPER[0],
              nodeEntry.status === 'running' ? INK[1] : PAPER[1],
              nodeEntry.status === 'running' ? INK[2] : PAPER[2],
              250 * alphaMul
            );
            sketch.text(labelText, pos.x, pillY + 9);
          }

          // Queue speech bubble for top-layer draw pass so chibi sidekicks never occlude speech!
        }

        // 7. TOP-LAYER MANGA SPEECH BUBBLES OVER ACTIVE CHARACTERS (Always crisp & unoccluded!)
        for (const nodeEntry of filteredNodes) {
          const pos = nodePositions.get(nodeEntry.id);
          if (!pos) continue;
          const isHovered = hoveredNodeId === nodeEntry.id;
          const isLit = !hoveredNodeId || litNodes.has(nodeEntry.id);
          const alphaMul = isLit ? 1 : 0.28;
          const rad = radiusForNode(nodeEntry);
          const bubble = speechBubbles.get(nodeEntry.id);
          if (
            bubble &&
            nowMs - bubble.bornAt < bubble.durationMs &&
            (nodeEntry.status !== 'idle' || isHovered)
          ) {
            const age = (nowMs - bubble.bornAt) / bubble.durationMs;
            const popIn = Math.min(1, (nowMs - bubble.bornAt) / 180);
            const fadeOut = age > 0.82 ? Math.max(0, (1 - age) / 0.18) : 1;
            const bScale = (0.7 + popIn * 0.3) * (isHovered ? 1.05 : 1);
            drawMangaSpeechBubble(
              sketch,
              pos.x,
              pos.y - rad - 18,
              bubble.text,
              bubble.rgb,
              bScale,
              fadeOut * alphaMul
            );
          }
        }

        // 8. POP-ART COMIC SFX ONOMATOPOEIA BURSTS (ZAP!! / BONK!! / SUMMON!!)
        for (let idx = comicBursts.length - 1; idx >= 0; idx -= 1) {
          const burst = comicBursts[idx];
          burst.life += 1;
          if (burst.life >= burst.maxLife) {
            comicBursts.splice(idx, 1);
            continue;
          }
          const frac = burst.life / burst.maxLife;
          const popScale =
            frac < 0.16
              ? 0.4 + (frac / 0.16) * 0.85
              : frac < 0.28
                ? 1.25 - ((frac - 0.16) / 0.12) * 0.25
                : 1;
          const fade = frac > 0.7 ? Math.max(0, (1 - frac) / 0.3) : 1;

          sketch.push();
          sketch.translate(burst.x, burst.y - frac * 22);
          sketch.rotate(burst.rot);
          sketch.scale(popScale);

          // Jagged starburst polygon
          sketch.stroke(INK[0], INK[1], INK[2], 255 * fade);
          sketch.strokeWeight(3);
          sketch.fill(burst.rgb[0], burst.rgb[1], burst.rgb[2], 245 * fade);
          drawComicStar(sketch, 0, 0, 38, 23, 9, 0);

          sketch.textFont('Road Rage, Anton, Impact, sans-serif');
          sketch.textSize(22);
          sketch.textAlign(sketch.CENTER, sketch.CENTER);
          sketch.fill(INK[0], INK[1], INK[2], 255 * fade);
          sketch.text(burst.text, 2, 2);
          sketch.fill(PAPER[0], PAPER[1], PAPER[2], 255 * fade);
          sketch.text(burst.text, 0, 0);
          sketch.pop();
        }

        sketch.pop();
      };

      sketch.mouseMoved = () => {
        if (!isVisible) return;
        const worldPt = screenToWorld(sketch.mouseX, sketch.mouseY);
        const hitNode = findNodeAtWorld(worldPt.x, worldPt.y);
        hoveredNodeId = hitNode ? hitNode.id : null;
        hostEl.style.cursor = hitNode ? 'pointer' : 'grab';
        updateTooltip(hitNode, sketch.mouseX, sketch.mouseY);
      };

      sketch.mousePressed = () => {
        if (!isVisible) return;
        pointerMoved = false;
        lastMouseX = sketch.mouseX;
        lastMouseY = sketch.mouseY;
        const worldPt = screenToWorld(sketch.mouseX, sketch.mouseY);
        const hitNode = findNodeAtWorld(worldPt.x, worldPt.y);
        if (hitNode) {
          draggedNodeId = hitNode.id;
          spawnInkSplash(worldPt.x, worldPt.y, colorForNode(hitNode), 8);
        } else {
          isPanning = true;
        }
      };

      sketch.mouseDragged = () => {
        if (!isVisible) return;
        const dx = sketch.mouseX - lastMouseX;
        const dy = sketch.mouseY - lastMouseY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pointerMoved = true;
        lastMouseX = sketch.mouseX;
        lastMouseY = sketch.mouseY;

        if (draggedNodeId) {
          const pos = nodePositions.get(draggedNodeId);
          if (pos) {
            pos.x += dx / camScale;
            pos.y += dy / camScale;
            pos.pinned = true;
          }
        } else if (isPanning) {
          targetCamX += dx;
          targetCamY += dy;
          camX = targetCamX;
          camY = targetCamY;
        }
      };

      sketch.mouseReleased = () => {
        if (!isVisible) return;
        if (draggedNodeId && !pointerMoved) {
          const nowMs = Date.now();
          const clickedNode = filteredNodes.find((entry) => entry.id === draggedNodeId);
          if (lastClickedNodeId === draggedNodeId && nowMs - lastClickTime < 320) {
            const pos = nodePositions.get(draggedNodeId);
            if (pos) pos.pinned = false;
          } else if (clickedNode && typeof callbacks.onNodeClick === 'function') {
            callbacks.onNodeClick(clickedNode);
          }
          lastClickedNodeId = draggedNodeId;
          lastClickTime = nowMs;
        }
        draggedNodeId = null;
        isPanning = false;
      };

      sketch.mouseWheel = (evt) => {
        if (!isVisible) return;
        if (evt.target && evt.target.tagName !== 'CANVAS') return;
        const zoomFactor = evt.delta > 0 ? 0.91 : 1.1;
        const nextScale = Math.max(0.38, Math.min(2.5, targetCamScale * zoomFactor));
        const worldX = (sketch.mouseX - targetCamX) / targetCamScale;
        const worldY = (sketch.mouseY - targetCamY) / targetCamScale;
        targetCamScale = nextScale;
        targetCamX = sketch.mouseX - worldX * nextScale;
        targetCamY = sketch.mouseY - worldY * nextScale;
        return false;
      };
    }, hostEl);

    function drawComicStar(sketch, cx, cy, outerR, innerR, points, rotRad) {
      sketch.beginShape();
      for (let idx = 0; idx < points * 2; idx += 1) {
        const ang = (Math.PI * idx) / points + rotRad - Math.PI / 2;
        const rad = idx % 2 === 0 ? outerR : innerR;
        sketch.vertex(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      }
      sketch.endShape(sketch.CLOSE);
    }

    function drawMangaSpeechBubble(sketch, cx, bottomY, text, accentRgb, scaleVal, alphaVal) {
      sketch.push();
      sketch.translate(cx, bottomY);
      sketch.scale(scaleVal);
      sketch.textFont('JetBrains Mono, Consolas, monospace');
      sketch.textSize(9.5);
      const clipped = text.length > 36 ? `${text.slice(0, 35)}…` : text;
      const bw = Math.min(240, Math.max(76, sketch.textWidth(clipped) + 18));
      const bh = 24;

      // Hard comic drop shadow
      sketch.noStroke();
      sketch.fill(INK[0], INK[1], INK[2], 220 * alphaVal);
      sketch.rect(-bw / 2 + 3, -bh - 7 + 3, bw, bh, 5);

      // Paper bubble + thick black ink border
      sketch.fill(PAPER[0], PAPER[1], PAPER[2], 248 * alphaVal);
      sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaVal);
      sketch.strokeWeight(2.5);
      sketch.rect(-bw / 2, -bh - 7, bw, bh, 5);

      // Little comic pointer tail
      sketch.triangle(-6, -7, 6, -7, 0, 1);
      // Colored accent bar on left of speech bubble
      sketch.noStroke();
      sketch.fill(accentRgb[0], accentRgb[1], accentRgb[2], 255 * alphaVal);
      sketch.rect(-bw / 2 + 2, -bh - 5, 4, bh - 4, 2);

      // Ink text
      sketch.fill(INK[0], INK[1], INK[2], 255 * alphaVal);
      sketch.textAlign(sketch.CENTER, sketch.CENTER);
      sketch.text(clipped, 3, -bh / 2 - 7);
      sketch.pop();
    }

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!sketchInstance) return;
        const w = Math.max(360, hostEl.clientWidth || window.innerWidth);
        const h = Math.max(360, hostEl.clientHeight || window.innerHeight);
        sketchInstance.resizeCanvas(w, h);
        applyFilterAndTargets(w, h);
      });
      resizeObserver.observe(hostEl);
    }

    return {
      setSnapshot(snapshot) {
        rawGraph = snapshot?.flowGraph || { nodes: [], edges: [], pulses: [] };
        if (sketchInstance) {
          applyFilterAndTargets(sketchInstance.width, sketchInstance.height);
          ingestNewPulses(rawGraph.pulses || []);
        }
      },
      setMode(nextMode) {
        layoutMode = nextMode;
        if (sketchInstance) {
          applyFilterAndTargets(sketchInstance.width, sketchInstance.height);
          fitViewToGraph();
        }
      },
      setBackdrop(nextKey) {
        if (STAGE_BACKDROPS[nextKey]) {
          stageBackdropKey = nextKey;
        }
      },
      setAutoCam(nextAuto) {
        autoCamEnabled = Boolean(nextAuto);
        if (!autoCamEnabled) fitViewToGraph();
      },
      setOptions(opts = {}) {
        if (typeof opts.showSubagents === 'boolean') showSubagents = opts.showSubagents;
        if (typeof opts.showTargets === 'boolean') showTargets = opts.showTargets;
        if (typeof opts.showIdle === 'boolean') showIdle = opts.showIdle;
        if (typeof opts.flowSpeed === 'number') flowSpeed = opts.flowSpeed;
        if (sketchInstance) applyFilterAndTargets(sketchInstance.width, sketchInstance.height);
      },
      setVisible(nextVisible) {
        isVisible = Boolean(nextVisible);
        if (!sketchInstance) return;
        if (isVisible) sketchInstance.loop();
        else sketchInstance.noLoop();
      },
      triggerShowstopper(labelText = 'KABOOM!!') {
        if (!sketchInstance) return;
        const centerWorld = screenToWorld(
          sketchInstance.width * 0.45,
          sketchInstance.height * 0.48
        );
        spawnComicBurst(centerWorld.x, centerWorld.y, labelText, MAGENTA);
        spawnInkSplash(centerWorld.x, centerWorld.y, YELLOW, 22);
        spawnInkSplash(centerWorld.x, centerWorld.y, CYAN, 16);
        screenShake = 14;
      },
      fitView: fitViewToGraph,
      resetPins() {
        for (const pos of nodePositions.values()) pos.pinned = false;
        fitViewToGraph();
      },
      savePng() {
        if (sketchInstance) sketchInstance.saveCanvas('moonwitness-riot-observatory', 'png');
      },
      destroy() {
        if (resizeObserver) resizeObserver.disconnect();
        if (sketchInstance) sketchInstance.remove();
      },
    };
  }

  window.MWObservatory.createFlowCanvas = createFlowCanvas;
})();
