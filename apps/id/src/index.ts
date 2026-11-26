export {
  buildApp,
  type BuildAppOptions,
  type IdentityAppConfig,
  type IdentityDatabase,
} from './app.js';

export {
  createIdentityServer,
  type IdentityServer,
  type IdentityServerOptions,
} from './server.js';

export const IDENTITY_SERVICE_NAME = '@moonwitness/id' as const;
