import { defineAddon } from '@moonwitness/orm';
import { a2aApiRoutes } from './http-plugin.js';

export const manifest = defineAddon({
  name: 'a2a',
  version: '1.0.0',
  depends: ['base', 'ai'],
  models: [],
  httpPlugins: [a2aApiRoutes],
});
