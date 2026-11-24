import { defineAddon, seed, ref } from '@moonwitness/orm';
import {
  ContentTemplate,
  ContentAsset,
  ContentCampaign,
  ContentPublishTarget,
  ContentPublication,
  ContentAnalytics,
} from './models/index.js';
import { views } from './views.js';
import { contentFactoryHttpPlugin } from './http-plugin.js';

export const manifest = defineAddon({
  name: 'content-factory',
  version: '1.0.0',
  depends: ['base'],
  models: [
    ContentTemplate,
    ContentAsset,
    ContentCampaign,
    ContentPublishTarget,
    ContentPublication,
    ContentAnalytics,
  ],
  httpPlugins: [contentFactoryHttpPlugin],
  data: [
    seed(ContentTemplate, 'content.template.article_default', {
      company: ref('base.company_default'),
      slug: 'article-default',
      name: 'Default Article',
      description: 'Standard long-form article template with intro, body sections, and conclusion.',
      kind: 'article',
      structure: {
        sections: [
          { title: '{{title}}', body: '{{intro}}' },
          { title: 'Analysis', body: '{{body}}' },
          { title: 'Conclusion', body: '{{conclusion}}' },
        ],
      },
      variables: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          intro: { type: 'string' },
          body: { type: 'string' },
          conclusion: { type: 'string' },
        },
        required: ['title', 'intro', 'body', 'conclusion'],
      },
      default_locale: 'en',
      supported_locales: ['en'],
      status: 'draft',
      version: '1.0.0',
    }),
    seed(ContentTemplate, 'content.template.social_post_default', {
      company: ref('base.company_default'),
      slug: 'social-post-default',
      name: 'Default Social Post',
      description: 'Short-form social media post with hook, value body, and call to action.',
      kind: 'social_post',
      structure: {
        sections: [
          { title: 'Hook', body: '{{hook}}' },
          { title: 'Value', body: '{{value}}' },
          { title: 'CTA', body: '{{call_to_action}}' },
        ],
      },
      variables: {
        type: 'object',
        properties: {
          hook: { type: 'string' },
          value: { type: 'string' },
          call_to_action: { type: 'string' },
        },
        required: ['hook', 'value'],
      },
      default_locale: 'en',
      supported_locales: ['en'],
      status: 'draft',
      version: '1.0.0',
    }),
    seed(ContentTemplate, 'content.template.newsletter_default', {
      company: ref('base.company_default'),
      slug: 'newsletter-default',
      name: 'Default Newsletter',
      description: 'Weekly newsletter template with headline, highlights list, and closing note.',
      kind: 'newsletter',
      structure: {
        sections: [
          { title: '{{headline}}', body: '{{opening_note}}' },
          { title: 'Highlights', body: '{{highlights}}' },
          { title: 'Closing', body: '{{closing_note}}' },
        ],
      },
      variables: {
        type: 'object',
        properties: {
          headline: { type: 'string' },
          opening_note: { type: 'string' },
          highlights: { type: 'string' },
          closing_note: { type: 'string' },
        },
        required: ['headline', 'highlights'],
      },
      default_locale: 'en',
      supported_locales: ['en'],
      status: 'draft',
      version: '1.0.0',
    }),
    seed(ContentTemplate, 'content.template.video_script_default', {
      company: ref('base.company_default'),
      slug: 'video-script-default',
      name: 'Default Video Script',
      description: 'Video script template with cold open, main content beats, and outro.',
      kind: 'video_script',
      structure: {
        sections: [
          { title: 'Cold Open', body: '{{cold_open}}' },
          { title: 'Main Content', body: '{{main_beats}}' },
          { title: 'Outro', body: '{{outro}}' },
        ],
      },
      variables: {
        type: 'object',
        properties: {
          cold_open: { type: 'string' },
          main_beats: { type: 'string' },
          outro: { type: 'string' },
        },
        required: ['main_beats'],
      },
      default_locale: 'en',
      supported_locales: ['en'],
      status: 'draft',
      version: '1.0.0',
    }),
  ],
  views,
  menus: [
    {
      model: ContentTemplate.modelName,
      label: 'Content Templates',
      group: 'Content Factory',
      sequence: 10,
    },
    {
      model: ContentAsset.modelName,
      label: 'Content Assets',
      group: 'Content Factory',
      sequence: 20,
    },
    {
      model: ContentCampaign.modelName,
      label: 'Campaigns',
      group: 'Content Factory',
      sequence: 30,
    },
    {
      model: ContentPublishTarget.modelName,
      label: 'Publish Targets',
      group: 'Content Factory',
      sequence: 40,
    },
    {
      model: ContentPublication.modelName,
      label: 'Publications',
      group: 'Content Factory',
      sequence: 50,
      developmentOnly: true,
    },
    {
      model: ContentAnalytics.modelName,
      label: 'Content Analytics',
      group: 'Content Factory',
      sequence: 60,
    },
  ],
});
