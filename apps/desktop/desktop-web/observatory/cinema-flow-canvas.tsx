import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import {
  portraitUrlForSession,
  readObservatoryCanvasPalette,
  runtimeAccentColor,
  STAGE_BACKDROP_URLS,
  type ObservatoryCanvasPalette,
} from './canvas-palette';
import type { ObservatoryIntensityLevel, ObservatorySfxName } from './sfx-engine';
import type {
  ObservatoryBattleTelemetryDto,
  ObservatoryFlowEdgeDto,
  ObservatoryFlowGraphDto,
  ObservatoryFlowNodeDto,
  ObservatoryRuntime,
} from './types';

export type CinemaLayoutMode = 'warzone' | 'stage' | 'pipeline' | 'orbital' | 'lanes';
export type CinemaBackdropMode = 'alley' | 'arcade' | 'grid';

export interface CinemaFlowCanvasHandle {
  fitView(): void;
  resetPins(): void;
  triggerAllOutClash(): void;
  savePng(): void;
}

export interface CinemaFlowCanvasProps {
  readonly flowGraph: ObservatoryFlowGraphDto | undefined;
  readonly battle: ObservatoryBattleTelemetryDto | undefined;
  readonly mode: CinemaLayoutMode;
  readonly backdrop: CinemaBackdropMode;
  readonly chaos: ObservatoryIntensityLevel;
  readonly autoCam: boolean;
  readonly showSubagents: boolean;
  readonly showTargets: boolean;
  readonly showIdle: boolean;
  readonly onSelectAgent?: (runtime: ObservatoryRuntime, sessionId: string) => void;
  readonly onSelectPlanWave?: (waveTitle: string) => void;
  readonly onPlaySfx?: (name: ObservatorySfxName) => void;
}

interface NodeBody {
  x: number;
  y: number;
  tx: number;
  ty: number;
  pinned: boolean;
  phase: number;
  dashX: number;
  dashY: number;
  recoilX: number;
  recoilY: number;
  hitFlash: number;
}

interface CombatBeam {
  kind: 'laser' | 'slash' | 'bolt' | 'boost';
  fromId: string;
  toId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;
  speed: number;
  color: string;
  label: string;
  impacted: boolean;
}

interface ComicBurst {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  rot: number;
}

interface Shockwave {
  x: number;
  y: number;
  r: number;
  maxR: number;
  color: string;
  alpha: number;
}

interface TooltipState {
  readonly x: number;
  readonly y: number;
  readonly node: ObservatoryFlowNodeDto;
}

const SFX_WORDS: Readonly<Record<string, readonly string[]>> = {
  tool: ['SLASH!!', 'KRAK-ZAP!', 'BEAM!!', 'WHAM!!'],
  subagent: ['SUMMON!!', 'SQUAD UP!', 'CLONE!!'],
  swarm: ['RIOT WAR!!', 'ALL-OUT!!'],
  focus: ['LOCK ON!!', 'CHARGE!!'],
  error: ['429 SHIELD!', 'GLITCH!!', 'BONK!!'],
  magpie: ['200 BOOST!!', 'ROUTE ZAP!', 'HYPER LINK!'],
};

