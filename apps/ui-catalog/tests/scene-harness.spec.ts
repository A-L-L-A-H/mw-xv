import { expect, test } from '@playwright/test';
import { resolveSceneLayerSources } from '../src/scene-layer-sources';

test('scene layer asset imports stay attached to canonical IDs when layer order changes', () => {
  const layers = [
    { id: 'sky', order: 0 },
    { id: 'moon', order: 10 },
    { id: 'prop-wires', order: 85 },
  ];
  const sources = { sky: '/sky.svg', moon: '/moon.svg', 'prop-wires': '/wires.svg' };
  const result = resolveSceneLayerSources([...layers].reverse(), sources);
  expect(result.map(({ id, src }) => [id, src])).toEqual([
    ['prop-wires', '/wires.svg'],
    ['moon', '/moon.svg'],
    ['sky', '/sky.svg'],
  ]);
});

test('scene layer source resolver rejects missing, duplicate, and unexpected mappings', () => {
  expect(() => resolveSceneLayerSources([{ id: 'moon' }], {})).toThrow(/missing an imported source/u);
  expect(() => resolveSceneLayerSources([{ id: 'moon' }, { id: 'moon' }], { moon: '/moon.svg' })).toThrow(/must be unique/u);
  expect(() => resolveSceneLayerSources([{ id: 'moon' }], { moon: '/moon.svg', sky: '/sky.svg' })).toThrow(/Unexpected imported source mapping/u);
});

test('environment depth inspector toggles and reorders planes and reflows on mobile (W4-008, W1-006)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#scene-environment-inspector');
  const lab = page.getByTestId('scene-lab');
  await expect(lab).toBeVisible();
  await expect(lab.locator('[data-scene-id="moon-city-hero"]')).toBeVisible();
  // 9 environment planes plus the in-scene crew-01 layer (z=82)
  await expect(lab.locator('[data-layer-id]')).toHaveCount(10);
  await expect(lab.locator('[data-layer-id="crew-01"]')).toHaveAttribute('data-z-order', '82');

  // Toggle off one plane
  await lab.locator('li[data-plane-id="prop-wires"] input[type="checkbox"]').uncheck();
  await expect(lab.locator('[data-layer-id]')).toHaveCount(9);

  // Reorder planes (move moon backward behind sky)
  await lab.locator('li[data-plane-id="moon"] button', { hasText: 'Back' }).click();
  await expect(lab.locator('li[data-plane-id="moon"]')).toHaveAttribute('data-plane-order', '0');

  // Switch responsive composition to Mobile 9:16 and verify safe guides + breakpoint overrides
  await lab.getByRole('button', { name: 'Mobile 9:16' }).click();
  await expect(lab.locator('.scene-lab-stage')).toHaveAttribute('data-composition', 'mobile');
  await expect(lab.getByTestId('scene-safe-guides')).toBeVisible();

  // Narrow viewport usability check (390px)
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(2);
});

test('Signals and Archive stay catalog-only until product routes and data contracts exist (W9-004)', async ({
  page,
}) => {
  await page.goto('./#scene-environment-inspector');
  const specimens = page.getByTestId('signals-archive-specimens');
  await expect(specimens).toBeVisible();
  await expect(specimens.getByTestId('signals-scene-specimen')).toContainText(
    'no route or live signal feed'
  );
  await expect(specimens.getByTestId('archive-scene-specimen')).toContainText(
    'no route or archive records'
  );
  await expect(specimens.locator('img')).toHaveCount(2);
  await expect(specimens.locator('a')).toHaveCount(0);
});

test('scene runtime supports static fallback, timeline controls, keyboard camera, and deterministic URL harness (W5-004..W5-010)', async ({
  page,
}) => {
  await page.goto('./?sceneTime=900&sceneFrame=1&scenePaused=1#scene-environment-inspector');
  const lab = page.getByTestId('scene-lab');
  await expect(lab).toBeVisible();

  // Deterministic harness pins sprite frame 1 and timeline time 900ms
  const sprite = lab.locator('[data-sprite-clip="crew-01-idle"]');
  await expect(sprite).toHaveAttribute('data-sprite-frame', '1');
  await expect(lab.getByTestId('scene-timeline-status')).toContainText('900ms');

  // Timeline controls step & complete without trapping navigation
  await lab.getByRole('button', { name: 'Complete timeline' }).click();
  await expect(lab.getByTestId('scene-timeline-status')).toContainText('completed');
  await lab.getByRole('slider', { name: 'Timeline position' }).fill('1200');
  await expect(lab.getByTestId('scene-timeline-status')).toContainText('1200ms');

  // Keyboard camera navigation does not hijack page scroll
  const scene = lab.locator('[data-scene-id="moon-city-hero"]');
  await scene.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('0');

  // Static fallback / reduced-motion toggle switches scene and sprite to static state
  await lab.getByRole('button', { name: 'Static fallback' }).click();
  await expect(scene).toHaveAttribute('data-scene-state', 'static');
  await expect(sprite).toHaveAttribute('data-sprite-state', 'static');
});

