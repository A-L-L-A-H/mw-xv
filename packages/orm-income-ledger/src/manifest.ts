import { defineAddon, ref, seed } from '@moonwitness/orm';
import {
  IncomeStream,
  IncomeEntry,
  IncomeMetric,
  IncomeExperiment,
  IncomeAllocation,
} from './models.js';
import { incomeHttpPlugin } from './http-plugin.js';

export const manifest = defineAddon({
  name: 'income',
  version: '1.0.0',
  depends: ['base'],
  models: [IncomeStream, IncomeEntry, IncomeMetric, IncomeExperiment, IncomeAllocation],
  data: [
    seed(IncomeStream, 'income.stream_saas', {
      kind: 'saas',
      platform: 'subscription',
      status: 'idea',
      goal_monthly_minor: 500_000,
      currency: 'USD',
      company: ref('base.company_default'),
    }),
    seed(IncomeStream, 'income.stream_marketplace', {
      kind: 'marketplace',
      platform: 'marketplace',
      status: 'idea',
      goal_monthly_minor: 300_000,
      currency: 'USD',
      company: ref('base.company_default'),
    }),
    seed(IncomeStream, 'income.stream_ads_adsense', {
      kind: 'ads',
      platform: 'adsense',
      status: 'idea',
      goal_monthly_minor: 50_000,
      currency: 'USD',
      company: ref('base.company_default'),
    }),
    seed(IncomeStream, 'income.stream_ads_admob', {
      kind: 'ads',
      platform: 'admob',
      status: 'idea',
      goal_monthly_minor: 20_000,
      currency: 'USD',
      company: ref('base.company_default'),
    }),
    seed(IncomeStream, 'income.stream_affiliate', {
      kind: 'affiliate',
      platform: 'partnerstack',
      status: 'idea',
      goal_monthly_minor: 100_000,
      currency: 'USD',
      company: ref('base.company_default'),
    }),
    seed(IncomeStream, 'income.stream_content_royalty', {
      kind: 'content_royalty',
      platform: 'youtube',
      status: 'idea',
      goal_monthly_minor: 80_000,
      currency: 'USD',
      company: ref('base.company_default'),
    }),
    seed(IncomeStream, 'income.stream_donation', {
      kind: 'donation',
      platform: 'kofi',
      status: 'idea',
      goal_monthly_minor: 30_000,
      currency: 'USD',
      company: ref('base.company_default'),
    }),
    seed(IncomeStream, 'income.stream_other', {
      kind: 'other',
      status: 'idea',
      goal_monthly_minor: 0,
      currency: 'USD',
      company: ref('base.company_default'),
    }),
    seed(IncomeAllocation, 'income.allocation_reinvest', {
      stream: ref('income.stream_saas'),
      target: 'reinvest',
      percentage: 40,
      is_active: true,
    }),
  ],
  httpPlugins: [incomeHttpPlugin],
});
