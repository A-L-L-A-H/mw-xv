/* global window, p5, ResizeObserver */
(function () {
  window.MWObservatory = window.MWObservatory || {};

  // Unified MoonWitness Riot Comic Palette
  const INK = [13, 13, 13];
  const PAPER = [243, 239, 228];
  const NIGHT = [14, 14, 16];
  const CHARCOAL = [23, 23, 28];
  const YELLOW = [255, 224, 49];
  const MAGENTA = [255, 46, 136];
  const CYAN = [0, 184, 240];
  const VIOLET = [192, 132, 252];
  const GREEN = [74, 222, 128];
  const SLATE = [120, 125, 138];

  const STATE_COLORS = Object.freeze({
    done: GREEN,
    active: YELLOW,
    ready: CYAN,
    blocked: SLATE,
  });

  function createDagCanvas(hostEl, tooltipEl, callbacks = {}) {
    if (!hostEl || typeof p5 === 'undefined') {
      return {
        setPlan() {},
        setSelectedTask() {},
        setShowCritical() {},
        setVisible() {},
        fitView() {},
        savePng() {},
        destroy() {},
      };
    }

    let currentPlan = null;
    let selectedTaskId = null;
    let hoveredTaskId = null;
    let showCriticalPath = true;
    let isVisible = false;

    let layoutNodes = [];
    let layoutById = new Map();
    let waveBounds = [];
    let criticalSet = new Set();
    let criticalEdgeSet = new Set();

    let camX = 24;
    let camY = 20;
    let camScale = 1;
    let targetCamX = 24;
    let targetCamY = 20;
    let targetCamScale = 1;

    let isPanning = false;
    let pointerMoved = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    let sketchInstance = null;
    let resizeObserver = null;

    function computeDagLayout() {
      layoutNodes = [];
      layoutById = new Map();
      waveBounds = [];
      criticalSet = new Set();
      criticalEdgeSet = new Set();

      if (!currentPlan || !currentPlan.dag || !currentPlan.dag.nodes.length) return;

      const dag = currentPlan.dag;
      const waves = currentPlan.waves || [];
      for (const taskId of dag.criticalPathIds || []) {
        criticalSet.add(taskId);
      }
      for (let idx = 0; idx < (dag.criticalPathIds || []).length - 1; idx += 1) {
        criticalEdgeSet.add(`${dag.criticalPathIds[idx]}->${dag.criticalPathIds[idx + 1]}`);
      }

      const nodesByWave = new Map();
      for (const node of dag.nodes) {
        const wIdx = node.waveIndex ?? 0;
        if (!nodesByWave.has(wIdx)) nodesByWave.set(wIdx, []);
        nodesByWave.get(wIdx).push(node);
      }

      const cardW = 142;
      const cardH = 44;
      const gapX = 24;
      const gapY = 14;
      const lanePad = 18;
      const laneGap = 36;
      const maxRowsPerSubCol = 8;

      let cursorX = 26;
      const waveCount = Math.max(1, waves.length);

      for (let wIdx = 0; wIdx < waveCount; wIdx += 1) {
        const waveMeta = waves[wIdx] || { title: `Wave ${wIdx}`, done: 0, total: 0, percent: 0 };
        const wNodes = nodesByWave.get(wIdx) || [];
        if (wNodes.length === 0) continue;

        const subCols = Math.max(1, Math.ceil(wNodes.length / maxRowsPerSubCol));
        const rowsInLane = Math.min(maxRowsPerSubCol, Math.ceil(wNodes.length / subCols));
        const laneW = lanePad * 2 + subCols * cardW + (subCols - 1) * gapX;
        const laneH = 66 + rowsInLane * (cardH + gapY) + lanePad;

        waveBounds.push({
          title: waveMeta.title,
          done: waveMeta.done,
          total: waveMeta.total,
          percent: waveMeta.percent,
          x: cursorX,
          y: 18,
          w: laneW,
          h: laneH,
        });

        for (let idx = 0; idx < wNodes.length; idx += 1) {
          const subCol = Math.floor(idx / rowsInLane);
          const row = idx % rowsInLane;
          const nx = cursorX + lanePad + subCol * (cardW + gapX);
          const ny = 76 + row * (cardH + gapY);
          const positioned = {
            ...wNodes[idx],
            x: nx,
            y: ny,
            w: cardW,
            h: cardH,
            cx: nx + cardW / 2,
            cy: ny + cardH / 2,
          };
          layoutNodes.push(positioned);
          layoutById.set(positioned.id, positioned);
        }

        cursorX += laneW + laneGap;
      }
    }

    function fitView() {
      if (!sketchInstance || waveBounds.length === 0) return;
      let maxX = 0;
      let maxY = 0;
      for (const bound of waveBounds) {
        maxX = Math.max(maxX, bound.x + bound.w);
        maxY = Math.max(maxY, bound.y + bound.h);
      }
      const totalW = Math.max(300, maxX + 36);
      const totalH = Math.max(240, maxY + 42);
      const scale = Math.min(
        1.15,
        Math.max(0.32, Math.min(sketchInstance.width / totalW, sketchInstance.height / totalH))
      );
      targetCamScale = scale;
      targetCamX = (sketchInstance.width - maxX * scale) / 2;
      targetCamY = Math.max(14, (sketchInstance.height - maxY * scale) / 2);
    }

    function collectChain(rootId) {
      const ancestors = new Set();
      const descendants = new Set();
      if (!rootId) return { ancestors, descendants };

      const upQueue = [rootId];
      while (upQueue.length > 0) {
        const current = upQueue.shift();
        const node = layoutById.get(current);
        for (const depId of node?.depIds || []) {
          if (!ancestors.has(depId)) {
            ancestors.add(depId);
            upQueue.push(depId);
          }
        }
      }

      const downQueue = [rootId];
      while (downQueue.length > 0) {
        const current = downQueue.shift();
        const node = layoutById.get(current);
        for (const childId of node?.dependents || []) {
          if (!descendants.has(childId)) {
            descendants.add(childId);
            downQueue.push(childId);
          }
        }
      }
      return { ancestors, descendants };
    }

    function screenToWorld(sx, sy) {
      return {
        x: (sx - camX) / camScale,
        y: (sy - camY) / camScale,
      };
    }

    function findCardAt(wx, wy) {
      for (const node of layoutNodes) {
        if (wx >= node.x && wx <= node.x + node.w && wy >= node.y && wy <= node.y + node.h) {
          return node;
        }
      }
      return null;
    }

    function updateTooltip(node, mouseX, mouseY) {
      if (!tooltipEl) return;
      if (!node) {
        tooltipEl.classList.add('hidden');
        return;
      }
      const esc = window.MWObservatory.utils?.esc || ((val) => String(val ?? ''));
      tooltipEl.innerHTML = `
        <div class="canvas-tooltip-title">${esc(node.id)} — ${esc(node.title)}</div>
        <div class="canvas-tooltip-sub">${esc(node.state.toUpperCase())} · ${esc(node.wave)}</div>
        <div class="canvas-tooltip-body">
          Deps: ${node.depIds.length ? esc(node.depIds.join(', ')) : 'None'}<br/>
          Unblocks: ${node.dependents.length ? esc(node.dependents.slice(0, 8).join(', ')) : 'Boss Clear'}
          ${node.commitSha ? `<br/>Commit: ${esc(node.commitSha)}` : ''}
        </div>
      `;
      tooltipEl.classList.remove('hidden');
      tooltipEl.style.left = `${Math.min(hostEl.clientWidth - 320, Math.max(12, mouseX + 16))}px`;
      tooltipEl.style.top = `${Math.min(hostEl.clientHeight - 130, Math.max(12, mouseY + 14))}px`;
    }

    function bezierEval(p0, p1, p2, p3, t) {
      const inv = 1 - t;
      return inv * inv * inv * p0 + 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t * p3;
    }

    function drawMiniStar(sketch, cx, cy, outerR, innerR, rotRad) {
      sketch.beginShape();
      for (let idx = 0; idx < 10; idx += 1) {
        const ang = (Math.PI * idx) / 5 + rotRad - Math.PI / 2;
        const rad = idx % 2 === 0 ? outerR : innerR;
        sketch.vertex(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      }
      sketch.endShape(sketch.CLOSE);
    }

    sketchInstance = new p5((sketch) => {
      sketch.setup = () => {
        const w = Math.max(320, hostEl.clientWidth || 860);
        const h = Math.max(340, hostEl.clientHeight || 500);
        const canvas = sketch.createCanvas(w, h);
        canvas.parent(hostEl);
        sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        sketch.textFont('JetBrains Mono, Consolas, monospace');
        if (!isVisible) sketch.noLoop();
      };

      sketch.draw = () => {
        if (!isVisible) return;
        sketch.background(NIGHT[0], NIGHT[1], NIGHT[2]);

        // Subtle Ben-Day comic halftone grid dots on background
        sketch.noStroke();
        sketch.fill(255, 224, 49, 14);
        for (let gx = 16; gx < sketch.width; gx += 32) {
          for (let gy = 16; gy < sketch.height; gy += 32) {
            sketch.circle(gx, gy, 2.2);
          }
        }

        camX = sketch.lerp(camX, targetCamX, 0.2);
        camY = sketch.lerp(camY, targetCamY, 0.2);
        camScale = sketch.lerp(camScale, targetCamScale, 0.2);

        const focusId = hoveredTaskId || selectedTaskId;
        const { ancestors, descendants } = collectChain(focusId);
        const timeSec = sketch.millis() * 0.001;

        sketch.push();
        sketch.translate(camX, camY);
        sketch.scale(camScale);

        // 1. RIOT COMIC CHAPTER SWIMLANES (Hard ink borders + comic drop shadow)
        for (const bound of waveBounds) {
          sketch.noStroke();
          sketch.fill(INK[0], INK[1], INK[2], 220);
          sketch.rect(bound.x + 5, bound.y + 5, bound.w, bound.h, 4);

          sketch.fill(CHARCOAL[0], CHARCOAL[1], CHARCOAL[2], 235);
          sketch.stroke(INK[0], INK[1], INK[2], 255);
          sketch.strokeWeight(3);
          sketch.rect(bound.x, bound.y, bound.w, bound.h, 4);

          // Yellow/Magenta comic header tape
          sketch.noStroke();
          sketch.fill(
            bound.percent === 100 ? GREEN[0] : YELLOW[0],
            bound.percent === 100 ? GREEN[1] : YELLOW[1],
            bound.percent === 100 ? GREEN[2] : YELLOW[2],
            240
          );
          sketch.rect(bound.x + 2, bound.y + 2, bound.w - 4, 24, 2);

          sketch.fill(INK[0], INK[1], INK[2]);
          sketch.textFont('Anton, Impact, sans-serif');
          sketch.textAlign(sketch.LEFT, sketch.CENTER);
          sketch.textSize(12);
          const shortTitle = bound.title.length > 26 ? `${bound.title.slice(0, 25)}…` : bound.title;
          sketch.text(shortTitle.toUpperCase(), bound.x + 10, bound.y + 14);

          sketch.textFont('JetBrains Mono, Consolas, monospace');
          sketch.textAlign(sketch.RIGHT, sketch.CENTER);
          sketch.textSize(10);
          sketch.text(`${bound.done}/${bound.total}`, bound.x + bound.w - 10, bound.y + 14);

          // Progress bar inside ink frame
          sketch.fill(INK[0], INK[1], INK[2]);
          sketch.rect(bound.x + 12, bound.y + 34, bound.w - 24, 7, 2);
          sketch.fill(
            bound.percent === 100 ? GREEN[0] : CYAN[0],
            bound.percent === 100 ? GREEN[1] : CYAN[1],
            bound.percent === 100 ? GREEN[2] : CYAN[2]
          );
          sketch.rect(
            bound.x + 13,
            bound.y + 35,
            Math.max(0, ((bound.w - 26) * bound.percent) / 100),
            5,
            1
          );
        }

        // 2. INK-CASED DEPENDENCY CONDUITS + BOSS-PATH STAR BEADS
        const edges = currentPlan?.dag?.edges || [];
        for (const edgeEntry of edges) {
          const fromNode = layoutById.get(edgeEntry.from);
          const toNode = layoutById.get(edgeEntry.to);
          if (!fromNode || !toNode) continue;

          const edgeKey = `${edgeEntry.from}->${edgeEntry.to}`;
          const isCritical = showCriticalPath && criticalEdgeSet.has(edgeKey);
          const isUpstreamEdge =
            focusId &&
            (ancestors.has(edgeEntry.from) || edgeEntry.from === focusId) &&
            (ancestors.has(edgeEntry.to) || edgeEntry.to === focusId);
          const isDownstreamEdge =
            focusId &&
            (descendants.has(edgeEntry.to) || edgeEntry.to === focusId) &&
            (descendants.has(edgeEntry.from) || edgeEntry.from === focusId);

          const x1 = fromNode.x + fromNode.w;
          const y1 = fromNode.cy;
          const x2 = toNode.x;
          const y2 = toNode.cy;
          const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
          const cx1 = x1 + dx;
          const cx2 = x2 - dx;

          let rgb = edgeEntry.satisfied ? GREEN : SLATE;
          let alpha = edgeEntry.satisfied ? 135 : 65;
          let weight = 1.6;

          if (isCritical) {
            rgb = MAGENTA;
            alpha = 235;
            weight = 3;
          }
          if (isUpstreamEdge) {
            rgb = CYAN;
            alpha = 245;
            weight = 3;
          } else if (isDownstreamEdge) {
            rgb = VIOLET;
            alpha = 245;
            weight = 3;
          } else if (focusId) {
            alpha = Math.min(alpha, 25);
          }

          sketch.noFill();
          if (isCritical || isUpstreamEdge || isDownstreamEdge) {
            sketch.stroke(INK[0], INK[1], INK[2], 220);
            sketch.strokeWeight(weight + 3);
            sketch.bezier(x1, y1, cx1, y1, cx2, y2, x2, y2);
          }
          sketch.stroke(rgb[0], rgb[1], rgb[2], alpha);
          sketch.strokeWeight(weight);
          sketch.bezier(x1, y1, cx1, y1, cx2, y2, x2, y2);

          if (
            (edgeEntry.satisfied && !toNode.done) ||
            isCritical ||
            isUpstreamEdge ||
            isDownstreamEdge
          ) {
            const flowT = (timeSec * 0.45 + fromNode.orderIndex * 0.13) % 1;
            const px = bezierEval(x1, cx1, cx2, x2, flowT);
            const py = bezierEval(y1, y1, y2, y2, flowT);
            sketch.stroke(INK[0], INK[1], INK[2], 240);
            sketch.strokeWeight(1.5);
            sketch.fill(
              isCritical ? YELLOW[0] : rgb[0],
              isCritical ? YELLOW[1] : rgb[1],
              isCritical ? YELLOW[2] : rgb[2],
              255
            );
            if (isCritical) {
              drawMiniStar(sketch, px, py, 6.5, 3, timeSec * 4);
            } else {
              sketch.circle(px, py, 6);
            }
          }
        }

        // 3. COMIC QUEST CARDS (Hard ink frame + hard shadow + bold status tape)
        for (const node of layoutNodes) {
          const baseRgb = STATE_COLORS[node.state] || STATE_COLORS.blocked;
          const isSelected = node.id === selectedTaskId;
          const isHovered = node.id === hoveredTaskId;
          const isCriticalNode = showCriticalPath && criticalSet.has(node.id);
          const isAncestor = ancestors.has(node.id);
          const isDescendant = descendants.has(node.id);
          const dimmed = focusId && !isSelected && !isHovered && !isAncestor && !isDescendant;
          const alphaMul = dimmed ? 0.26 : 1;

          // Offset comic shadow
          sketch.noStroke();
          sketch.fill(
            isSelected ? MAGENTA[0] : INK[0],
            isSelected ? MAGENTA[1] : INK[1],
            isSelected ? MAGENTA[2] : INK[2],
            220 * alphaMul
          );
          sketch.rect(node.x + 3.5, node.y + 3.5, node.w, node.h, 3);

          // Pulsing riot outline on active / ready / boss-path nodes
          if (node.state === 'ready' || node.state === 'active' || isCriticalNode || isSelected) {
            const pulse = (Math.sin(timeSec * 4.2 + node.orderIndex) + 1) * 0.5;
            const haloRgb = isSelected ? YELLOW : isCriticalNode ? MAGENTA : baseRgb;
            sketch.noFill();
            sketch.stroke(haloRgb[0], haloRgb[1], haloRgb[2], (100 + pulse * 135) * alphaMul);
            sketch.strokeWeight(isSelected ? 3.2 : 2.2);
            sketch.rect(node.x - 3, node.y - 3, node.w + 6, node.h + 6, 4);
          }

          sketch.fill(18, 18, 22, 248 * alphaMul);
          const borderRgb = isAncestor
            ? CYAN
            : isDescendant
              ? VIOLET
              : isCriticalNode
                ? MAGENTA
                : isHovered || isSelected
                  ? YELLOW
                  : INK;
          sketch.stroke(borderRgb[0], borderRgb[1], borderRgb[2], 255 * alphaMul);
          sketch.strokeWeight(isHovered || isSelected || isCriticalNode ? 2.6 : 2.2);
          sketch.rect(node.x, node.y, node.w, node.h, 3);

          // Bold left color bar
          sketch.noStroke();
          sketch.fill(baseRgb[0], baseRgb[1], baseRgb[2], 250 * alphaMul);
          sketch.rect(node.x + 2, node.y + 2, 6, node.h - 4, 1);

          // Quest ID + Commit SHA
          sketch.textFont('Anton, Impact, sans-serif');
          sketch.textAlign(sketch.LEFT, sketch.TOP);
          sketch.textSize(12);
          sketch.fill(baseRgb[0], baseRgb[1], baseRgb[2], 255 * alphaMul);
          sketch.text(node.id, node.x + 12, node.y + 5);

          if (node.commitSha) {
            sketch.textFont('JetBrains Mono, Consolas, monospace');
            sketch.textAlign(sketch.RIGHT, sketch.TOP);
            sketch.textSize(8.5);
            sketch.fill(GREEN[0], GREEN[1], GREEN[2], 235 * alphaMul);
            sketch.text(node.commitSha.slice(0, 7), node.x + node.w - 7, node.y + 7);
          }

          sketch.textFont('JetBrains Mono, Consolas, monospace');
          sketch.textAlign(sketch.LEFT, sketch.TOP);
          sketch.textSize(9);
          sketch.fill(PAPER[0], PAPER[1], PAPER[2], 235 * alphaMul);
          const shortTask = node.title.length > 19 ? `${node.title.slice(0, 18)}…` : node.title;
          sketch.text(shortTask, node.x + 12, node.y + 24);
        }

        sketch.pop();
      };

      sketch.mouseMoved = () => {
        if (!isVisible) return;
        if (
          sketch.mouseX < 0 ||
          sketch.mouseY < 0 ||
          sketch.mouseX > sketch.width ||
          sketch.mouseY > sketch.height
        ) {
          hoveredTaskId = null;
          updateTooltip(null, 0, 0);
          return;
        }
        const worldPt = screenToWorld(sketch.mouseX, sketch.mouseY);
        const hitCard = findCardAt(worldPt.x, worldPt.y);
        hoveredTaskId = hitCard ? hitCard.id : null;
        hostEl.style.cursor = hitCard ? 'pointer' : 'grab';
        updateTooltip(hitCard, sketch.mouseX, sketch.mouseY);
      };

      sketch.mousePressed = () => {
        if (!isVisible) return;
        if (
          sketch.mouseX < 0 ||
          sketch.mouseY < 0 ||
          sketch.mouseX > sketch.width ||
          sketch.mouseY > sketch.height
        ) {
          return;
        }
        pointerMoved = false;
        isPanning = true;
        lastMouseX = sketch.mouseX;
        lastMouseY = sketch.mouseY;
      };

      sketch.mouseDragged = () => {
        if (!isVisible || !isPanning) return;
        const dx = sketch.mouseX - lastMouseX;
        const dy = sketch.mouseY - lastMouseY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) pointerMoved = true;
        lastMouseX = sketch.mouseX;
        lastMouseY = sketch.mouseY;
        targetCamX += dx;
        targetCamY += dy;
        camX = targetCamX;
        camY = targetCamY;
      };

      sketch.mouseReleased = () => {
        if (!isVisible) return;
        if (isPanning && !pointerMoved) {
          const worldPt = screenToWorld(sketch.mouseX, sketch.mouseY);
          const hitCard = findCardAt(worldPt.x, worldPt.y);
          if (hitCard) {
            selectedTaskId = hitCard.id;
            if (typeof callbacks.onTaskSelect === 'function') {
              callbacks.onTaskSelect(hitCard.id);
            }
          }
        }
        isPanning = false;
      };

      sketch.mouseWheel = (evt) => {
        if (!isVisible) return;
        if (
          sketch.mouseX < 0 ||
          sketch.mouseY < 0 ||
          sketch.mouseX > sketch.width ||
          sketch.mouseY > sketch.height
        ) {
          return;
        }
        const zoomFactor = evt.delta > 0 ? 0.91 : 1.1;
        const nextScale = Math.max(0.28, Math.min(2.2, targetCamScale * zoomFactor));
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
        if (!sketchInstance || !isVisible) return;
        const w = Math.max(320, hostEl.clientWidth || 860);
        const h = Math.max(340, hostEl.clientHeight || 500);
        sketchInstance.resizeCanvas(w, h);
        fitView();
      });
      resizeObserver.observe(hostEl);
    }

    return {
      setPlan(planEntry) {
        const planChanged = !currentPlan || currentPlan.id !== planEntry?.id;
        currentPlan = planEntry;
        computeDagLayout();
        if (planChanged && isVisible) fitView();
      },
      setSelectedTask(taskId) {
        selectedTaskId = taskId;
      },
      setShowCritical(nextShow) {
        showCriticalPath = Boolean(nextShow);
      },
      setVisible(nextVisible) {
        isVisible = Boolean(nextVisible);
        if (!sketchInstance) return;
        if (isVisible) {
          const w = Math.max(320, hostEl.clientWidth || 860);
          const h = Math.max(340, hostEl.clientHeight || 500);
          sketchInstance.resizeCanvas(w, h);
          computeDagLayout();
          fitView();
          sketchInstance.loop();
        } else {
          sketchInstance.noLoop();
        }
      },
      fitView,
      savePng() {
        if (sketchInstance) sketchInstance.saveCanvas('moonwitness-quest-dag', 'png');
      },
      destroy() {
        if (resizeObserver) resizeObserver.disconnect();
        if (sketchInstance) sketchInstance.remove();
      },
    };
  }

  window.MWObservatory.createDagCanvas = createDagCanvas;
})();
