import assert from 'node:assert/strict';
import { createElement } from 'react';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtworkFrame } from '../dist/components/artwork-frame.js';
import { EmptyState } from '../dist/components/empty-state.js';
import { MetricTile } from '../dist/components/metric-tile.js';
import { PageHeader } from '../dist/components/page-header.js';
import { Panel } from '../dist/components/panel.js';
import { PaperNote } from '../dist/components/paper-note.js';
import { SectionRibbon } from '../dist/components/section-ribbon.js';
import { StatusBar } from '../dist/components/status-bar.js';
import { SmartButtonBox } from '../dist/components/smart-button-box.js';
import { KanbanBoard } from '../dist/components/kanban-board.js';
import { FilterFacetBar } from '../dist/components/filter-facet-bar.js';
import { Table, TableBody, TableCell, TableRow } from '../dist/components/table.js';

test('compositions expose semantic, configurable visual treatments', () => {
  const markup = renderToStaticMarkup(
    createElement(
      'main',
      null,
      createElement(
        Panel,
        { title: 'Dashboard', surface: 'ink', frame: 'torn', density: 'compact', headingLevel: 3 },
        'Content'
      ),
      createElement(SectionRibbon, {
        title: 'Stories',
        number: '01',
        accent: 'cyan',
        surface: 'ink',
      }),
      createElement(PaperNote, { accent: 'yellow' }, 'Same moon, different people.'),
      createElement(
        ArtworkFrame,
        { shape: 'portrait', caption: 'Example artwork', 'aria-label': 'Example artwork' },
        createElement('img', { src: '/example.webp', alt: 'Illustration example' })
      ),
      createElement(MetricTile, {
        label: 'Active partners',
        value: '12',
        detail: 'Current records',
      })
    )
  );

  assert.match(markup, /data-surface="ink"/u);
  assert.match(markup, /data-frame="torn"/u);
  assert.match(markup, /data-density="compact"/u);
  assert.match(markup, /<h3/u);
  assert.match(markup, /Stories/u);
  assert.match(markup, /data-surface="ink"/u);
  assert.match(markup, /Same moon, different people\./u);
  assert.match(markup, /<figure[^>]*data-shape="portrait"/u);
  assert.match(markup, /<figcaption/u);
  assert.match(markup, /Active partners/u);
  assert.match(markup, /aria-label="Example artwork"/u);
});

test('PageHeader, Table, and EmptyState support treatment, density, and headingLevel', () => {
  const markup = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(PageHeader, {
        title: 'Story workbench',
        treatment: 'brush',
        headingLevel: 2,
      }),
      createElement(
        Table,
        { density: 'compact', scrollLabel: 'Compact sample table' },
        createElement(
          TableBody,
          null,
          createElement(TableRow, null, createElement(TableCell, null, 'Row 1'))
        )
      ),
      createElement(EmptyState, {
        title: 'Nothing here',
        headingLevel: 3,
      })
    )
  );

  assert.match(markup, /data-treatment="brush"/u);
  assert.match(markup, /<h2 class="mw-ui-page-header-title">Story workbench<\/h2>/u);
  assert.match(markup, /data-density="compact"/u);
  assert.match(markup, /<h3 class="mw-ui-empty-state-title">Nothing here<\/h3>/u);
});

test('PageHeader supports two-tone split brush and MetricTile/ArtworkFrame support torn and scuffed frames', () => {
  const markup = renderToStaticMarkup(
    createElement(
      'section',
      null,
      createElement(PageHeader, {
        title: 'Shadow',
        accentTitle: 'Command center',
        accent: 'yellow',
        treatment: 'brush',
      }),
      createElement(MetricTile, {
        label: 'Telemetry',
        value: '04',
        detail: 'Active workers',
        accent: 'violet',
        surface: 'paper',
        frame: 'torn',
      }),
      createElement(
        ArtworkFrame,
        { frame: 'scuffed', shape: 'square' },
        createElement('img', { src: '/sample.webp', alt: 'Sample' })
      )
    )
  );

  assert.match(markup, /class="mw-ui-page-header-title-accent"/u);
  assert.match(markup, /Command center/u);
  assert.match(markup, /data-accent="yellow"/u);
  assert.match(markup, /data-accent="violet"/u);
  assert.match(markup, /data-surface="paper"/u);
  assert.match(markup, /data-frame="torn"/u);
  assert.match(markup, /data-frame="scuffed"/u);
});

test('new compositions expose state, count, and keyboard-accessible semantics', () => {
  const markup = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(StatusBar, {
        steps: [
          { id: 'draft', label: 'Draft', state: 'active', count: 2 },
          { id: 'review', label: 'Review', state: 'disabled' },
        ],
      }),
      createElement(SmartButtonBox, {
        label: 'Approve',
        description: 'Runs validation',
        count: 3,
        pending: true,
        'aria-label': 'Approve 3 selected records',
      }),
      createElement(KanbanBoard, {
        columns: [
          { id: 'open', title: 'Open', count: 1, cards: [{ id: 'record-1', title: 'Record 1' }] },
          { id: 'done', title: 'Done', count: 0 },
        ],
      }),
      createElement(FilterFacetBar, {
        facets: [{ id: 'status', label: 'Status', value: 'Open' }],
        onFacetRemove: () => {},
      })
    )
  );

  assert.match(markup, /aria-current="step"/u);
  assert.match(markup, /aria-label="Approve 3 selected records"/u);
  assert.match(markup, /aria-busy="true"/u);
  assert.match(markup, /<h3[^>]*>Open<\/h3>/u);
  assert.match(markup, /aria-label="Open"/u);
  assert.match(markup, /<button[^>]*data-slot="kanban-card"/u);
  assert.match(markup, /aria-label="Remove Status: Open"/u);
});

test('Panel, MetricTile, and SectionRibbon support raw-art grunge frames', () => {
  const markup = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(Panel, { title: 'Mission Control', frame: 'grunge' }, 'Payload'),
      createElement(MetricTile, {
        label: 'Active Stories',
        value: '12',
        frame: 'grunge',
        accent: 'magenta',
      }),
      createElement(SectionRibbon, {
        title: 'Editorial Pipeline',
        number: '02',
        frame: 'grunge',
        accent: 'yellow',
      })
    )
  );

  assert.match(markup, /class="mw-ui-panel"[^>]*data-frame="grunge"/u);
  assert.match(markup, /class="mw-ui-metric-tile"[^>]*data-frame="grunge"/u);
  assert.match(markup, /class="mw-ui-section-ribbon"[^>]*data-frame="grunge"/u);
});
