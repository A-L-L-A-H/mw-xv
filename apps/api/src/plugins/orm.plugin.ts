import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Knex } from 'knex';
import {
  Environment,
  Registry,
  createServiceToken,
  type BaseModel,
  type ServiceContainer,
  type ServiceToken,
} from '@moonwitness/orm';
import { testConnection } from '../database/knex.js';

const environmentServiceToken: ServiceToken<Environment> = createServiceToken('api.environment');
const knexServiceToken: ServiceToken<Knex> = createServiceToken('api.knex');

declare module 'fastify' {
  interface FastifyInstance {
    knex: Knex;
    env: Environment;
    services: ServiceContainer;
    models: typeof Registry;
    db: Knex;
    testConnection: () => Promise<boolean>;
    routeList: { method: string; url: string }[];
  }

  interface FastifyRequest {
    env: Environment;
    getModel<T extends typeof BaseModel = typeof BaseModel>(name: string): T;
  }
}

const ormPlugin: FastifyPluginAsync<{ db: Knex }> = async (fastify, options) => {
  // Global decorations
  const globalEnv = new Environment();
  const globalServices = globalEnv.services;
  globalServices.register(knexServiceToken, options.db);
  globalServices.register(environmentServiceToken, globalEnv);
  fastify.decorate('knex', options.db);
  fastify.decorate('db', options.db);
  fastify.decorate('env', globalEnv);
  fastify.decorate('services', globalServices);
  fastify.decorate('models', Registry);

  // Request-scoped decorations
  fastify.decorateRequest('env', null as unknown as Environment);
  fastify.decorateRequest('getModel', function (this: FastifyRequest, name: string) {
    return this.env.get(name);
  });

  fastify.addHook('onRequest', async (request) => {
    // userId and role are added later by the auth plugin from the verified access token.
    const lang = (request.headers['accept-language'] || 'en').split(',')[0].trim();
    const activeTest = request.headers['x-active-test'] !== 'false';

    request.env = new Environment({ lang, activeTest }, undefined, globalServices);
  });

  fastify.decorate('testConnection', () => testConnection(options.db));
};

export default fp(ormPlugin, {
  name: 'fastify-enterprise-orm',
});
