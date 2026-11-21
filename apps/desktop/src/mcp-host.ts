import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateJsonSchema } from '@moonwitness/ai-runtime';
import {
  AccessDeniedError,
  NotFoundError,
  ValidationError,
  isJsonValue,
  type JsonObject,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonValue,
} from '@moonwitness/types';
import { DesktopRiskGate, isLoopbackEndpointUrl, redactSensitiveValue } from './risk-gate.js';
import type {
  DesktopActionKind,
  LocalMcpServerConfig,
  LocalMcpToolHandler,
  LocalMcpToolInvocationRequest,
  LocalMcpToolInvocationResult,
  RiskAuditRecord,
  RiskTier,
} from './types.js';

const SERVER_ID_REGEX = /^[a-z][a-z0-9._-]{1,63}$/u;
const TOOL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9._:-]{0,127}$/u;
const CAPABILITY_REGEX = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@v[1-9][0-9]*$/u;
const BARE_COMMAND_REGEX = /^[a-zA-Z0-9._-]+$/u;

const RISK_ORDER: Readonly<Record<RiskTier, number>> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_MCP_FRAME_BYTES = 1_048_576; // 1 MiB

export interface LocalMcpToolSchemaSpec {
  readonly inputSchema?: JsonObject;
  readonly outputSchema?: JsonObject;
}

export function encodeJsonRpcStdioFrame(
  payload: JsonRpcRequest | JsonRpcResponse<JsonValue>,
  maxFrameBytes = DEFAULT_MAX_MCP_FRAME_BYTES
): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length > maxFrameBytes) {
    throw new ValidationError(
      `JSON-RPC stdio frame exceeds maxFrameBytes (${body.length} > ${maxFrameBytes})`
    );
  }
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, body]);
}

export function decodeJsonRpcStdioFrame(
  raw: Buffer | string,
  maxFrameBytes = DEFAULT_MAX_MCP_FRAME_BYTES
): JsonRpcResponse<JsonValue> {
  const buf = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  if (buf.length > maxFrameBytes) {
    throw new ValidationError(
      `JSON-RPC stdio response exceeds maxFrameBytes (${buf.length} > ${maxFrameBytes})`
    );
  }
  const text = buf.toString('utf8');
  const headerMatch = /^Content-Length:\s*(\d+)\r?\n\r?\n/iu.exec(text);
  let jsonPayload: string;
  if (headerMatch) {
    const declaredLen = Number.parseInt(headerMatch[1] ?? '0', 10);
    if (declaredLen > maxFrameBytes) {
      throw new ValidationError(
        `JSON-RPC Content-Length (${declaredLen}) exceeds maxFrameBytes (${maxFrameBytes})`
      );
    }
    const headerBytes = Buffer.byteLength(headerMatch[0], 'utf8');
    jsonPayload = buf.subarray(headerBytes, headerBytes + declaredLen).toString('utf8');
  } else {
    jsonPayload = text.trim().split(/\r?\n/u).pop() ?? '';
  }
  return JSON.parse(jsonPayload) as JsonRpcResponse<JsonValue>;
}

/**
 * DSK-8.6: Wrap untrusted external MCP output in explicit prompt data-fencing markers
 * so downstream LLM prompts never treat external tool output as system/developer instructions.
 */
export function frameUntrustedMcpOutput(
  serverId: string,
  toolName: string,
  redactedValue: JsonValue
): string {
  const serialized = JSON.stringify(redactedValue ?? null);
  return [
    `<untrusted_mcp_output server="${serverId}" tool="${toolName}" trust="untrusted_external_data">`,
    serialized,
    `</untrusted_mcp_output>`,
  ].join('\n');
}

export interface LocalMcpHostOptions {
  readonly riskGate?: DesktopRiskGate;
  readonly knownSecrets?: readonly string[];
  readonly initialServers?: readonly LocalMcpServerConfig[];
  readonly maxFrameBytes?: number;
  readonly onAuditRecord?: (record: RiskAuditRecord) => void;
}

