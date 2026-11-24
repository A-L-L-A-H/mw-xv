import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');

let matchMediaReduced = false;

Object.defineProperty(dom.window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: matchMediaReduced,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener() {},
    removeEventListener() {},
  }),
});

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { EditorialStudioPanel } = await import(
  '../src/components/creative/editorial-studio-panel.tsx'
);

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
  assert.ok(setter, 'Expected HTMLInputElement value setter');
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

test('EditorialStudioPanel drives Kuro expressions (0/4 -> 4/4) and unlocks badges at 4/4', async () => {
  matchMediaReduced = false;
  const container = dom.window.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(EditorialStudioPanel));
  });

  const getKuroImageSrc = () =>
    container
      .querySelector('.mw-ui-character-stage[data-character="kuro-signal"] img')
      ?.getAttribute('src') ?? '';

  const questCard = () => container.querySelector('.mw-ui-quest-card')!;
  const badgeArchitect = () =>
    container.querySelector('.mw-ui-achievement-badge[data-badge="badge-story-architect"]')!;
  const badgeZeroDrift = () =>
    container.querySelector('.mw-ui-achievement-badge[data-badge="badge-zero-drift"]')!;

  // Initial state: 1/4 checked ('dna-locked') -> curious
  assert.match(getKuroImageSrc(), /kuro-signal-expression-curious/u);
  assert.equal(questCard().getAttribute('data-status'), 'active');
  assert.match(questCard().textContent ?? '', /1\/4 steps \(25%\)/u);
  assert.equal(badgeArchitect().getAttribute('data-unlocked'), 'false');
  assert.equal(badgeZeroDrift().getAttribute('data-unlocked'), 'false');

  const toggleCheckbox = async (id: string) => {
    const box = container.querySelector<HTMLInputElement>(`#${id}`)!;
    assert.ok(box, `Expected checkbox #${id}`);
    await act(async () => {
      box.click();
    });
  };

  // Uncheck 'dna-locked' -> 0/4 -> thinking
  await toggleCheckbox('check-dna-locked');
  assert.match(getKuroImageSrc(), /kuro-signal-expression-thinking/u);
  assert.match(questCard().textContent ?? '', /0\/4 steps \(0%\)/u);
  assert.match(container.textContent ?? '', /0\/4 gates verified/u);

  // Check 1 -> curious, Check 2 -> excited
  await toggleCheckbox('check-dna-locked');
  assert.match(getKuroImageSrc(), /kuro-signal-expression-curious/u);

  await toggleCheckbox('check-typography');
  assert.match(getKuroImageSrc(), /kuro-signal-expression-excited/u);
  assert.match(questCard().textContent ?? '', /2\/4 steps \(50%\)/u);

  // Check 3 -> still excited
  await toggleCheckbox('check-provenance');
  assert.match(getKuroImageSrc(), /kuro-signal-expression-excited/u);
  assert.equal(badgeArchitect().getAttribute('data-unlocked'), 'false');

  // Check 4 -> celebrating & unlocks both badges + completed quest
  await toggleCheckbox('check-preflight');
  assert.match(getKuroImageSrc(), /kuro-signal-expression-celebrating/u);
  assert.equal(questCard().getAttribute('data-status'), 'completed');
  assert.match(questCard().textContent ?? '', /4\/4 steps \(100%\)/u);
  assert.equal(badgeArchitect().getAttribute('data-unlocked'), 'true');
  assert.equal(badgeZeroDrift().getAttribute('data-unlocked'), 'true');

  // Toggle animated clip on -> mounts SpritePlayer with kuro-signal-celebrate
  const clipToggle = Array.from(container.querySelectorAll('button')).find((btn) =>
    /Play celebrate Clip/u.test(btn.textContent ?? '')
  );
  assert.ok(clipToggle, 'Expected Play celebrate Clip toggle button');
  await act(async () => {
    clipToggle.click();
  });
  const sprite = container.querySelector('[data-sprite-clip="kuro-signal-celebrate"]');
  assert.ok(sprite, 'Expected SpritePlayer to mount kuro-signal-celebrate clip');

  await act(async () => {
    root.unmount();
  });
});

test('EditorialStudioPanel respects reduced motion when animation clip is toggled', async () => {
  matchMediaReduced = true;
  const container = dom.window.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(EditorialStudioPanel));
  });

  const clipToggle = Array.from(container.querySelectorAll('button')).find((btn) =>
    /Play idle Clip/u.test(btn.textContent ?? '')
  );
  assert.ok(clipToggle);
  await act(async () => {
    clipToggle.click();
  });

  const stage = container.querySelector('.mw-ui-character-stage[data-character="kuro-signal"]')!;
  assert.equal(stage.getAttribute('data-reduced-motion'), 'true');
  assert.equal(stage.getAttribute('data-animated'), 'false');
  assert.equal(container.querySelector('[data-sprite-clip]'), null);

  await act(async () => {
    root.unmount();
  });
});

test('EditorialStudioPanel Asmaul Husna explorer renders EmptyState on zero search results and resets filters', async () => {
  matchMediaReduced = false;
  const container = dom.window.document.getElementById('root')!;
  container.innerHTML = '';
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(EditorialStudioPanel));
  });

  const asmaulTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) =>
    /Asmaul Husna Concept Explorer/u.test(tab.textContent ?? '')
  ) as HTMLElement | undefined;
  assert.ok(asmaulTab, 'Expected Asmaul Husna Concept Explorer tab');

  await act(async () => {
    asmaulTab.dispatchEvent(
      new dom.window.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: false,
        view: dom.window as unknown as Window,
      })
    );
    asmaulTab.click();
  });
  assert.equal(asmaulTab.getAttribute('aria-selected'), 'true');

  const searchInput = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search Asmaul Husna concepts"]'
  );
  assert.ok(searchInput, 'Expected Asmaul Husna search input');

  await act(async () => {
    setInputValue(searchInput, 'zzz-nonexistent-asmaul-term');
  });

  const emptyState = container.querySelector('.mw-ui-empty-state');
  assert.ok(emptyState, 'Expected EmptyState when search yields 0 concepts');
  assert.match(emptyState.innerHTML, /state-no-search-results\.webp/u);
  assert.match(container.textContent ?? '', /0 \/ 12/u);

  const resetButton = Array.from(emptyState.querySelectorAll('button')).find((btn) =>
    /Reset Filters/u.test(btn.textContent ?? '')
  );
  assert.ok(resetButton, 'Expected Reset Filters button inside EmptyState');

  await act(async () => {
    resetButton.click();
  });

  assert.equal(container.querySelector('.mw-ui-empty-state'), null);
  assert.match(container.textContent ?? '', /12 \/ 12/u);
  assert.match(container.textContent ?? '', /Ar-Rahman/u);

  await act(async () => {
    root.unmount();
  });
});
