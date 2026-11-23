import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LogConsole } from '../dist/components/log-console.js';

const SAMPLE_ENTRIES = [
  {
    id: 'log-1',
    timestamp: '2026-11-23T03:00:01.120Z',
    level: 'info',
    source: 'rust',
    message: 'Sidecar spawned on loopback port 41920',
  },
  {
    id: 'log-2',
    timestamp: '2026-11-23T03:00:02.450Z',
    level: 'warn',
    source: 'sidecar',
    message: 'Mesh peer heartbeat delayed',
    detail: 'peer=vps-sg-01 rttMs=1420',
  },
  {
    id: 'log-3',
    timestamp: '2026-11-23T03:00:03.900Z',
    level: 'error',
    source: 'webview',
    message: 'Unhandled rejection in board query',
    detail: 'TypeError: Cannot read properties of undefined',
  },
];

test('LogConsole renders controls, counts, and entries in compact mode', () => {
  const html = renderToStaticMarkup(
    React.createElement(LogConsole, {
      entries: SAMPLE_ENTRIES,
      onRefresh: () => {},
      onClear: () => {},
      onCopyForAi: () => {},
    })
  );

  assert.match(html, /data-slot="log-console"/u);
  assert.match(html, /data-display-mode="compact"/u);
  assert.match(html, /1 err/u);
  assert.match(html, /1 warn/u);
  assert.match(html, /Copy for AI/u);
  assert.match(html, /aria-label="Refresh logs"/u);
  assert.match(html, /aria-label="Clear logs"/u);
  assert.match(html, /aria-label="Search logs"/u);
  assert.match(html, /aria-label="Filter by log level"/u);
  assert.match(html, /aria-label="Filter by log source"/u);
  assert.match(html, /Sidecar spawned on loopback port 41920/u);
  assert.match(html, /Unhandled rejection in board query/u);
});

test('LogConsole filters by defaultLevel, defaultSource, and defaultSearch', () => {
  const html = renderToStaticMarkup(
    React.createElement(LogConsole, {
      entries: SAMPLE_ENTRIES,
      defaultLevel: 'error',
      defaultSource: 'webview',
      defaultSearch: 'rejection',
    })
  );

  assert.match(html, /Unhandled rejection in board query/u);
  assert.doesNotMatch(html, /Sidecar spawned on loopback port 41920/u);
  assert.doesNotMatch(html, /Mesh peer heartbeat delayed/u);
});

test('LogConsole supports terminal display mode and copied status state', () => {
  const html = renderToStaticMarkup(
    React.createElement(LogConsole, {
      entries: SAMPLE_ENTRIES,
      defaultDisplayMode: 'terminal',
      copyStatus: 'copied',
      onCopyForAi: () => {},
    })
  );

  assert.match(html, /data-display-mode="terminal"/u);
  assert.match(html, /Copied for AI/u);
  assert.match(html, /\[error\]/u);
  assert.match(html, /\[webview\]/u);
});
