/**
 * Hand-rolled stdio JSON-RPC 2.0 MCP server for MoonWitness (read-only).
 *
 * Zero external MCP dependencies: the protocol surface implemented here is
 * `initialize`, `ping`, `tools/list`, and `tools/call`, using the same
 * newline-delimited / Content-Length framing conventions as
 * `@moonwitness/ai-mcp` (`serveAiMcpStdio`).
 */
import { isRecord } from '@moonwitness/types';
import { listMoonWitnessModels, describeMoonWitnessModel } from './catalog.js';
import { queryMoonWitnessModel, countMoonWitnessModel } from './query.js';
import { summarizeTaskos } from './taskos.js';
import { probeApiHealth } from './health.js';

export const MCP_SERVER_NAME = '@moonwitness/mcp-moonwitness';
export const MCP_SERVER_VERSION = '1.0.0-rc.1';
const SUPPORTED_PROTOCOL_VERSION = '2025-03-26';

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly riskTier: 'R0';
  readonly readOnly: true;
  readonly idempotent: true;
  readonly requiredCapability: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  };
}

export const MOONWITNESS_MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: 'mw_list_models',
    description:
      'Enumerate every MoonWitness ORM model name with its owning addon, statically read from addon manifests registered in apps/api/src/addons/registry.ts. Read-only static enumeration.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'mw.catalog.read@v1',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mw_describe_model',
    description:
      'Read-only field listing for one MoonWitness model (names only, never values). Password/secret/token/hash fields are included as names because listing names leaks no data.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'mw.catalog.read@v1',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: "Dot-notation model name, e.g. 'base.user'" },
      },
      required: ['model'],
    },
  },
  {
    name: 'mw_query',
    description:
      'Read-only paged query over a registered MoonWitness model. Rows with password-kind fields or fields named /password|secret|token|hash/i are redacted before returning. Mutations are impossible by construction.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'mw.query.read@v1',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Dot-notation model name' },
        limit: { type: 'integer', description: 'Page size, 1-200 (default 50)' },
        offset: { type: 'integer', description: 'Row offset (default 0)' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional column subset; secret-named fields are always dropped',
        },
      },
      required: ['model'],
    },
  },
  {
    name: 'mw_count',
    description: 'Read-only row count for a registered MoonWitness model.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'mw.query.read@v1',
    inputSchema: {
      type: 'object',
      properties: { model: { type: 'string', description: 'Dot-notation model name' } },
      required: ['model'],
    },
  },
  {
    name: 'mw_taskos_summary',
    description:
      'Summarize docs/tasks/tasks.json (moonwitness-tasks/v2): counts by status, project, and priority.',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'mw.taskos.read@v1',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Optional override path to tasks.json' } },
    },
  },
  {
    name: 'mw_api_health',
    description:
      'Read-only HTTP GET health probe of the MoonWitness API (configurable base URL, default localhost).',
    riskTier: 'R0',
    readOnly: true,
    idempotent: true,
    requiredCapability: 'mw.health.probe@v1',
    inputSchema: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string', description: 'API base URL (default http://127.0.0.1:3000)' },
        timeoutMs: { type: 'integer', description: 'Probe timeout in ms (default 5000)' },
      },
    },
  },
];

export interface MoonWitnessMcpRequest {
  readonly jsonrpc?: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface MoonWitnessMcpResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export interface MoonWitnessMcpContext {
  readonly apiBaseUrl?: string;
  readonly taskosPath?: string;
}

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;

export class MoonWitnessMcpServer {
  constructor(private readonly context: MoonWitnessMcpContext = {}) {}

  async handleRequest(request: MoonWitnessMcpRequest): Promise<MoonWitnessMcpResponse> {
    const id = request.id ?? null;
    try {
      if (request.method === 'initialize') {
        const params = isRecord(request.params) ? request.params : {};
        const requested =
          typeof params.protocolVersion === 'string'
            ? params.protocolVersion
            : SUPPORTED_PROTOCOL_VERSION;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: requested,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          },
        };
      }

      if (request.method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }

      if (request.method === 'tools/list') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: MOONWITNESS_MCP_TOOLS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: {
                riskTier: tool.riskTier,
                readOnly: tool.readOnly,
                idempotent: tool.idempotent,
                requiredCapability: tool.requiredCapability,
              },
            })),
          },
        };
      }

      if (request.method === 'tools/call') {
        const params = isRecord(request.params) ? request.params : {};
        const toolName = typeof params.name === 'string' ? params.name : '';
        const args = isRecord(params.arguments) ? params.arguments : {};
        return await this.dispatchTool(id, toolName, args);
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `Unknown method: ${request.method}` },
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: JSON_RPC_INTERNAL_ERROR,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async dispatchTool(
    id: string | number | null,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MoonWitnessMcpResponse> {
    const text = (payload: unknown) => ({
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    });

    switch (toolName) {
      case 'mw_list_models': {
        return { jsonrpc: '2.0', id, result: text({ models: listMoonWitnessModels() }) };
      }
      case 'mw_describe_model': {
        const model = args['model'];
        if (typeof model !== 'string' || model.length === 0) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: JSON_RPC_INVALID_PARAMS, message: "Missing required argument: 'model'" },
          };
        }
        const description = describeMoonWitnessModel(model);
        if (!description) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: JSON_RPC_INVALID_PARAMS, message: `Unknown model: ${model}` },
          };
        }
        return { jsonrpc: '2.0', id, result: text(description) };
      }
      case 'mw_query': {
        const model = args['model'];
        if (typeof model !== 'string' || model.length === 0) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: JSON_RPC_INVALID_PARAMS, message: "Missing required argument: 'model'" },
          };
        }
        const fields = Array.isArray(args['fields'])
          ? (args['fields'] as unknown[]).filter(
              (field): field is string => typeof field === 'string'
            )
          : undefined;
        const outcome = await queryMoonWitnessModel(model, {
          limit: typeof args['limit'] === 'number' ? args['limit'] : undefined,
          offset: typeof args['offset'] === 'number' ? args['offset'] : undefined,
          fields,
        });
        return { jsonrpc: '2.0', id, result: text(outcome) };
      }
      case 'mw_count': {
        const model = args['model'];
        if (typeof model !== 'string' || model.length === 0) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: JSON_RPC_INVALID_PARAMS, message: "Missing required argument: 'model'" },
          };
        }
        const total = await countMoonWitnessModel(model);
        return { jsonrpc: '2.0', id, result: text({ model, total }) };
      }
      case 'mw_taskos_summary': {
        const overridePath =
          typeof args['path'] === 'string' ? args['path'] : this.context.taskosPath;
        return { jsonrpc: '2.0', id, result: text(await summarizeTaskos(overridePath)) };
      }
      case 'mw_api_health': {
        const outcome = await probeApiHealth({
          baseUrl: typeof args['baseUrl'] === 'string' ? args['baseUrl'] : this.context.apiBaseUrl,
          timeoutMs: typeof args['timeoutMs'] === 'number' ? args['timeoutMs'] : undefined,
        });
        return { jsonrpc: '2.0', id, result: text(outcome) };
      }
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `Unknown tool: ${toolName}` },
        };
    }
  }
}

export const JSON_RPC_ERROR_CODES = {
  parseError: JSON_RPC_PARSE_ERROR,
  invalidRequest: JSON_RPC_INVALID_REQUEST,
  methodNotFound: JSON_RPC_METHOD_NOT_FOUND,
  invalidParams: JSON_RPC_INVALID_PARAMS,
  internalError: JSON_RPC_INTERNAL_ERROR,
} as const;
