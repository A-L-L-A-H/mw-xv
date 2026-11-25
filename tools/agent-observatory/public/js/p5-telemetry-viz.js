/* global window, p5, ResizeObserver */
(function () {
  window.MWObservatory = window.MWObservatory || {};

  // Unified MoonWitness Riot Comic Palette
  const INK = [13, 13, 13];
  const NIGHT = [14, 14, 16];
  const CHARCOAL = [24, 24, 30];
  const PAPER = [243, 239, 228];
  const YELLOW = [255, 224, 49];
  const MAGENTA = [255, 46, 136];
  const CYAN = [0, 184, 240];
  const VIOLET = [192, 132, 252];
  const ORANGE = [255, 122, 24];
  const LIME = [180, 255, 57];
  const GREEN = [74, 222, 128];
  const RED = [255, 59, 92];
  const MUTED = [168, 162, 152];

  function createTelemetryViz(oscHost, specHost, radarHost, healthHost, heatmapHost) {
    if (typeof p5 === 'undefined') {
      return {
        setSnapshot() {},
        setVisible() {},
        destroy() {},
      };
    }

    let latestSnapshot = null;
    let isVisible = false;
    const sketches = [];
    const observers = [];

    function bindResize(hostEl, sketchObj) {
      if (!hostEl || typeof ResizeObserver === 'undefined') return;
      const obs = new ResizeObserver(() => {
        if (!isVisible) return;
        const w = Math.max(260, hostEl.clientWidth || 420);
        const h = Math.max(220, hostEl.clientHeight || 270);
        sketchObj.resizeCanvas(w, h);
      });
      obs.observe(hostEl);
      observers.push(obs);
    }

    function drawComicGridBg(sketch, w, h) {
      sketch.background(NIGHT[0], NIGHT[1], NIGHT[2]);
      sketch.noStroke();
      sketch.fill(255, 224, 49, 14);
      for (let gx = 12; gx < w; gx += 24) {
        for (let gy = 12; gy < h; gy += 24) {
          sketch.circle(gx, gy, 1.8);
        }
      }
    }

    // 1. AMP OSCILLOSCOPE (MoonWitness Comic Ink Traces)
    if (oscHost) {
      const oscSketch = new p5((sketch) => {
        sketch.setup = () => {
          const canvas = sketch.createCanvas(Math.max(260, oscHost.clientWidth || 420), 270);
          canvas.parent(oscHost);
          sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          sketch.textFont('JetBrains Mono, Consolas, monospace');
          sketch.noLoop();
        };

        sketch.draw = () => {
          if (!isVisible) return;
          const w = sketch.width;
          const h = sketch.height;
          drawComicGridBg(sketch, w, h);

          const padL = 38;
          const padR = 14;
          const padT = 30;
          const padB = 24;
          const plotW = w - padL - padR;
          const plotH = h - padT - padB;

          // Crisp horizontal street reticle
          sketch.stroke(243, 239, 228, 30);
          sketch.strokeWeight(1);
          for (let step = 0; step <= 4; step += 1) {
            const y = padT + (plotH * step) / 4;
            sketch.line(padL, y, w - padR, y);
            sketch.noStroke();
            sketch.fill(MUTED[0], MUTED[1], MUTED[2], 195);
            sketch.textSize(9);
            sketch.textAlign(sketch.RIGHT, sketch.CENTER);
            sketch.text(`${100 - step * 25}%`, padL - 6, y);
            sketch.stroke(243, 239, 228, 30);
          }

          const history = latestSnapshot?.telemetryHistory || [];
          if (history.length < 1) {
            sketch.noStroke();
            sketch.fill(MUTED[0], MUTED[1], MUTED[2]);
            sketch.textAlign(sketch.CENTER, sketch.CENTER);
            sketch.text('Collecting telemetry frames…', w / 2, h / 2);
            return;
          }

          const maxEvents = Math.max(10, ...history.map((pt) => pt.recentEvents || 0));
          const series = [
            { label: 'CPU', rgb: CYAN, getVal: (pt) => pt.cpuPct || 0 },
            { label: 'RAM', rgb: MAGENTA, getVal: (pt) => pt.memPct || 0 },
            {
              label: 'EVENTS',
              rgb: YELLOW,
              getVal: (pt) => ((pt.recentEvents || 0) / maxEvents) * 100,
            },
            {
              label: 'ACTIVE',
              rgb: LIME,
              getVal: (pt) => Math.min(100, (pt.runningSessions || 0) * 10),
            },
          ];

          for (const trace of series) {
            // Bold comic ink backing under trace
            sketch.noFill();
            sketch.stroke(INK[0], INK[1], INK[2], 210);
            sketch.strokeWeight(4.5);
            sketch.beginShape();
            for (let idx = 0; idx < history.length; idx += 1) {
              const frac = history.length === 1 ? 1 : idx / (history.length - 1);
              const px = padL + frac * plotW;
              const val = Math.max(0, Math.min(100, trace.getVal(history[idx])));
              const py = padT + plotH - (val / 100) * plotH;
              sketch.vertex(px, py);
            }
            sketch.endShape();

            sketch.stroke(trace.rgb[0], trace.rgb[1], trace.rgb[2], 245);
            sketch.strokeWeight(2.3);
            sketch.beginShape();
            let lastX = padL;
            let lastY = padT + plotH;
            for (let idx = 0; idx < history.length; idx += 1) {
              const frac = history.length === 1 ? 1 : idx / (history.length - 1);
              const px = padL + frac * plotW;
              const val = Math.max(0, Math.min(100, trace.getVal(history[idx])));
              const py = padT + plotH - (val / 100) * plotH;
              sketch.vertex(px, py);
              lastX = px;
              lastY = py;
            }
            sketch.endShape();

            sketch.stroke(INK[0], INK[1], INK[2]);
            sketch.strokeWeight(1.8);
            sketch.fill(trace.rgb[0], trace.rgb[1], trace.rgb[2]);
            sketch.circle(lastX, lastY, 8);
          }

          if (
            sketch.mouseX >= padL &&
            sketch.mouseX <= w - padR &&
            sketch.mouseY >= padT &&
            sketch.mouseY <= h - padB
          ) {
            const idx = Math.round(((sketch.mouseX - padL) / plotW) * (history.length - 1));
            const sample = history[Math.max(0, Math.min(history.length - 1, idx))];
            if (sample) {
              sketch.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 185);
              sketch.strokeWeight(1.5);
              sketch.line(sketch.mouseX, padT, sketch.mouseX, padT + plotH);
              sketch.stroke(INK[0], INK[1], INK[2]);
              sketch.strokeWeight(2);
              sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], 245);
              sketch.rect(padL + 6, padT + 4, 260, 22, 2);
              sketch.noStroke();
              sketch.fill(INK[0], INK[1], INK[2]);
              sketch.textAlign(sketch.LEFT, sketch.CENTER);
              sketch.textSize(9.5);
              sketch.text(
                `CPU ${sample.cpuPct}% · RAM ${sample.memPct}% · ACT ${sample.runningSessions} · EV ${sample.recentEvents}`,
                padL + 12,
                padT + 15
              );
            }
          }

          // Top Legend pills
          let lx = padL;
          sketch.textAlign(sketch.LEFT, sketch.CENTER);
          sketch.textSize(9.5);
          for (const trace of series) {
            sketch.stroke(INK[0], INK[1], INK[2]);
            sketch.strokeWeight(1.5);
            sketch.fill(trace.rgb[0], trace.rgb[1], trace.rgb[2]);
            sketch.rect(lx, 8, 8, 8, 1);
            sketch.noStroke();
            sketch.fill(PAPER[0], PAPER[1], PAPER[2]);
            sketch.text(trace.label, lx + 12, 12);
            lx += 68;
          }
        };
      }, oscHost);
      sketches.push(oscSketch);
      bindResize(oscHost, oscSketch);
    }

    // 2. 60-MINUTE RIOT TOOL EQUALIZER
    if (specHost) {
      const specSketch = new p5((sketch) => {
        sketch.setup = () => {
          const canvas = sketch.createCanvas(Math.max(260, specHost.clientWidth || 420), 270);
          canvas.parent(specHost);
          sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          sketch.textFont('JetBrains Mono, Consolas, monospace');
          sketch.noLoop();
        };

        sketch.draw = () => {
          if (!isVisible) return;
          const w = sketch.width;
          const h = sketch.height;
          drawComicGridBg(sketch, w, h);

          const buckets = latestSnapshot?.analytics?.activityBuckets || [];
          const padL = 20;
          const padR = 16;
          const padT = 30;
          const padB = 30;
          const plotW = w - padL - padR;
          const plotH = h - padT - padB;

          if (!buckets.length) return;
          const maxTotal = Math.max(4, ...buckets.map((bucket) => bucket.total || 0));
          const barGap = 4;
          const barW = Math.max(4, (plotW - barGap * (buckets.length - 1)) / buckets.length);
          const scanX = padL + ((sketch.millis() * 0.045) % plotW);

          sketch.stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 50);
          sketch.strokeWeight(2.5);
          sketch.line(scanX, padT, scanX, padT + plotH);

          let hoveredBucket = null;
          for (let idx = 0; idx < buckets.length; idx += 1) {
            const bucket = buckets[idx];
            const bx = padL + idx * (barW + barGap);
            const isHot =
              sketch.mouseX >= bx &&
              sketch.mouseX <= bx + barW &&
              sketch.mouseY >= padT &&
              sketch.mouseY <= padT + plotH;
            if (isHot) hoveredBucket = bucket;

            sketch.stroke(INK[0], INK[1], INK[2], 180);
            sketch.strokeWeight(1.5);
            sketch.fill(CHARCOAL[0], CHARCOAL[1], CHARCOAL[2], 190);
            sketch.rect(bx, padT, barW, plotH, 2);

            const toolH = ((bucket.tools || 0) / maxTotal) * plotH;
            const subH = ((bucket.subagents || 0) / maxTotal) * plotH;
            const errH = ((bucket.errors || 0) / maxTotal) * plotH;

            let cursorY = padT + plotH;
            if (toolH > 0) {
              sketch.fill(CYAN[0], CYAN[1], CYAN[2], isHot ? 255 : 225);
              sketch.rect(bx, cursorY - toolH, barW, toolH, 1);
              cursorY -= toolH;
            }
            if (subH > 0) {
              sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], isHot ? 255 : 230);
              sketch.rect(bx, cursorY - subH, barW, subH, 1);
              cursorY -= subH;
            }
            if (errH > 0) {
              sketch.fill(MAGENTA[0], MAGENTA[1], MAGENTA[2], 250);
              sketch.rect(bx, cursorY - errH, barW, errH, 1);
              cursorY -= errH;
            }

            if (bucket.total > 0) {
              sketch.noStroke();
              sketch.fill(PAPER[0], PAPER[1], PAPER[2], 245);
              sketch.rect(bx, cursorY - 2.5, barW, 2.5);
            }

            if (idx % 6 === 0 || idx === buckets.length - 1) {
              sketch.noStroke();
              sketch.fill(MUTED[0], MUTED[1], MUTED[2], 210);
              sketch.textSize(8.5);
              sketch.textAlign(sketch.CENTER, sketch.TOP);
              sketch.text(bucket.label, bx + barW / 2, padT + plotH + 7);
            }
          }

          sketch.noStroke();
          sketch.textAlign(sketch.LEFT, sketch.CENTER);
          sketch.textSize(9.5);
          if (hoveredBucket) {
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2]);
            sketch.text(
              `${hoveredBucket.label}: ${hoveredBucket.total} EV (TOOLS ${hoveredBucket.tools} · SUB ${hoveredBucket.subagents} · BONK ${hoveredBucket.errors})`,
              padL,
              14
            );
          } else {
            const topTool = latestSnapshot?.analytics?.toolFrequency?.[0];
            sketch.fill(PAPER[0], PAPER[1], PAPER[2]);
            sketch.text(
              topTool
                ? `PEAK MOVE: ${topTool.name.toUpperCase()} (${topTool.calls} hits) · Hover bars`
                : '60m rolling comic equalizer',
              padL,
              14
            );
          }
        };
      }, specHost);
      sketches.push(specSketch);
      bindResize(specHost, specSketch);
    }

    // 3. STREET VPS & RUNTIME RADAR (MoonWitness Comic Neon Sweep)
    if (radarHost) {
      const radarSketch = new p5((sketch) => {
        sketch.setup = () => {
          const canvas = sketch.createCanvas(Math.max(260, radarHost.clientWidth || 420), 270);
          canvas.parent(radarHost);
          sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          sketch.textFont('JetBrains Mono, Consolas, monospace');
          sketch.noLoop();
        };

        sketch.draw = () => {
          if (!isVisible) return;
          const w = sketch.width;
          const h = sketch.height;
          drawComicGridBg(sketch, w, h);

          const cx = w / 2;
          const cy = h / 2 + 4;
          const maxR = Math.min(w, h) * 0.4;
          const sweepAngle = (sketch.millis() * 0.0017) % sketch.TWO_PI;

          // Bold ink radar rings
          sketch.noFill();
          for (let ring = 1; ring <= 4; ring += 1) {
            sketch.stroke(
              ring === 4 ? YELLOW[0] : PAPER[0],
              ring === 4 ? YELLOW[1] : PAPER[1],
              ring === 4 ? YELLOW[2] : PAPER[2],
              ring === 4 ? 140 : 42
            );
            sketch.strokeWeight(ring === 4 ? 2.2 : 1.2);
            sketch.circle(cx, cy, (maxR * 2 * ring) / 4);
          }
          sketch.stroke(PAPER[0], PAPER[1], PAPER[2], 42);
          sketch.strokeWeight(1);
          sketch.line(cx - maxR, cy, cx + maxR, cy);
          sketch.line(cx, cy - maxR, cx, cy + maxR);

          // Neon Magenta/Yellow phosphor sweep wedge
          for (let step = 0; step < 12; step += 1) {
            const a1 = sweepAngle - step * 0.05;
            const a2 = sweepAngle - (step + 1) * 0.05;
            sketch.noStroke();
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2], Math.max(0, 48 - step * 4));
            sketch.arc(cx, cy, maxR * 2, maxR * 2, a2, a1, sketch.PIE);
          }
          sketch.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 245);
          sketch.strokeWeight(2.4);
          sketch.line(cx, cy, cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);

          // Runtime cache-hit inner arcs (including OpenCode Orange & Magpie Magenta!)
          const rtRows = latestSnapshot?.analytics?.runtimeBreakdown || [];
          const arcColors = [CYAN, ORANGE, MAGENTA, YELLOW, LIME];
          for (let idx = 0; idx < Math.min(5, rtRows.length); idx += 1) {
            const row = rtRows[idx];
            const arcR = maxR * (0.24 + idx * 0.11);
            const span = Math.max(0.28, ((row.cacheHitPct || 20) / 100) * Math.PI * 1.65);
            const startA = -Math.PI / 2 + idx * 0.55;
            const aRgb = arcColors[idx % arcColors.length];
            sketch.noFill();
            sketch.stroke(aRgb[0], aRgb[1], aRgb[2], 150);
            sketch.strokeWeight(3.2);
            sketch.arc(cx, cy, arcR * 2, arcR * 2, startA, startA + span);
          }

          // Plot VPS endpoints with ink-outlined comic targets
          const vpsProbes = latestSnapshot?.probes?.vps || [];
          for (let idx = 0; idx < vpsProbes.length; idx += 1) {
            const probe = vpsProbes[idx];
            const angle = (idx / Math.max(1, vpsProbes.length)) * sketch.TWO_PI - Math.PI / 4;
            const latNorm =
              probe.status === 'down'
                ? 0.9
                : Math.min(0.84, Math.max(0.3, (probe.latencyMs || 80) / 800));
            const px = cx + Math.cos(angle) * maxR * latNorm;
            const py = cy + Math.sin(angle) * maxR * latNorm;

            const rgb = probe.status === 'up' ? GREEN : probe.status === 'warn' ? YELLOW : RED;

            let angleDiff = sweepAngle - ((angle + sketch.TWO_PI) % sketch.TWO_PI);
            if (angleDiff < 0) angleDiff += sketch.TWO_PI;
            const pingGlow = angleDiff < 0.8 ? 1 - angleDiff / 0.8 : 0;

            const lx = cx + Math.cos(angle) * (maxR + 14);
            const ly = cy + Math.sin(angle) * (maxR + 14);
            sketch.stroke(rgb[0], rgb[1], rgb[2], 130);
            sketch.strokeWeight(1.5);
            sketch.line(px, py, lx, ly);

            if (pingGlow > 0.05) {
              sketch.noFill();
              sketch.stroke(rgb[0], rgb[1], rgb[2], pingGlow * 210);
              sketch.strokeWeight(2);
              sketch.circle(px, py, 10 + pingGlow * 20);
            }
            sketch.stroke(INK[0], INK[1], INK[2]);
            sketch.strokeWeight(2);
            sketch.fill(rgb[0], rgb[1], rgb[2], 250);
            sketch.circle(px, py, 9.5);

            const shortName = probe.label
              .replace(/^HTTPS\s+/i, '')
              .replace(/\.moonwitness\.biz\.id/i, '')
              .replace(/^VPS IP\s+/i, 'VPS ')
              .slice(0, 16);
            const statTag =
              probe.status === 'down' ? probe.detail || 'DOWN' : `${probe.latencyMs ?? 0}ms`;
            sketch.noStroke();
            sketch.fill(PAPER[0], PAPER[1], PAPER[2], 245);
            sketch.textSize(8.5);
            const onRight = Math.cos(angle) >= 0;
            sketch.textAlign(onRight ? sketch.LEFT : sketch.RIGHT, sketch.CENTER);
            sketch.text(`${shortName} · ${statTag}`, lx + (onRight ? 4 : -4), ly);
          }
        };
      }, radarHost);
      sketches.push(radarSketch);
      bindResize(radarHost, radarSketch);
    }

    // 4. 6-SIGNAL FLEET HEALTH HEXAGON SPIDER RADAR (arXiv:2606.01365 + MAST + AgentDiet)
    if (healthHost) {
      const healthSketch = new p5((sketch) => {
        sketch.setup = () => {
          const canvas = sketch.createCanvas(Math.max(260, healthHost.clientWidth || 420), 270);
          canvas.parent(healthHost);
          sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          sketch.textFont('JetBrains Mono, Consolas, monospace');
          sketch.noLoop();
        };

        sketch.draw = () => {
          if (!isVisible) return;
          const w = sketch.width;
          const h = sketch.height;
          drawComicGridBg(sketch, w, h);

          const fh = latestSnapshot?.analytics?.fleetHealth;
          if (!fh) {
            sketch.noStroke();
            sketch.fill(MUTED[0], MUTED[1], MUTED[2]);
            sketch.textAlign(sketch.CENTER, sketch.CENTER);
            sketch.text('Computing 6-signal fleet health…', w / 2, h / 2);
            return;
          }

          const axes = [
            { key: 'toolReliability', label: 'TOOL' },
            { key: 'loopFreedom', label: 'NO-LOOP' },
            { key: 'recovery', label: 'RECOVER' },
            { key: 'cacheEfficiency', label: 'CACHE' },
            { key: 'dietScore', label: 'DIET' },
            { key: 'budgetHealth', label: 'BUDGET' },
          ];
          const cx = w * 0.42;
          const cy = h * 0.54;
          const maxR = Math.min(w * 0.3, h * 0.35);

          // Hexagonal concentric grid
          for (let ring = 1; ring <= 4; ring += 1) {
            const r = (maxR * ring) / 4;
            sketch.noFill();
            sketch.stroke(PAPER[0], PAPER[1], PAPER[2], ring === 4 ? 115 : 34);
            sketch.strokeWeight(ring === 4 ? 1.8 : 1);
            sketch.beginShape();
            for (let idx = 0; idx < 6; idx += 1) {
              const ang = (idx * Math.PI) / 3 - Math.PI / 2;
              sketch.vertex(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
            }
            sketch.endShape(sketch.CLOSE);
          }

          // Axis spokes + labels
          for (let idx = 0; idx < 6; idx += 1) {
            const ang = (idx * Math.PI) / 3 - Math.PI / 2;
            const ex = cx + Math.cos(ang) * maxR;
            const ey = cy + Math.sin(ang) * maxR;
            sketch.stroke(PAPER[0], PAPER[1], PAPER[2], 45);
            sketch.strokeWeight(1);
            sketch.line(cx, cy, ex, ey);

            const lx = cx + Math.cos(ang) * (maxR + 18);
            const ly = cy + Math.sin(ang) * (maxR + 16);
            sketch.noStroke();
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2]);
            sketch.textSize(9);
            sketch.textAlign(sketch.CENTER, sketch.CENTER);
            sketch.text(`${axes[idx].label} ${fh.signals?.[axes[idx].key] ?? 0}`, lx, ly);
          }

          // Spider Polygon Fill + Comic Ink Border
          sketch.stroke(INK[0], INK[1], INK[2], 240);
          sketch.strokeWeight(4.5);
          sketch.fill(CYAN[0], CYAN[1], CYAN[2], 78);
          sketch.beginShape();
          for (let idx = 0; idx < 6; idx += 1) {
            const ang = (idx * Math.PI) / 3 - Math.PI / 2;
            const val = Math.max(8, Math.min(100, fh.signals?.[axes[idx].key] ?? 80)) / 100;
            sketch.vertex(cx + Math.cos(ang) * maxR * val, cy + Math.sin(ang) * maxR * val);
          }
          sketch.endShape(sketch.CLOSE);

          sketch.noFill();
          sketch.stroke(CYAN[0], CYAN[1], CYAN[2], 250);
          sketch.strokeWeight(2.4);
          sketch.beginShape();
          for (let idx = 0; idx < 6; idx += 1) {
            const ang = (idx * Math.PI) / 3 - Math.PI / 2;
            const val = Math.max(8, Math.min(100, fh.signals?.[axes[idx].key] ?? 80)) / 100;
            sketch.vertex(cx + Math.cos(ang) * maxR * val, cy + Math.sin(ang) * maxR * val);
          }
          sketch.endShape(sketch.CLOSE);

          // Right-hand Arcade Rank Stamp Card
          const cardX = w * 0.72;
          const rankColor =
            fh.rank === 'S'
              ? YELLOW
              : fh.rank === 'A'
                ? CYAN
                : fh.rank === 'B'
                  ? LIME
                  : fh.rank === 'C'
                    ? ORANGE
                    : RED;
          sketch.noStroke();
          sketch.fill(INK[0], INK[1], INK[2]);
          sketch.rect(cardX + 4, 34 + 4, w - cardX - 20, 198, 4);
          sketch.fill(CHARCOAL[0], CHARCOAL[1], CHARCOAL[2]);
          sketch.stroke(rankColor[0], rankColor[1], rankColor[2]);
          sketch.strokeWeight(2.6);
          sketch.rect(cardX, 34, w - cardX - 20, 198, 4);

          const midCardX = cardX + (w - cardX - 20) / 2;
          sketch.noStroke();
          sketch.textAlign(sketch.CENTER, sketch.CENTER);
          sketch.fill(MUTED[0], MUTED[1], MUTED[2]);
          sketch.textSize(9.5);
          sketch.text('FLEET RANK', midCardX, 52);

          sketch.textFont('Anton, Impact, sans-serif');
          sketch.textSize(52);
          sketch.fill(INK[0], INK[1], INK[2]);
          sketch.text(fh.rank, midCardX + 3, 99);
          sketch.fill(rankColor[0], rankColor[1], rankColor[2]);
          sketch.text(fh.rank, midCardX, 96);

          sketch.textFont('JetBrains Mono, Consolas, monospace');
          sketch.textSize(10);
          sketch.fill(PAPER[0], PAPER[1], PAPER[2]);
          sketch.text(`SCORE ${fh.score}/100`, midCardX, 138);
          sketch.fill(
            fh.silentLoopCount > 0 ? RED[0] : GREEN[0],
            fh.silentLoopCount > 0 ? RED[1] : GREEN[1],
            fh.silentLoopCount > 0 ? RED[2] : GREEN[2]
          );
          sketch.text(`LOOPS: ${fh.silentLoopCount}`, midCardX, 158);
          sketch.fill(ORANGE[0], ORANGE[1], ORANGE[2]);
          sketch.text(`DIET WASTE: ~${fh.avgDietWastePct}%`, midCardX, 178);
          sketch.fill(MUTED[0], MUTED[1], MUTED[2]);
          sketch.textSize(8.5);
          const rc = fh.rankCounts || {};
          sketch.text(
            `S:${rc.S || 0} A:${rc.A || 0} B:${rc.B || 0} C:${rc.C || 0} D:${rc.D || 0}`,
            midCardX,
            206
          );
        };
      }, healthHost);
      sketches.push(healthSketch);
      bindResize(healthHost, healthSketch);
    }

    // 5. 7-DAY x 24H GITHUB-STYLE COMIC ACTIVITY HEATMAP (Pixel Agent Desk style)
    if (heatmapHost) {
      const heatSketch = new p5((sketch) => {
        sketch.setup = () => {
          const canvas = sketch.createCanvas(Math.max(260, heatmapHost.clientWidth || 420), 270);
          canvas.parent(heatmapHost);
          sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          sketch.textFont('JetBrains Mono, Consolas, monospace');
          sketch.noLoop();
        };

        sketch.draw = () => {
          if (!isVisible) return;
          const w = sketch.width;
          const h = sketch.height;
          drawComicGridBg(sketch, w, h);

          const hm = latestSnapshot?.analytics?.heatmap;
          if (!hm || !hm.cells?.length) {
            sketch.noStroke();
            sketch.fill(MUTED[0], MUTED[1], MUTED[2]);
            sketch.textAlign(sketch.CENTER, sketch.CENTER);
            sketch.text('Collecting 7-day heatmap…', w / 2, h / 2);
            return;
          }

          const padL = 42;
          const padR = 16;
          const padT = 36;
          const padB = 34;
          const cols = 7;
          const rows = 6;
          const gap = 5;
          const cellW = Math.max(18, (w - padL - padR - gap * (cols - 1)) / cols);
          const cellH = Math.max(16, (h - padT - padB - gap * (rows - 1)) / rows);

          // Slot labels (Y axis)
          sketch.noStroke();
          sketch.fill(MUTED[0], MUTED[1], MUTED[2]);
          sketch.textSize(9);
          sketch.textAlign(sketch.RIGHT, sketch.CENTER);
          for (let rIdx = 0; rIdx < rows; rIdx += 1) {
            sketch.text(hm.slots[rIdx] || '', padL - 7, padT + rIdx * (cellH + gap) + cellH / 2);
          }

          // Day labels (X axis)
          sketch.textAlign(sketch.CENTER, sketch.TOP);
          for (let cIdx = 0; cIdx < cols; cIdx += 1) {
            sketch.text(
              hm.days[cIdx]?.label || '',
              padL + cIdx * (cellW + gap) + cellW / 2,
              padT + rows * (cellH + gap) + 5
            );
          }

          let hoveredCell = null;
          for (const cell of hm.cells) {
            const cx = padL + cell.dayIdx * (cellW + gap);
            const cy = padT + cell.slotIdx * (cellH + gap);
            const isHot =
              sketch.mouseX >= cx &&
              sketch.mouseX <= cx + cellW &&
              sketch.mouseY >= cy &&
              sketch.mouseY <= cy + cellH;
            if (isHot) hoveredCell = cell;

            const ratio = cell.hits / Math.max(1, hm.maxHits || 1);
            const tileRgb =
              cell.hits === 0
                ? CHARCOAL
                : ratio < 0.25
                  ? [16, 78, 108]
                  : ratio < 0.5
                    ? CYAN
                    : ratio < 0.78
                      ? YELLOW
                      : MAGENTA;

            sketch.stroke(
              isHot ? PAPER[0] : INK[0],
              isHot ? PAPER[1] : INK[1],
              isHot ? PAPER[2] : INK[2]
            );
            sketch.strokeWeight(isHot ? 2.4 : 1.8);
            sketch.fill(tileRgb[0], tileRgb[1], tileRgb[2], cell.hits === 0 ? 185 : 245);
            sketch.rect(cx, cy, cellW, cellH, 3);

            if (cell.hits > 0 && cellW > 26) {
              sketch.noStroke();
              sketch.fill(
                ratio >= 0.5 && ratio < 0.78 ? INK[0] : PAPER[0],
                ratio >= 0.5 && ratio < 0.78 ? INK[1] : PAPER[1],
                ratio >= 0.5 && ratio < 0.78 ? INK[2] : PAPER[2]
              );
              sketch.textAlign(sketch.CENTER, sketch.CENTER);
              sketch.textSize(9.5);
              sketch.text(String(cell.hits), cx + cellW / 2, cy + cellH / 2);
            }
          }

          // Top status bar
          sketch.noStroke();
          sketch.textAlign(sketch.LEFT, sketch.CENTER);
          sketch.textSize(9.5);
          if (hoveredCell) {
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2]);
            const fmtNum = window.MWObservatory.utils?.fmtNum || ((val) => String(val));
            sketch.text(
              `${hoveredCell.dayLabel} ${hoveredCell.slotLabel}: ${hoveredCell.hits} activity · ${fmtNum(hoveredCell.tokens)} tok`,
              padL,
              16
            );
          } else {
            sketch.fill(PAPER[0], PAPER[1], PAPER[2]);
            sketch.text('7-DAY x 4H RIOT HEATMAP · Hover tiles to inspect', padL, 16);
          }
        };
      }, heatmapHost);
      sketches.push(heatSketch);
      bindResize(heatmapHost, heatSketch);
    }

    return {
      setSnapshot(snapshot) {
        latestSnapshot = snapshot;
      },
      setVisible(nextVisible) {
        isVisible = Boolean(nextVisible);
        for (const sketchObj of sketches) {
          if (isVisible) {
            const parent = sketchObj.canvas?.parentElement;
            if (parent) {
              sketchObj.resizeCanvas(Math.max(260, parent.clientWidth || 420), 270);
            }
            sketchObj.loop();
          } else {
            sketchObj.noLoop();
          }
        }
      },
      destroy() {
        for (const obs of observers) obs.disconnect();
        for (const sketchObj of sketches) sketchObj.remove();
      },
    };
  }

  // 4. HERO DOSSIER CADENCE RIBBON (MoonWitness Comic Bars)
  function createSessionStripSketch(hostEl, events) {
    if (!hostEl || typeof p5 === 'undefined') return null;
    const KIND_RGB = Object.freeze({
      tool: CYAN,
      focus: YELLOW,
      subagent: VIOLET,
      swarm: MAGENTA,
      error: RED,
      user: LIME,
      message: ORANGE,
    });

    const timeline = (events || []).slice(-64);
    return new p5((sketch) => {
      sketch.setup = () => {
        const w = Math.max(240, hostEl.clientWidth || 640);
        const canvas = sketch.createCanvas(w, 86);
        canvas.parent(hostEl);
        sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        sketch.textFont('JetBrains Mono, Consolas, monospace');
        sketch.frameRate(20);
      };

      sketch.draw = () => {
        const w = sketch.width;
        const h = sketch.height;
        sketch.background(NIGHT[0], NIGHT[1], NIGHT[2]);

        if (!timeline.length) {
          sketch.noStroke();
          sketch.fill(MUTED[0], MUTED[1], MUTED[2]);
          sketch.textAlign(sketch.CENTER, sketch.CENTER);
          sketch.textSize(10);
          sketch.text('No action cadence recorded', w / 2, h / 2);
          return;
        }

        const padX = 12;
        const stepX = (w - padX * 2) / Math.max(1, timeline.length);
        let hovered = null;

        sketch.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 95);
        sketch.strokeWeight(1.5);
        sketch.line(padX, 52, w - padX, 52);

        for (let idx = 0; idx < timeline.length; idx += 1) {
          const ev = timeline[idx];
          const rgb = KIND_RGB[ev.kind] || KIND_RGB.tool;
          const x = padX + idx * stepX + stepX / 2;
          const barH =
            ev.kind === 'error'
              ? 34
              : ev.kind === 'subagent' || ev.kind === 'swarm'
                ? 28
                : ev.kind === 'focus'
                  ? 22
                  : 16;
          const isHot =
            Math.abs(sketch.mouseX - x) <= Math.max(5, stepX * 0.55) &&
            sketch.mouseY >= 0 &&
            sketch.mouseY <= h;
          if (isHot) hovered = ev;

          sketch.stroke(INK[0], INK[1], INK[2], 235);
          sketch.strokeWeight(1.4);
          sketch.fill(rgb[0], rgb[1], rgb[2], isHot ? 255 : 225);
          sketch.rect(
            x - Math.max(2.5, stepX * 0.36),
            52 - barH,
            Math.max(4.5, stepX * 0.72),
            barH,
            1
          );
          if (isHot) {
            sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2]);
            sketch.circle(x, 52 - barH - 5, 6);
          }
        }

        sketch.noStroke();
        sketch.textAlign(sketch.LEFT, sketch.CENTER);
        sketch.textSize(9.5);
        if (hovered) {
          sketch.fill(YELLOW[0], YELLOW[1], YELLOW[2]);
          const summary = `[${hovered.tool || hovered.kind}] ${hovered.summary || ''}`.slice(0, 82);
          sketch.text(summary, padX, 70);
        } else {
          sketch.fill(PAPER[0], PAPER[1], PAPER[2]);
          sketch.text(
            `ACTION CADENCE (${timeline.length} moves) · Hover bars to inspect`,
            padX,
            70
          );
        }
      };
    }, hostEl);
  }

  window.MWObservatory.createTelemetryViz = createTelemetryViz;
  window.MWObservatory.createSessionStripSketch = createSessionStripSketch;
})();
