import type { FastifyPluginAsync } from 'fastify';

import {
  getBootstrapSetupState,
  type BootstrapStatePorts,
} from '../bootstrap/bootstrap-state.js';

export type BootstrapRoutesOptions = BootstrapStatePorts;

export const bootstrapRoutes: FastifyPluginAsync<BootstrapRoutesOptions> = async (
  fastify,
  options
) => {
  fastify.get('/setup-status', async (_request, reply) => {
    const state = await getBootstrapSetupState(options);
    return reply.header('Cache-Control', 'no-store').send(state);
  });
};
