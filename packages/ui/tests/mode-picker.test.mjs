import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModePicker } from '../dist/components/mode-picker.js';

test('ModePicker renders accessible dialog with Workspace and DX / Developer options', () => {
  const html = renderToStaticMarkup(
    React.createElement(ModePicker, {
      onSelect: () => {},
    })
  );

  assert.match(html, /role="dialog"/u);
  assert.match(html, /aria-modal="true"/u);
  assert.match(html, /data-slot="mode-picker"/u);
  assert.match(html, /Workspace/u);
  assert.match(html, /DX \/ Developer/u);
  assert.match(html, /Offline-first, zero technical clutter/u);
  assert.match(html, /Full AI Mission Control/u);
  assert.match(html, /data-mode-option="workspace"/u);
  assert.match(html, /data-mode-option="developer"/u);
});

test('ModePicker marks active currentMode and renders optional dismiss button', () => {
  const html = renderToStaticMarkup(
    React.createElement(ModePicker, {
      currentMode: 'workspace',
      onSelect: () => {},
      onDismiss: () => {},
    })
  );

  assert.match(html, /data-mode-option="workspace"[^>]*data-selected="true"/u);
  assert.match(html, /data-mode-option="developer"[^>]*data-selected="false"/u);
  assert.match(html, /Active: Workspace/u);
  assert.match(html, /aria-label="Close mode selector"/u);
});
