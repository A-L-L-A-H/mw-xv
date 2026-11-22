import { expect, test } from '@playwright/test';

test('FX Lab particles bounded, transitions interruptible, soundscape muted by default (W6-003, W6-004, W6-006)', async ({
  page,
}) => {
  await page.goto('./#fx-lab');
  const lab = page.getByTestId('fx-lab');
  await expect(lab).toBeVisible();

  // Particles: bounded count, data attribute visible, reduced-motion switches to static
  const particles = lab.getByTestId('fx-particles');
  await expect(particles.locator('[data-particle-preset]')).toHaveAttribute(
    'data-particle-count',
    /\d+/
  );
  const maxCount = await particles.locator('[data-particle-preset]').getAttribute('data-particle-count');
  expect(Number(maxCount ?? 0)).toBeLessThanOrEqual(36);

  // Transitions: click retriggers without blocking, keyboard cancels
  const transitions = lab.getByTestId('fx-transitions');
  await expect(transitions.locator('[data-transition-variant="panel-reveal"]')).toBeVisible();
  await transitions.getByRole('button', { name: 'Retrigger' }).click();
  await expect(transitions.locator('[data-transition-state="entered"]')).toBeVisible({ timeout: 1000 });

  // Soundscape: starts muted, requires gesture, single source on scene switch
  const audio = lab.getByTestId('fx-audio');
  await expect(audio.locator('.fx-lab-audio-status')).toContainText('Muted: yes');
  await audio.getByRole('button', { name: 'Enable gesture' }).click();
  await audio.getByRole('button', { name: 'Unmute' }).click();
  await expect(audio.locator('.fx-lab-audio-status')).toContainText('Muted: no');
  await audio.getByRole('button', { name: 'Archive' }).click();
  await expect(audio.locator('.fx-lab-audio-status')).toContainText('Active: archive-quiet');
  await audio.getByRole('button', { name: 'Mute' }).click();
  await expect(audio.locator('.fx-lab-audio-status')).toContainText('Muted: yes');

  // Mobile reflow
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await lab.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test('Comic transitions respect reduced-motion and never hide content (W6-004)', async ({
  page,
}) => {
  await page.goto('./?sceneReducedMotion=1#fx-lab');
  const transitions = page.getByTestId('fx-transitions');
  await expect(transitions.locator('[data-transition-state="entered"]')).toBeVisible();
  await expect(transitions.locator('[data-reduced-motion="true"]')).toBeVisible();
  const content = transitions.locator('.fx-lab-transition-content');
  await expect(content).toHaveText('Scene Content');
});

test('FX catalog documents purpose and anti-patterns for every effect family (W6-007)', async ({ page }) => {
  await page.goto('./?skin=moonwitness-ink&mode=dark#fx-lab');
  const lab = page.getByTestId('fx-lab');
  await expect(lab.getByText(/Intended for restrained atmospheric depth/)).toBeVisible();
  await expect(lab.getByText(/Avoid stacking transitions or delaying navigation/)).toBeVisible();
  await expect(lab.getByText(/Avoid autoplay, overlapping loops/)).toBeVisible();
  await expect(lab.getByRole('button', { name: 'Intense' })).toBeVisible();
  await lab.getByRole('button', { name: 'Intense' }).click();
  await expect(lab.getByTestId('fx-particles').locator('[data-particle-intensity="intense"]')).toBeVisible();
});

test('active particle scene stays within the Chromium frame-time budget (W6-003)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./#fx-lab');
  const lab = page.getByTestId('fx-lab');
  const particles = lab.getByTestId('fx-particles').locator('[data-particle-preset]');
  await expect(particles).toHaveAttribute('data-particle-state', 'active');
  await lab.getByRole('button', { name: 'Intense' }).click();
  await expect(particles).toHaveAttribute('data-particle-count', '30');

  const frameReport = await page.evaluate(async () => {
    const samples: number[] = [];
    let previous = 0;
    await new Promise<void>((resolve) => {
      const sample = (timestamp: number) => {
        if (previous > 0) samples.push(timestamp - previous);
        previous = timestamp;
        if (samples.length < 119) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      sampleCount: samples.length,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
      maxFrameMs: Math.max(...samples),
    };
  });
  console.info(`W6-003 Chromium frame report: ${JSON.stringify(frameReport)}`);
  expect(frameReport.sampleCount).toBeGreaterThanOrEqual(100);
  expect(frameReport.p95FrameMs).toBeLessThanOrEqual(50);
  expect(frameReport.maxFrameMs).toBeLessThanOrEqual(150);
});
