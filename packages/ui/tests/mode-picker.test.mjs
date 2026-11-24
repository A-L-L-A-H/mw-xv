import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import('react-dom/client');
const { ModePicker } = await import('../dist/components/mode-picker.js');
let root;

beforeEach(() => {
  root = createRoot(document.getElementById('root'));
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  document.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
});

test('ModePicker renders an accessible Radix dialog with both experience options', async () => {
  await React.act(async () => {
    root.render(React.createElement(ModePicker, { onSelect: () => {} }));
  });

  const dialog = document.querySelector('[data-slot="mode-picker"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const title = document.getElementById(dialog.getAttribute('aria-labelledby'));
  const description = document.getElementById(dialog.getAttribute('aria-describedby'));
  assert.equal(title.tagName, 'H2');
  assert.equal(title.textContent, 'Choose Your Desktop Experience');
  assert.match(description.textContent, /Pick the workspace layout/);
  assert.match(dialog.textContent, /Workspace/);
  assert.match(dialog.textContent, /DX \/ Developer/);
  assert.match(dialog.textContent, /Offline-first, zero technical clutter/);
  assert.match(dialog.textContent, /Full AI Mission Control/);
  assert.ok(dialog.querySelector('[data-mode-option="workspace"]'));
  assert.ok(dialog.querySelector('[data-mode-option="developer"]'));
});

test('ModePicker marks the active mode and dismisses through its accessible close button', async () => {
  let dismissals = 0;
  await React.act(async () => {
    root.render(
      React.createElement(ModePicker, {
        currentMode: 'workspace',
        onSelect: () => {},
        onDismiss: () => (dismissals += 1),
      })
    );
  });

  assert.equal(
    document
      .querySelector('[data-mode-option="workspace"]')
      .getAttribute('data-selected'),
    'true'
  );
  assert.equal(
    document
      .querySelector('[data-mode-option="developer"]')
      .getAttribute('data-selected'),
    'false'
  );
  const activeButton = [...document.querySelectorAll('button')].find((button) =>
    button.textContent.includes('Active: Workspace')
  );
  assert.equal(activeButton.getAttribute('aria-pressed'), 'true');

  const closeButton = document.querySelector('button[aria-label="Close mode selector"]');
  await React.act(async () => {
    closeButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.equal(dismissals, 1);
});

test('ModePicker keeps separate instances free of hardcoded title and description IDs', async () => {
  await React.act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ModePicker, { title: 'First picker', onSelect: () => {} }),
        React.createElement(ModePicker, { title: 'Second picker', onSelect: () => {} })
      )
    );
  });

  const dialogs = [...document.querySelectorAll('[data-slot="mode-picker"]')];
  assert.equal(dialogs.length, 2);
  assert.notEqual(dialogs[0].getAttribute('aria-labelledby'), dialogs[1].getAttribute('aria-labelledby'));
  assert.notEqual(
    dialogs[0].getAttribute('aria-describedby'),
    dialogs[1].getAttribute('aria-describedby')
  );
});
