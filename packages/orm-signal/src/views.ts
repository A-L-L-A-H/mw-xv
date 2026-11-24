import { defineView } from '@moonwitness/orm';
import { SignalAlert, SignalObservation, SignalScore, SignalSource } from './models.js';

export const views = [
  defineView(SignalSource, {
    title: 'Signal Sources',
    list: {
      columns: ['code', 'name', 'kind', 'is_active', 'company'],
      order: 'code asc',
      decorations: [{ color: 'success', domain: [['is_active', '=', true]] }],
    },
    form: {
      sections: [
        { title: 'Source', columns: 2, fields: ['code', 'name', 'kind', 'is_active', 'company'] },
        { title: 'Adapter Config', fields: ['config'] },
      ],
    },
    search: {
      fields: ['code', 'name'],
      filters: [{ label: 'Active Only', domain: [['is_active', '=', true]] }],
      groupBy: [{ label: 'Kind', field: 'kind' }],
    },
    kanban: { groupBy: 'kind', cardTitle: 'name', cardFields: ['code', 'is_active'], badgeField: 'kind' },
  }),
  defineView(SignalObservation, {
    title: 'Signal Observations',
    list: {
      columns: ['title', 'source', 'published_at', 'content_hash', 'source_ref', 'url', 'company'],
      order: 'published_at desc, id desc',
    },
    form: {
      sections: [
        { title: 'Observation', columns: 2, fields: ['title', 'source', 'url', 'published_at', 'source_ref', 'company'] },
        { title: 'Content', fields: ['summary', 'tags', 'raw', 'content_hash'] },
      ],
    },
    search: {
      fields: ['title', 'summary', 'url', 'source_ref'],
      groupBy: [
        { label: 'Source', field: 'source_id' },
        { label: 'Company', field: 'company_id' },
      ],
    },
    kanban: { groupBy: 'source_id', cardTitle: 'title', cardFields: ['published_at', 'source_ref'], badgeField: 'source_ref' },
  }),
  defineView(SignalScore, {
    title: 'Signal Scores',
    list: {
      columns: ['observation', 'keyword_weight', 'recency_decay', 'source_authority', 'velocity', 'final_score', 'scored_at'],
      order: 'final_score desc, id desc',
      decorations: [
        { color: 'success', domain: [['final_score', '>=', 0.75]] },
        { color: 'warning', domain: [['final_score', '<', 0.5]] },
      ],
    },
    form: {
      sections: [
        {
          title: 'Score Breakdown',
          columns: 2,
          fields: ['observation', 'scored_at', 'keyword_weight', 'recency_decay', 'source_authority', 'velocity', 'final_score'],
        },
      ],
    },
    search: {
      fields: ['observation'],
      filters: [{ label: 'High Score (>=0.75)', domain: [['final_score', '>=', 0.75]] }],
    },
  }),
  defineView(SignalAlert, {
    title: 'Signal Alerts',
    list: {
      columns: ['observation', 'threshold', 'fired_at', 'status', 'score_ref'],
      order: 'fired_at desc, id desc',
      decorations: [
        { color: 'danger', domain: [['status', '=', 'open']] },
        { color: 'success', domain: [['status', '=', 'resolved']] },
      ],
    },
    form: {
      sections: [
        { title: 'Alert', columns: 2, fields: ['observation', 'status', 'threshold', 'fired_at', 'score_ref'] },
      ],
    },
    search: {
      fields: ['observation', 'score_ref'],
      filters: [{ label: 'Open Alerts', domain: [['status', '=', 'open']] }],
      groupBy: [{ label: 'Status', field: 'status' }],
    },
    kanban: { groupBy: 'status', cardTitle: 'observation', cardFields: ['threshold', 'fired_at'], badgeField: 'status' },
  }),
];