export class LocalMcpHostRegistry {
  private readonly servers = new Map<string, LocalMcpServerConfig>();
  private readonly handlers = new Map<string, LocalMcpToolHandler>();
  private readonly toolSchemas = new Map<string, LocalMcpToolSchemaSpec>();
  private readonly idempotencyCache = new Map<string, LocalMcpToolInvocationResult>();
  private readonly runQuotas = new Map<string, number>();
  private readonly riskGate: DesktopRiskGate;
  private readonly knownSecrets: readonly string[];
  private readonly maxFrameBytes: number;
  private readonly onAuditRecord?: (record: RiskAuditRecord) => void;

  constructor(options?: LocalMcpHostOptions) {
    this.riskGate = options?.riskGate ?? new DesktopRiskGate();
    this.knownSecrets = options?.knownSecrets ?? [];
    this.maxFrameBytes = Math.max(1024, options?.maxFrameBytes ?? DEFAULT_MAX_MCP_FRAME_BYTES);
    this.onAuditRecord = options?.onAuditRecord;
    for (const server of options?.initialServers ?? []) {
      this.registerServer(server);
    }
  }

  registerServer(config: LocalMcpServerConfig): LocalMcpServerConfig {
    if (!SERVER_ID_REGEX.test(config.serverId)) {
      throw new ValidationError(`Invalid MCP serverId '${config.serverId}'`);
    }
    if (!config.name.trim()) {
      throw new ValidationError(`MCP server '${config.serverId}' must define a name`);
    }
    if (!CAPABILITY_REGEX.test(config.requiredCapability)) {
      throw new ValidationError(
        `Invalid requiredCapability '${config.requiredCapability}' on MCP server '${config.serverId}'`
      );
    }
    if (!Number.isSafeInteger(config.maxCallsPerRun) || config.maxCallsPerRun < 1) {
      throw new ValidationError(`MCP server '${config.serverId}' maxCallsPerRun must be >= 1`);
    }
    if (config.maxRiskTier === 'R4') {
      throw new AccessDeniedError('MCP server cannot be configured with prohibited risk tier R4');
    }

    if (config.transport === 'stdio') {
      if (!config.command || !BARE_COMMAND_REGEX.test(config.command)) {
        throw new ValidationError(
          `MCP stdio server '${config.serverId}' requires a bare command executable`
        );
      }
      for (const arg of config.args ?? []) {
        if (arg.includes('\0')) {
          throw new ValidationError(`MCP server '${config.serverId}' arg contains NUL byte`);
        }
      }
    } else if (config.transport === 'loopback_http') {
      if (!config.endpointUrl || !isLoopbackEndpointUrl(config.endpointUrl)) {
        throw new AccessDeniedError(
          `MCP loopback_http server '${config.serverId}' endpointUrl must target loopback (127.0.0.1/localhost/::1)`
        );
      }
    } else {
      throw new ValidationError(`Unsupported MCP transport on server '${config.serverId}'`);
    }

    const frozen: LocalMcpServerConfig = Object.freeze({
      ...config,
      ...(config.args ? { args: [...config.args] } : {}),
      allowedDataClassifications: [...config.allowedDataClassifications],
    });
    this.servers.set(config.serverId, frozen);
    return frozen;
  }

  registerHandler(serverId: string, handler: LocalMcpToolHandler): void {
    if (!this.servers.has(serverId)) {
      throw new NotFoundError(`MCP server '${serverId}' is not registered`);
    }
    this.handlers.set(serverId, handler);
  }

  registerToolSchemas(serverId: string, toolName: string, spec: LocalMcpToolSchemaSpec): void {
    if (!this.servers.has(serverId)) {
      throw new NotFoundError(`MCP server '${serverId}' is not registered`);
    }
    this.toolSchemas.set(`${serverId}::${toolName}`, spec);
  }

  listServers(): readonly LocalMcpServerConfig[] {
    return [...this.servers.values()];
  }

