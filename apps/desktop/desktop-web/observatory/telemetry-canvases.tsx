import { useEffect, useRef } from 'react';
import { readObservatoryCanvasPalette } from './canvas-palette';
import type {
  ObservatoryAnalyticsDto,
  ObservatoryEventDto,
  ObservatoryProbeResultDto,
  ObservatoryTelemetryHistoryPointDto,
} from './types';

function setupHiDpiCanvas(canvas: HTMLCanvasElement, host: HTMLDivElement, fixedHeight: number) {
  const w = Math.max(240, host.clientWidth || 420);
  const h = fixedHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  return { w, h, dpr };
}

export function TelemetryOscilloscopeCanvas({
  history,
}: {
  readonly history: readonly ObservatoryTelemetryHistoryPointDto[];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverXRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const draw = () => {
      const { w, h, dpr } = setupHiDpiCanvas(canvas, host, 230);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pal = readObservatoryCanvasPalette();

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = pal.night;
      ctx.fillRect(0, 0, w, h);

      const padL = 36;
      const padR = 14;
      const padT = 28;
      const padB = 22;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      // Grid lines
      ctx.strokeStyle = pal.nightRaised;
      ctx.lineWidth = 1;
      ctx.font = `500 9px ${pal.fontMono}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let step = 0; step <= 4; step += 1) {
        const y = padT + (plotH * step) / 4;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.fillStyle = pal.moon;
        ctx.fillText(`${100 - step * 25}%`, padL - 6, y);
      }

      if (history.length === 0) {
        ctx.fillStyle = pal.moon;
        ctx.textAlign = 'center';
        ctx.fillText('Collecting live host frames…', w / 2, h / 2);
        ctx.restore();
        return;
      }

      const maxEvents = Math.max(10, ...history.map((pt) => pt.recentEvents));
      const series = [
        { label: 'CPU', color: pal.cyan, getVal: (pt: ObservatoryTelemetryHistoryPointDto) => pt.cpuPct },
        { label: 'RAM', color: pal.violet, getVal: (pt: ObservatoryTelemetryHistoryPointDto) => pt.memPct },
        {
          label: 'Events',
          color: pal.yellow,
          getVal: (pt: ObservatoryTelemetryHistoryPointDto) => (pt.recentEvents / maxEvents) * 100,
        },
        {
          label: 'Active',
          color: pal.chart1,
          getVal: (pt: ObservatoryTelemetryHistoryPointDto) => Math.min(100, pt.runningSessions * 15),
        },
      ];

      for (const trace of series) {
        ctx.save();
        ctx.strokeStyle = trace.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let lastX = padL;
        let lastY = padT + plotH;
        history.forEach((pt, idx) => {
          const frac = history.length === 1 ? 1 : idx / (history.length - 1);
          const px = padL + frac * plotW;
          const val = Math.max(0, Math.min(100, trace.getVal(pt)));
          const py = padT + plotH - (val / 100) * plotH;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
          lastX = px;
          lastY = py;
        });
        ctx.stroke();

        ctx.fillStyle = trace.color;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Legend
      let lx = padL;
      ctx.textAlign = 'left';
      for (const trace of series) {
        ctx.fillStyle = trace.color;
        ctx.beginPath();
        ctx.arc(lx + 4, 13, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = pal.paper;
        ctx.fillText(trace.label, lx + 11, 13);
        lx += 64;
      }

      const hx = hoverXRef.current;
      if (hx !== null && hx >= padL && hx <= w - padR) {
        const idx = Math.round(((hx - padL) / plotW) * (history.length - 1));
        const sample = history[Math.max(0, Math.min(history.length - 1, idx))];
        if (sample) {
          ctx.strokeStyle = pal.cyan;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(hx, padT);
          ctx.lineTo(hx, padT + plotH);
          ctx.stroke();

          ctx.fillStyle = pal.nightRaised;
          ctx.fillRect(padL + 6, padT + 4, 250, 20);
          ctx.fillStyle = pal.paper;
          ctx.fillText(
            `CPU ${sample.cpuPct}% · RAM ${sample.memPct}% · Act ${sample.runningSessions} · Ev ${sample.recentEvents}`,
            padL + 12,
            padT + 14
          );
        }
      }

      ctx.restore();
    };

    draw();
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    obs?.observe(host);

    const onMove = (evt: PointerEvent) => {
      hoverXRef.current = evt.clientX - canvas.getBoundingClientRect().left;
      draw();
    };
    const onLeave = () => {
      hoverXRef.current = null;
      draw();
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    return () => {
      obs?.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [history]);

  return (
    <div ref={hostRef} className="w-full border-2 border-ink bg-night">
      <canvas ref={canvasRef} aria-label="Live CPU, RAM, and activity oscilloscope" className="block w-full" />
    </div>
  );
}

export function ActivitySpectrogramCanvas({
  analytics,
}: {
  readonly analytics: ObservatoryAnalyticsDto | undefined;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverIdxRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const buckets = analytics?.activityBuckets ?? [];
    const draw = () => {
      const { w, h, dpr } = setupHiDpiCanvas(canvas, host, 230);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pal = readObservatoryCanvasPalette();

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = pal.night;
      ctx.fillRect(0, 0, w, h);

      const padL = 18;
      const padR = 16;
      const padT = 28;
      const padB = 26;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      if (buckets.length === 0) {
        ctx.fillStyle = pal.moon;
        ctx.font = `500 10px ${pal.fontMono}`;
        ctx.textAlign = 'center';
        ctx.fillText('No 60m bucket data yet', w / 2, h / 2);
        ctx.restore();
        return;
      }

      const maxTotal = Math.max(4, ...buckets.map((b) => b.total));
      const barGap = 4;
      const barW = Math.max(4, (plotW - barGap * (buckets.length - 1)) / buckets.length);

      buckets.forEach((bucket, idx) => {
        const bx = padL + idx * (barW + barGap);
        const isHot = hoverIdxRef.current === idx;

        ctx.fillStyle = pal.nightRaised;
        ctx.fillRect(bx, padT, barW, plotH);

        const toolH = (bucket.tools / maxTotal) * plotH;
        const subH = (bucket.subagents / maxTotal) * plotH;
        const errH = (bucket.errors / maxTotal) * plotH;

        let cy = padT + plotH;
        if (toolH > 0) {
          ctx.fillStyle = pal.cyan;
          ctx.fillRect(bx, cy - toolH, barW, toolH);
          cy -= toolH;
        }
        if (subH > 0) {
          ctx.fillStyle = pal.violet;
          ctx.fillRect(bx, cy - subH, barW, subH);
          cy -= subH;
        }
        if (errH > 0) {
          ctx.fillStyle = pal.error;
          ctx.fillRect(bx, cy - errH, barW, errH);
        }
        if (isHot) {
          ctx.strokeStyle = pal.yellow;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx, padT, barW, plotH);
        }

        if (idx % 6 === 0 || idx === buckets.length - 1) {
          ctx.fillStyle = pal.moon;
          ctx.font = `500 8.5px ${pal.fontMono}`;
          ctx.textAlign = 'center';
          ctx.fillText(bucket.label, bx + barW / 2, padT + plotH + 13);
        }
      });

      const hovered = hoverIdxRef.current !== null ? buckets[hoverIdxRef.current] : null;
      ctx.font = `600 9.5px ${pal.fontMono}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = hovered ? pal.yellow : pal.moon;
      if (hovered) {
        ctx.fillText(
          `${hovered.label}: ${hovered.total} ev (tools ${hovered.tools} · sub ${hovered.subagents} · err ${hovered.errors})`,
          padL,
          15
        );
      } else {
        const topTool = analytics?.toolFrequency[0];
        ctx.fillText(
          topTool
            ? `Peak tool: ${topTool.name} (${topTool.calls} calls) · Hover bars`
            : '60m rolling event spectrogram',
          padL,
          15
        );
      }

      ctx.restore();
    };

    draw();
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    obs?.observe(host);

    const onMove = (evt: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = evt.clientX - rect.left;
      const plotW = Math.max(1, rect.width - 34);
      const idx = Math.floor(((mx - 18) / plotW) * buckets.length);
      hoverIdxRef.current = idx >= 0 && idx < buckets.length ? idx : null;
      draw();
    };
    const onLeave = () => {
      hoverIdxRef.current = null;
      draw();
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    return () => {
      obs?.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [analytics]);

  return (
    <div ref={hostRef} className="w-full border-2 border-ink bg-night">
      <canvas ref={canvasRef} aria-label="60-minute tool call spectrogram" className="block w-full" />
    </div>
  );
}

export function NetworkRadarCanvas({
  probes,
  analytics,
}: {
  readonly probes: readonly ObservatoryProbeResultDto[];
  readonly analytics: ObservatoryAnalyticsDto | undefined;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    const render = (nowMs: number) => {
      const { w, h, dpr } = setupHiDpiCanvas(canvas, host, 230);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pal = readObservatoryCanvasPalette();

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = pal.night;
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2 + 2;
      const maxR = Math.min(w, h) * 0.38;
      const sweep = reducedMotion ? 0.6 : (nowMs * 0.0014) % (Math.PI * 2);

      // Rings & crosshairs
      ctx.strokeStyle = pal.nightRaised;
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 4; ring += 1) {
        ctx.beginPath();
        ctx.arc(cx, cy, (maxR * ring) / 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      // Sweep beam
      ctx.save();
      ctx.strokeStyle = pal.cyan;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweep) * maxR, cy + Math.sin(sweep) * maxR);
      ctx.stroke();
      ctx.restore();

      // Runtime cache-hit arcs
      const rts = analytics?.runtimeBreakdown ?? [];
      rts.slice(0, 4).forEach((row, idx) => {
        const arcR = maxR * (0.28 + idx * 0.11);
        const span = Math.max(0.25, ((row.cacheHitPct || 15) / 100) * Math.PI * 1.6);
        const startA = -Math.PI / 2 + idx * 0.5;
        ctx.save();
        ctx.strokeStyle = pal.violet;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, startA, startA + span);
        ctx.stroke();
        ctx.restore();
      });

      // VPS probe dots
      probes.forEach((probe, idx) => {
        const angle = (idx / Math.max(1, probes.length)) * Math.PI * 2 - Math.PI / 4;
        const latNorm =
          probe.status === 'down' || probe.status === 'blocked'
            ? 0.9
            : Math.min(0.84, Math.max(0.28, (probe.latencyMs ?? 80) / 800));
        const px = cx + Math.cos(angle) * maxR * latNorm;
        const py = cy + Math.sin(angle) * maxR * latNorm;
        const lx = cx + Math.cos(angle) * (maxR + 14);
        const ly = cy + Math.sin(angle) * (maxR + 14);

        const dotColor =
          probe.status === 'up'
            ? pal.chart1
            : probe.status === 'warn' || probe.status === 'pending'
              ? pal.yellow
              : pal.error;

        ctx.strokeStyle = dotColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(lx, ly);
        ctx.stroke();

        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();

        const shortName = probe.label
          .replace(/^HTTPS\s+/iu, '')
          .replace(/\.moonwitness\.biz\.id/iu, '')
          .replace(/^VPS IP\s+/iu, 'VPS ')
          .slice(0, 14);
        const tag =
          probe.status === 'down' ? probe.detail || 'down' : `${probe.latencyMs ?? 0}ms`;
        ctx.fillStyle = pal.paper;
        ctx.font = `500 8.5px ${pal.fontMono}`;
        ctx.textAlign = Math.cos(angle) >= 0 ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${shortName} ${tag}`, lx + (Math.cos(angle) >= 0 ? 4 : -4), ly);
      });

      ctx.restore();
      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(render);
      }
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [probes, analytics]);

  return (
    <div ref={hostRef} className="w-full border-2 border-ink bg-night">
      <canvas ref={canvasRef} aria-label="Polar VPS latency and runtime cache radar" className="block w-full" />
    </div>
  );
}

export function SessionCadenceCanvas({
  events,
}: {
  readonly events: readonly ObservatoryEventDto[];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoveredIdxRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const timeline = events.slice(-64);

    const draw = () => {
      const { w, h, dpr } = setupHiDpiCanvas(canvas, host, 82);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const pal = readObservatoryCanvasPalette();

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = pal.night;
      ctx.fillRect(0, 0, w, h);

      if (timeline.length === 0) {
        ctx.fillStyle = pal.moon;
        ctx.font = `500 10px ${pal.fontMono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No event cadence recorded', w / 2, h / 2);
        ctx.restore();
        return;
      }

      const padX = 10;
      const stepX = (w - padX * 2) / Math.max(1, timeline.length);
      ctx.strokeStyle = pal.nightRaised;
      ctx.beginPath();
      ctx.moveTo(padX, 50);
      ctx.lineTo(w - padX, 50);
      ctx.stroke();

      timeline.forEach((ev, idx) => {
        const x = padX + idx * stepX + stepX / 2;
        const barH =
          ev.kind === 'error'
            ? 32
            : ev.kind === 'subagent' || ev.kind === 'swarm'
              ? 28
              : ev.kind === 'focus'
                ? 22
                : 16;
        const barColor =
          ev.kind === 'error'
            ? pal.error
            : ev.kind === 'subagent'
              ? pal.violet
              : ev.kind === 'swarm'
                ? pal.magenta
                : ev.kind === 'focus'
                  ? pal.yellow
                  : ev.kind === 'user'
                    ? pal.chart1
                    : pal.cyan;

        ctx.fillStyle = barColor;
        const bw = Math.max(3, stepX * 0.68);
        ctx.fillRect(x - bw / 2, 50 - barH, bw, barH);
        if (hoveredIdxRef.current === idx) {
          ctx.fillStyle = pal.paper;
          ctx.beginPath();
          ctx.arc(x, 50 - barH - 4, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      const hovered = hoveredIdxRef.current !== null ? timeline[hoveredIdxRef.current] : null;
      ctx.font = `500 9.5px ${pal.fontMono}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = hovered ? pal.cyan : pal.moon;
      const footer = hovered
        ? `[${hovered.tool || hovered.kind}] ${hovered.summary}`.slice(0, 82)
        : `Session event cadence (${timeline.length} recent events) · Hover bars to inspect`;
      ctx.fillText(footer, padX, 68);
      ctx.restore();
    };

    draw();
    const onMove = (evt: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = evt.clientX - rect.left;
      const idx = Math.floor(((mx - 10) / Math.max(1, rect.width - 20)) * timeline.length);
      hoveredIdxRef.current = idx >= 0 && idx < timeline.length ? idx : null;
      draw();
    };
    const onLeave = () => {
      hoveredIdxRef.current = null;
      draw();
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);

    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [events]);

  return (
    <div ref={hostRef} className="w-full border-2 border-ink bg-night">
      <canvas ref={canvasRef} aria-label="Session event cadence timeline" className="block w-full" />
    </div>
  );
}