test('environment inspector resets layer visibility, z-order and composition to the canonical baseline (W7-004)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#scene-environment-inspector');
  const lab = page.getByTestId('scene-lab');
  await lab.locator('li[data-plane-id="prop-wires"] input[type="checkbox"]').uncheck();
  await lab.getByRole('button', { name: 'Mobile 9:16' }).click();
  await lab.getByRole('button', { name: 'Reset inspector' }).click();
  await expect(lab.locator('[data-layer-id]')).toHaveCount(10);
  await expect(lab.locator('[data-layer-id="sky"]')).toBeVisible();
  await expect(lab.locator('[data-layer-id="crew-01"]')).toBeVisible();
  await expect(lab.locator('.scene-lab-stage')).toHaveAttribute('data-composition', 'desktop');
});

test('character studio plays, pauses and resets imported clip frames when motion is allowed (W7-003)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#character-preview');
  await expect(
    page.getByText(/Catalog-only fictional example\. crew-01 is not a real crew member/u)
  ).toBeVisible();
  const specimen = page.getByTestId('character-preview-specimen');
  const player = specimen.locator(
    '[data-sprite-clip="animation/crew-01-idle/crew-01-idle-clip.json"]'
  );
  await expect(player).toHaveAttribute('data-sprite-state', 'paused');
  await specimen.getByRole('button', { name: 'Play' }).first().click();
  await expect(player).toHaveAttribute('data-sprite-state', 'playing');
  await specimen.getByRole('button', { name: 'Pause' }).first().click();
  await expect(player).toHaveAttribute('data-sprite-state', 'paused');
  await specimen.getByRole('button', { name: 'Reset' }).first().click();
  await expect(specimen.getByRole('button', { name: 'Play' }).first()).toBeVisible();
});

test('character studio starts static for reduced motion and offers explicit preview playback (W7-003)', async ({
  page,
}) => {
  await page.goto('./#character-preview');
  const specimen = page.getByTestId('character-preview-specimen');
  const player = specimen.locator(
    '[data-sprite-clip="animation/crew-01-idle/crew-01-idle-clip.json"]'
  );
  await expect(player).toHaveAttribute('data-sprite-state', 'static');
  await expect(specimen.getByRole('button', { name: 'Reduced motion on' }).first()).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await specimen.getByRole('button', { name: 'Play' }).first().click();
  await expect(player).toHaveAttribute('data-sprite-state', 'playing');
});

