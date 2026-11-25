/* global window, p5, ResizeObserver */
(function () {
  window.MWObservatory = window.MWObservatory || {};

  const STATE_COLORS = Object.freeze({
    done: [74, 222, 128],
    active: [255, 224, 49],
    ready: [0, 184, 240],
    blocked: [100, 116, 139],
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

    let layoutNodes = []; // { ...node, x, y, w, h }
    let layoutById = new Map();
    let waveBounds = []; // { title, x, y, w, h, done, total, percent }
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

      const cardW = 136;
      const cardH = 42;
      const gapX = 22;
      const gapY = 12;
      const lanePad = 18;
      const laneGap = 34;
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
        const laneH = 62 + rowsInLane * (cardH + gapY) + lanePad;

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
          const ny = 74 + row * (cardH + gapY);
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
      const totalW = Math.max(300, maxX + 32);
      const totalH = Math.max(240, maxY + 40);
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
          Unblocks: ${node.dependents.length ? esc(node.dependents.slice(0, 8).join(', ')) : 'Terminal'}
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

    sketchInstance = new p5((sketch) => {
      sketch.setup = () => {
        const w = Math.max(320, hostEl.clientWidth || 860);
        const h = Math.max(340, hostEl.clientHeight || 500);
        const canvas = sketch.createCanvas(w, h);
        canvas.parent(hostEl);
        sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        sketch.textFont('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
        if (!isVisible) sketch.noLoop();
      };

      sketch.draw = () => {
        if (!isVisible) return;
        sketch.clear();

        camX = sketch.lerp(camX, targetCamX, 0.2);
        camY = sketch.lerp(camY, targetCamY, 0.2);
        camScale = sketch.lerp(camScale, targetCamScale, 0.2);

        const focusId = hoveredTaskId || selectedTaskId;
        const { ancestors, descendants } = collectChain(focusId);
        const timeSec = sketch.millis() * 0.001;

        sketch.push();
        sketch.translate(camX, camY);
        sketch.scale(camScale);

        // Draw Wave Swimlanes
        for (const bound of waveBounds) {
          sketch.fill(11, 18, 30, 175);
          sketch.stroke(52, 74, 102, 110);
          sketch.strokeWeight(1);
          sketch.rect(bound.x, bound.y, bound.w, bound.h, 12);

          // Wave header + progress strip
          sketch.noStroke();
          sketch.fill(239, 246, 255, 225);
          sketch.textAlign(sketch.LEFT, sketch.TOP);
          sketch.textSize(10.5);
          const shortTitle = bound.title.length > 26 ? `${bound.title.slice(0, 25)}…` : bound.title;
          sketch.text(shortTitle, bound.x + 12, bound.y + 11);

          sketch.fill(156, 176, 200, 200);
          sketch.textAlign(sketch.RIGHT, sketch.TOP);
          sketch.textSize(9.5);
          sketch.text(`${bound.done}/${bound.total}`, bound.x + bound.w - 12, bound.y + 12);

          sketch.fill(23, 35, 52, 220);
          sketch.rect(bound.x + 12, bound.y + 32, bound.w - 24, 5, 3);
          sketch.fill(56, 232, 240, 220);
          sketch.rect(bound.x + 12, bound.y + 32, ((bound.w - 24) * bound.percent) / 100, 5, 3);
        }

        // Draw Dependency Bezier Edges
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

          let rgb = edgeEntry.satisfied ? [74, 222, 128] : [71, 85, 105];
          let alpha = edgeEntry.satisfied ? 92 : 42;
          let weight = 1.2;

          if (isCritical) {
            rgb = [244, 114, 182];
            alpha = 185;
            weight = 2.1;
          }
          if (isUpstreamEdge) {
            rgb = [56, 232, 240];
            alpha = 225;
            weight = 2.2;
          } else if (isDownstreamEdge) {
            rgb = [167, 139, 250];
            alpha = 225;
            weight = 2.2;
          } else if (focusId) {
            alpha = Math.min(alpha, 22);
          }

          sketch.noFill();
          sketch.stroke(rgb[0], rgb[1], rgb[2], alpha);
          sketch.strokeWeight(weight);
          sketch.bezier(x1, y1, cx1, y1, cx2, y2, x2, y2);

          // Animated flow bead on ready frontier or critical edges
          if (
            (edgeEntry.satisfied && !toNode.done) ||
            isCritical ||
            isUpstreamEdge ||
            isDownstreamEdge
          ) {
            const flowT = (timeSec * 0.42 + fromNode.orderIndex * 0.13) % 1;
            const px = bezierEval(x1, cx1, cx2, x2, flowT);
            const py = bezierEval(y1, y1, y2, y2, flowT);
            sketch.noStroke();
            sketch.fill(rgb[0], rgb[1], rgb[2], 235);
            sketch.circle(px, py, isCritical ? 5.2 : 4);
          }
        }

        // Draw Task Nodes
        for (const node of layoutNodes) {
          const baseRgb = STATE_COLORS[node.state] || STATE_COLORS.blocked;
          const isSelected = node.id === selectedTaskId;
          const isHovered = node.id === hoveredTaskId;
          const isCriticalNode = showCriticalPath && criticalSet.has(node.id);
          const isAncestor = ancestors.has(node.id);
          const isDescendant = descendants.has(node.id);
          const dimmed = focusId && !isSelected && !isHovered && !isAncestor && !isDescendant;
          const alphaMul = dimmed ? 0.28 : 1;

          // Pulsing glow for ready / active / critical nodes
          if (node.state === 'ready' || node.state === 'active' || isCriticalNode || isSelected) {
            const pulse = (Math.sin(timeSec * 3.2 + node.orderIndex) + 1) * 0.5;
            const haloRgb = isSelected
              ? [56, 232, 240]
              : isCriticalNode
                ? [244, 114, 182]
                : baseRgb;
            sketch.noFill();
            sketch.stroke(haloRgb[0], haloRgb[1], haloRgb[2], (70 + pulse * 105) * alphaMul);
            sketch.strokeWeight(isSelected ? 2.8 : 1.8);
            sketch.rect(node.x - 3, node.y - 3, node.w + 6, node.h + 6, 10);
          }

          sketch.fill(13, 21, 35, 242 * alphaMul);
          const borderRgb = isAncestor
            ? [56, 232, 240]
            : isDescendant
              ? [167, 139, 250]
              : isCriticalNode
                ? [244, 114, 182]
                : baseRgb;
          sketch.stroke(
            borderRgb[0],
            borderRgb[1],
            borderRgb[2],
            (isHovered || isSelected ? 255 : 195) * alphaMul
          );
          sketch.strokeWeight(isHovered || isSelected ? 2.1 : 1.3);
          sketch.rect(node.x, node.y, node.w, node.h, 8);

          // Left state strip
          sketch.noStroke();
          sketch.fill(baseRgb[0], baseRgb[1], baseRgb[2], 235 * alphaMul);
          sketch.rect(node.x + 1, node.y + 4, 4, node.h - 8, 3);

          // Task ID & Title
          sketch.textAlign(sketch.LEFT, sketch.TOP);
          sketch.textSize(10.5);
          sketch.fill(baseRgb[0], baseRgb[1], baseRgb[2], 245 * alphaMul);
          sketch.text(node.id, node.x + 11, node.y + 6);

          if (node.commitSha) {
            sketch.textAlign(sketch.RIGHT, sketch.TOP);
            sketch.textSize(8.5);
            sketch.fill(74, 222, 128, 220 * alphaMul);
            sketch.text(node.commitSha.slice(0, 7), node.x + node.w - 8, node.y + 7);
          }

          sketch.textAlign(sketch.LEFT, sketch.TOP);
          sketch.textSize(9);
          sketch.fill(226, 236, 248, 225 * alphaMul);
          const shortTask = node.title.length > 19 ? `${node.title.slice(0, 18)}…` : node.title;
          sketch.text(shortTask, node.x + 11, node.y + 22);
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
        if (sketchInstance) sketchInstance.saveCanvas('moonwitness-plan-dag', 'png');
      },
      destroy() {
        if (resizeObserver) resizeObserver.disconnect();
        if (sketchInstance) sketchInstance.remove();
      },
    };
  }

  window.MWObservatory.createDagCanvas = createDagCanvas;
})();
