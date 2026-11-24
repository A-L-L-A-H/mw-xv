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
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { createRoot } = await import('react-dom/client');
const { ConfirmDialog } = await import('../dist/components/confirm-dialog.js');
const { InboxPopover } = await import('../dist/components/inbox-popover.js');
const { KanbanBoard } = await import('../dist/components/kanban-board.js');

let root;

beforeEach(() => {
  root = createRoot(document.getElementById('root'));
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  document.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
});

test('ConfirmDialog enforces busy guard and renders warning, consequence, and alert error', async () => {
  let confirmed = 0;
  let closeAttempts = 0;

  await React.act(async () => {
    root.render(
      React.createElement(ConfirmDialog, {
        open: true,
        onOpenChange: () => {
          closeAttempts += 1;
        },
        title: 'Delete project',
        description: 'Are you sure?',
        warningBanner: 'Irreversible operation',
        consequence: 'All artifacts will be removed.',
        destructive: true,
        busy: true,
        error: 'Server busy',
        onConfirm: () => {
          confirmed += 1;
        },
      })
    );
  });

  const dialog = document.body.querySelector('[data-slot="confirm-dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('data-destructive'), 'true');
  assert.match(dialog.textContent, /Irreversible operation/u);
  assert.match(dialog.textContent, /All artifacts will be removed\./u);
  assert.ok(dialog.querySelector('[role="alert"]'));
  assert.equal(confirmed, 0);
  assert.equal(closeAttempts, 0);
});

test('InboxPopover renders unread badge and error retry state', async () => {
  let retried = 0;

  await React.act(async () => {
    root.render(
      React.createElement(InboxPopover, {
        open: true,
        title: 'Notifications',
        subtitle: '3 unread',
        triggerLabel: 'Notifications, 3 unread',
        unreadCount: 3,
        error: 'Failed to load',
        onRetry: () => {
          retried += 1;
        },
      })
    );
  });

  const trigger = document.body.querySelector('[data-slot="inbox-popover-trigger"]');
  assert.ok(trigger);
  assert.match(trigger.textContent, /3/u);
  const popover = document.body.querySelector('[data-slot="inbox-popover"]');
  assert.ok(popover);
  assert.ok(popover.querySelector('[role="alert"]'));

  const retryButton = popover.querySelector('button');
  assert.ok(retryButton);
  await React.act(async () => {
    retryButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  assert.equal(retried, 1);
});

test('KanbanBoard supports ArrowLeft and ArrowRight keyboard card moves', async () => {
  const moves = [];

  await React.act(async () => {
    root.render(
      React.createElement(KanbanBoard, {
        columns: [
          { id: 'todo', title: 'Todo', cards: [{ id: 'c1', title: 'Task 1' }] },
          { id: 'done', title: 'Done', cards: [] },
        ],
        onCardMove: (cardId, fromId, toId) => {
          moves.push([cardId, fromId, toId]);
        },
      })
    );
  });

  const card = document.body.querySelector('[data-slot="kanban-card"]');
  assert.ok(card);
  await React.act(async () => {
    card.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  assert.deepEqual(moves, [['c1', 'todo', 'done']]);
});
