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
  const ORANGE = [255, 122, 24];
  const RED = [255, 59, 92];
  const GOLD = [255, 200, 60];

  const RUNTIME_COLORS = Object.freeze({
    hub: YELLOW,
    antigravity: CYAN,
    claude: YELLOW,
    codex: LIME,
    opencode: ORANGE,
    magpie: MAGENTA,
    qoder: VIOLET,
    'gemini-cli': [96, 165, 250],
    'visual-swarm': MAGENTA,
    plan: YELLOW,
    git: ORANGE,
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
    kuroLaugh:
      '/mw-assets/illustrations/riot-universe/characters/kuro-signal-expression-laughing.webp',
    vesper: '/mw-assets/illustrations/riot-universe/characters/vesper-ink-portrait.webp',
    avatarKuro: '/mw-assets/illustrations/riot-universe/game/avatar-kuro.png',
    avatarVesper: '/mw-assets/illustrations/riot-universe/game/avatar-vesper.png',
    stickerBoom: '/mw-assets/illustrations/riot-universe/stickers/sticker-comic-boom.png',
    stickerBolt: '/mw-assets/illustrations/riot-universe/stickers/sticker-lightning-bolt.png',
    stickerStar: '/mw-assets/illustrations/riot-universe/stickers/sticker-riot-star.png',
    stickerFlame: '/mw-assets/illustrations/riot-universe/stickers/sticker-street-flame.png',
    stickerSplash: '/mw-assets/illustrations/riot-universe/stickers/sticker-paint-splash.png',
    stickerCrown: '/mw-assets/illustrations/riot-universe/stickers/sticker-graffiti-crown.png',
  });

  const SFX_WORDS = Object.freeze({
    tool: ['SLASH!!', 'KRAK-ZAP!', 'BEAM!!', 'WHAM!!', 'BASH!!'],
    subagent: ['SUMMON!!', 'SQUAD UP!', 'CLONE!!', 'SWARM!!'],
    swarm: ['RIOT WAR!!', 'ALL-OUT!!', 'MEGA!!'],
    focus: ['LOCK ON!!', 'CHARGE!!', 'POWER UP!'],
    error: ['429 SHIELD!', 'GLITCH!!', 'BONK!!', 'COUNTER!!'],
    message: ['COMBO!!', 'CRIT!!', 'BOOM!!'],
    magpie: ['200 BOOST!!', 'ROUTE ZAP!', 'HYPER LINK!'],
  });

  function colorForNode(nodeEntry) {
    if (nodeEntry.status === 'error') return RED;
    if (nodeEntry.kind === 'swarm') return MAGENTA;
    return RUNTIME_COLORS[nodeEntry.runtime] || PAPER;
  }

  function radiusForNode(nodeEntry, mode) {
    if (nodeEntry.kind === 'hub') return mode === 'warzone' ? 54 : 42;
    if (nodeEntry.kind === 'runtime') return mode === 'warzone' ? 28 : 30;
    if (nodeEntry.kind === 'agent') {
      if (nodeEntry.status === 'running') return mode === 'warzone' ? 33 : 30;
      if (nodeEntry.status === 'recent') return mode === 'warzone' ? 25 : 24;
      if (nodeEntry.status === 'error') return 26;
      return 15;
    }
    if (nodeEntry.kind === 'swarm') return 28;
    if (nodeEntry.kind === 'subagent') return 12;
    return mode === 'warzone' ? 22 : 18;
  }

  function createFlowCanvas(hostEl, tooltipEl, callbacks = {}) {
    if (!hostEl || typeof p5 === 'undefined') {
      return {
        setSnapshot() {},
        setMode() {},
        setBackdrop() {},
        setChaosLevel() {},
        setAutoCam() {},
        setOptions() {},
        setVisible() {},
        triggerShowstopper() {},
        triggerAllOutClash() {},
        fitView() {},
        resetPins() {},
        savePng() {},
        destroy() {},
      };
    }

    let layoutMode = 'warzone';
    let stageBackdropKey = 'rooftop';
    let chaosLevel = 'riot'; // 'chill' | 'riot' | 'overdrive'
    let autoCamEnabled = false;
    let showSubagents = true;
    let showTargets = true;
    let showIdle = true;
    let flowSpeed = 1.15;
    let isVisible = true;

    let rawGraph = { nodes: [], edges: [], pulses: [] };
    let battleMeta = {
      bossName: 'REPO CHAOS BOSS',
      bossHpPct: 100,
      bossShieldCount: 0,
      readyStrikeCount: 0,
      activeWarriors: 0,
      sidekickSwarmCount: 0,
      glitchCount: 0,
      magpieBoostCalls: 0,
    };
    let filteredNodes = [];
    let filteredEdges = [];
    const nodePositions = new Map();
    const seenPulseIds = new Set();

    // Living anime cartoon battle FX pools
    const ambientPackets = [];
    const combatAttacks = []; // { kind: 'laser'|'slash'|'bolt'|'rocket'|'boost', fromId, toId, fromX, fromY, toX, toY, progress, speed, rgb, label, damageText, impacted }
    const comicBursts = []; // { x, y, text, rgb, life, maxLife, rot, scale, stickerKey }
    const damagePopups = []; // { x, y, vx, vy, text, rgb, life, maxLife, big }
    const speechBubbles = new Map(); // nodeId -> { text, rgb, bornAt, durationMs }
    const inkSplashes = []; // { x, y, vx, vy, r, rgb, alpha, angular }
    const shockwaves = []; // { x, y, r, maxR, rgb, alpha, weight }
    const rainDrops = [];
    const speedLines = [];
    let screenShake = 0;
    let screenFlashAlpha = 0;
    let hitStopFrames = 0;
    let autoBattleCooldown = 0;

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

    function chaosMultiplier() {
      if (chaosLevel === 'overdrive') return 1.85;
      if (chaosLevel === 'chill') return 0.55;
      return 1.15;
    }

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
          dashX: 0,
          dashY: 0,
          recoilX: 0,
          recoilY: 0,
          hitFlash: 0,
          trail: [],
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
          const leftRad = radiusForNode(leftNode, layoutMode);
          for (let rightIdx = leftIdx + 1; rightIdx < nodesList.length; rightIdx += 1) {
            const rightNode = nodesList[rightIdx];
            const rightPos = nodePositions.get(rightNode.id);
            if (!rightPos || rightPos.pinned) continue;
            const minGap = leftRad + radiusForNode(rightNode, layoutMode) + 20;
            const dx = rightPos.tx - leftPos.tx;
            const dy = rightPos.ty - leftPos.ty;
            const distSq = dx * dx + dy * dy;
            if (distSq < minGap * minGap) {
              const dist = Math.max(0.5, Math.sqrt(distSq));
              const push = (minGap - dist) * 0.42;
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

      const safeTop = 154;
      const safeBottom = 94;
      const safeLeft = 86;
      const safeRight = 380; // Keep right margin clear of collapsible manga box
      const stageW = Math.max(660, width - safeLeft - safeRight);
      const stageH = Math.max(380, height - safeTop - safeBottom);
      const stageCx = safeLeft + stageW * 0.5;
      const stageCy = safeTop + stageH * 0.52;

      if (layoutMode === 'warzone') {
        // ANIME CARTOON BOSS WARZONE:
        // Left/Center: Coding Hero Vanguard (Antigravity, OpenCode, Claude, Codex, Qoder)
        // Lower-Left Support: Magpie Hyper-Router Turret beaming golden boosts to heroes!
        // Right/Upper-Right: Giant Plan BOSS CORE + Enemy Drones (Dirty Zones / Waves / VPS)
        const bossX = safeLeft + stageW * 0.83;
        const bossY = safeTop + stageH * 0.4;
        upsertTarget('hub:workspace', bossX, bossY);

        const runtimes = filteredNodes.filter((entry) => entry.kind === 'runtime');
        const magpieAgents = filteredNodes.filter(
          (entry) => entry.kind === 'agent' && entry.runtime === 'magpie'
        );
        const warriorAgents = filteredNodes.filter(
          (entry) => entry.kind === 'agent' && entry.runtime !== 'magpie' && entry.status !== 'idle'
        );
        const idleAgents = filteredNodes.filter(
          (entry) => entry.kind === 'agent' && entry.runtime !== 'magpie' && entry.status === 'idle'
        );
        const subs = filteredNodes.filter(
          (entry) => entry.kind === 'subagent' || entry.kind === 'swarm'
        );
        const targets = filteredNodes.filter(
          (entry) =>
            entry.kind === 'plan-wave' || entry.kind === 'workspace-area' || entry.kind === 'infra'
        );

        // Runtime beacons arrayed along left flank (Magpie prominent at bottom-left turbo turret)
        const nonMagpieRts = runtimes.filter((rt) => rt.runtime !== 'magpie');
        for (let idx = 0; idx < nonMagpieRts.length; idx += 1) {
          const frac = nonMagpieRts.length === 1 ? 0.5 : idx / (nonMagpieRts.length - 1);
          upsertTarget(
            nonMagpieRts[idx].id,
            safeLeft + stageW * 0.08,
            safeTop + stageH * (0.1 + frac * 0.56)
          );
        }
        const magpieRt = runtimes.find((rt) => rt.runtime === 'magpie');
        if (magpieRt) {
          upsertTarget(magpieRt.id, safeLeft + stageW * 0.14, safeTop + stageH * 0.82);
        }

        // Active & Recent Warriors in aggressive staggered anime frontline arc facing the Boss!
        const heroCoords = new Map();
        const frontline = warriorAgents.length > 0 ? warriorAgents : idleAgents.slice(0, 4);
        const frontlineIds = new Set(frontline.map((entry) => entry.id));
        for (let idx = 0; idx < frontline.length; idx += 1) {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const rowsTotal = Math.max(1, Math.ceil(frontline.length / 2));
          const rowFrac = rowsTotal === 1 ? 0.5 : row / (rowsTotal - 1);
          const hx = safeLeft + stageW * (col === 0 ? 0.36 : 0.25) + (row % 2 === 0 ? 18 : -10);
          const hy = safeTop + stageH * (0.14 + rowFrac * 0.58);
          heroCoords.set(frontline[idx].sessionId, { x: hx, y: hy });
          upsertTarget(frontline[idx].id, hx, hy);
        }

        // Magpie Router stream turrets flanking lower-left support battery
        for (let idx = 0; idx < magpieAgents.length; idx += 1) {
          const mx = safeLeft + stageW * (0.24 + (idx % 3) * 0.12);
          const my = safeTop + stageH * (0.79 + (idx >= 3 ? 0.12 : 0));
          heroCoords.set(magpieAgents[idx].sessionId, { x: mx, y: my });
          upsertTarget(magpieAgents[idx].id, mx, my);
        }

        // Remaining idle bench neatly docked at bottom edge
        const bench = idleAgents.filter((entry) => !frontlineIds.has(entry.id));
        for (let idx = 0; idx < bench.length; idx += 1) {
          const frac = bench.length === 1 ? 0.5 : idx / (bench.length - 1);
          upsertTarget(
            bench[idx].id,
            safeLeft + stageW * (0.08 + frac * 0.52),
            safeTop + stageH * 0.94 + (idx % 2 === 0 ? -8 : 8)
          );
        }

        // Chibi Subagents & Swarms orbiting their warrior hero like anime combat funnels!
        for (let idx = 0; idx < subs.length; idx += 1) {
          const sub = subs[idx];
          const parentPt = sub.parentSessionId ? heroCoords.get(sub.parentSessionId) : null;
          if (parentPt) {
            const ang = -Math.PI * 0.75 + (idx % 6) * 0.52;
            upsertTarget(sub.id, parentPt.x + Math.cos(ang) * 76, parentPt.y + Math.sin(ang) * 64);
          } else {
            upsertTarget(
              sub.id,
              safeLeft + stageW * 0.5,
              safeTop + stageH * (0.18 + ((idx % 6) / 5) * 0.6)
            );
          }
        }

        // Enemy Drones / Plan Waves / Dirty Zones / VPS Towers orbiting the Boss Core on right flank
        for (let idx = 0; idx < targets.length; idx += 1) {
          const arcSpan = Math.PI * 1.15;
          const frac = targets.length === 1 ? 0.5 : idx / (targets.length - 1);
          const ang = Math.PI * 0.52 + frac * arcSpan; // Shielding arc around left/bottom/top of Boss
          const orbitR = 135 + (idx % 2) * 44;
          const tx = Math.min(safeLeft + stageW - 14, bossX + Math.cos(ang) * orbitR);
          const ty = Math.max(
            safeTop + 18,
            Math.min(safeTop + stageH - 18, bossY + Math.sin(ang) * orbitR * 0.92)
          );
          upsertTarget(targets[idx].id, tx, ty);
        }

        relaxOverlaps(filteredNodes, 4);
      } else if (layoutMode === 'stage') {
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

        for (let idx = 0; idx < runtimes.length; idx += 1) {
          const frac = runtimes.length === 1 ? 0.5 : idx / (runtimes.length - 1);
          const rx = safeLeft + stageW * (0.14 + frac * 0.72);
          const ry = safeTop + stageH * 0.34 - Math.sin(frac * Math.PI) * 34;
          upsertTarget(runtimes[idx].id, rx, ry);
        }

        const heroCoords = new Map();
        for (let idx = 0; idx < activeAgents.length; idx += 1) {
          const frac = activeAgents.length === 1 ? 0.5 : idx / (activeAgents.length - 1);
          const hx = safeLeft + stageW * (0.18 + frac * 0.64);
          const hy = safeTop + stageH * 0.65 + (idx % 2 === 0 ? -18 : 22);
          heroCoords.set(activeAgents[idx].sessionId, { x: hx, y: hy });
          upsertTarget(activeAgents[idx].id, hx, hy);
        }

        for (let idx = 0; idx < idleAgents.length; idx += 1) {
          const frac = idleAgents.length === 1 ? 0.5 : idx / (idleAgents.length - 1);
          const ix = safeLeft + stageW * (0.08 + frac * 0.84);
          const iy = safeTop + stageH * 0.91 + (idx % 2 === 0 ? -14 : 10);
          upsertTarget(idleAgents[idx].id, ix, iy);
        }

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

      const desiredPackets = Math.min(96, filteredEdges.length * 2);
      while (ambientPackets.length < desiredPackets && filteredEdges.length > 0) {
        const edgeIdx = ambientPackets.length % filteredEdges.length;
        ambientPackets.push({
          edgeId: filteredEdges[edgeIdx].id,
          progress: Math.random(),
          speed: 0.004 + Math.random() * 0.006,
          size: 3 + Math.random() * 2.4,
        });
      }
      if (ambientPackets.length > desiredPackets) ambientPackets.length = desiredPackets;

      if (!hasAutoFitted && filteredNodes.length > 0 && sketchInstance) {
        hasAutoFitted = true;
        fitViewToGraph();
      }
    }

    function spawnInkSplash(x, y, rgb, count = 14) {
      for (let idx = 0; idx < count; idx += 1) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 2.2 + Math.random() * 7.2;
        inkSplashes.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 1.6,
          r: 2.5 + Math.random() * 5.8,
          rgb,
          alpha: 250,
          angular: idx % 3 === 0,
        });
      }
      if (inkSplashes.length > 260) inkSplashes.splice(0, inkSplashes.length - 260);
    }

    function spawnShockwave(x, y, rgb, maxR = 96, weight = 4.5) {
      shockwaves.push({ x, y, r: 10, maxR, rgb, alpha: 245, weight });
      if (shockwaves.length > 26) shockwaves.shift();
    }

    function spawnComicBurst(x, y, text, rgb, stickerKey = null, scaleBoost = 1) {
      // Prevent comic starbursts from piling directly on top of each other
      for (const existing of comicBursts) {
        if (Math.hypot(existing.x - x, existing.y - y) < 88) {
          return;
        }
      }
      comicBursts.push({
        x,
        y,
        text,
        rgb,
        life: 0,
        maxLife: 64,
        rot: (Math.random() - 0.5) * 0.28,
        scale: scaleBoost,
        stickerKey,
      });
      if (comicBursts.length > 6) comicBursts.shift();
    }

    function spawnDamagePopup(x, y, text, rgb, big = false) {
      damagePopups.push({
        x: x + (Math.random() - 0.5) * 28,
        y: y - 16,
        vx: (Math.random() - 0.5) * 2.4,
        vy: -(big ? 3.8 : 2.5) - Math.random() * 1.4,
        text,
        rgb,
        life: 0,
        maxLife: big ? 84 : 62,
        big,
      });
      if (damagePopups.length > 32) damagePopups.shift();
    }

    function pickEnemyTargetForAttacker(attackerNode) {
      const targets = filteredNodes.filter(
        (entry) =>
          entry.kind === 'hub' ||
          entry.kind === 'plan-wave' ||
          entry.kind === 'workspace-area' ||
          (entry.kind === 'infra' && entry.status === 'error')
      );
      if (attackerNode.runtime === 'magpie') {
        // Magpie Router fires golden turbo boosts into routed coding heroes!
        const routedHeroes = filteredNodes.filter(
          (entry) =>
            entry.kind === 'agent' &&
            entry.runtime !== 'magpie' &&
            (attackerNode.targetRuntime
              ? entry.runtime === attackerNode.targetRuntime
              : entry.status !== 'idle')
        );
        if (routedHeroes.length > 0) {
          return routedHeroes[Math.floor(Math.random() * routedHeroes.length)];
        }
      }
      // Prefer explicit connected target edge if present
      const linkedTarget = filteredEdges.find(
        (edgeEntry) =>
          edgeEntry.from === attackerNode.id &&
          (edgeEntry.kind === 'plan-link' || edgeEntry.kind === 'workspace-link')
      );
      if (linkedTarget && Math.random() < 0.65) {
        const hit = filteredNodes.find((entry) => entry.id === linkedTarget.to);
        if (hit) return hit;
      }
      if (targets.length > 0) {
        // 55% chance to strike Boss Core directly, 45% enemy minions
        const bossNode = targets.find((entry) => entry.kind === 'hub');
        if (bossNode && Math.random() < 0.55) return bossNode;
        return targets[Math.floor(Math.random() * targets.length)];
      }
      return filteredNodes.find((entry) => entry.kind === 'hub') || null;
    }

    function launchCombatAttack(attackerNode, targetNode, options = {}) {
      if (!attackerNode || !targetNode) return;
      const fromPos = nodePositions.get(attackerNode.id);
      const toPos = nodePositions.get(targetNode.id);
      if (!fromPos || !toPos) return;

      const rgb = options.rgb || colorForNode(attackerNode);
      let kind = options.kind;
      if (!kind) {
        if (attackerNode.runtime === 'magpie') kind = 'boost';
        else if (attackerNode.runtime === 'opencode')
          kind = Math.random() < 0.62 ? 'slash' : 'laser';
        else if (attackerNode.runtime === 'codex') kind = Math.random() < 0.6 ? 'rocket' : 'laser';
        else if (attackerNode.runtime === 'claude') kind = Math.random() < 0.55 ? 'bolt' : 'slash';
        else if (attackerNode.kind === 'subagent') kind = 'rocket';
        else {
          const pool = ['laser', 'slash', 'bolt', 'rocket'];
          kind = pool[Math.floor(Math.random() * pool.length)];
        }
      }

      // Lunge attacker toward target with anime dash impulse!
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const lungeDist = kind === 'slash' ? Math.min(dist * 0.58, 175) : 34;
      fromPos.dashX += (dx / dist) * lungeDist;
      fromPos.dashY += (dy / dist) * lungeDist;

      combatAttacks.push({
        kind,
        fromId: attackerNode.id,
        toId: targetNode.id,
        fromX: fromPos.x,
        fromY: fromPos.y,
        toX: toPos.x,
        toY: toPos.y,
        progress: 0,
        speed:
          kind === 'laser'
            ? 0.08
            : kind === 'slash'
              ? 0.095
              : kind === 'bolt'
                ? 0.11
                : kind === 'boost'
                  ? 0.055
                  : 0.042,
        rgb,
        label: options.label || null,
        damageText: options.damageText || null,
        heavy: Boolean(options.heavy),
        impacted: false,
      });

      if (combatAttacks.length > 42) combatAttacks.shift();
    }

    function applyAttackImpact(attack) {
      const toPos = nodePositions.get(attack.toId);
      const ix = toPos ? toPos.x : attack.toX;
      const iy = toPos ? toPos.y : attack.toY;
      const fromPos = nodePositions.get(attack.fromId);
      const fx = fromPos ? fromPos.x : attack.fromX;
      const fy = fromPos ? fromPos.y : attack.fromY;

      if (toPos) {
        const dx = ix - fx;
        const dy = iy - fy;
        const dist = Math.max(1, Math.hypot(dx, dy));
        if (attack.kind !== 'boost') {
          toPos.recoilX += (dx / dist) * (attack.heavy ? 24 : 11);
          toPos.recoilY += (dy / dist) * (attack.heavy ? 18 : 8);
        }
        toPos.hitFlash = attack.heavy ? 12 : 7;
      }

      spawnInkSplash(ix, iy, attack.rgb, attack.heavy ? 24 : 11);
      spawnShockwave(ix, iy, attack.rgb, attack.heavy ? 135 : 68, attack.heavy ? 5.5 : 3.2);

      if (attack.damageText) {
        spawnDamagePopup(ix, iy - 12, attack.damageText, attack.rgb, attack.heavy);
      }

      if (attack.label) {
        const stickerKey = attack.heavy
          ? 'stickerBoom'
          : attack.kind === 'bolt'
            ? 'stickerBolt'
            : attack.kind === 'slash'
              ? 'stickerFlame'
              : attack.kind === 'rocket'
                ? 'stickerSplash'
                : null;
        spawnComicBurst(
          ix + (Math.random() - 0.5) * 34,
          iy - 34,
          attack.label,
          attack.rgb,
          stickerKey,
          attack.heavy ? 1.28 : 0.92
        );
      }

      if (attack.heavy) {
        screenShake = Math.max(screenShake, 15);
        screenFlashAlpha = Math.max(screenFlashAlpha, 95);
        hitStopFrames = Math.max(hitStopFrames, 3);
      } else {
        screenShake = Math.max(screenShake, 4.5);
      }
    }

    function formatToolDamage(toolName, kind, runtime) {
      if (runtime === 'magpie') {
        return kind === 'error' ? '429 DEFLECT!!' : '200 BOOST!!';
      }
      if (kind === 'error') return 'GLITCH HIT!!';
      const cleaned = String(toolName || 'STRIKE')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .toUpperCase()
        .slice(0, 10);
      const dmg = Math.floor(320 + Math.random() * 1880);
      return `${cleaned || 'CRIT'} -${dmg}!`;
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
              : pulse.runtime === 'magpie'
                ? GOLD
                : pulse.kind === 'focus'
                  ? YELLOW
                  : RUNTIME_COLORS[pulse.runtime] || CYAN;

        if (pulse.toNode && pulse.summary) {
          const shortBubble = `${pulse.tool ? `[${pulse.tool}] ` : ''}${pulse.summary}`.slice(
            0,
            42
          );
          speechBubbles.set(pulse.toNode, {
            text: shortBubble,
            rgb,
            bornAt: Date.now(),
            durationMs: 9500,
          });
        }

        if (isInitial && combatAttacks.length >= 5) continue;

        const attackerNode =
          filteredNodes.find((entry) => entry.id === pulse.toNode) ||
          filteredNodes.find((entry) => entry.id === pulse.fromNode);
        if (attackerNode) {
          const enemyTarget = pickEnemyTargetForAttacker(attackerNode);
          const isMagpiePulse = pulse.runtime === 'magpie';
          const wordPool = isMagpiePulse
            ? SFX_WORDS.magpie
            : SFX_WORDS[pulse.kind] || SFX_WORDS.tool;
          const word = wordPool[Math.floor(Math.random() * wordPool.length)];
          if (enemyTarget) {
            launchCombatAttack(attackerNode, enemyTarget, {
              rgb,
              label: isMagpiePulse ? null : word,
              damageText: formatToolDamage(pulse.tool, pulse.kind, pulse.runtime),
              heavy: pulse.kind === 'error' || pulse.kind === 'swarm',
            });
          }
          newestHotNodeId = attackerNode.id;
        }

        if (!isInitial && typeof callbacks.onLivePulse === 'function') {
          callbacks.onLivePulse(pulse);
        }
      }

      if (autoCamEnabled && newestHotNodeId && sketchInstance) {
        const focusPos = nodePositions.get(newestHotNodeId);
        if (focusPos) {
          targetCamScale = 1.15;
          targetCamX = sketchInstance.width * 0.4 - focusPos.x * targetCamScale;
          targetCamY = sketchInstance.height * 0.5 - focusPos.y * targetCamScale;
        }
      }
    }

    function stepAutonomousSkirmish() {
      if (layoutMode !== 'warzone' && chaosLevel === 'chill') return;
      autoBattleCooldown -= chaosMultiplier();
      if (autoBattleCooldown > 0) return;
      autoBattleCooldown = chaosLevel === 'overdrive' ? 18 : chaosLevel === 'riot' ? 34 : 70;

      const heroCombatants = filteredNodes.filter(
        (entry) =>
          (entry.kind === 'agent' && entry.runtime !== 'magpie' && entry.status !== 'idle') ||
          entry.kind === 'swarm'
      );
      const magpieCombatants = filteredNodes.filter(
        (entry) => entry.kind === 'agent' && entry.runtime === 'magpie'
      );
      const allCombatants = heroCombatants.length > 0 ? heroCombatants : magpieCombatants;
      if (allCombatants.length === 0) return;

      const volleyCount = chaosLevel === 'overdrive' ? 2 : 1;
      for (let vIdx = 0; vIdx < volleyCount; vIdx += 1) {
        const useMagpie = magpieCombatants.length > 0 && Math.random() < 0.22;
        const pool = useMagpie ? magpieCombatants : allCombatants;
        const attacker = pool[Math.floor(Math.random() * pool.length)];
        const target = pickEnemyTargetForAttacker(attacker);
        if (!target || target.id === attacker.id) continue;

        const isMagpie = attacker.runtime === 'magpie';
        const tokensMetric = attacker.metrics?.tokens || 0;
        const dmgText = isMagpie
          ? Math.random() < 0.14
            ? '429 DEFLECT!'
            : '200 BOOST!'
          : tokensMetric > 1000
            ? `+${(tokensMetric / 1000).toFixed(1)}K CRIT!`
            : `${(attacker.sublabel || 'STRIKE').slice(0, 9).toUpperCase()}!`;
        const burstPool = attacker.status === 'error' ? SFX_WORDS.error : SFX_WORDS.tool;
        const showWord = !isMagpie && Math.random() < (chaosLevel === 'overdrive' ? 0.5 : 0.28);

        launchCombatAttack(attacker, target, {
          rgb: isMagpie ? GOLD : colorForNode(attacker),
          label: showWord ? burstPool[Math.floor(Math.random() * burstPool.length)] : null,
          damageText: dmgText,
          heavy: !isMagpie && chaosLevel === 'overdrive' && Math.random() < 0.3,
        });
      }
    }

    function triggerAllOutClash(labelText = 'RIOT CLASH!!') {
      if (!sketchInstance) return;
      const bossNode = filteredNodes.find((entry) => entry.kind === 'hub') || filteredNodes[0];
      const warriors = filteredNodes
        .filter((entry) => entry.kind === 'agent' || entry.kind === 'swarm')
        .slice(0, 10);

      if (bossNode && warriors.length > 0) {
        const attackTypes = ['laser', 'slash', 'bolt', 'rocket'];
        warriors.forEach((warrior, idx) => {
          launchCombatAttack(warrior, bossNode, {
            kind: warrior.runtime === 'magpie' ? 'boost' : attackTypes[idx % attackTypes.length],
            rgb: warrior.runtime === 'magpie' ? GOLD : colorForNode(warrior),
            damageText: idx === 0 ? '9999 SUPER CRIT!!' : `COMBO x${idx + 2}!!`,
            label: idx === 0 ? labelText : idx === 1 ? 'OVERDRIVE!!' : null,
            heavy: idx < 3,
          });
        });
      }

      const bossPos = bossNode
        ? nodePositions.get(bossNode.id)
        : screenToWorld(sketchInstance.width * 0.5, sketchInstance.height * 0.48);
      if (bossPos) {
        spawnComicBurst(bossPos.x, bossPos.y - 24, labelText, MAGENTA, 'stickerBoom', 1.45);
        spawnInkSplash(bossPos.x, bossPos.y, YELLOW, 28);
        spawnInkSplash(bossPos.x, bossPos.y, CYAN, 22);
        spawnInkSplash(bossPos.x, bossPos.y, ORANGE, 18);
        spawnShockwave(bossPos.x, bossPos.y, YELLOW, 195, 7);
        spawnShockwave(bossPos.x, bossPos.y, MAGENTA, 145, 5);
      }
      screenShake = 22;
      screenFlashAlpha = 135;
      hitStopFrames = 4;
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
        const rad = radiusForNode(nodeEntry, layoutMode);
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
      if (nodeEntry.runtime === 'opencode') {
        return nodeEntry.status === 'running' ? spriteImgs.kuroWork : spriteImgs.avatarKuro;
      }
      if (nodeEntry.runtime === 'magpie') return spriteImgs.avatarVesper || spriteImgs.stickerBolt;
      if (nodeEntry.runtime === 'claude') return spriteImgs.vesper;
      if (nodeEntry.runtime === 'codex') return spriteImgs.kuroGaming;
      if (nodeEntry.runtime === 'qoder') return spriteImgs.kuroLaugh;
      if (nodeEntry.runtime === 'gemini-cli') return spriteImgs.kuroCurious;
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
        const rad = radiusForNode(nodeEntry, layoutMode) + 10;
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
      if (nodeEntry.kind === 'hub' && layoutMode === 'warzone') {
        lines.push(`BOSS: ${battleMeta.bossName}`);
        lines.push(`BOSS HP: ${battleMeta.bossHpPct}% · SHIELDS: ${battleMeta.bossShieldCount}`);
        lines.push('CLICK BOSS TO UNLEASH DIRECT STRIKE!!');
      } else {
        if (nodeEntry.model) lines.push(`GEAR: ${nodeEntry.model}`);
        if (nodeEntry.metrics?.tokens)
          lines.push(`POWER: ${fmtNum(nodeEntry.metrics.tokens)} tokens`);
        if (nodeEntry.metrics?.steps) lines.push(`MOVES: ${nodeEntry.metrics.steps} steps`);
        if (nodeEntry.metrics?.subagents) lines.push(`SIDEKICKS: ${nodeEntry.metrics.subagents}`);
        if (nodeEntry.focus) lines.push(`ACTION: ${nodeEntry.focus}`);
        if (nodeEntry.lastError) lines.push(`BONK: ${nodeEntry.lastError}`);
      }

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

    function drawComicStar(sketch, cx, cy, outerR, innerR, points, rotRad) {
      sketch.beginShape();
      for (let idx = 0; idx < points * 2; idx += 1) {
        const ang = (Math.PI * idx) / points + rotRad - Math.PI / 2;
        const rad = idx % 2 === 0 ? outerR : innerR;
        sketch.vertex(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      }
      sketch.endShape(sketch.CLOSE);
    }

    function drawSpikyAura(sketch, rad, rgb, timeSec, alphaMul, boost = 1) {
      const spikes = 12;
      sketch.push();
      sketch.rotate(timeSec * 1.4);
      sketch.stroke(INK[0], INK[1], INK[2], 190 * alphaMul);
      sketch.strokeWeight(2);
      sketch.fill(rgb[0], rgb[1], rgb[2], 95 * alphaMul);
      sketch.beginShape();
      for (let idx = 0; idx < spikes * 2; idx += 1) {
        const ang = (Math.PI * idx) / spikes;
        const flicker = Math.sin(timeSec * 13 + idx * 2.1) * 5 * boost;
        const r = idx % 2 === 0 ? rad + 16 * boost + flicker : rad + 4;
        sketch.vertex(Math.cos(ang) * r, Math.sin(ang) * r);
      }
      sketch.endShape(sketch.CLOSE);
      sketch.pop();
    }

    function drawLightningBolt(sketch, x1, y1, x2, y2, rgb, weight = 3.5) {
      const segments = 7;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.max(1, Math.hypot(dx, dy));
      const perpX = -dy / len;
      const perpY = dx / len;
      const pts = [{ x: x1, y: y1 }];
      for (let step = 1; step < segments; step += 1) {
        const frac = step / segments;
        const jitter = (Math.random() - 0.5) * 28;
        pts.push({
          x: x1 + dx * frac + perpX * jitter,
          y: y1 + dy * frac + perpY * jitter,
        });
      }
      pts.push({ x: x2, y: y2 });

      sketch.noFill();
      sketch.stroke(INK[0], INK[1], INK[2], 235);
      sketch.strokeWeight(weight + 4);
      sketch.beginShape();
      for (const pt of pts) sketch.vertex(pt.x, pt.y);
      sketch.endShape();

      sketch.stroke(rgb[0], rgb[1], rgb[2], 255);
      sketch.strokeWeight(weight);
      sketch.beginShape();
      for (const pt of pts) sketch.vertex(pt.x, pt.y);
      sketch.endShape();

      sketch.stroke(PAPER[0], PAPER[1], PAPER[2], 240);
      sketch.strokeWeight(Math.max(1.2, weight * 0.4));
      sketch.beginShape();
      for (const pt of pts) sketch.vertex(pt.x, pt.y);
      sketch.endShape();
    }

    function drawKatanaSlashArc(sketch, cx, cy, ang, progress, rgb, scaleMul = 1) {
      const arcR = 54 * scaleMul;
      const alpha = Math.sin(progress * Math.PI) * 255;
      sketch.push();
      sketch.translate(cx, cy);
      sketch.rotate(ang + (progress - 0.5) * 1.4);
      sketch.noFill();
      sketch.stroke(INK[0], INK[1], INK[2], alpha);
      sketch.strokeWeight(14 * scaleMul);
      sketch.arc(0, 0, arcR * 2, arcR * 1.5, -1.2, 1.2);
      sketch.stroke(rgb[0], rgb[1], rgb[2], alpha);
      sketch.strokeWeight(8 * scaleMul);
      sketch.arc(0, 0, arcR * 2, arcR * 1.5, -1.15, 1.15);
      sketch.stroke(PAPER[0], PAPER[1], PAPER[2], alpha);
      sketch.strokeWeight(3 * scaleMul);
      sketch.arc(0, 0, arcR * 2.04, arcR * 1.52, -1.05, 1.05);
      sketch.pop();
    }

    function drawMangaSpeechBubble(sketch, cx, bottomY, text, accentRgb, scaleVal, alphaVal) {
      sketch.push();
      sketch.translate(cx, bottomY);
      sketch.scale(scaleVal);
      sketch.textFont('JetBrains Mono, Consolas, monospace');
      sketch.textSize(9.5);
      const clipped = text.length > 34 ? `${text.slice(0, 33)}…` : text;
      const bw = Math.min(232, Math.max(74, sketch.textWidth(clipped) + 18));
      const bh = 23;

      sketch.noStroke();
      sketch.fill(INK[0], INK[1], INK[2], 220 * alphaVal);
      sketch.rect(-bw / 2 + 3, -bh - 7 + 3, bw, bh, 5);

      sketch.fill(PAPER[0], PAPER[1], PAPER[2], 248 * alphaVal);
      sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaVal);
      sketch.strokeWeight(2.5);
      sketch.rect(-bw / 2, -bh - 7, bw, bh, 5);

      sketch.triangle(-6, -7, 6, -7, 0, 1);
      sketch.noStroke();
      sketch.fill(accentRgb[0], accentRgb[1], accentRgb[2], 255 * alphaVal);
      sketch.rect(-bw / 2 + 2, -bh - 5, 4, bh - 4, 2);

      sketch.fill(INK[0], INK[1], INK[2], 255 * alphaVal);
      sketch.textAlign(sketch.CENTER, sketch.CENTER);
      sketch.text(clipped, 3, -bh / 2 - 7);
      sketch.pop();
    }

    sketchInstance = new p5((sketch) => {
      sketch.setup = () => {
        const w = Math.max(360, hostEl.clientWidth || window.innerWidth);
        const h = Math.max(360, hostEl.clientHeight || window.innerHeight);
        const canvas = sketch.createCanvas(w, h);
        canvas.parent(hostEl);
        sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        sketch.textFont('Anton, Impact, sans-serif');

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

        for (let idx = 0; idx < 48; idx += 1) {
          rainDrops.push({
            x: Math.random() * w,
            y: Math.random() * h,
            len: 14 + Math.random() * 26,
            spd: 8 + Math.random() * 9,
            tint: idx % 4 === 0 ? MAGENTA : idx % 4 === 1 ? CYAN : idx % 4 === 2 ? YELLOW : ORANGE,
          });
        }
        for (let idx = 0; idx < 28; idx += 1) {
          speedLines.push({
            angle: (idx / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.14,
            innerRatio: 0.34 + Math.random() * 0.18,
            weight: 1.5 + Math.random() * 3,
            tint: idx % 3 === 0 ? YELLOW : idx % 3 === 1 ? CYAN : MAGENTA,
          });
        }

        applyFilterAndTargets(w, h);
      };

      sketch.draw = () => {
        if (!isVisible) return;
        const w = sketch.width;
        const h = sketch.height;
        const timeSec = sketch.millis() * 0.001;
        const frozen = hitStopFrames > 0;
        if (frozen) hitStopFrames -= 1;

        sketch.background(14, 14, 16);

        // 1. PARALLAX MOONWITNESS ART BACKDROP
        const activeBg = backdropImgs[stageBackdropKey];
        if (activeBg) {
          const parallaxX = ((sketch.mouseX - w / 2) / Math.max(1, w)) * -20;
          const parallaxY = ((sketch.mouseY - h / 2) / Math.max(1, h)) * -12;
          const coverScale = Math.max((w + 54) / activeBg.width, (h + 54) / activeBg.height);
          const drawW = activeBg.width * coverScale;
          const drawH = activeBg.height * coverScale;
          sketch.push();
          sketch.imageMode(sketch.CENTER);
          sketch.tint(255, 165);
          sketch.image(activeBg, w / 2 + parallaxX, h / 2 + parallaxY, drawW, drawH);
          sketch.noTint();
          sketch.pop();
        }

        // Dark comic halftone shade
        sketch.noStroke();
        sketch.fill(10, 10, 15, 98);
        sketch.rect(0, 0, w, h);

        // 2. TRIGGER-STYLE RADIAL ANIME ACTION SPEEDLINES (Scales with Chaos Level & Combat!)
        const speedAlpha =
          chaosLevel === 'overdrive'
            ? 88
            : chaosLevel === 'riot'
              ? 36 + Math.min(48, combatAttacks.length * 6)
              : Math.min(34, combatAttacks.length * 4);
        if (speedAlpha > 8) {
          const cx = w * 0.44;
          const cy = h * 0.5;
          const maxR = Math.hypot(w, h) * 0.72;
          for (let idx = 0; idx < speedLines.length; idx += 1) {
            const lineEntry = speedLines[idx];
            const jitter = Math.sin(timeSec * 22 + idx * 3.1) * 0.04;
            const ang = lineEntry.angle + jitter;
            const rStart = maxR * (lineEntry.innerRatio + Math.sin(timeSec * 14 + idx) * 0.05);
            sketch.stroke(lineEntry.tint[0], lineEntry.tint[1], lineEntry.tint[2], speedAlpha);
            sketch.strokeWeight(lineEntry.weight);
            sketch.line(
              cx + Math.cos(ang) * rStart,
              cy + Math.sin(ang) * rStart,
              cx + Math.cos(ang) * maxR,
              cy + Math.sin(ang) * maxR
            );
          }
        }

        // Stylized neon rain / ember streaks
        for (const drop of rainDrops) {
          if (!frozen) {
            drop.y += drop.spd * flowSpeed * chaosMultiplier();
            drop.x -= drop.spd * 0.22 * flowSpeed * chaosMultiplier();
            if (drop.y > h + 20) {
              drop.y = -20;
              drop.x = Math.random() * (w + 180);
            }
          }
          sketch.stroke(drop.tint[0], drop.tint[1], drop.tint[2], 62);
          sketch.strokeWeight(1.6);
          sketch.line(drop.x, drop.y, drop.x - drop.len * 0.22, drop.y + drop.len);
        }

        // Camera lerp + screen-shake decay
        camX = sketch.lerp(camX, targetCamX, 0.15);
        camY = sketch.lerp(camY, targetCamY, 0.15);
        camScale = sketch.lerp(camScale, targetCamScale, 0.15);
        let shakeX = 0;
        let shakeY = 0;
        if (screenShake > 0.2) {
          shakeX = (Math.random() - 0.5) * screenShake * 2.0;
          shakeY = (Math.random() - 0.5) * screenShake * 2.0;
          if (!frozen) screenShake *= 0.85;
        }

        // Autonomous anime battle skirmishes between SSE ticks
        if (!frozen) {
          stepAutonomousSkirmish();
        }

        // Spring node positions + lively battle strafe / dash / recoil + afterimage trails
        const cMult = chaosMultiplier();
        for (let idx = 0; idx < filteredNodes.length; idx += 1) {
          const nodeEntry = filteredNodes[idx];
          const pos = nodePositions.get(nodeEntry.id);
          if (!pos) continue;

          if (!frozen) {
            pos.dashX *= 0.84;
            pos.dashY *= 0.84;
            pos.recoilX *= 0.82;
            pos.recoilY *= 0.82;
            if (pos.hitFlash > 0) pos.hitFlash -= 1;

            if (!pos.pinned) {
              const isFighter =
                (nodeEntry.kind === 'agent' && nodeEntry.status !== 'idle') ||
                nodeEntry.kind === 'swarm';
              const strafeX =
                layoutMode === 'warzone' && isFighter
                  ? Math.cos(timeSec * 3.1 * cMult + pos.bouncePhase) * (12 * cMult)
                  : 0;
              const bounceAmp =
                nodeEntry.status === 'running'
                  ? 8.5 * cMult
                  : nodeEntry.status === 'recent'
                    ? 4.2
                    : nodeEntry.kind === 'hub' && layoutMode === 'warzone'
                      ? 7
                      : 1.0;
              const bounceY =
                Math.sin(timeSec * (nodeEntry.status === 'running' ? 6.2 : 2.4) + pos.bouncePhase) *
                bounceAmp;

              const destX = pos.tx + strafeX + pos.dashX + pos.recoilX;
              const destY = pos.ty + bounceY + pos.dashY + pos.recoilY;
              pos.x = sketch.lerp(pos.x, destX, 0.16);
              pos.y = sketch.lerp(pos.y, destY, 0.16);

              // Record ghostly anime speed afterimage trail when moving fast
              const speedMag = Math.hypot(pos.dashX, pos.dashY);
              if (
                (isFighter && speedMag > 5) ||
                (layoutMode === 'warzone' &&
                  nodeEntry.status === 'running' &&
                  sketch.frameCount % 3 === 0)
              ) {
                pos.trail.push({ x: pos.x, y: pos.y, alpha: 140 });
                if (pos.trail.length > 5) pos.trail.shift();
              }
            }
            for (let tIdx = pos.trail.length - 1; tIdx >= 0; tIdx -= 1) {
              pos.trail[tIdx].alpha -= 16;
              if (pos.trail[tIdx].alpha <= 8) pos.trail.splice(tIdx, 1);
            }
          }
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

        // 3. WARZONE ARENA GROUND RING / BATTLE FLOOR PERSPECTIVE LINES
        if (layoutMode === 'warzone') {
          const bossPos = nodePositions.get('hub:workspace');
          if (bossPos) {
            sketch.noFill();
            sketch.stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 70);
            sketch.strokeWeight(2.5);
            sketch.ellipse(bossPos.x, bossPos.y + 42, 310, 92);
            sketch.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 55);
            sketch.strokeWeight(1.8);
            sketch.ellipse(bossPos.x, bossPos.y + 42, 220, 62);
          }
        }

        // 4. CEL-SHADED INK-OUTLINED NEON ENERGY CONDUITS
        const edgeMap = new Map();
        for (const edgeEntry of filteredEdges) {
          edgeMap.set(edgeEntry.id, edgeEntry);
          const fromPos = nodePositions.get(edgeEntry.from);
          const toPos = nodePositions.get(edgeEntry.to);
          if (!fromPos || !toPos) continue;
          const isRouter = edgeEntry.kind === 'router-link';
          const rgb = isRouter ? GOLD : RUNTIME_COLORS[edgeEntry.runtime] || CYAN;
          const isLit = !hoveredNodeId || litEdges.has(edgeEntry.id);

          const midX = (fromPos.x + toPos.x) * 0.5;
          const archOffset = layoutMode === 'stage' || layoutMode === 'warzone' ? -30 : 0;
          const ctrlSpan = Math.max(46, Math.abs(toPos.x - fromPos.x) * 0.42);
          const cx1 =
            layoutMode === 'stage' || layoutMode === 'warzone'
              ? midX
              : fromPos.x + (toPos.x >= fromPos.x ? ctrlSpan : -ctrlSpan);
          const cy1 =
            layoutMode === 'stage' || layoutMode === 'warzone'
              ? Math.min(fromPos.y, toPos.y) + archOffset
              : fromPos.y;
          const cx2 =
            layoutMode === 'stage' || layoutMode === 'warzone'
              ? midX
              : toPos.x - (toPos.x >= fromPos.x ? ctrlSpan : -ctrlSpan);
          const cy2 =
            layoutMode === 'stage' || layoutMode === 'warzone'
              ? Math.min(fromPos.y, toPos.y) + archOffset
              : toPos.y;

          sketch.noFill();
          if ((edgeEntry.active || isRouter) && isLit) {
            sketch.stroke(INK[0], INK[1], INK[2], 200);
            sketch.strokeWeight(isRouter ? 7.5 : 5.5);
            sketch.bezier(fromPos.x, fromPos.y, cx1, cy1, cx2, cy2, toPos.x, toPos.y);
          }
          sketch.stroke(
            rgb[0],
            rgb[1],
            rgb[2],
            isLit ? (isRouter ? 245 : edgeEntry.active ? 205 : 70) : 18
          );
          sketch.strokeWeight(isRouter ? 3.8 : edgeEntry.active ? 2.8 : 1.2);
          sketch.bezier(fromPos.x, fromPos.y, cx1, cy1, cx2, cy2, toPos.x, toPos.y);
        }

        // 5. FLOWING ENERGY ORBS ALONG CONDUITS
        for (const packet of ambientPackets) {
          const edgeEntry = edgeMap.get(packet.edgeId);
          if (!edgeEntry) continue;
          const fromPos = nodePositions.get(edgeEntry.from);
          const toPos = nodePositions.get(edgeEntry.to);
          if (!fromPos || !toPos) continue;
          if (!frozen) {
            packet.progress =
              (packet.progress +
                packet.speed * (edgeEntry.active ? 1.7 : 0.5) * flowSpeed * cMult) %
              1;
          }
          if (hoveredNodeId && !litEdges.has(edgeEntry.id)) continue;

          const midX = (fromPos.x + toPos.x) * 0.5;
          const archOffset = layoutMode === 'stage' || layoutMode === 'warzone' ? -30 : 0;
          const ctrlSpan = Math.max(46, Math.abs(toPos.x - fromPos.x) * 0.42);
          const cx1 =
            layoutMode === 'stage' || layoutMode === 'warzone'
              ? midX
              : fromPos.x + (toPos.x >= fromPos.x ? ctrlSpan : -ctrlSpan);
          const cy1 =
            layoutMode === 'stage' || layoutMode === 'warzone'
              ? Math.min(fromPos.y, toPos.y) + archOffset
              : fromPos.y;
          const cx2 =
            layoutMode === 'stage' || layoutMode === 'warzone'
              ? midX
              : toPos.x - (toPos.x >= fromPos.x ? ctrlSpan : -ctrlSpan);
          const cy2 =
            layoutMode === 'stage' || layoutMode === 'warzone'
              ? Math.min(fromPos.y, toPos.y) + archOffset
              : toPos.y;

          const px = bezierPoint(fromPos.x, cx1, cx2, toPos.x, packet.progress);
          const py = bezierPoint(fromPos.y, cy1, cy2, toPos.y, packet.progress);
          const rgb =
            edgeEntry.kind === 'router-link' ? GOLD : RUNTIME_COLORS[edgeEntry.runtime] || YELLOW;

          sketch.stroke(INK[0], INK[1], INK[2], 225);
          sketch.strokeWeight(1.8);
          sketch.fill(rgb[0], rgb[1], rgb[2], edgeEntry.active ? 245 : 140);
          sketch.circle(px, py, packet.size * 2.1);
        }

        // 6. IMPACT SHOCKWAVE RINGS
        for (let idx = shockwaves.length - 1; idx >= 0; idx -= 1) {
          const ring = shockwaves[idx];
          if (!frozen) {
            ring.r = sketch.lerp(ring.r, ring.maxR, 0.22);
            ring.alpha -= 13;
          }
          if (ring.alpha <= 6) {
            shockwaves.splice(idx, 1);
            continue;
          }
          sketch.noFill();
          sketch.stroke(INK[0], INK[1], INK[2], ring.alpha * 0.85);
          sketch.strokeWeight(ring.weight + 3);
          sketch.circle(ring.x, ring.y, ring.r * 2);
          sketch.stroke(ring.rgb[0], ring.rgb[1], ring.rgb[2], ring.alpha);
          sketch.strokeWeight(ring.weight);
          sketch.circle(ring.x, ring.y, ring.r * 2);
        }

        // 7. LIVING ANIME CHARACTERS, BOSS CORE, MAGPIE TURRET & DRONES
        const nowMs = Date.now();
        for (let idx = 0; idx < filteredNodes.length; idx += 1) {
          const nodeEntry = filteredNodes[idx];
          const pos = nodePositions.get(nodeEntry.id);
          if (!pos) continue;
          const rad = radiusForNode(nodeEntry, layoutMode);
          const rgb = colorForNode(nodeEntry);
          const isHovered = hoveredNodeId === nodeEntry.id;
          const isLit = !hoveredNodeId || litNodes.has(nodeEntry.id);
          const alphaMul = isLit ? 1 : 0.28;

          // Ghostly anime speed afterimages behind dashing fighters
          if (pos.trail && pos.trail.length > 0 && isLit) {
            for (const ghost of pos.trail) {
              sketch.noStroke();
              sketch.fill(rgb[0], rgb[1], rgb[2], ghost.alpha * 0.45);
              sketch.circle(ghost.x, ghost.y, rad * 1.85);
            }
          }

          const isEnergetic = nodeEntry.status === 'running' || nodeEntry.kind === 'swarm';
          const squashWave = isEnergetic ? Math.sin(timeSec * 7.5 + pos.bouncePhase) * 0.09 : 0;
          const scaleX = (isHovered ? 1.15 : 1) * (1 - squashWave);
          const scaleY = (isHovered ? 1.15 : 1) * (1 + squashWave);

          sketch.push();
          sketch.translate(pos.x, pos.y);
          sketch.scale(scaleX, scaleY);

          // Spiky anime battle flame aura for active fighters!
          if (isEnergetic || nodeEntry.status === 'error' || isHovered) {
            drawSpikyAura(
              sketch,
              rad,
              nodeEntry.status === 'error' ? RED : rgb,
              timeSec,
              alphaMul,
              chaosLevel === 'overdrive' ? 1.3 : 1
            );
          }

          if (nodeEntry.kind === 'hub') {
            // BOSS CORE IN WARZONE / LUNAR REACTOR IN STAGE
            const isBoss = layoutMode === 'warzone';
            sketch.noFill();
            sketch.stroke(
              isBoss ? MAGENTA[0] : YELLOW[0],
              isBoss ? MAGENTA[1] : YELLOW[1],
              isBoss ? MAGENTA[2] : YELLOW[2],
              225 * alphaMul
            );
            sketch.strokeWeight(3.2);
            sketch.push();
            sketch.rotate(timeSec * (isBoss ? 1.1 : 0.5));
            sketch.ellipse(0, 0, rad * 3.1, rad * 1.15);
            sketch.rotate(Math.PI / 3);
            sketch.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 215 * alphaMul);
            sketch.ellipse(0, 0, rad * 3.1, rad * 1.15);
            if (isBoss) {
              sketch.rotate(Math.PI / 3);
              sketch.stroke(ORANGE[0], ORANGE[1], ORANGE[2], 200 * alphaMul);
              sketch.ellipse(0, 0, rad * 2.75, rad * 1.05);
            }
            sketch.pop();

            // Comic shadow + armored core body
            sketch.noStroke();
            sketch.fill(INK[0], INK[1], INK[2], 235 * alphaMul);
            sketch.circle(6, 6, rad * 2);

            const bodyRgb = pos.hitFlash > 0 ? PAPER : isBoss ? [32, 16, 40] : CYAN;
            sketch.fill(bodyRgb[0], bodyRgb[1], bodyRgb[2], 250 * alphaMul);
            sketch.stroke(
              isBoss ? MAGENTA[0] : INK[0],
              isBoss ? MAGENTA[1] : INK[1],
              isBoss ? MAGENTA[2] : INK[2],
              255 * alphaMul
            );
            sketch.strokeWeight(4.5);
            sketch.circle(0, 0, rad * 2);

            if (isBoss) {
              // Menacing glowing cartoon Boss eyes + Crescent Crown
              sketch.noStroke();
              sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 255 * alphaMul);
              sketch.triangle(-20, -8, -4, 0, -18, 6);
              sketch.triangle(20, -8, 4, 0, 18, 6);
              sketch.fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 255 * alphaMul);
              sketch.arc(0, 14, 28, 16, 0, Math.PI);
              if (spriteImgs.stickerCrown) {
                sketch.imageMode(sketch.CENTER);
                sketch.image(spriteImgs.stickerCrown, 0, -rad - 12, 46, 36);
              }
            } else {
              sketch.noStroke();
              sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 255 * alphaMul);
              sketch.circle(-3, -2, rad * 1.05);
              sketch.fill(CYAN[0], CYAN[1], CYAN[2], 255 * alphaMul);
              sketch.circle(6, -6, rad * 0.85);
            }
          } else if (nodeEntry.kind === 'agent' || nodeEntry.kind === 'swarm') {
            const sprite = pickSpriteForNode(nodeEntry);
            // Comic drop shadow
            sketch.noStroke();
            sketch.fill(INK[0], INK[1], INK[2], 230 * alphaMul);
            sketch.circle(5, 6, rad * 2);

            // Cel-shaded battle medallion backing
            const hitBright = pos.hitFlash > 0;
            sketch.fill(
              hitBright ? YELLOW[0] : PAPER[0],
              hitBright ? YELLOW[1] : PAPER[1],
              hitBright ? YELLOW[2] : PAPER[2],
              (nodeEntry.status === 'idle' ? 185 : 252) * alphaMul
            );
            sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaMul);
            sketch.strokeWeight(3.8);
            sketch.circle(0, 0, rad * 2);

            // Neon inner battle rim
            sketch.noFill();
            sketch.stroke(rgb[0], rgb[1], rgb[2], 250 * alphaMul);
            sketch.strokeWeight(3.6);
            sketch.circle(0, 0, (rad - 3.5) * 2);

            if (sprite) {
              sketch.push();
              sketch.imageMode(sketch.CENTER);
              if (alphaMul < 0.9) sketch.tint(255, Math.round(255 * alphaMul));
              const imgScale = (rad * 2.18) / Math.max(sprite.width, sprite.height);
              sketch.image(sprite, 0, -2, sprite.width * imgScale, sprite.height * imgScale);
              sketch.noTint();
              sketch.pop();
            }

            // Runtime special emblem corner badge (OpenCode flame / Magpie bolt / Active star)
            if (nodeEntry.runtime === 'opencode' && spriteImgs.stickerFlame) {
              sketch.imageMode(sketch.CENTER);
              sketch.image(spriteImgs.stickerFlame, -rad * 0.72, -rad * 0.72, 24, 24);
            } else if (nodeEntry.runtime === 'magpie' && spriteImgs.stickerBolt) {
              sketch.imageMode(sketch.CENTER);
              sketch.image(spriteImgs.stickerBolt, -rad * 0.72, -rad * 0.72, 24, 24);
            }

            if (nodeEntry.status === 'running') {
              sketch.stroke(INK[0], INK[1], INK[2], 255);
              sketch.strokeWeight(2);
              sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 255);
              drawComicStar(sketch, rad * 0.78, -rad * 0.78, 10, 4.5, 4, timeSec * 5);
            } else if (nodeEntry.status === 'error') {
              sketch.stroke(INK[0], INK[1], INK[2], 255);
              sketch.strokeWeight(2);
              sketch.fill(RED[0], RED[1], RED[2], 255);
              sketch.triangle(
                rad * 0.52,
                -rad * 0.45,
                rad * 0.98,
                -rad * 0.45,
                rad * 0.75,
                -rad * 1.08
              );
            }
          } else if (nodeEntry.kind === 'runtime') {
            // Street-punk tilted relay / Magpie hyper-turret diamond
            sketch.noStroke();
            sketch.fill(INK[0], INK[1], INK[2], 225 * alphaMul);
            sketch.rectMode(sketch.CENTER);
            sketch.push();
            sketch.rotate(
              Math.PI / 4 + (nodeEntry.runtime === 'magpie' ? Math.sin(timeSec * 4) * 0.08 : 0)
            );
            sketch.rect(4, 4, rad * 1.48, rad * 1.48, 5);
            sketch.fill(rgb[0], rgb[1], rgb[2], 245 * alphaMul);
            sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaMul);
            sketch.strokeWeight(3.6);
            sketch.rect(0, 0, rad * 1.48, rad * 1.48, 5);
            sketch.pop();
            sketch.rectMode(sketch.CORNER);
            if (nodeEntry.runtime === 'magpie' && spriteImgs.stickerBolt) {
              sketch.imageMode(sketch.CENTER);
              sketch.image(spriteImgs.stickerBolt, 0, 0, 26, 26);
            } else if (nodeEntry.runtime === 'opencode' && spriteImgs.stickerFlame) {
              sketch.imageMode(sketch.CENTER);
              sketch.image(spriteImgs.stickerFlame, 0, 0, 26, 26);
            }
          } else if (nodeEntry.kind === 'subagent') {
            // Bouncy chibi riot star-funnel drone
            sketch.stroke(INK[0], INK[1], INK[2], 240 * alphaMul);
            sketch.strokeWeight(2.2);
            sketch.fill(rgb[0], rgb[1], rgb[2], 240 * alphaMul);
            drawComicStar(sketch, 0, 0, rad + 3, rad * 0.52, 5, timeSec * 2.5 + idx);
          } else {
            // Enemy Glitch Target / Plan Wave Shield / VPS Tower
            sketch.rectMode(sketch.CENTER);
            sketch.noStroke();
            sketch.fill(INK[0], INK[1], INK[2], 235 * alphaMul);
            sketch.rect(4, 4, rad * 2.6, rad * 1.6, 4);
            sketch.fill(
              pos.hitFlash > 0 ? PAPER[0] : 22,
              pos.hitFlash > 0 ? PAPER[1] : 20,
              pos.hitFlash > 0 ? PAPER[2] : 30,
              248 * alphaMul
            );
            sketch.stroke(rgb[0], rgb[1], rgb[2], 250 * alphaMul);
            sketch.strokeWeight(3.2);
            sketch.rect(0, 0, rad * 2.6, rad * 1.6, 4);
            sketch.noStroke();
            sketch.fill(rgb[0], rgb[1], rgb[2], 240 * alphaMul);
            sketch.rect(0, -rad * 0.52, rad * 2.2, 5, 2);
            sketch.rectMode(sketch.CORNER);
          }

          sketch.pop();

          // Live Arcade Boss HP Bar above Boss Core in Warzone!
          if (nodeEntry.kind === 'hub' && layoutMode === 'warzone') {
            const barW = 148;
            const barH = 12;
            const bx = pos.x - barW / 2;
            const by = pos.y - rad - 34;
            sketch.stroke(INK[0], INK[1], INK[2], 255);
            sketch.strokeWeight(2.8);
            sketch.fill(16, 14, 22, 245);
            sketch.rect(bx, by, barW, barH, 3);
            const hpRatio = Math.max(0, Math.min(1, (battleMeta.bossHpPct ?? 100) / 100));
            sketch.noStroke();
            sketch.fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 255);
            sketch.rect(bx + 2, by + 2, (barW - 4) * hpRatio, barH - 4, 2);
            sketch.textFont('Anton, Impact, sans-serif');
            sketch.textSize(10.5);
            sketch.textAlign(sketch.CENTER, sketch.BOTTOM);
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 255);
            sketch.text(`BOSS HP ${battleMeta.bossHpPct}%`, pos.x, by - 3);
          }

          // Mini Energy / Power Bar under active fighters in Warzone!
          if (
            layoutMode === 'warzone' &&
            nodeEntry.kind === 'agent' &&
            nodeEntry.status !== 'idle'
          ) {
            const barW = 54;
            const bx = pos.x - barW / 2;
            const by = pos.y - rad - 13;
            const energyPct = Math.min(
              1,
              Math.max(0.25, ((nodeEntry.metrics?.steps || 10) % 100) / 100)
            );
            sketch.stroke(INK[0], INK[1], INK[2], 240 * alphaMul);
            sketch.strokeWeight(1.8);
            sketch.fill(16, 16, 22, 235 * alphaMul);
            sketch.rect(bx, by, barW, 6, 2);
            sketch.noStroke();
            sketch.fill(rgb[0], rgb[1], rgb[2], 250 * alphaMul);
            sketch.rect(bx + 1.5, by + 1.5, (barW - 3) * energyPct, 3, 1);
          }

          // Crisp comic nameplate tape
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
            const rawTitle =
              nodeEntry.kind === 'hub' && layoutMode === 'warzone'
                ? `BOSS: ${battleMeta.bossName}`
                : nodeEntry.label;
            const labelText = rawTitle.length > 22 ? `${rawTitle.slice(0, 21)}…` : rawTitle;
            sketch.textFont('JetBrains Mono, Consolas, monospace');
            sketch.textSize(nodeEntry.kind === 'hub' ? 11.5 : 9.5);
            const pillW = Math.min(182, sketch.textWidth(labelText) + 14);
            const pillY = pos.y + rad + 7;
            sketch.stroke(INK[0], INK[1], INK[2], 255 * alphaMul);
            sketch.strokeWeight(2.2);
            const highlightRunning =
              nodeEntry.status === 'running' || nodeEntry.runtime === 'opencode';
            sketch.fill(
              highlightRunning ? rgb[0] : 18,
              highlightRunning ? rgb[1] : 18,
              highlightRunning ? rgb[2] : 24,
              242 * alphaMul
            );
            sketch.rect(pos.x - pillW / 2, pillY, pillW, 17, 2);
            sketch.noStroke();
            sketch.textAlign(sketch.CENTER, sketch.CENTER);
            sketch.fill(
              highlightRunning ? INK[0] : PAPER[0],
              highlightRunning ? INK[1] : PAPER[1],
              highlightRunning ? INK[2] : PAPER[2],
              250 * alphaMul
            );
            sketch.text(labelText, pos.x, pillY + 9);
          }
        }

        // 8. LIVE COMBAT PROJECTILES: LASER BEAMS, KATANA SLASHES, LIGHTNING, ROCKETS & MAGPIE BOOSTS
        for (let idx = combatAttacks.length - 1; idx >= 0; idx -= 1) {
          const attack = combatAttacks[idx];
          if (!frozen) {
            attack.progress += attack.speed * Math.max(0.65, flowSpeed) * cMult;
          }
          const fromPos = nodePositions.get(attack.fromId);
          const toPos = nodePositions.get(attack.toId);
          const fx = fromPos ? fromPos.x : attack.fromX;
          const fy = fromPos ? fromPos.y : attack.fromY;
          const tx = toPos ? toPos.x : attack.toX;
          const ty = toPos ? toPos.y : attack.toY;

          if (attack.progress >= 0.85 && !attack.impacted) {
            attack.impacted = true;
            applyAttackImpact(attack);
          }
          if (attack.progress >= 1.12) {
            combatAttacks.splice(idx, 1);
            continue;
          }

          const clamped = Math.min(1, attack.progress);
          const fade = attack.progress > 0.85 ? Math.max(0, (1.12 - attack.progress) / 0.27) : 1;
          const ang = Math.atan2(ty - fy, tx - fx);

          if (attack.kind === 'laser') {
            // Thick cel-shaded anime mega-beam!
            const beamEndX = sketch.lerp(fx, tx, Math.min(1, clamped * 1.4));
            const beamEndY = sketch.lerp(fy, ty, Math.min(1, clamped * 1.4));
            const wScale = (attack.heavy ? 1.55 : 1) * fade;
            sketch.stroke(INK[0], INK[1], INK[2], 240 * fade);
            sketch.strokeWeight(16 * wScale);
            sketch.line(fx, fy, beamEndX, beamEndY);
            sketch.stroke(attack.rgb[0], attack.rgb[1], attack.rgb[2], 255 * fade);
            sketch.strokeWeight(10 * wScale);
            sketch.line(fx, fy, beamEndX, beamEndY);
            sketch.stroke(PAPER[0], PAPER[1], PAPER[2], 255 * fade);
            sketch.strokeWeight(4 * wScale);
            sketch.line(fx, fy, beamEndX, beamEndY);
            // Muzzle burst star
            sketch.stroke(INK[0], INK[1], INK[2], 240 * fade);
            sketch.strokeWeight(2);
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 250 * fade);
            drawComicStar(sketch, fx, fy, 16 * wScale, 7 * wScale, 6, timeSec * 12);
          } else if (attack.kind === 'slash') {
            // Blazing anime dash line + curved crescent katana slash across target!
            sketch.stroke(attack.rgb[0], attack.rgb[1], attack.rgb[2], 175 * fade);
            sketch.strokeWeight(3.5);
            sketch.line(fx, fy, tx, ty);
            drawKatanaSlashArc(sketch, tx, ty, ang, clamped, attack.rgb, attack.heavy ? 1.35 : 1);
          } else if (attack.kind === 'bolt') {
            const boltEndX = sketch.lerp(fx, tx, Math.min(1, clamped * 1.3));
            const boltEndY = sketch.lerp(fy, ty, Math.min(1, clamped * 1.3));
            drawLightningBolt(
              sketch,
              fx,
              fy,
              boltEndX,
              boltEndY,
              attack.rgb,
              attack.heavy ? 5 : 3.4
            );
          } else if (attack.kind === 'boost') {
            // Golden/Pink Magpie Power-Up Stream with orbiting chevrons!
            drawLightningBolt(sketch, fx, fy, tx, ty, GOLD, 2.8);
            const bx = sketch.lerp(fx, tx, clamped);
            const by = sketch.lerp(fy, ty, clamped);
            sketch.stroke(INK[0], INK[1], INK[2], 240);
            sketch.strokeWeight(2.5);
            sketch.fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 255);
            drawComicStar(sketch, bx, by, 13, 6, 5, timeSec * 10);
          } else {
            // Arcing Homing Chibi Rocket with cartoon puff trail
            const arcLift = Math.sin(clamped * Math.PI) * 74;
            const rx = sketch.lerp(fx, tx, clamped);
            const ry = sketch.lerp(fy, ty, clamped) - arcLift;
            // Smoke trail dots
            for (let step = 1; step <= 4; step += 1) {
              const prevT = Math.max(0, clamped - step * 0.055);
              const sx = sketch.lerp(fx, tx, prevT);
              const sy = sketch.lerp(fy, ty, prevT) - Math.sin(prevT * Math.PI) * 74;
              sketch.noStroke();
              sketch.fill(PAPER[0], PAPER[1], PAPER[2], 190 - step * 35);
              sketch.circle(sx, sy, 12 - step * 1.8);
            }
            sketch.push();
            sketch.translate(rx, ry);
            sketch.rotate(ang);
            sketch.stroke(INK[0], INK[1], INK[2], 255);
            sketch.strokeWeight(2.5);
            sketch.fill(attack.rgb[0], attack.rgb[1], attack.rgb[2], 255);
            sketch.triangle(14, 0, -10, -8, -10, 8);
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 255);
            sketch.circle(-11, 0, 8);
            sketch.pop();
          }
        }

        // 9. SPRAY-PAINT INK SHARDS & COMIC EXPLOSION PARTICLES
        for (let idx = inkSplashes.length - 1; idx >= 0; idx -= 1) {
          const drop = inkSplashes[idx];
          if (!frozen) {
            drop.x += drop.vx;
            drop.y += drop.vy;
            drop.vy += 0.16;
            drop.alpha -= 7.2;
          }
          if (drop.alpha <= 4) {
            inkSplashes.splice(idx, 1);
            continue;
          }
          sketch.stroke(INK[0], INK[1], INK[2], drop.alpha);
          sketch.strokeWeight(1.6);
          sketch.fill(drop.rgb[0], drop.rgb[1], drop.rgb[2], drop.alpha);
          if (drop.angular) {
            sketch.push();
            sketch.translate(drop.x, drop.y);
            sketch.rotate(drop.alpha * 0.06);
            sketch.rect(-drop.r, -drop.r * 0.6, drop.r * 2, drop.r * 1.2);
            sketch.pop();
          } else {
            sketch.circle(drop.x, drop.y, drop.r * 2);
          }
        }

        // 10. TOP-LAYER MANGA SPEECH BUBBLES (Limit to top 3 newest + hovered so stage stays clean!)
        const activeBubbles = [];
        for (const nodeEntry of filteredNodes) {
          const pos = nodePositions.get(nodeEntry.id);
          if (!pos) continue;
          const isHovered = hoveredNodeId === nodeEntry.id;
          const bubble = speechBubbles.get(nodeEntry.id);
          if (
            bubble &&
            nowMs - bubble.bornAt < bubble.durationMs &&
            (nodeEntry.status !== 'idle' || isHovered)
          ) {
            activeBubbles.push({ nodeEntry, pos, bubble, isHovered });
          }
        }
        activeBubbles.sort(
          (left, right) =>
            Number(right.isHovered) - Number(left.isHovered) ||
            right.bubble.bornAt - left.bubble.bornAt
        );
        for (const entry of activeBubbles.slice(0, 3)) {
          const { nodeEntry, pos, bubble, isHovered } = entry;
          const isLit = !hoveredNodeId || litNodes.has(nodeEntry.id);
          const alphaMul = isLit ? 1 : 0.28;
          const rad = radiusForNode(nodeEntry, layoutMode);
          const age = (nowMs - bubble.bornAt) / bubble.durationMs;
          const popIn = Math.min(1, (nowMs - bubble.bornAt) / 160);
          const fadeOut = age > 0.82 ? Math.max(0, (1 - age) / 0.18) : 1;
          const bScale = (0.72 + popIn * 0.28) * (isHovered ? 1.05 : 1);
          drawMangaSpeechBubble(
            sketch,
            pos.x,
            pos.y - rad - 22,
            bubble.text,
            bubble.rgb,
            bScale,
            fadeOut * alphaMul
          );
        }

        // 11. FLOATING ARCADE DAMAGE & TOKEN POPUPS (+2.4K PWR! / CRIT!! / 429 DEFLECT!)
        for (let idx = damagePopups.length - 1; idx >= 0; idx -= 1) {
          const pop = damagePopups[idx];
          if (!frozen) {
            pop.life += 1;
            pop.x += pop.vx;
            pop.y += pop.vy;
            pop.vy *= 0.94;
          }
          if (pop.life >= pop.maxLife) {
            damagePopups.splice(idx, 1);
            continue;
          }
          const frac = pop.life / pop.maxLife;
          const scaleVal = frac < 0.15 ? 0.5 + (frac / 0.15) * 0.7 : 1.15 - frac * 0.2;
          const alpha = frac > 0.68 ? Math.max(0, (1 - frac) / 0.32) * 255 : 255;

          sketch.push();
          sketch.translate(pop.x, pop.y);
          sketch.scale(scaleVal);
          sketch.textFont('Anton, Impact, sans-serif');
          sketch.textSize(pop.big ? 20 : 14);
          sketch.textAlign(sketch.CENTER, sketch.CENTER);
          sketch.fill(INK[0], INK[1], INK[2], alpha);
          sketch.text(pop.text, 2.5, 2.5);
          sketch.fill(pop.rgb[0], pop.rgb[1], pop.rgb[2], alpha);
          sketch.text(pop.text, 0, 0);
          sketch.pop();
        }

        // 12. POP-ART COMIC SFX ONOMATOPOEIA & MOONWITNESS STICKER EXPLOSIONS
        for (let idx = comicBursts.length - 1; idx >= 0; idx -= 1) {
          const burst = comicBursts[idx];
          if (!frozen) burst.life += 1;
          if (burst.life >= burst.maxLife) {
            comicBursts.splice(idx, 1);
            continue;
          }
          const frac = burst.life / burst.maxLife;
          const popScale =
            (frac < 0.15
              ? 0.35 + (frac / 0.15) * 0.95
              : frac < 0.28
                ? 1.3 - ((frac - 0.15) / 0.13) * 0.3
                : 1) * (burst.scale || 1);
          const fade = frac > 0.7 ? Math.max(0, (1 - frac) / 0.3) : 1;

          sketch.push();
          sketch.translate(burst.x, burst.y - frac * 24);
          sketch.rotate(burst.rot);
          sketch.scale(popScale);

          const stickerImg = burst.stickerKey ? spriteImgs[burst.stickerKey] : null;
          if (stickerImg) {
            sketch.imageMode(sketch.CENTER);
            sketch.tint(255, Math.round(255 * fade));
            sketch.image(stickerImg, 0, 0, 92, 92);
            sketch.noTint();
          } else {
            sketch.stroke(INK[0], INK[1], INK[2], 255 * fade);
            sketch.strokeWeight(3);
            sketch.fill(burst.rgb[0], burst.rgb[1], burst.rgb[2], 245 * fade);
            drawComicStar(sketch, 0, 0, 40, 24, 9, 0);
          }

          sketch.textFont('Road Rage, Anton, Impact, sans-serif');
          sketch.textSize(23);
          sketch.textAlign(sketch.CENTER, sketch.CENTER);
          sketch.fill(INK[0], INK[1], INK[2], 255 * fade);
          sketch.text(burst.text, 2.5, 2.5);
          sketch.fill(PAPER[0], PAPER[1], PAPER[2], 255 * fade);
          sketch.text(burst.text, 0, 0);
          sketch.pop();
        }

        sketch.pop();

        // Fullscreen anime impact flash fade
        if (screenFlashAlpha > 2) {
          sketch.noStroke();
          sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], screenFlashAlpha);
          sketch.rect(0, 0, w, h);
          if (!frozen) screenFlashAlpha *= 0.78;
        }
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
          spawnInkSplash(worldPt.x, worldPt.y, colorForNode(hitNode), 10);
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
          } else if (clickedNode) {
            if (clickedNode.kind === 'hub' && layoutMode === 'warzone') {
              triggerAllOutClash('BOSS STRIKE!!');
            }
            if (typeof callbacks.onNodeClick === 'function') {
              callbacks.onNodeClick(clickedNode);
            }
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
        if (snapshot?.battle) battleMeta = snapshot.battle;
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
      setChaosLevel(nextLevel) {
        if (nextLevel === 'chill' || nextLevel === 'riot' || nextLevel === 'overdrive') {
          chaosLevel = nextLevel;
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
      triggerShowstopper(labelText = 'RIOT CLASH!!') {
        triggerAllOutClash(labelText);
      },
      triggerAllOutClash,
      fitView: fitViewToGraph,
      resetPins() {
        for (const pos of nodePositions.values()) pos.pinned = false;
        fitViewToGraph();
      },
      savePng() {
        if (sketchInstance) sketchInstance.saveCanvas('moonwitness-riot-warzone', 'png');
      },
      destroy() {
        if (resizeObserver) resizeObserver.disconnect();
        if (sketchInstance) sketchInstance.remove();
      },
    };
  }

  window.MWObservatory.createFlowCanvas = createFlowCanvas;
})();
