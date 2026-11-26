# W10-001 — Moon City runtime performance baseline

Date: 2026-11-25 (Asia/Jakarta)
Target: production build, Next.js 16.4.6 / Turbopack, Chromium (Playwright bundled headless executable), Windows workspace runner.
Method: `bun --filter @moonwitness/board build`, `PORT=5188 bunx --cwd apps/board next start --hostname 127.0.0.1 --port 5188`, then `node scripts/visual-universe/measure-home-scene.mjs`. The harness creates a fresh browser context per profile, disables HTTP cache with CDP, records `PerformanceResourceTiming` encoded bytes and paint timings, samples 3 seconds of `requestAnimationFrame`, and reads Chromium CDP script/task/heap metrics.

## Measurements

| Profile | Cold navigation to initial network idle | FCP / LCP | Initial route JS / CSS | Deferred scene JS / assets | Initial / active route resources | RAF mean / p95 | CDP script / task time | JS heap used** |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop 1440×900, DPR 1 | 5,571 ms | 256 / 256 ms | 246,041 / 164,892 B | 8,629 / 6,118 B | 1,206,544 / 1,221,291 B | 16.67 / 16.70 ms | 53.5 / 412.8 ms | 6.01 MB |
| Mobile emulation 390×844, DPR 3 | 5,400 ms | 116 / 200 ms | 239,066 / 164,892 B | 8,629 / 6,118 B | 1,268,074 / 1,282,821 B | 16.67 / 16.70 ms | 37.8 / 323.9 ms | 5.88 MB |

The initial static scene contains the hero image and first idle frame: 361,047 bytes desktop and 215,683 bytes mobile. When motion is enabled after initial measurement, two dynamic runtime chunks add 8,629 encoded JS bytes and the nine environment vectors add 6,118 bytes. The static hero delivered 359,616 bytes desktop and 214,252 bytes mobile. The browser begins loading some below-fold images during cold navigation, so route resource totals describe the route window through network idle rather than a first-viewport-only budget.

\** Chromium CDP `JSHeapUsedSize`; `performance.memory` is Chromium's coarse 10 MB bucket here and is not used as the reported heap value. No comparable browser GPU/process memory API is exposed by this harness. RAF results are headless runner cadence, not a physical-device GPU guarantee.

## Loading and cache policy

- The homepage does not load the SceneLab chunk, Signals specimen, Archive specimen, or unrelated universe assets. The initial state requests the static hero and one idle frame; after motion is enabled, two small dynamic runtime chunks and the canonical nine vectors load.
- Scene SVG and animation paths and the two static hero variants now use `public, max-age=3600, stale-while-revalidate=86400`; the optimized static image response remains Next's own `public, max-age=14400, must-revalidate` policy.
- `Save-Data` and reduced-motion keep the static artwork and page copy present while avoiding the interactive layered scene/idle playback.
- No arbitrary absolute frame-rate or CPU claim is made. Initial route JS/CSS and deferred scene transfers are kept separate in the harness output.

## Reproduction

```powershell
bun --filter @moonwitness/board build
$env:PORT='5188'
bunx --cwd apps/board next start --hostname 127.0.0.1 --port 5188
node scripts/visual-universe/measure-home-scene.mjs
```

Recorded cold measurement: 2026-11-25 07:02 UTC. The harness first loads with reduced motion to measure the initial route, then enables motion and records resources added by the deferred scene. It resolves optimized image URLs back to source asset paths when separating scene resources. Raw measured values are represented in the table above; rerun the harness for a machine-specific JSON capture. This is a local production-build baseline, not a field RUM sample.
