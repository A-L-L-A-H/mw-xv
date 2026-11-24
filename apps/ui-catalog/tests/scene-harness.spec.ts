import { expect, test } from '@playwright/test';

test('environment depth inspector toggles and reorders planes and reflows on mobile (W4-008, W1-006)', async ({
  page,
}) => {
  await page.goto('./#scene-environment-inspector');
  const lab = page.getByTestId('scene-lab');
  await expect(lab).toBeVisible();
  await expect(lab.locator('[data-scene-id="moon-city-hero"]')).toBeVisible();
  await expect(lab.locator('[data-layer-id]')).toHaveCount(9);

  // Toggle off one plane
  await lab.locator('li[data-plane-id="prop-wires"] input[type="checkbox"]').uncheck();
  await expect(lab.locator('[data-layer-id]')).toHaveCount(8);

  // Reorder planes (move moon backward behind sky)
  await lab.locator('li[data-plane-id="moon"] button', { hasText: 'Back' }).click();
  await expect(lab.locator('li[data-plane-id="moon"]')).toHaveAttribute('data-plane-order', '0');

  // Switch responsive composition to Mobile 9:16 and verify safe guides + breakpoint overrides
  await lab.getByRole('button', { name: 'Mobile 9:16' }).click();
  await expect(lab.locator('.scene-lab-stage')).toHaveAttribute('data-composition', 'mobile');
  await expect(lab.getByTestId('scene-safe-guides')).toBeVisible();

  // Narrow viewport usability check (390px)
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
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

test('environment inspector resets layer visibility, z-order and composition to the canonical baseline (W7-004)', async ({ page }) => {
  await page.goto('./#scene-environment-inspector');
  const lab = page.getByTestId('scene-lab');
  await lab.locator('li[data-plane-id="prop-wires"] input[type="checkbox"]').uncheck();
  await lab.getByRole('button', { name: 'Mobile 9:16' }).click();
  await lab.getByRole('button', { name: 'Reset inspector' }).click();
  await expect(lab.locator('[data-layer-id]')).toHaveCount(9);
  await expect(lab.locator('[data-layer-id="sky"]')).toBeVisible();
  await expect(lab.locator('.scene-lab-stage')).toHaveAttribute('data-composition', 'desktop');
});

test('character studio plays, pauses and resets imported clip frames when motion is allowed (W7-003)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#character-preview');
  await expect(
    page.getByText(/Catalog-only fictional example\. crew-01 is not a real crew member/u)
  ).toBeVisible();
  const specimen = page.getByTestId('character-preview-specimen');
  const player = specimen.locator('[data-sprite-clip="animation/crew-01-idle/crew-01-idle-clip.json"]');
  await expect(player).toHaveAttribute('data-sprite-state', 'paused');
  await specimen.getByRole('button', { name: 'Play' }).first().click();
  await expect(player).toHaveAttribute('data-sprite-state', 'playing');
  await specimen.getByRole('button', { name: 'Pause' }).first().click();
  await expect(player).toHaveAttribute('data-sprite-state', 'paused');
  await specimen.getByRole('button', { name: 'Reset' }).first().click();
  await expect(specimen.getByRole('button', { name: 'Play' }).first()).toBeVisible();
});

test('character studio starts static for reduced motion and offers explicit preview playback (W7-003)', async ({ page }) => {
  await page.goto('./#character-preview');
  const specimen = page.getByTestId('character-preview-specimen');
  const player = specimen.locator('[data-sprite-clip="animation/crew-01-idle/crew-01-idle-clip.json"]');
  await expect(player).toHaveAttribute('data-sprite-state', 'static');
  await expect(specimen.getByRole('button', { name: 'Reduced motion on' }).first()).toHaveAttribute('aria-pressed', 'true');
  await specimen.getByRole('button', { name: 'Play' }).first().click();
  await expect(player).toHaveAttribute('data-sprite-state', 'playing');
});

test('asset diagnostics loads and exports the build-time validator report (W7-007)', async ({ page }) => {
  await page.goto('./#asset-diagnostics');
  const panel = page.getByTestId('asset-diagnostics');
  await expect(panel.getByRole('button', { name: 'Export report' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Load build diagnostics' }).click();
  await expect(panel.getByText('Build diagnostics: passed; scene validation: passed.')).toBeVisible();
  await expect(panel.locator('.auth-coverage-facts')).toContainText('Asset QA errors0');
  await expect(panel.locator('.auth-coverage-facts')).toContainText('Scene validation errors0');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export report' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('moonwitness-asset-diagnostics.json');
});

test('scene inspector captures desktop/mobile compositions and reduced-motion fallback (W7-006)', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#scene-environment-inspector');
  const lab = page.getByTestId('scene-lab');
  const stage = lab.locator('.scene-lab-stage');
  const desktopScene = lab.locator('[data-scene-id="moon-city-hero"]');
  await expect(stage).toHaveAttribute('data-composition', 'desktop');
  const desktopMoon = desktopScene.locator('[data-layer-id="moon"]');
  const desktopPivotRatio = await desktopMoon.evaluate((layer) => {
    const [originX, originY] = getComputedStyle(layer).transformOrigin.split(' ').map(Number.parseFloat);
    const bounds = layer.getBoundingClientRect();
    return [originX / bounds.width, originY / bounds.height];
  });
  expect(desktopPivotRatio[0]).toBeCloseTo(0.72, 2);
  expect(desktopPivotRatio[1]).toBeCloseTo(0.24, 2);
  await stage.scrollIntoViewIfNeeded();
  await stage.screenshot({ path: testInfo.outputPath('scene-preview-desktop.png') });

  await lab.getByRole('button', { name: 'Mobile 9:16' }).click();
  await expect(stage).toHaveAttribute('data-composition', 'mobile');
  const mobileMoon = desktopScene.locator('[data-layer-id="moon"]');
  const mobilePivotRatio = await mobileMoon.evaluate((layer) => {
    const [originX, originY] = getComputedStyle(layer).transformOrigin.split(' ').map(Number.parseFloat);
    const bounds = layer.getBoundingClientRect();
    return [originX / bounds.width, originY / bounds.height];
  });
  expect(mobilePivotRatio[0]).toBeCloseTo(0.52, 2);
  expect(mobilePivotRatio[1]).toBeCloseTo(0.2, 2);
  await stage.screenshot({ path: testInfo.outputPath('scene-preview-mobile.png') });

  await lab.getByRole('button', { name: 'Static fallback' }).click();
  await expect(desktopScene).toHaveAttribute('data-scene-state', 'static');
  await expect(desktopScene.locator('[data-scene-fallback="true"]')).toBeVisible();
});
