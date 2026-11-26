/* global PerformanceObserver, requestAnimationFrame, window, performance */
import { chromium } from '@playwright/test';

const baseURL = process.env.MW_SCENE_BASE_URL ?? 'http://127.0.0.1:5188';
const getAssetPath = (value) => {
  const url = new URL(value);
  const optimizedSource = url.searchParams.get('url');
  return optimizedSource ? new URL(optimizedSource, url.origin).pathname : url.pathname;
};
const isHeroSceneAsset = (value) =>
  /^\/(?:environments\/moon-city-|animation\/crew-01-idle\/|illustrations\/home-hero-)/u.test(
    getAssetPath(value)
  );
const browser = await chromium.launch({ headless: true });
const output = [];

for (const profile of [
  { name: 'Desktop 1440x900 DPR 1', viewport: { width: 1440, height: 900 }, dpr: 1 },
  { name: 'Mobile emulation 390x844 DPR 3', viewport: { width: 390, height: 844 }, dpr: 3 },
]) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.dpr,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const sceneResponseHeaders = new Map();
  page.on('response', async (response) => {
    if (isHeroSceneAsset(response.url())) {
      sceneResponseHeaders.set(getAssetPath(response.url()), (await response.allHeaders())['cache-control'] ?? null);
    }
  });
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Performance.enable');
  await page.addInitScript(() => {
    window.__mwPaints = { fcp: null, lcp: null };
    new PerformanceObserver((list) => {
      const first = list.getEntries().find((entry) => entry.name === 'first-contentful-paint');
      if (first) window.__mwPaints.fcp = first.startTime;
    }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length) window.__mwPaints.lcp = entries.at(-1).startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const startedAt = Date.now();
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const readMetrics = async (sampleFrames) => page.evaluate(async ({ headersByPath, sampleFrames }) => {
    const resources = performance.getEntriesByType('resource');
    const getAssetPath = (value) => {
      const url = new URL(value);
      const optimizedSource = url.searchParams.get('url');
      return optimizedSource ? new URL(optimizedSource, url.origin).pathname : url.pathname;
    };
    const isHeroSceneAsset = (value) =>
      /^\/(?:environments\/moon-city-|animation\/crew-01-idle\/|illustrations\/home-hero-)/u.test(
        getAssetPath(value)
      );
    const count = (predicate) => resources.filter(predicate).reduce((sum, item) => sum + item.encodedBodySize, 0);
    const byType = (type) => count((entry) => entry.initiatorType === type || new URL(entry.name).pathname.endsWith(type === 'script' ? '.js' : '.css'));
    const all = count(() => true);
    const scene = count((entry) => isHeroSceneAsset(entry.name));
    const frames = [];
    if (sampleFrames) await new Promise((resolve) => {
      const start = performance.now();
      const tick = (now) => { frames.push(now); if (now - start < 3000) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    const intervals = frames.slice(1).map((time, index) => time - frames[index]);
    const sorted = [...intervals].sort((a, b) => a - b);
    return {
      fcpMs: window.__mwPaints.fcp,
      lcpMs: window.__mwPaints.lcp,
      jsEncodedBytes: byType('script'),
      cssEncodedBytes: byType('css'),
      totalResourceEncodedBytes: all,
      sceneAssetEncodedBytes: scene,
      sceneRequests: resources.filter((entry) => isHeroSceneAsset(entry.name)).map((entry) => ({ url: getAssetPath(entry.name), bytes: entry.encodedBodySize, durationMs: Math.round(entry.duration), cacheControl: headersByPath[getAssetPath(entry.name)] ?? null })),
      scriptResources: resources.filter((entry) => entry.initiatorType === 'script' || new URL(entry.name).pathname.endsWith('.js')).map((entry) => ({ url: new URL(entry.name).pathname, bytes: entry.encodedBodySize })),
      animationFrames: intervals.length,
      meanFrameIntervalMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      p95FrameIntervalMs: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      memory: performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null,
      resourceCount: resources.length,
    };
  }, { headersByPath: Object.fromEntries(sceneResponseHeaders), sampleFrames });
  const initialMetrics = await readMetrics(false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[data-scene-id="moon-city-hero"]').waitFor({ state: 'attached' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);
  const activeMetrics = await readMetrics(true);
  const initialScripts = new Set(initialMetrics.scriptResources.map(({ url }) => url));
  const deferredSceneScriptResources = activeMetrics.scriptResources.filter(({ url }) => !initialScripts.has(url));
  const pageMetrics = {
    fcpMs: initialMetrics.fcpMs,
    lcpMs: initialMetrics.lcpMs,
    initialJsEncodedBytes: initialMetrics.jsEncodedBytes,
    initialCssEncodedBytes: initialMetrics.cssEncodedBytes,
    deferredSceneJsEncodedBytes: deferredSceneScriptResources.reduce((sum, item) => sum + item.bytes, 0),
    deferredSceneScriptResources,
    initialResourceEncodedBytes: initialMetrics.totalResourceEncodedBytes,
    activeResourceEncodedBytes: activeMetrics.totalResourceEncodedBytes,
    initialSceneAssetEncodedBytes: initialMetrics.sceneAssetEncodedBytes,
    activeSceneAssetEncodedBytes: activeMetrics.sceneAssetEncodedBytes,
    sceneRequests: activeMetrics.sceneRequests,
    animationFrames: activeMetrics.animationFrames,
    meanFrameIntervalMs: activeMetrics.meanFrameIntervalMs,
    p95FrameIntervalMs: activeMetrics.p95FrameIntervalMs,
    memory: activeMetrics.memory,
    resourceCount: activeMetrics.resourceCount,
  };
  const metrics = await session.send('Performance.getMetrics');
  const metric = (name) => metrics.metrics.find((item) => item.name === name)?.value ?? null;
  output.push({
    profile: profile.name,
    browser: 'Chromium headless (Playwright bundled executable)',
    coldCache: true,
    elapsedThroughNetworkIdleMs: Date.now() - startedAt,
    ...pageMetrics,
    elapsedThroughInitialNetworkIdleMs: Date.now() - startedAt,
    cdp: {
    scriptDurationSeconds: metric('ScriptDuration'),
      taskDurationSeconds: metric('TaskDuration'),
      jsHeapUsedBytes: metric('JSHeapUsedSize'),
      documents: metric('Documents'),
    },
  });
  await context.close();
}

await browser.close();
process.stdout.write(`${JSON.stringify({ baseURL, measuredAt: new Date().toISOString(), results: output }, null, 2)}\n`);
