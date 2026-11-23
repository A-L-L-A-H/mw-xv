import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM(
  '<!doctype html><html><body><button id="opener">Open</button><div id="root"></div></body></html>',
  { url: 'http://localhost/' }
);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import('react-dom/client');
const { useModalFocus } = await import('../dist/lib/use-modal-focus.js');

let root;

function Modal({ onDismiss, children }) {
  const ref = useModalFocus(onDismiss);
  return React.createElement(
    'div',
    { ref, tabIndex: -1, 'data-slot': 'modal' },
    children ?? [
      React.createElement('button', { id: 'first', key: 'first' }, 'First'),
      React.createElement('button', { id: 'second', key: 'second' }, 'Second'),
      React.createElement(
        'button',
        { id: 'hidden', key: 'hidden', 'aria-hidden': 'true' },
        'Hidden'
      ),
    ]
  );
}

beforeEach(() => {
  document.body.style.overflow = 'scroll';
  document.getElementById('opener').focus();
  root = createRoot(document.getElementById('root'));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function act(callback) {
  const react = await import('react');
  return react.act(callback);
}

function pressKey(key, options = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  document.dispatchEvent(event);
  return event;
}

test('focuses the first control, locks scroll, and restores focus on close', async () => {
  await act(async () => {
    root.render(React.createElement(Modal, {}));
  });

  assert.equal(document.activeElement.id, 'first');
  assert.equal(document.body.style.overflow, 'hidden');

  await act(async () => {
    root.render(null);
  });

  assert.equal(document.activeElement.id, 'opener');
  assert.equal(document.body.style.overflow, 'scroll');
});

test('traps Tab and Shift+Tab inside the dialog and skips aria-hidden controls', async () => {
  await act(async () => {
    root.render(React.createElement(Modal, {}));
  });

  document.getElementById('second').focus();
  await act(async () => {
    const event = pressKey('Tab');
    assert.equal(event.defaultPrevented, true);
  });
  assert.equal(document.activeElement.id, 'first');

  await act(async () => {
    const event = pressKey('Tab', { shiftKey: true });
    assert.equal(event.defaultPrevented, true);
  });
  assert.equal(document.activeElement.id, 'second');
});

test('Escape dismisses once and prevents the default event', async () => {
  let dismissals = 0;
  await act(async () => {
    root.render(React.createElement(Modal, { onDismiss: () => (dismissals += 1) }));
  });

  await act(async () => {
    const event = pressKey('Escape');
    assert.equal(event.defaultPrevented, true);
  });

  assert.equal(dismissals, 1);
});

test('a dialog without focusable controls keeps focus on its container', async () => {
  await act(async () => {
    root.render(React.createElement(Modal, {}, []));
  });

  assert.equal(document.activeElement.getAttribute('data-slot'), 'modal');
  await act(async () => {
    const event = pressKey('Tab');
    assert.equal(event.defaultPrevented, true);
  });
  assert.equal(document.activeElement.getAttribute('data-slot'), 'modal');
});