  async invoke(request: LocalMcpToolInvocationRequest): Promise<LocalMcpToolInvocationResult> {
    const server = this.servers.get(request.serverId);
    if (!server) {
      throw new NotFoundError(`MCP server '${request.serverId}' not found`);
    }
    if (!server.enabled) {
      throw new AccessDeniedError(`MCP server '${request.serverId}' is disabled`);
    }
    if (!TOOL_NAME_REGEX.test(request.toolName)) {
      throw new ValidationError(`Invalid MCP toolName '${request.toolName}'`);
    }
    if (!isJsonValue(request.arguments)) {
      throw new ValidationError('MCP tool arguments must be valid JSON');
    }

    const schemaSpec = this.toolSchemas.get(`${server.serverId}::${request.toolName}`);
    if (schemaSpec?.inputSchema) {
      const validation = validateJsonSchema(schemaSpec.inputSchema, request.arguments);
      if (!validation.valid) {
        throw new ValidationError(
          `MCP tool '${request.toolName}' input schema validation failed: ${validation.errors.join('; ')}`
        );
      }
    }

    if (!server.allowedDataClassifications.includes(request.auth.dataClassification)) {
      throw new AccessDeniedError(
        `MCP server '${server.serverId}' does not allow data classification '${request.auth.dataClassification}'`
      );
    }
    if (request.auth.grant.capability !== server.requiredCapability) {
      throw new AccessDeniedError(
        `Grant capability '${request.auth.grant.capability}' does not match server requirement '${server.requiredCapability}'`
      );
    }

    // DSK-8.7: Idempotency deduplication for repeated R2/R3 tool calls with the same key.
    const idempotencyCacheKey = request.idempotencyKey
      ? `${request.runId}::${server.serverId}::${request.toolName}::${request.idempotencyKey}`
      : null;
    if (idempotencyCacheKey) {
      const cached = this.idempotencyCache.get(idempotencyCacheKey);
      if (cached) {
        return { ...cached, deduplicated: true };
      }
    }

    const action: DesktopActionKind =
      server.maxRiskTier === 'R3'
        ? 'upstream.sync_push'
        : RISK_ORDER[server.maxRiskTier] >= RISK_ORDER.R1
          ? 'mcp.local_write'
          : 'mcp.read';

    const decision = this.riskGate.assertAllowed({
      runId: request.runId,
      action,
      companyId: request.auth.companyId,
      agentId: request.auth.agentId,
      workContractId: request.auth.workContractId,
      expectedPolicyVersion: request.auth.expectedPolicyVersion,
      dataClassification: request.auth.dataClassification,
      grant: request.auth.grant,
      humanApproval: request.auth.humanApproval,
      targetEndpointUrl: server.endpointUrl,
    });
    this.onAuditRecord?.(decision.auditEntry);

    const quotaKey = `${request.runId}::${server.serverId}`;
    const usedCalls = this.runQuotas.get(quotaKey) ?? 0;
    if (usedCalls >= server.maxCallsPerRun) {
      throw new AccessDeniedError(
        `MCP server '${server.serverId}' quota exceeded for run '${request.runId}' (${server.maxCallsPerRun})`
      );
    }
    this.runQuotas.set(quotaKey, usedCalls + 1);
    const callCountForRun = usedCalls + 1;

    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(100, server.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      const handler = this.handlers.get(server.serverId);
      const rawOutput = handler
        ? await this.runWithTimeout(
            handler(request.toolName, request.arguments, controller.signal),
            timeoutMs,
            server.serverId
          )
        : server.transport === 'stdio'
          ? await this.invokeStdioJsonRpc(server, request, timeoutMs)
          : await this.invokeLoopbackHttp(server, request, controller.signal);

      if (schemaSpec?.outputSchema) {
        const outValidation = validateJsonSchema(schemaSpec.outputSchema, rawOutput);
        if (!outValidation.valid) {
          throw new ValidationError(
            `MCP tool '${request.toolName}' output schema validation failed: ${outValidation.errors.join('; ')}`
          );
        }
      }

      const redactedResult = redactSensitiveValue(rawOutput, this.knownSecrets);
      const serialized = JSON.stringify(redactedResult.value ?? null);
      const outputSha256 = createHash('sha256').update(serialized).digest('hex');
      const framedPromptContext = frameUntrustedMcpOutput(
        server.serverId,
        request.toolName,
        redactedResult.value
      );

      const result: LocalMcpToolInvocationResult = {
        serverId: server.serverId,
        toolName: request.toolName,
        output: redactedResult.value,
        outputSha256,
        redacted: redactedResult.redacted,
        callCountForRun,
        durationMs: Math.max(0, Date.now() - startTime),
        deduplicated: false,
        framedPromptContext,
      };

      if (idempotencyCacheKey) {
        this.idempotencyCache.set(idempotencyCacheKey, result);
      }

      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    serverId: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new ValidationError(`MCP server '${serverId}' timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async invokeLoopbackHttp(
    server: LocalMcpServerConfig,
    request: LocalMcpToolInvocationRequest,
    signal: AbortSignal
  ): Promise<JsonValue> {
    if (!server.endpointUrl || !isLoopbackEndpointUrl(server.endpointUrl)) {
      throw new AccessDeniedError('Non-loopback MCP HTTP endpoint blocked');
    }
    const rpcPayload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `${request.runId}:${request.toolName}`,
      method: 'tools/call',
      params: {
        name: request.toolName,
        arguments: request.arguments,
      },
    };
    const response = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpcPayload),
      signal,
    });
    if (!response.ok) {
      throw new ValidationError(
        `MCP loopback HTTP server '${server.serverId}' returned status ${response.status}`
      );
    }
    const decoded = (await response.json()) as JsonRpcResponse<JsonValue>;
    if (decoded.error) {
      throw new ValidationError(`MCP tool error (${decoded.error.code}): ${decoded.error.message}`);
    }
    return decoded.result ?? null;
  }

  private async invokeStdioJsonRpc(
    server: LocalMcpServerConfig,
    request: LocalMcpToolInvocationRequest,
    timeoutMs: number
  ): Promise<JsonValue> {
    if (!server.command) {
      throw new ValidationError(`MCP stdio server '${server.serverId}' has no command`);
    }
    const executable = server.command === 'node' ? process.execPath : server.command;
    const rpcPayload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: `${request.runId}:${request.toolName}`,
      method: 'tools/call',
      params: {
        name: request.toolName,
        arguments: request.arguments,
      },
    };

    return await new Promise<JsonValue>((resolve, reject) => {
      const child = spawn(executable, [...(server.args ?? [])], {
        shell: false,
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
        },
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill();
          reject(new ValidationError(`MCP stdio server '${server.serverId}' timed out`));
        }
      }, timeoutMs);

      let totalStdoutBytes = 0;
      child.stdout.on('data', (chunk: Buffer) => {
        totalStdoutBytes += chunk.length;
        if (totalStdoutBytes > this.maxFrameBytes) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            child.kill();
            reject(
              new ValidationError(
                `MCP stdio server '${server.serverId}' response exceeded maxFrameBytes (${this.maxFrameBytes})`
              )
            );
          }
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const stderrText = Buffer.concat(stderrChunks).toString('utf8');
          reject(
            new ValidationError(
              `MCP stdio server '${server.serverId}' exited with code ${String(code)}: ${stderrText}`
            )
          );
          return;
        }
        try {
          const parsed = decodeJsonRpcStdioFrame(Buffer.concat(stdoutChunks), this.maxFrameBytes);
          if (parsed.error) {
            reject(
              new ValidationError(`MCP tool error (${parsed.error.code}): ${parsed.error.message}`)
            );
            return;
          }
          resolve(parsed.result ?? null);
        } catch (error) {
          reject(
            new ValidationError(`MCP stdio server '${server.serverId}' returned invalid JSON-RPC`, {
              cause: error,
            })
          );
        }
      });

      child.stdin.write(`${JSON.stringify(rpcPayload)}\n`);
      child.stdin.end();
    });
  }
}
