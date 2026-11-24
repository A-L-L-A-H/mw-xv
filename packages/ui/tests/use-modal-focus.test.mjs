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
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.Node = dom.window.Node;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function getVisibleClientRects(element) {
  let current = element;
  while (current) {
    if (
      current.hidden ||
      current.getAttribute('aria-hidden') === 'true' ||
      current.hasAttribute('inert') ||
      dom.window.getComputedStyle(current).display === 'none'
    ) {
      return [];
    }
    current = current.parentElement;
  }
  const closedDetails = element.closest('details:not([open])');
  if (closedDetails && !closedDetails.querySelector('summary')?.contains(element)) return [];
  return [{}];
}

// JSDOM has no layout engine. Model visible boxes while retaining hidden-state checks.
Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', {
  configurable: true,
  value() {
    return getVisibleClientRects(this);
  },
});

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

test('nested modals dismiss only the top modal and share a reference-counted body lock', async () => {
  let outerDismissals = 0;
  let innerDismissals = 0;
  const outer = React.createElement(Modal, {
    key: 'outer',
    onDismiss: () => (outerDismissals += 1),
  });
  const inner = React.createElement(
    Modal,
    { key: 'inner', onDismiss: () => (innerDismissals += 1) },
    [
      React.createElement('button', { id: 'inner-first', key: 'first' }, 'Inner first'),
      React.createElement('button', { id: 'inner-last', key: 'last' }, 'Inner last'),
    ]
  );

  await act(async () => root.render(React.createElement(React.Fragment, null, outer)));
  assert.equal(document.body.style.overflow, 'hidden');
  document.getElementById('second').focus();

  await act(async () =>
    root.render(React.createElement(React.Fragment, null, outer, inner))
  );
  assert.equal(document.activeElement.id, 'inner-first');
  assert.equal(document.body.style.overflow, 'hidden');

  await act(async () => {
    const event = pressKey('Escape');
    assert.equal(event.defaultPrevented, true);
  });
  assert.equal(innerDismissals, 1);
  assert.equal(outerDismissals, 0);

  await act(async () => root.render(React.createElement(React.Fragment, null, outer)));
  assert.equal(document.activeElement.id, 'second');
  assert.equal(document.body.style.overflow, 'hidden');

  await act(async () => root.render(null));
  assert.equal(document.body.style.overflow, 'scroll');
  assert.equal(document.activeElement.id, 'opener');
});

test('a non-dismissible top modal blocks Escape from reaching the modal below it', async () => {
  let outerDismissals = 0;
  const outer = React.createElement(Modal, {
    key: 'outer',
    onDismiss: () => (outerDismissals += 1),
  });
  const inner = React.createElement(Modal, { key: 'inner' }, []);

  await act(async () =>
    root.render(React.createElement(React.Fragment, null, outer, inner))
  );
  await act(async () => {
    const event = pressKey('Escape');
    assert.equal(event.defaultPrevented, true);
  });
  assert.equal(outerDismissals, 0);
});

test('focus trapping excludes disabled, hidden, inert, closed-details, and negative-tabindex controls', async () => {
  const children = [
    React.createElement('button', { id: 'visible-first', key: 'first' }, 'First'),
    React.createElement('button', { id: 'disabled', disabled: true, key: 'disabled' }, 'Disabled'),
    React.createElement('button', { id: 'negative', tabIndex: -1, key: 'negative' }, 'Negative'),
    React.createElement('button', { id: 'hidden', hidden: true, key: 'hidden' }, 'Hidden'),
    React.createElement('button', {
      id: 'display-none',
      style: { display: 'none' },
      key: 'display-none',
    }, 'Display none'),
    React.createElement('button', {
      id: 'visibility-hidden',
      style: { visibility: 'hidden' },
      key: 'visibility-hidden',
    }, 'Visibility hidden'),
    React.createElement(
      'div',
      { id: 'inert-parent', inert: true, key: 'inert-parent' },
      React.createElement('button', { id: 'inert' }, 'Inert')
    ),
    React.createElement(
      'fieldset',
      { disabled: true, key: 'fieldset' },
      React.createElement('button', { id: 'fieldset-disabled' }, 'Fieldset disabled')
    ),
    React.createElement(
      'details',
      { key: 'details' },
      React.createElement('summary', { id: 'summary' }, 'Summary'),
      React.createElement('button', { id: 'closed-details' }, 'Closed details')
    ),
    React.createElement('button', { id: 'visible-last', key: 'last' }, 'Last'),
  ];

  await act(async () => root.render(React.createElement(Modal, {}, children)));
  assert.equal(document.activeElement.id, 'visible-first');
  document.getElementById('visible-first').focus();
  await act(async () => pressKey('Tab', { shiftKey: true }));
  assert.equal(document.activeElement.id, 'visible-last');
  document.getElementById('visible-last').focus();
  await act(async () => pressKey('Tab'));
  assert.equal(document.activeElement.id, 'visible-first');
});

test('focus restoration skips an opener that was removed or became unavailable', async () => {
  await act(async () => root.render(React.createElement(Modal)));
  document.getElementById('opener').remove();
  await act(async () => root.render(null));
  assert.notEqual(document.activeElement, document.getElementById('opener'));
  assert.equal(document.activeElement, document.body);

  const replacement = document.createElement('button');
  replacement.id = 'replacement';
  replacement.style.display = 'none';
  document.body.append(replacement);
  replacement.focus();
  await act(async () => root.render(React.createElement(Modal)));
  await act(async () => root.render(null));
  assert.notEqual(document.activeElement, replacement);
  replacement.remove();
});