function radiusForNode(node: ObservatoryFlowNodeDto, mode: CinemaLayoutMode): number {
  if (node.kind === 'hub') return mode === 'warzone' ? 46 : 36;
  if (node.kind === 'runtime') return 25;
  if (node.kind === 'agent') {
    if (node.status === 'running') return 29;
    if (node.status === 'recent' || node.status === 'error') return 23;
    return 15;
  }
  if (node.kind === 'swarm') return 24;
  if (node.kind === 'subagent') return 12;
  return 20;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export const CinemaFlowCanvas = forwardRef<CinemaFlowCanvasHandle, CinemaFlowCanvasProps>(
  function CinemaFlowCanvas(props, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);

    const propsRef = useRef(props);
    propsRef.current = props;

    const stateRef = useRef({
      width: 900,
      height: 500,
      camX: 0,
      camY: 0,
      camScale: 1,
      targetCamX: 0,
      targetCamY: 0,
      targetCamScale: 1,
      hasAutoFitted: false,
      filteredNodes: [] as ObservatoryFlowNodeDto[],
      filteredEdges: [] as ObservatoryFlowEdgeDto[],
      positions: new Map<string, NodeBody>(),
      seenPulses: new Set<string>(),
      beams: [] as CombatBeam[],
      bursts: [] as ComicBurst[],
      shockwaves: [] as Shockwave[],
      screenShake: 0,
      hitStop: 0,
      autoCooldown: 0,
      hoveredNodeId: null as string | null,
      draggedNodeId: null as string | null,
      isPanning: false,
      pointerMoved: false,
      lastX: 0,
      lastY: 0,
      images: new Map<string, HTMLImageElement>(),
      palette: readObservatoryCanvasPalette(),
    });

    const getCachedImage = (url: string | null): HTMLImageElement | null => {
      if (!url || typeof window === 'undefined') return null;
      const map = stateRef.current.images;
      const existing = map.get(url);
      if (existing) {
        return existing.complete && existing.naturalWidth > 0 ? existing : null;
      }
      const img = new Image();
      img.src = url;
      map.set(url, img);
      return null;
    };

    const fitView = () => {
      const st = stateRef.current;
      if (st.filteredNodes.length === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of st.filteredNodes) {
        const pos = st.positions.get(node.id);
        if (!pos) continue;
        const r = radiusForNode(node, propsRef.current.mode) + 36;
        minX = Math.min(minX, pos.tx - r);
        minY = Math.min(minY, pos.ty - r);
        maxX = Math.max(maxX, pos.tx + r);
        maxY = Math.max(maxY, pos.ty + r);
      }
      if (!Number.isFinite(minX)) return;
      const boxW = Math.max(220, maxX - minX);
      const boxH = Math.max(180, maxY - minY);
      const scale = Math.max(0.45, Math.min(1.18, Math.min((st.width - 48) / boxW, (st.height - 48) / boxH)));
      st.targetCamScale = scale;
      st.targetCamX = (st.width - (minX + maxX) * scale) / 2;
      st.targetCamY = (st.height - (minY + maxY) * scale) / 2;
    };

    const recomputeLayout = () => {
      const st = stateRef.current;
      const cur = propsRef.current;
      const graph = cur.flowGraph;
      const nodes = graph?.nodes ?? [];
      const edges = graph?.edges ?? [];

      const filteredNodes = nodes.filter((node) => {
        if (!cur.showSubagents && (node.kind === 'subagent' || node.kind === 'swarm')) return false;
        if (
          !cur.showTargets &&
          (node.kind === 'plan-wave' || node.kind === 'workspace-area' || node.kind === 'infra')
        ) {
          return false;
        }
        if (!cur.showIdle && node.kind === 'agent' && node.status === 'idle') return false;
        return true;
      });
      const idSet = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = edges.filter((e) => idSet.has(e.from) && idSet.has(e.to));
      st.filteredNodes = filteredNodes;
      st.filteredEdges = filteredEdges;

      const upsert = (id: string, tx: number, ty: number) => {
        const existing = st.positions.get(id);
        if (!existing) {
          st.positions.set(id, {
            x: tx,
            y: ty,
            tx,
            ty,
            pinned: false,
            phase: Math.random() * Math.PI * 2,
            dashX: 0,
            dashY: 0,
            recoilX: 0,
            recoilY: 0,
            hitFlash: 0,
          });
        } else if (!existing.pinned) {
          existing.tx = tx;
          existing.ty = ty;
        }
      };

      const padX = 72;
      const padY = 64;
      const stageW = Math.max(540, st.width - padX * 2);
      const stageH = Math.max(320, st.height - padY * 2);
      const cx = padX + stageW * 0.5;
      const cy = padY + stageH * 0.5;

      const runtimes = filteredNodes.filter((n) => n.kind === 'runtime');
      const agents = filteredNodes.filter((n) => n.kind === 'agent');
      const subs = filteredNodes.filter((n) => n.kind === 'subagent' || n.kind === 'swarm');
      const targets = filteredNodes.filter(
        (n) => n.kind === 'plan-wave' || n.kind === 'workspace-area' || n.kind === 'infra'
      );

      if (cur.mode === 'warzone') {
        const bossX = padX + stageW * 0.84;
        const bossY = padY + stageH * 0.44;
        upsert('hub:workspace', bossX, bossY);

        const nonMagpieRts = runtimes.filter((r) => r.runtime !== 'magpie');
        nonMagpieRts.forEach((rt, idx) => {
          const frac = nonMagpieRts.length === 1 ? 0.5 : idx / (nonMagpieRts.length - 1);
          upsert(rt.id, padX + stageW * 0.08, padY + stageH * (0.12 + frac * 0.58));
        });
        const magpieRt = runtimes.find((r) => r.runtime === 'magpie');
        if (magpieRt) upsert(magpieRt.id, padX + stageW * 0.14, padY + stageH * 0.84);

        const magpieAgents = agents.filter((a) => a.runtime === 'magpie');
        const activeHeroes = agents.filter((a) => a.runtime !== 'magpie' && a.status !== 'idle');
        const idleHeroes = agents.filter((a) => a.runtime !== 'magpie' && a.status === 'idle');
        const frontline = activeHeroes.length > 0 ? activeHeroes : idleHeroes.slice(0, 4);
        const frontlineIds = new Set(frontline.map((a) => a.id));
        const heroCoords = new Map<string, { x: number; y: number }>();

        frontline.forEach((hero, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const rowsTotal = Math.max(1, Math.ceil(frontline.length / 2));
          const rowFrac = rowsTotal === 1 ? 0.5 : row / (rowsTotal - 1);
          const hx = padX + stageW * (col === 0 ? 0.38 : 0.25);
          const hy = padY + stageH * (0.16 + rowFrac * 0.58);
          if (hero.sessionId) heroCoords.set(hero.sessionId, { x: hx, y: hy });
          upsert(hero.id, hx, hy);
        });

        magpieAgents.forEach((ma, idx) => {
          const mx = padX + stageW * (0.26 + (idx % 3) * 0.11);
          const my = padY + stageH * 0.84;
          if (ma.sessionId) heroCoords.set(ma.sessionId, { x: mx, y: my });
          upsert(ma.id, mx, my);
        });

        const bench = idleHeroes.filter((a) => !frontlineIds.has(a.id));
        bench.forEach((b, idx) => {
          const frac = bench.length === 1 ? 0.5 : idx / (bench.length - 1);
          upsert(b.id, padX + stageW * (0.1 + frac * 0.52), padY + stageH * 0.94);
        });

        subs.forEach((sub, idx) => {
          const parentPt = sub.parentSessionId ? heroCoords.get(sub.parentSessionId) : undefined;
          if (parentPt) {
            const ang = -Math.PI * 0.75 + (idx % 6) * 0.55;
            upsert(sub.id, parentPt.x + Math.cos(ang) * 68, parentPt.y + Math.sin(ang) * 58);
          } else {
            upsert(sub.id, padX + stageW * 0.52, padY + stageH * (0.2 + ((idx % 5) / 4) * 0.6));
          }
        });

        targets.forEach((target, idx) => {
          const frac = targets.length === 1 ? 0.5 : idx / (targets.length - 1);
          const ang = Math.PI * 0.56 + frac * Math.PI * 1.1;
          const orbitR = 122 + (idx % 2) * 34;
          upsert(
            target.id,
            Math.min(padX + stageW - 10, bossX + Math.cos(ang) * orbitR),
            Math.max(padY + 14, Math.min(padY + stageH - 14, bossY + Math.sin(ang) * orbitR * 0.9))
          );
        });
      } else if (cur.mode === 'pipeline') {
        const tiers = new Map<number, ObservatoryFlowNodeDto[]>();
        for (const n of filteredNodes) {
          const list = tiers.get(n.tier) ?? [];
          list.push(n);
          tiers.set(n.tier, list);
        }
        const sortedTiers = Array.from(tiers.keys()).sort((a, b) => a - b);
        sortedTiers.forEach((tier, colIdx) => {
          const colNodes = tiers.get(tier) ?? [];
          const colX = sortedTiers.length === 1 ? cx : padX + (colIdx / (sortedTiers.length - 1)) * stageW;
          const stepY = Math.min(72, Math.max(42, stageH / Math.max(1, colNodes.length)));
          const totalH = stepY * Math.max(0, colNodes.length - 1);
          colNodes.forEach((n, rIdx) => {
            upsert(n.id, colX, cy - totalH / 2 + rIdx * stepY);
          });
        });
      } else if (cur.mode === 'orbital') {
        upsert('hub:workspace', cx, cy);
        const r1 = Math.min(stageW, stageH) * 0.24;
        const r2 = Math.min(stageW, stageH) * 0.44;
        const r3 = Math.min(stageW, stageH) * 0.6;
        runtimes.forEach((rt, idx) => {
          const ang = (idx / Math.max(1, runtimes.length)) * Math.PI * 2 - Math.PI / 2;
          upsert(rt.id, cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        });
        agents.forEach((ag, idx) => {
          const ang = (idx / Math.max(1, agents.length)) * Math.PI * 2 - Math.PI / 2;
          upsert(ag.id, cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
        });
        [...subs, ...targets].forEach((node, idx, arr) => {
          const ang = (idx / Math.max(1, arr.length)) * Math.PI * 2;
          upsert(node.id, cx + Math.cos(ang) * r3, cy + Math.sin(ang) * r3);
        });
      } else if (cur.mode === 'lanes') {
        upsert('hub:workspace', padX, cy);
        const laneH = Math.max(84, stageH / Math.max(1, runtimes.length));
        const laneY = new Map<string, number>();
        runtimes.forEach((rt, idx) => {
          const y = padY + laneH * (idx + 0.5);
          laneY.set(rt.runtime, y);
          upsert(rt.id, padX + 100, y);
        });
        const byRt = new Map<string, ObservatoryFlowNodeDto[]>();
        agents.forEach((ag) => {
          const list = byRt.get(ag.runtime) ?? [];
          list.push(ag);
          byRt.set(ag.runtime, list);
        });
        for (const [rtName, list] of byRt.entries()) {
          const ly = laneY.get(rtName) ?? cy;
          list.forEach((ag, idx) => {
            const frac = list.length === 1 ? 0.35 : idx / (list.length - 1);
            upsert(ag.id, padX + 210 + frac * stageW * 0.55, ly);
          });
        }
        subs.forEach((sub, idx) => {
          const ly = laneY.get(sub.runtime) ?? cy;
          upsert(sub.id, padX + stageW * 0.84, ly + ((idx % 3) - 1) * 20);
        });
        targets.forEach((t, idx) => {
          upsert(t.id, padX + stageW, padY + ((idx + 0.5) / Math.max(1, targets.length)) * stageH);
        });
      } else {
        // stage formation
        upsert('hub:workspace', cx, padY + stageH * 0.14);
        runtimes.forEach((rt, idx) => {
          const frac = runtimes.length === 1 ? 0.5 : idx / (runtimes.length - 1);
          upsert(rt.id, padX + stageW * (0.14 + frac * 0.72), padY + stageH * 0.36);
        });
        agents.forEach((ag, idx) => {
          const frac = agents.length === 1 ? 0.5 : idx / (agents.length - 1);
          upsert(ag.id, padX + stageW * (0.12 + frac * 0.76), padY + stageH * (0.66 + (idx % 2 === 0 ? -0.05 : 0.06)));
        });
        subs.forEach((sub, idx) => {
          const frac = subs.length === 1 ? 0.5 : idx / (subs.length - 1);
          upsert(sub.id, padX + stageW * (0.15 + frac * 0.7), padY + stageH * 0.88);
        });
        targets.forEach((t, idx) => {
          const onLeft = idx % 2 === 0;
          const row = Math.floor(idx / 2);
          const rowsTotal = Math.max(1, Math.ceil(targets.length / 2));
          upsert(
            t.id,
            onLeft ? padX + 14 : padX + stageW - 14,
            padY + stageH * (0.18 + (row / Math.max(1, rowsTotal)) * 0.65)
          );
        });
      }

      // Simple overlap relaxation
      for (let iter = 0; iter < 4; iter += 1) {
        for (let i = 0; i < filteredNodes.length; i += 1) {
          const left = filteredNodes[i];
          if (!left) continue;
          const lp = st.positions.get(left.id);
          if (!lp || lp.pinned) continue;
          const lr = radiusForNode(left, cur.mode);
          for (let j = i + 1; j < filteredNodes.length; j += 1) {
            const right = filteredNodes[j];
            if (!right) continue;
            const rp = st.positions.get(right.id);
            if (!rp || rp.pinned) continue;
            const minGap = lr + radiusForNode(right, cur.mode) + 18;
            const dx = rp.tx - lp.tx;
            const dy = rp.ty - lp.ty;
            const dSq = dx * dx + dy * dy;
            if (dSq < minGap * minGap) {
              const dist = Math.max(0.5, Math.sqrt(dSq));
              const push = (minGap - dist) * 0.35;
              lp.tx -= (dx / dist) * push;
              lp.ty -= (dy / dist) * push;
              rp.tx += (dx / dist) * push;
              rp.ty += (dy / dist) * push;
            }
          }
        }
      }

      // Emit beams for newly arrived live pulses
      for (const pulse of (graph?.pulses ?? []).slice(0, 8)) {
        if (st.seenPulses.has(pulse.id)) continue;
        st.seenPulses.add(pulse.id);
        const attacker =
          filteredNodes.find((n) => n.id === pulse.toNode) ??
          filteredNodes.find((n) => n.id === pulse.fromNode);
        const boss = filteredNodes.find((n) => n.kind === 'hub');
        if (attacker && boss && attacker.id !== boss.id) {
          const fromPos = st.positions.get(attacker.id);
          const toPos = st.positions.get(boss.id);
          if (fromPos && toPos) {
            const words = SFX_WORDS[pulse.runtime === 'magpie' ? 'magpie' : pulse.kind] ?? SFX_WORDS.tool;
            const label = words?.[Math.floor(Math.random() * words.length)] ?? 'ZAP!!';
            st.beams.push({
              kind: attacker.runtime === 'magpie' ? 'boost' : pulse.kind === 'error' ? 'bolt' : 'laser',
              fromId: attacker.id,
              toId: boss.id,
              fromX: fromPos.x,
              fromY: fromPos.y,
              toX: toPos.x,
              toY: toPos.y,
              progress: 0,
              speed: 0.065,
              color: runtimeAccentColor(attacker.runtime, attacker.status, st.palette),
              label,
              impacted: false,
            });
          }
        }
      }
      if (st.seenPulses.size > 400) {
        st.seenPulses.clear();
      }

      if (!st.hasAutoFitted && filteredNodes.length > 0) {
        st.hasAutoFitted = true;
        fitView();
      }
    };

    const launchAllOutClash = () => {
      const st = stateRef.current;
      const boss = st.filteredNodes.find((n) => n.kind === 'hub');
      const warriors = st.filteredNodes.filter((n) => n.kind === 'agent' || n.kind === 'swarm');
      if (!boss || warriors.length === 0) return;
      const bossPos = st.positions.get(boss.id);
      if (!bossPos) return;

      const kinds: readonly CombatBeam['kind'][] = ['laser', 'slash', 'bolt', 'boost'];
      warriors.slice(0, 8).forEach((warrior, idx) => {
        const wPos = st.positions.get(warrior.id);
        if (!wPos) return;
        const kind = warrior.runtime === 'magpie' ? 'boost' : (kinds[idx % kinds.length] ?? 'laser');
        const dx = bossPos.x - wPos.x;
        const dy = bossPos.y - wPos.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        wPos.dashX += (dx / dist) * 32;
        wPos.dashY += (dy / dist) * 32;
        st.beams.push({
          kind,
          fromId: warrior.id,
          toId: boss.id,
          fromX: wPos.x,
          fromY: wPos.y,
          toX: bossPos.x,
          toY: bossPos.y,
          progress: 0,
          speed: 0.055 + (idx % 3) * 0.015,
          color: runtimeAccentColor(warrior.runtime, warrior.status, st.palette),
          label: idx === 0 ? 'ALL-OUT CLASH!!' : 'CRIT!!',
          impacted: false,
        });
      });
      st.screenShake = Math.max(st.screenShake, 10);
      propsRef.current.onPlaySfx?.('ultimate');
    };

    useImperativeHandle(ref, () => ({
      fitView,
      resetPins() {
        for (const pos of stateRef.current.positions.values()) {
          pos.pinned = false;
        }
        recomputeLayout();
        fitView();
      },
      triggerAllOutClash: launchAllOutClash,
      savePng() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'moonwitness-observatory-cinema.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        propsRef.current.onPlaySfx?.('camera');
      },
    }));

    useEffect(() => {
      stateRef.current.palette = readObservatoryCanvasPalette();
      recomputeLayout();
    }, [
      props.flowGraph,
      props.mode,
      props.showSubagents,
      props.showTargets,
      props.showIdle,
    ]);

    useEffect(() => {
      const host = hostRef.current;
      const canvas = canvasRef.current;
      if (!host || !canvas) return;

      const reducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const updateSize = () => {
        const w = Math.max(320, host.clientWidth || 900);
        const h = Math.max(360, host.clientHeight || 500);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        stateRef.current.width = w;
        stateRef.current.height = h;
        stateRef.current.palette = readObservatoryCanvasPalette();
        recomputeLayout();
      };

      updateSize();
      const resizeObserver =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
      resizeObserver?.observe(host);

      let rafId = 0;
      const render = (nowMs: number) => {
        const st = stateRef.current;
        const cur = propsRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = canvas.width / Math.max(1, st.width);
        const pal: ObservatoryCanvasPalette = st.palette;
        const t = nowMs * 0.001;
        const chaosMul = cur.chaos === 'overdrive' ? 1.8 : cur.chaos === 'chill' ? 0.55 : 1.1;

        ctx.save();
        ctx.scale(dpr, dpr);

        // Background stage
        ctx.fillStyle = pal.night;
        ctx.fillRect(0, 0, st.width, st.height);

        const bgUrl = STAGE_BACKDROP_URLS[cur.backdrop];
        const bgImg = getCachedImage(bgUrl);
        if (bgImg) {
          const imgRatio = bgImg.naturalWidth / Math.max(1, bgImg.naturalHeight);
          const stageRatio = st.width / Math.max(1, st.height);
          let dw = st.width;
          let dh = st.height;
          if (stageRatio > imgRatio) {
            dh = st.width / imgRatio;
          } else {
            dw = st.height * imgRatio;
          }
          ctx.save();
          ctx.globalAlpha = 0.24;
          ctx.drawImage(bgImg, (st.width - dw) / 2, (st.height - dh) / 2, dw, dh);
          ctx.restore();
        }

        // Subtle comic grid lines
        ctx.save();
        ctx.strokeStyle = pal.nightRaised;
        ctx.lineWidth = 1;
        for (let gx = 0; gx < st.width; gx += 44) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, st.height);
          ctx.stroke();
        }
        for (let gy = 0; gy < st.height; gy += 44) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(st.width, gy);
          ctx.stroke();
        }
        ctx.restore();

        // Auto-cam drift
        if (cur.autoCam && !reducedMotion && !st.isPanning && !st.draggedNodeId) {
          st.targetCamX += Math.sin(t * 0.45) * 0.4;
          st.targetCamY += Math.cos(t * 0.35) * 0.3;
        }

        st.camX += (st.targetCamX - st.camX) * 0.16;
        st.camY += (st.targetCamY - st.camY) * 0.16;
        st.camScale += (st.targetCamScale - st.camScale) * 0.16;

        // Ambient skirmish fire in warzone mode when active heroes exist
        if (!reducedMotion && cur.mode === 'warzone' && st.hitStop <= 0) {
          st.autoCooldown -= chaosMul;
          if (st.autoCooldown <= 0) {
            st.autoCooldown = Math.max(36, 95 / chaosMul);
            const fighters = st.filteredNodes.filter(
              (n) => n.kind === 'agent' && (n.status === 'running' || n.status === 'recent')
            );
            const boss = st.filteredNodes.find((n) => n.kind === 'hub');
            if (fighters.length > 0 && boss) {
              const attacker = fighters[Math.floor(Math.random() * fighters.length)];
              if (attacker) {
                const fromPos = st.positions.get(attacker.id);
                const toPos = st.positions.get(boss.id);
                if (fromPos && toPos) {
                  st.beams.push({
                    kind: attacker.runtime === 'magpie' ? 'boost' : 'laser',
                    fromId: attacker.id,
                    toId: boss.id,
                    fromX: fromPos.x,
                    fromY: fromPos.y,
                    toX: toPos.x,
                    toY: toPos.y,
                    progress: 0,
                    speed: 0.055 * chaosMul,
                    color: runtimeAccentColor(attacker.runtime, attacker.status, pal),
                    label: attacker.runtime === 'magpie' ? 'BOOST!!' : 'SLASH!!',
                    impacted: false,
                  });
                }
              }
            }
          }
        }

        const shakeX = st.screenShake > 0.2 ? (Math.random() - 0.5) * st.screenShake : 0;
        const shakeY = st.screenShake > 0.2 ? (Math.random() - 0.5) * st.screenShake : 0;
        st.screenShake *= 0.86;

        if (st.hitStop > 0) {
          st.hitStop -= 1;
        } else {
          // Physics interpolation
          for (const pos of st.positions.values()) {
            pos.x += (pos.tx - pos.x) * 0.16;
            pos.y += (pos.ty - pos.y) * 0.16;
            pos.dashX *= 0.82;
            pos.dashY *= 0.82;
            pos.recoilX *= 0.8;
            pos.recoilY *= 0.8;
            pos.hitFlash *= 0.85;
          }
        }

        ctx.save();
        ctx.translate(st.camX + shakeX, st.camY + shakeY);
        ctx.scale(st.camScale, st.camScale);

        // Edges + ambient flow beads
        for (const edge of st.filteredEdges) {
          const p1 = st.positions.get(edge.from);
          const p2 = st.positions.get(edge.to);
          if (!p1 || !p2) continue;
          const x1 = p1.x + p1.dashX + p1.recoilX;
          const y1 = p1.y + p1.dashY + p1.recoilY;
          const x2 = p2.x + p2.dashX + p2.recoilX;
          const y2 = p2.y + p2.dashY + p2.recoilY;
          const edgeColor = runtimeAccentColor(edge.runtime, edge.active ? 'running' : 'idle', pal);

          ctx.save();
          ctx.beginPath();
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2 - (edge.kind === 'router-link' ? 28 : 12);
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(mx, my, x2, y2);
          ctx.strokeStyle = edgeColor;
          ctx.globalAlpha = edge.active ? 0.65 : 0.22;
          ctx.lineWidth = edge.kind === 'router-link' ? 2.6 : edge.active ? 2 : 1.1;
          if (edge.kind === 'router-link') ctx.setLineDash([7, 5]);
          ctx.stroke();

          if (edge.active && !reducedMotion) {
            const p = (t * 0.45 * chaosMul + edge.weight * 0.17) % 1;
            const inv = 1 - p;
            const bx = inv * inv * x1 + 2 * inv * p * mx + p * p * x2;
            const by = inv * inv * y1 + 2 * inv * p * my + p * p * y2;
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = edgeColor;
            ctx.beginPath();
            ctx.arc(bx, by, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }

        // Combat beams
        for (let i = st.beams.length - 1; i >= 0; i -= 1) {
          const beam = st.beams[i];
          if (!beam) continue;
          if (st.hitStop <= 0) beam.progress += beam.speed;
          const p = Math.min(1, beam.progress);
          const hx = beam.fromX + (beam.toX - beam.fromX) * p;
          const hy = beam.fromY + (beam.toY - beam.fromY) * p;
          const tail = Math.max(0, p - 0.35);
          const tx = beam.fromX + (beam.toX - beam.fromX) * tail;
          const ty = beam.fromY + (beam.toY - beam.fromY) * tail;

          ctx.save();
          ctx.strokeStyle = beam.color;
          ctx.lineWidth = beam.kind === 'boost' ? 3.5 : 4.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(hx, hy);
          ctx.stroke();

          ctx.fillStyle = pal.paper;
          ctx.beginPath();
          ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          if (beam.progress >= 1 && !beam.impacted) {
            beam.impacted = true;
            const targetPos = st.positions.get(beam.toId);
            if (targetPos) {
              targetPos.hitFlash = 1;
              targetPos.recoilX += (beam.toX - beam.fromX) * 0.05;
              targetPos.recoilY += (beam.toY - beam.fromY) * 0.05;
            }
            st.shockwaves.push({
              x: beam.toX,
              y: beam.toY,
              r: 8,
              maxR: 72,
              color: beam.color,
              alpha: 0.95,
            });
            st.bursts.push({
              x: beam.toX + (Math.random() - 0.5) * 34,
              y: beam.toY - 26,
              text: beam.label,
              color: beam.color,
              life: 0,
              maxLife: 48,
              rot: (Math.random() - 0.5) * 0.25,
            });
            st.screenShake = Math.max(st.screenShake, 5);
            if (st.bursts.length > 8) st.bursts.shift();
          }
          if (beam.progress >= 1.15) {
            st.beams.splice(i, 1);
          }
        }

        // Shockwaves
        for (let i = st.shockwaves.length - 1; i >= 0; i -= 1) {
          const sw = st.shockwaves[i];
          if (!sw) continue;
          sw.r += 3.2;
          sw.alpha *= 0.9;
          ctx.save();
          ctx.strokeStyle = sw.color;
          ctx.globalAlpha = sw.alpha;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          if (sw.alpha < 0.05 || sw.r >= sw.maxR) st.shockwaves.splice(i, 1);
        }

        // Nodes
        for (const node of st.filteredNodes) {
          const pos = st.positions.get(node.id);
          if (!pos) continue;
          const r = radiusForNode(node, cur.mode);
          const bob =
            !reducedMotion && node.status === 'running' ? Math.sin(t * 3.5 + pos.phase) * 3 : 0;
          const nx = pos.x + pos.dashX + pos.recoilX;
          const ny = pos.y + pos.dashY + pos.recoilY + bob;
          const accent = runtimeAccentColor(node.runtime, node.status, pal);
          const isHovered = st.hoveredNodeId === node.id;

          // Active pulsing aura
          if (node.status === 'running' || isHovered || node.kind === 'hub') {
            const pulse = (Math.sin(t * 4 + pos.phase) + 1) * 0.5;
            ctx.save();
            ctx.strokeStyle = accent;
            ctx.globalAlpha = isHovered ? 0.85 : 0.35 + pulse * 0.35;
            ctx.lineWidth = isHovered ? 3 : 2;
            ctx.beginPath();
            ctx.arc(nx, ny, r + 5 + pulse * 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          // Node comic circle fill
          ctx.save();
          ctx.fillStyle = pos.hitFlash > 0.3 ? pal.paper : pal.nightRaised;
          ctx.strokeStyle = accent;
          ctx.lineWidth = isHovered || node.isCurrentSession ? 3.5 : 2.5;
          ctx.beginPath();
          ctx.arc(nx, ny, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Character portrait inside agent/hub nodes
          if (node.kind === 'agent') {
            const portrait = getCachedImage(portraitUrlForSession(node.runtime, node.status));
            if (portrait) {
              ctx.save();
              ctx.beginPath();
              ctx.arc(nx, ny, Math.max(4, r - 3), 0, Math.PI * 2);
              ctx.clip();
              ctx.drawImage(portrait, nx - r + 3, ny - r + 3, (r - 3) * 2, (r - 3) * 2);
              ctx.restore();
            }
          } else if (node.kind === 'hub') {
            // Boss HP bar arc around Hub Core
            const hpPct = cur.battle?.bossHpPct ?? 100;
            ctx.beginPath();
            ctx.strokeStyle = pal.magenta;
            ctx.lineWidth = 4.5;
            ctx.arc(nx, ny, r - 6, -Math.PI / 2, -Math.PI / 2 + (hpPct / 100) * Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = pal.yellow;
            ctx.font = `700 11px ${pal.fontMono}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`HP ${Math.round(hpPct)}%`, nx, ny);
          } else {
            ctx.fillStyle = accent;
            ctx.font = `700 9px ${pal.fontMono}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const shortCode = node.kind === 'runtime' ? node.runtime.slice(0, 4).toUpperCase() : node.kind.slice(0, 3).toUpperCase();
            ctx.fillText(shortCode, nx, ny);
          }

          // Label pill below node
          const labelText = node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label;
          ctx.font = `700 10px ${pal.fontMono}`;
          const textW = ctx.measureText(labelText).width;
          const pillW = Math.max(48, textW + 12);
          const pillX = nx - pillW / 2;
          const pillY = ny + r + 5;
          drawRoundedRect(ctx, pillX, pillY, pillW, 16, 3);
          ctx.fillStyle = pal.night;
          ctx.fill();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.fillStyle = pal.paper;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(labelText, nx, pillY + 8.5);
          ctx.restore();
        }

        // Comic bursts ("SLASH!!", "200 BOOST!!", "ALL-OUT CLASH!!")
        for (let i = st.bursts.length - 1; i >= 0; i -= 1) {
          const burst = st.bursts[i];
          if (!burst) continue;
          burst.life += 1;
          const progress = burst.life / burst.maxLife;
          ctx.save();
          ctx.translate(burst.x, burst.y - progress * 24);
          ctx.rotate(burst.rot);
          ctx.globalAlpha = Math.max(0, 1 - progress);
          ctx.font = `900 14px ${pal.fontDisplay}`;
          const tw = ctx.measureText(burst.text).width;
          drawRoundedRect(ctx, -tw / 2 - 8, -11, tw + 16, 22, 4);
          ctx.fillStyle = burst.color;
          ctx.fill();
          ctx.strokeStyle = pal.ink;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = pal.ink;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(burst.text, 0, 0.5);
          ctx.restore();
          if (burst.life >= burst.maxLife) st.bursts.splice(i, 1);
        }

        ctx.restore();
        ctx.restore();

        if (!reducedMotion) {
          rafId = window.requestAnimationFrame(render);
        }
      };

      rafId = window.requestAnimationFrame(render);

      const getCanvasPoint = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        return { sx: clientX - rect.left, sy: clientY - rect.top };
      };

      const screenToWorld = (sx: number, sy: number) => ({
        x: (sx - stateRef.current.camX) / stateRef.current.camScale,
        y: (sy - stateRef.current.camY) / stateRef.current.camScale,
      });

      const findNodeAt = (wx: number, wy: number): ObservatoryFlowNodeDto | null => {
        const st = stateRef.current;
        for (let i = st.filteredNodes.length - 1; i >= 0; i -= 1) {
          const node = st.filteredNodes[i];
          if (!node) continue;
          const pos = st.positions.get(node.id);
          if (!pos) continue;
          const r = radiusForNode(node, propsRef.current.mode) + 6;
          if (Math.hypot(wx - pos.x, wy - pos.y) <= r) return node;
        }
        return null;
      };

      const onPointerDown = (evt: PointerEvent) => {
        const st = stateRef.current;
        const { sx, sy } = getCanvasPoint(evt.clientX, evt.clientY);
        const world = screenToWorld(sx, sy);
        const hit = findNodeAt(world.x, world.y);
        st.pointerMoved = false;
        st.lastX = sx;
        st.lastY = sy;
        if (hit) {
          st.draggedNodeId = hit.id;
          st.isPanning = false;
        } else {
          st.draggedNodeId = null;
          st.isPanning = true;
        }
      };

      const onPointerMove = (evt: PointerEvent) => {
        const st = stateRef.current;
        const { sx, sy } = getCanvasPoint(evt.clientX, evt.clientY);
        const world = screenToWorld(sx, sy);
        if (st.draggedNodeId) {
          const dx = sx - st.lastX;
          const dy = sy - st.lastY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) st.pointerMoved = true;
          st.lastX = sx;
          st.lastY = sy;
          const pos = st.positions.get(st.draggedNodeId);
          if (pos) {
            pos.x = world.x;
            pos.y = world.y;
            pos.tx = world.x;
            pos.ty = world.y;
            pos.pinned = true;
          }
          return;
        }
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
        const hit = findNodeAt(world.x, world.y);
        st.hoveredNodeId = hit?.id ?? null;
        setTooltip(hit ? { x: sx, y: sy, node: hit } : null);
      };

      const onPointerUp = (evt: PointerEvent) => {
        const st = stateRef.current;
        if (!st.pointerMoved) {
          const { sx, sy } = getCanvasPoint(evt.clientX, evt.clientY);
          const world = screenToWorld(sx, sy);
          const hit = findNodeAt(world.x, world.y);
          if (hit) {
            propsRef.current.onPlaySfx?.('pop');
            if (hit.kind === 'agent' && hit.sessionId) {
              propsRef.current.onSelectAgent?.(hit.runtime as ObservatoryRuntime, hit.sessionId);
            } else if (hit.kind === 'plan-wave' && hit.waveTitle) {
              propsRef.current.onSelectPlanWave?.(hit.waveTitle);
            }
          }
        }
        st.draggedNodeId = null;
        st.isPanning = false;
      };

      const onWheel = (evt: WheelEvent) => {
        evt.preventDefault();
        const st = stateRef.current;
        const { sx, sy } = getCanvasPoint(evt.clientX, evt.clientY);
        const factor = evt.deltaY > 0 ? 0.91 : 1.1;
        const nextScale = Math.max(0.35, Math.min(2.2, st.targetCamScale * factor));
        const wx = (sx - st.targetCamX) / st.targetCamScale;
        const wy = (sy - st.targetCamY) / st.targetCamScale;
        st.targetCamScale = nextScale;
        st.targetCamX = sx - wx * nextScale;
        st.targetCamY = sy - wy * nextScale;
      };

      const onPointerLeave = () => {
        stateRef.current.hoveredNodeId = null;
        stateRef.current.draggedNodeId = null;
        stateRef.current.isPanning = false;
        setTooltip(null);
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointerleave', onPointerLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });

      return () => {
        window.cancelAnimationFrame(rafId);
        resizeObserver?.disconnect();
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
        className="desktop-observatory-stage relative h-[30rem] w-full overflow-hidden border-2 border-ink"
      >
        <canvas
          ref={canvasRef}
          aria-label="Multi-agent live neural flow and boss warzone stage"
          className="block h-full w-full cursor-grab"
        />
        {tooltip ? (
          <div
            className="desktop-observatory-tooltip pointer-events-none absolute z-20 max-w-xs border-2 border-ink bg-paper p-2.5 font-mono text-xs text-ink"
            style={{
              left: `${Math.min(Math.max(12, tooltip.x + 14), Math.max(12, stateRef.current.width - 260))}px`,
              top: `${Math.min(Math.max(12, tooltip.y + 12), Math.max(12, stateRef.current.height - 120))}px`,
            }}
          >
            <p className="font-bold uppercase">{tooltip.node.label}</p>
            <p className="text-ink-faint">
              {tooltip.node.kind.toUpperCase()} · {tooltip.node.runtime} ·{' '}
              {tooltip.node.status.toUpperCase()}
            </p>
            {tooltip.node.focus ? <p className="mt-1 truncate">{tooltip.node.focus}</p> : null}
            {tooltip.node.sublabel ? (
              <p className="text-ink-faint">{tooltip.node.sublabel}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
);
