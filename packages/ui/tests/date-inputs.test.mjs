import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatePicker } from '../dist/components/date-picker.js';
import { NumberInput, parseNumber } from '../dist/components/number-input.js';
import { TagInput } from '../dist/components/tag-input.js';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.Node = dom.window.Node;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
});

const { createRoot } = await import('react-dom/client');
let root;
let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function setInputValue(input, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function pressKey(input, key, options = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  await act(async () => input.dispatchEvent(event));
  return event;
}

function TagsHarness({ initialValue = [], onChange = () => {} }) {
  const [value, setValue] = useState(initialValue);
  return createElement(
    'form',
    { id: 'tags-form' },
    createElement(TagInput, {
      id: 'topics',
      name: 'topics',
      label: 'Topics',
      required: true,
      value,
      onValueChange: (nextValue) => {
        onChange(nextValue);
        setValue(nextValue);
      },
    })
  );
}

test('date picker associates label, description, and error with native controls', () => {
  const html = renderToStaticMarkup(
    createElement(DatePicker, {
      id: 'started',
      label: 'Started',
      value: { date: '2026-11-22', time: '10:30' },
      includeTime: true,
      required: true,
      error: 'Enter a valid date',
      description: 'Jakarta time',
    })
  );

  assert.match(html, /<label[^>]*for="started"[^>]*>Started/u);
  assert.match(html, /id="started"[^>]*type="date"[^>]*value="2026-11-22"/u);
  assert.match(html, /type="time"[^>]*value="10:30"/u);
  assert.match(html, /aria-invalid="true"/u);
  assert.match(html, /aria-describedby="started-description started-error"/u);
  assert.match(html, /role="alert"/u);
});

test('number input renders decimal, currency, and disabled state', () => {
  const html = renderToStaticMarkup(
    createElement(NumberInput, {
      id: 'amount',
      label: 'Amount',
      value: 1234.5,
      currency: 'IDR',
      step: 0.01,
      disabled: true,
    })
  );

  assert.match(html, /id="amount"[^>]*type="number"[^>]*value="1234\.5"/u);
  assert.match(html, /data-currency="IDR"/u);
  assert.match(html, /disabled=""/u);
});

test('tag input renders keyboard-accessible removable tags', () => {
  const html = renderToStaticMarkup(
    createElement(TagInput, {
      id: 'topics',
      label: 'Topics',
      value: ['moon', 'ink'],
      onValueChange: () => {},
    })
  );

  assert.match(html, /aria-label="Remove moon"/u);
  assert.match(html, /aria-label="Remove ink"/u);
  assert.match(html, /<li class="mw-ui-tag">/u);
});

test('date picker treats undefined as uncontrolled and preserves changes between date and time', async () => {
  const changes = [];
  await act(async () => {
    root.render(
      createElement(DatePicker, {
        id: 'schedule',
        name: 'schedule',
        label: 'Schedule',
        includeTime: true,
        onValueChange: (value) => changes.push(value),
      })
    );
  });
  const date = container.querySelector('input[type="date"]');
  const time = container.querySelector('input[type="time"]');
  assert.equal(date.value, '');
  assert.equal(time.value, '');

  await setInputValue(date, '2024-02-29');
  assert.equal(date.value, '2024-02-29');
  await setInputValue(time, '09:30');
  assert.equal(time.value, '09:30');
  assert.deepEqual(changes.at(-1), { date: '2024-02-29', time: '09:30' });

  await setInputValue(date, '');
  assert.equal(date.value, '');
  assert.equal(time.value, '');
  assert.equal(changes.at(-1), null);
});

test('number input treats undefined as uncontrolled and null as controlled empty', async () => {
  const uncontrolledChanges = [];
  await act(async () => {
    root.render(
      createElement(NumberInput, {
        id: 'quantity',
        label: 'Quantity',
        onValueChange: (value) => uncontrolledChanges.push(value),
      })
    );
  });
  const quantity = container.querySelector('input');
  await setInputValue(quantity, '12.5');
  assert.equal(quantity.value, '12.5');
  assert.equal(uncontrolledChanges.at(-1), 12.5);

  const controlledChanges = [];
  await act(async () => {
    root.render(
      createElement(NumberInput, {
        id: 'quantity',
        label: 'Quantity',
        value: null,
        onValueChange: (value) => controlledChanges.push(value),
      })
    );
  });
  await setInputValue(container.querySelector('input'), '7');
  assert.equal(container.querySelector('input').value, '');
  assert.equal(controlledChanges.at(-1), 7);
});

test('date picker treats null as controlled empty', async () => {
  const changes = [];
  await act(async () => {
    root.render(
      createElement(DatePicker, {
        id: 'due',
        label: 'Due',
        value: null,
        onValueChange: (value) => changes.push(value),
      })
    );
  });
  const input = container.querySelector('input');
  await setInputValue(input, '2026-11-20');
  assert.equal(input.value, '');
  assert.deepEqual(changes.at(-1), { date: '2026-11-20' });
});

test('parseNumber keeps decimal normalization and strict integer validation', () => {
  assert.equal(parseNumber('12,5', false), 12.5);
  assert.equal(parseNumber('-0.25', false), -0.25);
  assert.equal(parseNumber('', false), null);
  assert.equal(parseNumber('01', false), null);
  assert.equal(parseNumber('1.2', true), null);
  assert.equal(parseNumber('12', true), 12);
});

test('tag input serializes committed tags only and keeps its draft unnamed', async () => {
  await act(async () => root.render(createElement(TagsHarness, { initialValue: ['base'] })));
  const input = container.querySelector('input[type="text"]');
  assert.equal(input.name, '');
  assert.equal(input.validationMessage, '');
  await setInputValue(input, 'pending draft');

  const formData = new window.FormData(container.querySelector('form'));
  assert.deepEqual(formData.getAll('topics'), ['base']);
  assert.equal(input.value, 'pending draft');

  await pressKey(input, 'Enter');
  assert.equal(input.value, '');
  assert.deepEqual(new window.FormData(container.querySelector('form')).getAll('topics'), [
    'base',
    'pending draft',
  ]);
});

test('tag input enforces committed-tag required validity without accepting a pending draft', async () => {
  await act(async () => root.render(createElement(TagsHarness)));
  const form = container.querySelector('form');
  const input = container.querySelector('input[type="text"]');
  assert.equal(input.required, false);
  assert.equal(input.validationMessage, 'Add at least one tag.');
  assert.equal(form.checkValidity(), false);

  await setInputValue(input, 'not committed');
  assert.equal(form.checkValidity(), false);
  assert.equal(input.validationMessage, 'Add at least one tag.');

  await pressKey(input, ',');
  assert.equal(input.validationMessage, '');
  assert.equal(form.checkValidity(), true);
  assert.deepEqual(new window.FormData(form).getAll('topics'), ['not committed']);
});

test('tag input ignores commit keys during IME composition', async () => {
  const changes = [];
  await act(async () => {
    root.render(
      createElement(TagsHarness, { initialValue: ['base'], onChange: (v) => changes.push(v) })
    );
  });
  const input = container.querySelector('input[type="text"]');
  await act(async () => {
    input.dispatchEvent(new window.Event('compositionstart', { bubbles: true }));
  });
  await setInputValue(input, '構成');
  const enter = await pressKey(input, 'Enter', { isComposing: true });
  assert.equal(enter.defaultPrevented, false);
  assert.equal(changes.length, 0);
  assert.equal(input.value, '構成');

  await act(async () => {
    input.dispatchEvent(new window.Event('compositionend', { bubbles: true }));
  });
  await pressKey(input, 'Enter');
  assert.deepEqual(changes.at(-1), ['base', '構成']);
  assert.equal(input.value, '');
});