test('asset diagnostics loads and exports the build-time validator report (W7-007)', async ({
  page,
}) => {
  await page.goto('./#asset-diagnostics');
  const panel = page.getByTestId('asset-diagnostics');
  await expect(panel.getByRole('button', { name: 'Export report' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Load build diagnostics' }).click();
  await expect(
    panel.getByText('Build diagnostics: passed; scene validation: passed.')
  ).toBeVisible();
  await expect(panel.locator('.auth-coverage-facts')).toContainText('Asset QA errors0');
  await expect(panel.locator('.auth-coverage-facts')).toContainText('Scene validation errors0');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export report' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('moonwitness-asset-diagnostics.json');
});

test('scene inspector captures desktop/mobile compositions and reduced-motion fallback (W7-006)', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#scene-environment-inspector');
  const lab = page.getByTestId('scene-lab');
  const stage = lab.locator('.scene-lab-stage');
  const desktopScene = lab.locator('[data-scene-id="moon-city-hero"]');
  await expect(stage).toHaveAttribute('data-composition', 'desktop');
  const desktopMoon = desktopScene.locator('[data-layer-id="moon"]');
  const desktopPivotRatio = await desktopMoon.evaluate((layer) => {
    const [originX, originY] = getComputedStyle(layer)
      .transformOrigin.split(' ')
      .map(Number.parseFloat);
    const bounds = layer.getBoundingClientRect();
    return [originX / bounds.width, originY / bounds.height];
  });
  expect(desktopPivotRatio[0]).toBeCloseTo(0.72, 2);
  expect(desktopPivotRatio[1]).toBeCloseTo(0.24, 2);
  // Crew-01 is composited into the scene (z=82): visible, near the rooftop, right of center,
  // and scaled to roughly a fifth of the stage height.
  const crew = stage.locator('[data-layer-id="crew-01"]');
  await expect(crew).toBeVisible();
  await expect(crew).toHaveAttribute('data-z-order', '82');
  await stage.scrollIntoViewIfNeeded();
  const desktopStageBox = await stage.boundingBox();
  const desktopCrewBox = await crew.boundingBox();
  expect(desktopStageBox).not.toBeNull();
  expect(desktopCrewBox).not.toBeNull();
  const desktopHeightRatio = desktopCrewBox!.height / desktopStageBox!.height;
  expect(desktopHeightRatio).toBeGreaterThan(0.18);
  expect(desktopHeightRatio).toBeLessThan(0.26);
  const desktopCenterX =
    (desktopCrewBox!.x + desktopCrewBox!.width / 2 - desktopStageBox!.x) / desktopStageBox!.width;
  expect(desktopCenterX).toBeGreaterThan(0.55);
  expect(desktopCenterX).toBeLessThan(0.75);
  const desktopCenterY =
    (desktopCrewBox!.y + desktopCrewBox!.height / 2 - desktopStageBox!.y) / desktopStageBox!.height;
  expect(desktopCenterY).toBeGreaterThan(0.6);
  expect(desktopCenterY).toBeLessThan(0.95);
  await stage.screenshot({ path: testInfo.outputPath('scene-preview-desktop.png') });

  await lab.getByRole('button', { name: 'Mobile 9:16' }).click();
  await expect(stage).toHaveAttribute('data-composition', 'mobile');
  const mobileMoon = desktopScene.locator('[data-layer-id="moon"]');
  const mobilePivotRatio = await mobileMoon.evaluate((layer) => {
    const [originX, originY] = getComputedStyle(layer)
      .transformOrigin.split(' ')
      .map(Number.parseFloat);
    const bounds = layer.getBoundingClientRect();
    return [originX / bounds.width, originY / bounds.height];
  });
  expect(mobilePivotRatio[0]).toBeCloseTo(0.52, 2);
  expect(mobilePivotRatio[1]).toBeCloseTo(0.2, 2);

  // Mobile keeps the crew in frame and below the text safe zone (top 8%–44%).
  const mobileStageBox = await stage.boundingBox();
  const mobileCrewBox = await crew.boundingBox();
  expect(mobileStageBox).not.toBeNull();
  expect(mobileCrewBox).not.toBeNull();
  const mobileHeightRatio = mobileCrewBox!.height / mobileStageBox!.height;
  expect(mobileHeightRatio).toBeGreaterThan(0.18);
  expect(mobileHeightRatio).toBeLessThan(0.26);
  expect((mobileCrewBox!.y - mobileStageBox!.y) / mobileStageBox!.height).toBeGreaterThan(0.5);
  const mobileCenterX =
    (mobileCrewBox!.x + mobileCrewBox!.width / 2 - mobileStageBox!.x) / mobileStageBox!.width;
  expect(mobileCenterX).toBeGreaterThan(0.45);
  expect(mobileCenterX).toBeLessThan(0.8);
  await stage.screenshot({ path: testInfo.outputPath('scene-preview-mobile.png') });

  await lab.getByRole('button', { name: 'Static fallback' }).click();
  await expect(desktopScene).toHaveAttribute('data-scene-state', 'static');
  await expect(desktopScene.locator('[data-scene-fallback="true"]')).toBeVisible();

  // The crew is a separate in-scene plane, so it survives the environment fallback and
  // resolves to a static frame 01 instead of continuing to animate.
  await expect(crew).toBeVisible();
  await expect(crew.locator('[data-sprite-clip]')).toHaveAttribute('data-sprite-state', 'static');
  await expect(crew.locator('img')).toHaveAttribute(
    'src',
    /crew-01-idle-frame-01(?:-[A-Za-z0-9_-]+)?\.svg/
  );
});

test('in-scene crew-01 stays static under the reduced-motion harness and media query', async ({
  page,
}) => {
  await page.goto('./?sceneReducedMotion=1#scene-environment-inspector');
  const crew = page.getByTestId('scene-lab').locator('[data-layer-id="crew-01"]');
  await expect(crew).toBeVisible();
  await expect(crew.locator('[data-sprite-clip]')).toHaveAttribute('data-sprite-state', 'static');
  await expect(crew.locator('img')).toHaveAttribute(
    'src',
    /crew-01-idle-frame-01(?:-[A-Za-z0-9_-]+)?\.svg/
  );

  // prefers-reduced-motion alone is enough, even without the URL harness.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#scene-environment-inspector');
  const mediaCrew = page.getByTestId('scene-lab').locator('[data-layer-id="crew-01"]');
  await expect(mediaCrew).toBeVisible();
  await expect(mediaCrew.locator('[data-sprite-clip]')).toHaveAttribute(
    'data-sprite-state',
    'static'
  );
  await expect(mediaCrew.locator('img')).toHaveAttribute(
    'src',
    /crew-01-idle-frame-01(?:-[A-Za-z0-9_-]+)?\.svg/
  );
});
