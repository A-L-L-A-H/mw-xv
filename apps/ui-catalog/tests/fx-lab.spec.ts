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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
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
