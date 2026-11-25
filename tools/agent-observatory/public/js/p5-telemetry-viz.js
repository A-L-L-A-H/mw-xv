/* global window, p5, ResizeObserver */
(function () {
  window.MWObservatory = window.MWObservatory || {};

  function createTelemetryViz(oscHost, specHost, radarHost) {
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

    // 1. OSCILLOSCOPE: Real CPU %, RAM %, Active Agents, Recent Event Velocity
    if (oscHost) {
      const oscSketch = new p5((sketch) => {
        sketch.setup = () => {
          const canvas = sketch.createCanvas(Math.max(260, oscHost.clientWidth || 420), 270);
          canvas.parent(oscHost);
          sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          sketch.textFont('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
          sketch.noLoop();
        };

        sketch.draw = () => {
          if (!isVisible) return;
          const w = sketch.width;
          const h = sketch.height;
          sketch.background(7, 12, 21);

          const padL = 36;
          const padR = 14;
          const padT = 28;
          const padB = 26;
          const plotW = w - padL - padR;
          const plotH = h - padT - padB;

          // Reticle grid
          sketch.stroke(52, 74, 102, 55);
          sketch.strokeWeight(1);
          for (let step = 0; step <= 4; step += 1) {
            const y = padT + (plotH * step) / 4;
            sketch.line(padL, y, w - padR, y);
            sketch.noStroke();
            sketch.fill(103, 123, 147, 175);
            sketch.textSize(9);
            sketch.textAlign(sketch.RIGHT, sketch.CENTER);
            sketch.text(`${100 - step * 25}%`, padL - 6, y);
            sketch.stroke(52, 74, 102, 55);
          }

          const history = latestSnapshot?.telemetryHistory || [];
          if (history.length < 1) {
            sketch.noStroke();
            sketch.fill(103, 123, 147);
            sketch.textAlign(sketch.CENTER, sketch.CENTER);
            sketch.text('Collecting telemetry frames…', w / 2, h / 2);
            return;
          }

          const maxEvents = Math.max(10, ...history.map((pt) => pt.recentEvents || 0));
          const series = [
            { label: 'CPU', rgb: [56, 232, 240], getVal: (pt) => pt.cpuPct || 0 },
            { label: 'RAM', rgb: [167, 139, 250], getVal: (pt) => pt.memPct || 0 },
            {
              label: 'Events',
              rgb: [251, 191, 36],
              getVal: (pt) => ((pt.recentEvents || 0) / maxEvents) * 100,
            },
            {
              label: 'Active',
              rgb: [74, 222, 128],
              getVal: (pt) => Math.min(100, (pt.runningSessions || 0) * 15),
            },
          ];

          for (const trace of series) {
            sketch.noFill();
            sketch.stroke(trace.rgb[0], trace.rgb[1], trace.rgb[2], 215);
            sketch.strokeWeight(1.8);
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

            // Phosphor lead glow
            sketch.noStroke();
            sketch.fill(trace.rgb[0], trace.rgb[1], trace.rgb[2], 95);
            sketch.circle(lastX, lastY, 10);
            sketch.fill(245, 252, 255);
            sketch.circle(lastX, lastY, 4);
          }

          // Hover crosshair readout
          if (
            sketch.mouseX >= padL &&
            sketch.mouseX <= w - padR &&
            sketch.mouseY >= padT &&
            sketch.mouseY <= h - padB
          ) {
            const idx = Math.round(((sketch.mouseX - padL) / plotW) * (history.length - 1));
            const sample = history[Math.max(0, Math.min(history.length - 1, idx))];
            if (sample) {
              sketch.stroke(56, 232, 240, 110);
              sketch.strokeWeight(1);
              sketch.line(sketch.mouseX, padT, sketch.mouseX, padT + plotH);
              sketch.noStroke();
              sketch.fill(10, 16, 26, 225);
              sketch.rect(padL + 6, padT + 4, 248, 22, 6);
              sketch.fill(239, 246, 255);
              sketch.textAlign(sketch.LEFT, sketch.CENTER);
              sketch.textSize(9.5);
              sketch.text(
                `CPU ${sample.cpuPct}% · RAM ${sample.memPct}% · Act ${sample.runningSessions} · Ev ${sample.recentEvents}`,
                padL + 12,
                padT + 15
              );
            }
          }

          // Top Legend
          let lx = padL;
          sketch.textAlign(sketch.LEFT, sketch.CENTER);
          sketch.textSize(9.5);
          for (const trace of series) {
            sketch.noStroke();
            sketch.fill(trace.rgb[0], trace.rgb[1], trace.rgb[2]);
            sketch.circle(lx + 4, 13, 6);
            sketch.fill(180, 198, 218);
            sketch.text(trace.label, lx + 11, 13);
            lx += 68;
          }
        };
      }, oscHost);
      sketches.push(oscSketch);
      bindResize(oscHost, oscSketch);
    }

    // 2. 60-MINUTE ACTIVITY SPECTROGRAM (Tools, Subagents, Errors)
    if (specHost) {
      const specSketch = new p5((sketch) => {
        sketch.setup = () => {
          const canvas = sketch.createCanvas(Math.max(260, specHost.clientWidth || 420), 270);
          canvas.parent(specHost);
          sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          sketch.textFont('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
          sketch.noLoop();
        };

        sketch.draw = () => {
          if (!isVisible) return;
          const w = sketch.width;
          const h = sketch.height;
          sketch.background(7, 12, 21);

          const buckets = latestSnapshot?.analytics?.activityBuckets || [];
          const padL = 22;
          const padR = 16;
          const padT = 30;
          const padB = 30;
          const plotW = w - padL - padR;
          const plotH = h - padT - padB;

          if (!buckets.length) return;
          const maxTotal = Math.max(4, ...buckets.map((bucket) => bucket.total || 0));
          const barGap = 4;
          const barW = Math.max(4, (plotW - barGap * (buckets.length - 1)) / buckets.length);
          const scanX = padL + ((sketch.millis() * 0.04) % plotW);

          // Animated scanline glow
          sketch.stroke(56, 232, 240, 28);
          sketch.strokeWeight(2);
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

            // Back slot
            sketch.noStroke();
            sketch.fill(20, 31, 48, 125);
            sketch.rect(bx, padT, barW, plotH, 3);

            const toolH = ((bucket.tools || 0) / maxTotal) * plotH;
            const subH = ((bucket.subagents || 0) / maxTotal) * plotH;
            const errH = ((bucket.errors || 0) / maxTotal) * plotH;

            let cursorY = padT + plotH;
            if (toolH > 0) {
              sketch.fill(56, 232, 240, isHot ? 255 : 200);
              sketch.rect(bx, cursorY - toolH, barW, toolH, 2);
              cursorY -= toolH;
            }
            if (subH > 0) {
              sketch.fill(167, 139, 250, isHot ? 255 : 215);
              sketch.rect(bx, cursorY - subH, barW, subH, 2);
              cursorY -= subH;
            }
            if (errH > 0) {
              sketch.fill(251, 113, 133, 245);
              sketch.rect(bx, cursorY - errH, barW, errH, 2);
              cursorY -= errH;
            }

            if (bucket.total > 0) {
              sketch.fill(245, 252, 255, 210);
              sketch.rect(bx, cursorY - 2, barW, 2, 1);
            }

            if (idx % 6 === 0 || idx === buckets.length - 1) {
              sketch.fill(103, 123, 147, 180);
              sketch.textSize(8.5);
              sketch.textAlign(sketch.CENTER, sketch.TOP);
              sketch.text(bucket.label, bx + barW / 2, padT + plotH + 7);
            }
          }

          // Top status / hover readout
          sketch.noStroke();
          sketch.textAlign(sketch.LEFT, sketch.CENTER);
          sketch.textSize(9.5);
          if (hoveredBucket) {
            sketch.fill(56, 232, 240);
            sketch.text(
              `${hoveredBucket.label}: ${hoveredBucket.total} ev (tools ${hoveredBucket.tools} · sub ${hoveredBucket.subagents} · err ${hoveredBucket.errors})`,
              padL,
              14
            );
          } else {
            const topTool = latestSnapshot?.analytics?.toolFrequency?.[0];
            sketch.fill(156, 176, 200);
            sketch.text(
              topTool
                ? `Peak tool: ${topTool.name} (${topTool.calls} calls) · Hover bars`
                : '60m rolling event spectrum',
              padL,
              14
            );
          }
        };
      }, specHost);
      sketches.push(specSketch);
      bindResize(specHost, specSketch);
    }

    // 3. POLAR NETWORK & RUNTIME HEALTH RADAR
    if (radarHost) {
      const radarSketch = new p5((sketch) => {
        sketch.setup = () => {
          const canvas = sketch.createCanvas(Math.max(260, radarHost.clientWidth || 420), 270);
          canvas.parent(radarHost);
          sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
          sketch.textFont('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
          sketch.noLoop();
        };

        sketch.draw = () => {
          if (!isVisible) return;
          const w = sketch.width;
          const h = sketch.height;
          sketch.background(7, 12, 21);

          const cx = w / 2;
          const cy = h / 2 + 4;
          const maxR = Math.min(w, h) * 0.4;
          const sweepAngle = (sketch.millis() * 0.0014) % sketch.TWO_PI;

          // Concentric radar rings & crosshairs
          sketch.noFill();
          for (let ring = 1; ring <= 4; ring += 1) {
            sketch.stroke(56, 232, 240, ring === 4 ? 75 : 32);
            sketch.strokeWeight(1);
            sketch.circle(cx, cy, (maxR * 2 * ring) / 4);
          }
          sketch.stroke(56, 232, 240, 28);
          sketch.line(cx - maxR, cy, cx + maxR, cy);
          sketch.line(cx, cy - maxR, cx, cy + maxR);

          // Phosphor sweep wedge
          for (let step = 0; step < 14; step += 1) {
            const a1 = sweepAngle - step * 0.045;
            const a2 = sweepAngle - (step + 1) * 0.045;
            sketch.noStroke();
            sketch.fill(56, 232, 240, Math.max(0, 42 - step * 3));
            sketch.arc(cx, cy, maxR * 2, maxR * 2, a2, a1, sketch.PIE);
          }
          sketch.stroke(56, 232, 240, 220);
          sketch.strokeWeight(1.8);
          sketch.line(cx, cy, cx + Math.cos(sweepAngle) * maxR, cy + Math.sin(sweepAngle) * maxR);

          // Runtime cache-hit inner arcs
          const rtRows = latestSnapshot?.analytics?.runtimeBreakdown || [];
          for (let idx = 0; idx < Math.min(4, rtRows.length); idx += 1) {
            const row = rtRows[idx];
            const arcR = maxR * (0.28 + idx * 0.11);
            const span = Math.max(0.25, ((row.cacheHitPct || 15) / 100) * Math.PI * 1.6);
            const startA = -Math.PI / 2 + idx * 0.55;
            sketch.noFill();
            sketch.stroke(167, 139, 250, 110);
            sketch.strokeWeight(3);
            sketch.arc(cx, cy, arcR * 2, arcR * 2, startA, startA + span);
          }

          // Plot VPS endpoints around perimeter with outer HUD callout labels & leader lines
          const vpsProbes = latestSnapshot?.probes?.vps || [];
          for (let idx = 0; idx < vpsProbes.length; idx += 1) {
            const probe = vpsProbes[idx];
            const angle = (idx / Math.max(1, vpsProbes.length)) * sketch.TWO_PI - Math.PI / 4;
            const latNorm =
              probe.status === 'down'
                ? 0.92
                : Math.min(0.86, Math.max(0.28, (probe.latencyMs || 80) / 800));
            const px = cx + Math.cos(angle) * maxR * latNorm;
            const py = cy + Math.sin(angle) * maxR * latNorm;

            const rgb =
              probe.status === 'up'
                ? [74, 222, 128]
                : probe.status === 'warn'
                  ? [251, 191, 36]
                  : [251, 113, 133];

            let angleDiff = sweepAngle - ((angle + sketch.TWO_PI) % sketch.TWO_PI);
            if (angleDiff < 0) angleDiff += sketch.TWO_PI;
            const pingGlow = angleDiff < 0.8 ? 1 - angleDiff / 0.8 : 0;

            // Leader line to outer HUD label
            const lx = cx + Math.cos(angle) * (maxR + 14);
            const ly = cy + Math.sin(angle) * (maxR + 14);
            sketch.stroke(rgb[0], rgb[1], rgb[2], 95);
            sketch.strokeWeight(1);
            sketch.line(px, py, lx, ly);

            sketch.noStroke();
            if (pingGlow > 0.05) {
              sketch.fill(rgb[0], rgb[1], rgb[2], pingGlow * 140);
              sketch.circle(px, py, 12 + pingGlow * 16);
            }
            sketch.fill(rgb[0], rgb[1], rgb[2], 240);
            sketch.circle(px, py, 7.5);

            const shortName = probe.label
              .replace(/^HTTPS\s+/i, '')
              .replace(/\.moonwitness\.biz\.id/i, '')
              .replace(/^VPS IP\s+/i, 'VPS ')
              .slice(0, 16);
            const statTag =
              probe.status === 'down' ? probe.detail || 'down' : `${probe.latencyMs ?? 0}ms`;
            sketch.fill(226, 236, 248, 225);
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

  function createSessionStripSketch(hostEl, events) {
    if (!hostEl || typeof p5 === 'undefined') return null;
    const KIND_RGB = Object.freeze({
      tool: [56, 232, 240],
      focus: [251, 191, 36],
      subagent: [167, 139, 250],
      swarm: [244, 114, 182],
      error: [251, 113, 133],
      user: [74, 222, 128],
      message: [96, 165, 250],
    });

    const timeline = (events || []).slice(-64);
    return new p5((sketch) => {
      sketch.setup = () => {
        const w = Math.max(240, hostEl.clientWidth || 640);
        const canvas = sketch.createCanvas(w, 84);
        canvas.parent(hostEl);
        sketch.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        sketch.textFont('ui-monospace, SFMono-Regular, Menlo, Consolas, monospace');
        sketch.frameRate(20);
      };

      sketch.draw = () => {
        const w = sketch.width;
        const h = sketch.height;
        sketch.background(6, 10, 18);

        if (!timeline.length) {
          sketch.fill(103, 123, 147);
          sketch.textAlign(sketch.CENTER, sketch.CENTER);
          sketch.textSize(10);
          sketch.text('No event cadence recorded', w / 2, h / 2);
          return;
        }

        const padX = 12;
        const stepX = (w - padX * 2) / Math.max(1, timeline.length);
        let hovered = null;

        sketch.stroke(52, 74, 102, 80);
        sketch.line(padX, 50, w - padX, 50);

        for (let idx = 0; idx < timeline.length; idx += 1) {
          const ev = timeline[idx];
          const rgb = KIND_RGB[ev.kind] || KIND_RGB.tool;
          const x = padX + idx * stepX + stepX / 2;
          const barH =
            ev.kind === 'error'
              ? 32
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

          sketch.noStroke();
          sketch.fill(rgb[0], rgb[1], rgb[2], isHot ? 255 : 200);
          sketch.rect(x - Math.max(2, stepX * 0.34), 50 - barH, Math.max(4, stepX * 0.68), barH, 2);
          if (isHot) {
            sketch.fill(255);
            sketch.circle(x, 50 - barH - 4, 5);
          }
        }

        sketch.noStroke();
        sketch.textAlign(sketch.LEFT, sketch.CENTER);
        sketch.textSize(9.5);
        if (hovered) {
          sketch.fill(56, 232, 240);
          const summary = `[${hovered.tool || hovered.kind}] ${hovered.summary || ''}`.slice(0, 82);
          sketch.text(summary, padX, 68);
        } else {
          sketch.fill(156, 176, 200);
          sketch.text(
            `Session event cadence (${timeline.length} recent events) · Hover bars to inspect`,
            padX,
            68
          );
        }
      };
    }, hostEl);
  }

  window.MWObservatory.createTelemetryViz = createTelemetryViz;
  window.MWObservatory.createSessionStripSketch = createSessionStripSketch;
})();
