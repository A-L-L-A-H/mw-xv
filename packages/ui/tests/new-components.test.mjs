import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorState } from '../dist/components/error-state.js';
import { Breadcrumbs } from '../dist/components/breadcrumbs.js';
import { BrandMark } from '../dist/components/brand-mark.js';
import { EmptyState } from '../dist/components/empty-state.js';
import { Pagination } from '../dist/components/pagination.js';
import { SectionRibbon } from '../dist/components/section-ribbon.js';
import { Panel } from '../dist/components/panel.js';
import { MetricTile } from '../dist/components/metric-tile.js';
import { PageHeader } from '../dist/components/page-header.js';
import { Select, SelectTrigger, SelectValue } from '../dist/components/select.js';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('new component subpaths are exported in package.json', () => {
  for (const subpath of [
    './components/confirm-dialog',
    './components/error-state',
    './components/breadcrumbs',
    './components/brand-mark',
    './components/inbox-popover',
  ]) {
    assert.ok(packageJson.exports[subpath], `Missing package export for ${subpath}`);
  }
});

test('ErrorState, Breadcrumbs, BrandMark, EmptyState illustration, Pagination trailing, and CX-018 variants render cleanly', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ErrorState, {
        code: '404',
        title: 'Signal missing',
        description: 'Page not found.',
        stateSlug: 'not-found',
        basePath: '/app',
        onRetry: () => {},
        retrying: true,
        secondaryAction: React.createElement('a', { href: '/' }, 'Go home'),
      }),
      React.createElement(Breadcrumbs, {
        items: [
          { label: 'Board', href: '/board' },
          { label: 'Projects', current: true },
        ],
      }),
      React.createElement(BrandMark, {
        variant: 'symbol',
        tone: 'light',
        basePath: '/app',
      }),
      React.createElement(EmptyState, {
        title: 'No search results',
        illustration: 'no-search-results',
        basePath: '/app',
      }),
      React.createElement(Pagination, {
        page: 2,
        pageCount: 5,
        onPageChange: () => {},
        trailing: React.createElement('span', null, '25 per page'),
      }),
      React.createElement(SectionRibbon, {
        title: 'Compact Ribbon',
        size: 'sm',
        treatment: 'brush',
      }),
      React.createElement(
        Panel,
        {
          title: 'Micro Panel',
          density: 'micro',
          contentClassName: 'custom-panel-body',
        },
        'Body'
      ),
      React.createElement(MetricTile, {
        label: 'Hero KPI',
        value: '42',
        accent: 'magenta',
        size: 'hero',
        interactive: true,
      }),
      React.createElement(PageHeader, {
        title: 'Catalog Hero',
        scale: 'hero',
      }),
      React.createElement(
        Select,
        null,
        React.createElement(
          SelectTrigger,
          { fullWidth: true },
          React.createElement(SelectValue, { placeholder: 'Pick' })
        )
      )
    )
  );

  assert.match(html, /role="alert"[^>]*data-slot="error-state"/u);
  assert.match(html, /\/app\/illustrations\/riot-universe\/states\/state-not-found\.webp/u);
  assert.match(html, /aria-busy="true"/u);
  assert.match(html, /Go home/u);

  assert.match(html, /data-slot="breadcrumbs"/u);
  assert.match(html, /href="\/board"/u);
  assert.match(html, /aria-current="page">Projects</u);

  assert.match(html, /data-slot="brand-mark"[^>]*data-variant="symbol"[^>]*data-tone="light"/u);
  assert.match(html, /\/app\/brand\/moonwitness-symbol-light\.svg/u);

  assert.match(html, /mw-ui-empty-state-illustration/u);
  assert.match(html, /\/app\/illustrations\/riot-universe\/states\/state-no-search-results\.webp/u);

  assert.match(html, /mw-ui-pagination-trailing/u);
  assert.match(html, /25 per page/u);

  assert.match(html, /data-size="sm"[^>]*data-treatment="brush"/u);
  assert.match(html, /data-density="micro"/u);
  assert.match(html, /mw-ui-panel-content custom-panel-body/u);
  assert.match(html, /data-interactive="true" data-size="hero"/u);
  assert.match(html, /data-scale="hero"/u);
  assert.match(html, /data-full-width="true"/u);
});
