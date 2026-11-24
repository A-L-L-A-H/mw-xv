/**
 * `@moonwitness/mcp-moonwitness` — read-only MoonWitness MCP server.
 *
 * STRICT CONSTRAINTS (enforced by scripts/check-addon-agent-boundary.mjs):
 * - No `defineModel` / `defineAddon` calls anywhere in this package.
 * - No INSERT / UPDATE / DELETE against the database.
 * - Every exposed tool is read-only, R0 risk tier, idempotent.
 */
export {
  MoonWitnessMcpServer,
  MOONWITNESS_MCP_TOOLS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  JSON_RPC_ERROR_CODES,
  type McpToolDescriptor,
  type MoonWitnessMcpContext,
  type MoonWitnessMcpRequest,
  type MoonWitnessMcpResponse,
} from './server.js';
export {
  serveMoonWitnessStdio,
  type MoonWitnessStdioHandle,
  type MoonWitnessStdioStreams,
} from './stdio.js';
export {
  listMoonWitnessModels,
  describeMoonWitnessModel,
  registerMoonWitnessManifest,
  type ModelCatalogEntry,
} from './catalog.js';
export { registerCatalogManifests } from './manifest-registry.js';
export {
  queryMoonWitnessModel,
  countMoonWitnessModel,
  redactRow,
  isForbiddenFieldName,
  type QueryOptions,
  type QueryResult,
} from './query.js';
export { summarizeTaskos, type TaskosSummary } from './taskos.js';
export { probeApiHealth, type ApiHealthOptions, type ApiHealthResult } from './health.js';
