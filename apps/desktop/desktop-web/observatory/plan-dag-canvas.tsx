import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { readObservatoryCanvasPalette, type ObservatoryCanvasPalette } from './canvas-palette';
import type { ObservatoryPlanDagNodeDto, ObservatoryPlanSummaryDto } from './types';

export interface PlanDagCanvasHandle {
  fitView(): void;
  savePng(): void;
}

export interface PlanDagCanvasProps {
  readonly plan: ObservatoryPlanSummaryDto | null;
  readonly selectedTaskId: string | null;
  readonly showCriticalPath: boolean;
  readonly onSelectTask: (taskId: string) => void;
}

interface PositionedNode extends ObservatoryPlanDagNodeDto {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
}

interface WaveBound {
  readonly title: string;
  readonly done: number;
  readonly total: number;
  readonly percent: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function stateColor(state: string, palette: ObservatoryCanvasPalette): string {
  if (state === 'done') return palette.chart1;
  if (state === 'active') return palette.yellow;
  if (state === 'ready') return palette.cyan;
  return palette.inkFaint;
}

function bezierPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const inv = 1 - t;
  return inv * inv * inv * p0 + 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t * p3;
}

export const PlanDagCanvas = forwardRef<PlanDagCanvasHandle, PlanDagCanvasProps>(
  function PlanDagCanvas(props, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [hoveredNode, setHoveredNode] = useState<{
      x: number;
      y: number;
      node: PositionedNode;
    } | null>(null);

    const propsRef = useRef(props);
    propsRef.current = props;

    const stateRef = useRef({
      width: 820,
      height: 440,
      camX: 20,
      camY: 16,
      camScale: 1,
      targetCamX: 20,
      targetCamY: 16,
      targetCamScale: 1,
      nodes: [] as PositionedNode[],
      byId: new Map<string, PositionedNode>(),
      waves: [] as WaveBound[],
      criticalNodes: new Set<string>(),
      criticalEdges: new Set<string>(),
      hoveredId: null as string | null,
      isPanning: false,
      pointerMoved: false,
      lastX: 0,
      lastY: 0,
      palette: readObservatoryCanvasPalette(),
      lastPlanId: '' as string,
    });

    const fitView = () => {
      const st = stateRef.current;
      if (st.waves.length === 0) return;
      let maxX = 0;
      let maxY = 0;
      for (const bound of st.waves) {
        maxX = Math.max(maxX, bound.x + bound.w);
        maxY = Math.max(maxY, bound.y + bound.h);
      }
      const totalW = Math.max(280, maxX + 28);
      const totalH = Math.max(220, maxY + 36);
      const scale = Math.min(1.12, Math.max(0.32, Math.min(st.width / totalW, st.height / totalH)));
      st.targetCamScale = scale;
      st.targetCamX = (st.width - maxX * scale) / 2;
      st.targetCamY = Math.max(12, (st.height - maxY * scale) / 2);
    };

    const computeLayout = () => {
      const st = stateRef.current;
      const plan = propsRef.current.plan;
      st.nodes = [];
      st.byId = new Map();
      st.waves = [];
      st.criticalNodes = new Set();
      st.criticalEdges = new Set();

      if (!plan?.dag || plan.dag.nodes.length === 0) return;
      const dag = plan.dag;
      for (const id of dag.criticalPathIds) st.criticalNodes.add(id);
      for (let i = 0; i < dag.criticalPathIds.length - 1; i += 1) {
        const left = dag.criticalPathIds[i];
        const right = dag.criticalPathIds[i + 1];
        if (left && right) st.criticalEdges.add(`${left}->${right}`);
      }

      const byWave = new Map<number, ObservatoryPlanDagNodeDto[]>();
      for (const node of dag.nodes) {
        const list = byWave.get(node.waveIndex) ?? [];
        list.push(node);
        byWave.set(node.waveIndex, list);
      }

      const cardW = 140;
      const cardH = 44;
      const gapX = 20;
      const gapY = 12;
      const lanePad = 16;
      const laneGap = 30;
      const maxRows = 7;

      let cursorX = 22;
      const waveCount = Math.max(1, plan.waves.length);
      for (let wIdx = 0; wIdx < waveCount; wIdx += 1) {
        const wMeta = plan.waves[wIdx] ?? { title: `Wave ${wIdx}`, done: 0, total: 0, percent: 0 };
        const wNodes = byWave.get(wIdx) ?? [];
        if (wNodes.length === 0) continue;

        const subCols = Math.max(1, Math.ceil(wNodes.length / maxRows));
        const rowsInLane = Math.min(maxRows, Math.ceil(wNodes.length / subCols));
        const laneW = lanePad * 2 + subCols * cardW + (subCols - 1) * gapX;
        const laneH = 60 + rowsInLane * (cardH + gapY) + lanePad;

        st.waves.push({
          title: wMeta.title,
          done: wMeta.done,
          total: wMeta.total,
          percent: wMeta.percent,
          x: cursorX,
          y: 16,
          w: laneW,
          h: laneH,
        });

        wNodes.forEach((node, idx) => {
          const subCol = Math.floor(idx / rowsInLane);
          const row = idx % rowsInLane;
          const x = cursorX + lanePad + subCol * (cardW + gapX);
          const y = 70 + row * (cardH + gapY);
          const placed: PositionedNode = {
            ...node,
            x,
            y,
            w: cardW,
            h: cardH,
            cx: x + cardW / 2,
            cy: y + cardH / 2,
          };
          st.nodes.push(placed);
          st.byId.set(placed.id, placed);
        });
        cursorX += laneW + laneGap;
      }

      if (st.lastPlanId !== plan.id) {
        st.lastPlanId = plan.id;
        fitView();
      }
    };

    useImperativeHandle(ref, () => ({
      fitView,
      savePng() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'moonwitness-plan-dag.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
    }));

    useEffect(() => {
      stateRef.current.palette = readObservatoryCanvasPalette();
      computeLayout();
    }, [props.plan]);

    useEffect(() => {
      const host = hostRef.current;
      const canvas = canvasRef.current;
      if (!host || !canvas) return;

      const reducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const updateSize = () => {
        const w = Math.max(300, host.clientWidth || 820);
        const h = Math.max(340, host.clientHeight || 440);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        stateRef.current.width = w;
        stateRef.current.height = h;
        stateRef.current.palette = readObservatoryCanvasPalette();
        computeLayout();
        fitView();
      };

      updateSize();
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
      observer?.observe(host);

      const collectChain = (rootId: string | null) => {
        const ancestors = new Set<string>();
        const descendants = new Set<string>();
        if (!rootId) return { ancestors, descendants };
        const up = [rootId];
        while (up.length > 0) {
          const cur = up.shift();
          if (!cur) continue;
          const node = stateRef.current.byId.get(cur);
          for (const dep of node?.depIds ?? []) {
            if (!ancestors.has(dep)) {
              ancestors.add(dep);
              up.push(dep);
            }
          }
        }
        const down = [rootId];
        while (down.length > 0) {
          const cur = down.shift();
          if (!cur) continue;
          const node = stateRef.current.byId.get(cur);
          for (const child of node?.dependents ?? []) {
            if (!descendants.has(child)) {
              descendants.add(child);
              down.push(child);
            }
          }
        }
        return { ancestors, descendants };
      };

      let rafId = 0;
      const render = (nowMs: number) => {
        const st = stateRef.current;
        const cur = propsRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = canvas.width / Math.max(1, st.width);
        const pal = st.palette;
        const t = nowMs * 0.001;

        st.camX += (st.targetCamX - st.camX) * 0.2;
        st.camY += (st.targetCamY - st.camY) * 0.2;
        st.camScale += (st.targetCamScale - st.camScale) * 0.2;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = pal.night;
        ctx.fillRect(0, 0, st.width, st.height);

        const focusId = st.hoveredId ?? cur.selectedTaskId;
        const { ancestors, descendants } = collectChain(focusId);

        ctx.save();
        ctx.translate(st.camX, st.camY);
        ctx.scale(st.camScale, st.camScale);

        // Wave swimlanes
        for (const bound of st.waves) {
          ctx.fillStyle = pal.nightSoft;
          ctx.strokeStyle = pal.nightRaised;
          ctx.lineWidth = 1.5;
          ctx.fillRect(bound.x, bound.y, bound.w, bound.h);
          ctx.strokeRect(bound.x, bound.y, bound.w, bound.h);

          ctx.fillStyle = pal.paper;
          ctx.font = `700 10.5px ${pal.fontMono}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          const shortTitle = bound.title.length > 26 ? `${bound.title.slice(0, 25)}…` : bound.title;
          ctx.fillText(shortTitle, bound.x + 12, bound.y + 11);

          ctx.fillStyle = pal.moon;
          ctx.textAlign = 'right';
          ctx.fillText(`${bound.done}/${bound.total}`, bound.x + bound.w - 12, bound.y + 11);

          ctx.fillStyle = pal.nightRaised;
          ctx.fillRect(bound.x + 12, bound.y + 32, bound.w - 24, 5);
          ctx.fillStyle = pal.cyan;
          ctx.fillRect(bound.x + 12, bound.y + 32, ((bound.w - 24) * bound.percent) / 100, 5);
        }

        // Edges
        for (const edge of cur.plan?.dag?.edges ?? []) {
          const fromNode = st.byId.get(edge.from);
          const toNode = st.byId.get(edge.to);
          if (!fromNode || !toNode) continue;

          const edgeKey = `${edge.from}->${edge.to}`;
          const isCritical = cur.showCriticalPath && st.criticalEdges.has(edgeKey);
          const isUpstream =
            Boolean(focusId) &&
            (ancestors.has(edge.from) || edge.from === focusId) &&
            (ancestors.has(edge.to) || edge.to === focusId);
          const isDownstream =
            Boolean(focusId) &&
            (descendants.has(edge.from) || edge.from === focusId) &&
            (descendants.has(edge.to) || edge.to === focusId);

          const x1 = fromNode.x + fromNode.w;
          const y1 = fromNode.cy;
          const x2 = toNode.x;
          const y2 = toNode.cy;
          const dx = Math.max(34, Math.abs(x2 - x1) * 0.45);
          const cx1 = x1 + dx;
          const cx2 = x2 - dx;

          let stroke = edge.satisfied ? pal.chart1 : pal.inkFaint;
          let alpha = edge.satisfied ? 0.55 : 0.28;
          let width = 1.4;
          if (isCritical) {
            stroke = pal.magenta;
            alpha = 0.9;
            width = 2.4;
          }
          if (isUpstream) {
            stroke = pal.cyan;
            alpha = 0.95;
            width = 2.4;
          } else if (isDownstream) {
            stroke = pal.violet;
            alpha = 0.95;
            width = 2.4;
          } else if (focusId) {
            alpha = 0.14;
          }

          ctx.save();
          ctx.strokeStyle = stroke;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(cx1, y1, cx2, y2, x2, y2);
          ctx.stroke();

          if (!reducedMotion && ((edge.satisfied && !toNode.done) || isCritical || isUpstream || isDownstream)) {
            const flowT = (t * 0.4 + fromNode.orderIndex * 0.13) % 1;
            const px = bezierPoint(x1, cx1, cx2, x2, flowT);
            const py = bezierPoint(y1, y1, y2, y2, flowT);
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = stroke;
            ctx.beginPath();
            ctx.arc(px, py, isCritical ? 3.5 : 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // Task cards
        for (const node of st.nodes) {
          const base = stateColor(node.state, pal);
          const isSelected = node.id === cur.selectedTaskId;
          const isHovered = node.id === st.hoveredId;
          const isCritical = cur.showCriticalPath && st.criticalNodes.has(node.id);
          const isAncestor = ancestors.has(node.id);
          const isDescendant = descendants.has(node.id);
          const dimmed = Boolean(focusId) && !isSelected && !isHovered && !isAncestor && !isDescendant;

          ctx.save();
          ctx.globalAlpha = dimmed ? 0.3 : 1;

          const border = isAncestor
            ? pal.cyan
            : isDescendant
              ? pal.violet
              : isCritical
                ? pal.magenta
                : base;

          ctx.fillStyle = pal.nightRaised;
          ctx.strokeStyle = border;
          ctx.lineWidth = isSelected || isHovered ? 2.4 : 1.4;
          ctx.fillRect(node.x, node.y, node.w, node.h);
          ctx.strokeRect(node.x, node.y, node.w, node.h);

          // Left state strip
          ctx.fillStyle = base;
          ctx.fillRect(node.x + 1, node.y + 3, 4, node.h - 6);

          ctx.fillStyle = base;
          ctx.font = `700 10.5px ${pal.fontMono}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(node.id, node.x + 11, node.y + 6);

          if (node.commitSha) {
            ctx.fillStyle = pal.chart1;
            ctx.font = `700 8.5px ${pal.fontMono}`;
            ctx.textAlign = 'right';
            ctx.fillText(node.commitSha.slice(0, 7), node.x + node.w - 7, node.y + 7);
          }

          ctx.fillStyle = pal.paper;
          ctx.font = `500 9px ${pal.fontMono}`;
          ctx.textAlign = 'left';
          const shortTask = node.title.length > 19 ? `${node.title.slice(0, 18)}…` : node.title;
          ctx.fillText(shortTask, node.x + 11, node.y + 23);
          ctx.restore();
        }

        ctx.restore();
        ctx.restore();

        if (!reducedMotion) {
          rafId = window.requestAnimationFrame(render);
        }
      };

      rafId = window.requestAnimationFrame(render);

      const screenToWorld = (sx: number, sy: number) => ({
        x: (sx - stateRef.current.camX) / stateRef.current.camScale,
        y: (sy - stateRef.current.camY) / stateRef.current.camScale,
      });

      const findCardAt = (wx: number, wy: number): PositionedNode | null => {
        for (const node of stateRef.current.nodes) {
          if (wx >= node.x && wx <= node.x + node.w && wy >= node.y && wy <= node.y + node.h) {
            return node;
          }
        }
        return null;
      };

      const onPointerDown = (evt: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const st = stateRef.current;
        st.isPanning = true;
        st.pointerMoved = false;
        st.lastX = evt.clientX - rect.left;
        st.lastY = evt.clientY - rect.top;
      };

      const onPointerMove = (evt: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const sx = evt.clientX - rect.left;
        const sy = evt.clientY - rect.top;
        const st = stateRef.current;
        if (st.isPanning) {
          const dx = sx - st.lastX;
          const dy = sy - st.lastY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) st.pointerMoved = true;
          st.lastX = sx;
          st.lastY = sy;
          st.targetCamX += dx;
          st.targetCamY += dy;
          st.camX = st.targetCamX;
          st.camY = st.targetCamY;
          return;
        }
        const world = screenToWorld(sx, sy);
        const hit = findCardAt(world.x, world.y);
        st.hoveredId = hit?.id ?? null;
        setHoveredNode(hit ? { x: sx, y: sy, node: hit } : null);
      };

      const onPointerUp = (evt: PointerEvent) => {
        const st = stateRef.current;
        if (st.isPanning && !st.pointerMoved) {
          const rect = canvas.getBoundingClientRect();
          const world = screenToWorld(evt.clientX - rect.left, evt.clientY - rect.top);
          const hit = findCardAt(world.x, world.y);
          if (hit) propsRef.current.onSelectTask(hit.id);
        }
        st.isPanning = false;
      };

      const onWheel = (evt: WheelEvent) => {
        evt.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = evt.clientX - rect.left;
        const sy = evt.clientY - rect.top;
        const st = stateRef.current;
        const factor = evt.deltaY > 0 ? 0.91 : 1.1;
        const nextScale = Math.max(0.28, Math.min(2.2, st.targetCamScale * factor));
        const wx = (sx - st.targetCamX) / st.targetCamScale;
        const wy = (sy - st.targetCamY) / st.targetCamScale;
        st.targetCamScale = nextScale;
        st.targetCamX = sx - wx * nextScale;
        st.targetCamY = sy - wy * nextScale;
      };

      const onPointerLeave = () => {
        stateRef.current.hoveredId = null;
        stateRef.current.isPanning = false;
        setHoveredNode(null);
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointerleave', onPointerLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });

      return () => {
        window.cancelAnimationFrame(rafId);
        observer?.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('wheel', onWheel);
      };
    }, []);

    return (
      <div
        ref={hostRef}
        className="relative h-[26rem] w-full overflow-hidden border-2 border-ink bg-night"
      >
        <canvas
          ref={canvasRef}
          aria-label="Plan micro-task dependency DAG map"
          className="block h-full w-full cursor-grab"
        />
        {hoveredNode ? (
          <div
            className="pointer-events-none absolute z-20 max-w-xs border-2 border-ink bg-paper p-2 font-mono text-xs text-ink"
            style={{
              left: `${Math.min(Math.max(12, hoveredNode.x + 14), Math.max(12, stateRef.current.width - 250))}px`,
              top: `${Math.min(Math.max(12, hoveredNode.y + 12), Math.max(12, stateRef.current.height - 105))}px`,
            }}
          >
            <p className="font-bold">
              {hoveredNode.node.id} — {hoveredNode.node.title}
            </p>
            <p className="text-ink-faint">
              {hoveredNode.node.state.toUpperCase()} · {hoveredNode.node.wave}
            </p>
            <p className="text-ink-faint">
              Deps: {hoveredNode.node.depIds.length > 0 ? hoveredNode.node.depIds.join(', ') : 'None'}
            </p>
          </div>
        ) : null}
      </div>
    );
  }
);
