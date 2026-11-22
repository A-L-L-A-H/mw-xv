import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatePicker } from '../dist/components/date-picker.js';
import { NumberInput } from '../dist/components/number-input.js';
import { TagInput } from '../dist/components/tag-input.js';

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
